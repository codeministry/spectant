// The guidance of a workspace (spec 020, ISC-237): what waits on the principal and what is next, each entry with its
// spec, command, reason and since, derived from the item-state model of ISC-221 (`itemStates`) and the files.
//
//   - waits: every `open` item whose next step lies with the principal: a spec's own item in a principal stage
//     (`PRINCIPAL_STAGES`: review, code-review, close), and what the spec page lists as waiting on you: an open claim
//     with a `manual` probe, an open task in lane `operator`, a `question` task of the newest rounds.jsonl line. The
//     latter three are `waitingOnYouOf`, the one derivation the spec page (spec.ts) reads too.
//   - next: every other spec item in state `open`, one entry per spec (its claims and tasks share its command).
//   Ideas, the two marks and every item in `waiting`, `running`, `aborted` or `done` are in neither list.
//
// Both lists sort by priority (P1 first, a missing key reads P3 as everywhere in core), then since (oldest first, null
// last), then spec id, item kind (spec, claim, task, question) and ref in natural order (ISC-2 before ISC-10).
//
// Each entry's reason is a stable key with its values, so the web renders one sentence per key in its own catalogs:
// `stage.<stage>.<i>` for a spec (the template `matchReason` finds in the stage table), `waiting.<kind>` for the
// others. `GUIDANCE_REASONS` lists every key, generated from the stage table, never kept by hand.
//
// Pure and browser-safe: text and models in, model out. No file system, no Bun or Node API, no clock.
import { parseClaims } from './claims.ts';
import type { DashboardInput, DashboardModel, DashboardSpecRow } from './dashboard.ts';
import { parseEvents } from './events.ts';
import type { Guidance, GuidanceEntry, GuidanceItem, GuidanceReason, ItemStateInfo, SpecFiles, WaitingItem } from './files.ts';
import { GUIDANCE_REASONS, WAITING_TEMPLATES } from './guidance-reasons.ts';
import { fillsTemplate, matchReason, PRINCIPAL_STAGES } from './stage.ts';
import type { Stage } from './stage.ts';
import { parseTaskLines } from './tasks.ts';

/** What `guidanceOf` reads: the workspace as read, its dashboard, and `itemStates` over both at the caller's clock. */
export interface GuidanceInput {
  readonly workspace: DashboardInput;
  readonly dashboard: DashboardModel;
  readonly items: readonly ItemStateInfo[];
}

const OPERATOR = 'operator';

// ── what waits on you, from a spec folder's texts (shared with spec.ts) ─────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Each non-blank line parsed as a JSON object; lines that are not are skipped (the dashboard reports them). */
function jsonLines(text: string | undefined): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const raw of (text ?? '').split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    try {
      const value: unknown = JSON.parse(raw);
      if (isRecord(value)) out.push(value);
    } catch {
      // not JSON: skipped
    }
  }
  return out;
}

/** The rounds.jsonl line with the highest `round` number (the later line on a tie); null without one. */
export function newestRoundLine(text: string | undefined): Record<string, unknown> | null {
  let newest: Record<string, unknown> | null = null;
  for (const line of jsonLines(text)) {
    if (typeof line.round !== 'number') continue;
    if (newest === null || line.round >= (newest.round as number)) newest = line;
  }
  return newest;
}

function questionsOf(round: Record<string, unknown> | null): WaitingItem[] {
  const tasks = round !== null && Array.isArray(round.tasks) ? (round.tasks as unknown[]).filter(isRecord) : [];
  return tasks
    .filter((t) => t.state === 'question' && typeof t.id === 'string')
    .map((t) => {
      const note = typeof t.note === 'string' ? t.note.replace(/^question:\s*/i, '').trim() : '';
      const text = typeof t.text === 'string' ? t.text : '';
      return { kind: 'question', ref: t.id as string, title: note !== '' ? note : text };
    });
}

/**
 * What of one spec folder waits on the principal, in this order: open operator tasks (struck bullets carry no box),
 * open claims (not checked, not dropped) whose Test Strategy row has type `manual`, then the newest round's questions.
 * The spec page's `waitingOnYou` and the guidance's claim, task and question entries are this one list.
 */
export function waitingOnYouOf(texts: SpecFiles['texts']): WaitingItem[] {
  const doc = parseClaims(texts.spec ?? '');
  const manual = new Set(doc.testStrategy.filter((r) => r.type.trim().toLowerCase() === 'manual').map((r) => r.isc));
  return [
    ...parseTaskLines({ tasks: texts.tasks ?? '' })
      .tasks.filter((t) => t.state !== 'struck' && t.state !== 'done' && t.lane === OPERATOR)
      .map((t): WaitingItem => ({ kind: 'operator', ref: t.id, title: t.text, checked: false })),
    ...doc.claims
      .filter((c) => !c.checked && !c.dropped && manual.has(c.id))
      .map((c): WaitingItem => ({ kind: 'manual', ref: c.id, title: c.text })),
    ...questionsOf(newestRoundLine(texts.rounds)),
  ];
}

// ── the reasons (T8; the key list lives in guidance-reasons.ts) ──────────────────────────────────────────────────────

export { GUIDANCE_REASON_KEYS, GUIDANCE_REASONS, WAITING_TEMPLATES } from './guidance-reasons.ts';
export type { GuidanceReasonTemplate } from './guidance-reasons.ts';

const fill = (template: string, values: Readonly<Record<string, string>>): string =>
  template.replace(/\{([a-zA-Z]+)\}/g, (placeholder, name: string) => values[name] ?? placeholder);

/** A spec entry's reason: the stage template its phrase fills, else the fallback key `phrase` with no values. */
function specReason(stage: string, phrase: string): GuidanceReason {
  const match = matchReason(stage as Stage, phrase);
  const key = GUIDANCE_REASONS.find((r) => r.key.startsWith(`stage.${stage}.`) && fillsTemplate(r.template, phrase))?.key;
  return match === null || key === undefined ? { key: 'phrase', values: {}, phrase } : { key, values: match.values, phrase };
}

function waitingReason(kind: WaitingItem['kind'], ref: string): GuidanceReason {
  const values = { ref };
  return { key: `waiting.${kind}`, values, phrase: fill(WAITING_TEMPLATES[kind], values) };
}

// ── the order ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ITEM_ORDER: Readonly<Record<GuidanceItem, number>> = { spec: 0, claim: 1, task: 2, question: 3 };

const priorityRank = (p: string): number => Number(/\d/.exec(p)?.[0] ?? 3);

function sinceRank(since: string | null): number {
  if (since === null) return Number.POSITIVE_INFINITY;
  const t = Date.parse(since);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

const natural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

function compareEntries(a: GuidanceEntry, b: GuidanceEntry): number {
  return (
    priorityRank(a.priority) - priorityRank(b.priority) ||
    // Both undated: equal; `Infinity - Infinity` is NaN, which `||` passes over.
    (sinceRank(a.since) === sinceRank(b.since) ? 0 : sinceRank(a.since) < sinceRank(b.since) ? -1 : 1) ||
    natural(a.spec, b.spec) ||
    ITEM_ORDER[a.item] - ITEM_ORDER[b.item] ||
    natural(a.ref ?? '', b.ref ?? '')
  );
}

// ── the guidance ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Since when a spec waits in `stage`: the newest valid events.jsonl line into it, else frontmatter `updated:`. */
function specSince(files: SpecFiles | undefined, stage: string, updated: string | null): string | null {
  const into = files?.texts.events === undefined ? [] : parseEvents(files.texts.events).events.filter((e) => e.to === stage);
  return into[into.length - 1]?.ts ?? updated;
}

/** The workspace guidance (ISC-237): `waits` and `next`, each sorted as the header says. */
export function guidanceOf(input: GuidanceInput): Guidance {
  const folders = new Map(input.workspace.specs.map((f) => [f.folder, f]));
  const rows = new Map<string, DashboardSpecRow>(input.dashboard.specs.map((r) => [r.id, r]));
  const itemOf = (kind: string, spec: string, id: string): ItemStateInfo | undefined =>
    input.items.find((i) => i.kind === kind && (kind === 'spec' ? i.id === spec : i.spec === spec && i.id === id));

  const waits: GuidanceEntry[] = [];
  const next: GuidanceEntry[] = [];

  for (const specItem of input.items) {
    if (specItem.kind !== 'spec') continue;
    const row = rows.get(specItem.id);
    if (row === undefined) continue;
    const files = folders.get(row.slug);
    const stage = specItem.stage ?? row.stage;
    const since = specSince(files, stage, row.updated);
    const base = { spec: row.id, priority: row.priority };

    if (specItem.state === 'open') {
      const phrase = specItem.reason ?? '';
      const entry: GuidanceEntry = {
        ...base,
        item: 'spec',
        ref: null,
        title: row.title,
        command: specItem.command ?? null,
        since,
        reason: specReason(stage, phrase),
      };
      ((PRINCIPAL_STAGES as readonly string[]).includes(stage) ? waits : next).push(entry);
    }

    if (files === undefined) continue;
    const roundTs = newestRoundLine(files.texts.rounds)?.ts;
    for (const w of waitingOnYouOf(files.texts)) {
      if (w.kind === 'question') {
        // A question waits while its spec is not done and its task, where the state model knows it, is open.
        const task = itemOf('task', row.id, w.ref);
        if (specItem.state === 'done' || (task !== undefined && task.state !== 'open')) continue;
        waits.push({
          ...base,
          item: 'question',
          ref: w.ref,
          title: w.title,
          command: specItem.state === 'open' ? (specItem.command ?? null) : null,
          since: typeof roundTs === 'string' ? roundTs : null,
          reason: waitingReason('question', w.ref),
        });
        continue;
      }
      const kind = w.kind === 'manual' ? 'claim' : 'task';
      const item = itemOf(kind, row.id, w.ref);
      if (item?.state !== 'open') continue;
      waits.push({ ...base, item: kind, ref: w.ref, title: w.title, command: item.command ?? null, since, reason: waitingReason(w.kind, w.ref) });
    }
  }

  return { waits: waits.sort(compareEntries), next: next.sort(compareEntries) };
}

/** `model` with its guidance set; every other field kept. */
export function withGuidance<M extends object>(model: M, guidance: Guidance): M & { readonly guidance: Guidance } {
  return { ...model, guidance };
}

/** The entries of one spec, both lists in their order: the spec page's slice of the workspace guidance. */
export function guidanceOfSpec(guidance: Guidance, specId: string): Guidance {
  return { waits: guidance.waits.filter((e) => e.spec === specId), next: guidance.next.filter((e) => e.spec === specId) };
}
