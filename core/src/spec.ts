// The spec page model (T12, ISC-78): what `/w/:ws/s/:id` shows above the fold. Head, key numbers, the idea quote,
// the next step with its reasons, one bar per lane, the four gates, the warnings, what waits on the principal, the
// area tiles and this spec's slice of the TL;DR.
//
// One source for every shared counter (ISC-72): stage, progress, tasks, next command and reason, takeable claims,
// warnings and gates are the dashboard row of the same spec, built by `buildDashboard` itself over this one folder
// (its siblings passed as archived, which feeds drift's "held elsewhere" exactly as the workspace dashboard does).
// Nothing the row holds is recounted here, so the page and the row cannot disagree.
//
// What the row does not hold is read here, small and local:
//   - the task lines' checkbox, id, lane token and text, from tasks.ts's `parseTaskLines` (T23); struck bullets carry
//     no box, so the lanes count exactly the boxes archive.ts counts;
//   - the constitution's `## Lanes` table, first column, for the lane order;
//   - the newest rounds.jsonl line's `question` tasks, and its `stop`;
//   - events.jsonl's newest line into the current stage, for since/via. INTERIM until T16 lands `events.ts`.
// Round count, decisions and the Status tile's entry count come from timeline.ts.
//
// Pure: text in, model out. No file system, no Bun API, no clock; deterministic over its input.
import { goalOf } from './archive.ts';
import { parseClaims } from './claims.ts';
import { buildDashboard } from './dashboard.ts';
import type { DashboardSpecRow } from './dashboard.ts';
import type {
  ClaimLock,
  IdeaSource,
  KeyNumbers,
  LaneProgress,
  SpecAreas,
  SpecHead,
  SpecNextStep,
  SpecPageInput,
  SpecPageModel,
  SpecTldr,
  WaitingItem,
} from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { parseTaskLines } from './tasks.ts';
import { buildTimeline } from './timeline.ts';
import { parseTldr, tldrState } from './tldr.ts';

const OPERATOR = 'operator';
/** A task line whose lane token cannot be read (no ` — `, or no segment before it besides the id and claim). */
const UNKNOWN_LANE = 'unknown';
/** Stages the stage table reaches only past its review row, so the reviewed mark is fresh there. */
const PAST_REVIEW: ReadonlySet<string> = new Set(['build', 'code-review', 'close', 'blocked']);
const MAX_REASONS = 3;

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

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

// ── tasks.md (tasks.ts) ───────────────────────────────────────────────────────────────────────────────────────────

interface TaskBox {
  readonly id: string;
  readonly landed: boolean;
  readonly lane: string;
  readonly title: string;
}

/** The checkbox task lines of tasks.ts's grammar (struck bullets have no box): the same boxes archive.ts counts. */
function taskBoxes(text: string | undefined): TaskBox[] {
  return parseTaskLines({ tasks: text ?? '' })
    .tasks.filter((t) => t.state !== 'struck')
    .map((t) => ({ id: t.id, landed: t.state === 'done', lane: t.lane === '' ? UNKNOWN_LANE : t.lane, title: t.text }));
}

/** The first column of the constitution's `## Lanes` table, in table order. */
function constitutionLanes(text: string | undefined): string[] {
  const section = /^## Lanes\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec((text ?? '').replace(/\r\n?/g, '\n'))?.[1] ?? '';
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|'));
  return rows
    .slice(1) // the header row
    .filter((row) => !/^\|?[\s:|-]+$/.test(row.trim()))
    .map((row) => (row.trim().replace(/^\|/, '').split('|')[0] ?? '').trim().replace(/`/g, ''))
    .filter((name) => name !== '');
}

/** Constitution lanes in order, then lanes only tasks.md names (first seen), `operator` last; empty without tasks.md. */
function lanesOf(tasks: string | undefined, constitution: string | undefined): LaneProgress[] {
  if (tasks === undefined) return [];
  const boxes = taskBoxes(tasks);
  const order = constitutionLanes(constitution).filter((l) => l !== OPERATOR);
  for (const box of boxes) if (box.lane !== OPERATOR && !order.includes(box.lane)) order.push(box.lane);
  order.push(OPERATOR);
  return [...new Set(order)].map((name) => {
    const own = boxes.filter((b) => b.lane === name);
    return { name, landed: own.filter((b) => b.landed).length, total: own.length };
  });
}

// ── rounds.jsonl and events.jsonl ─────────────────────────────────────────────────────────────────────────────────

/** The line with the highest `round` number (the later line on a tie); null without one. */
function newestRoundLine(text: string | undefined): Record<string, unknown> | null {
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

/** The newest events.jsonl line (file order) whose `to` is the current stage. */
function sinceOf(events: string | undefined, stage: string): { since: string | null; via: string | null } {
  const into = jsonLines(events).filter((e) => e.to === stage && typeof e.ts === 'string' && typeof e.command === 'string');
  const last = into[into.length - 1];
  return last === undefined ? { since: null, via: null } : { since: last.ts as string, via: last.command as string };
}

// ── spec.md ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** Up to the first `.`, `!` or `?` that is followed by white space and a capital, digit, quote or code span, or ends the text. */
const FIRST_SENTENCE = /^(.+?[.!?])(?=\s+[\p{Lu}\d"'“„«(`*_[]|\s*$)/su;

function ideaOf(goal: string, task: string | null): { quote: string | null; source: IdeaSource | null } {
  if (goal !== '') return { quote: FIRST_SENTENCE.exec(goal)?.[1] ?? goal, source: 'goal' };
  if (task !== null && task.trim() !== '') return { quote: task.trim(), source: 'task' };
  return { quote: null, source: null };
}

/** The H1 without its `NNN —` prefix; null without an H1. */
function h1Of(body: string): string | null {
  const title = /^# (.+?)\s*$/m.exec(body)?.[1];
  if (title === undefined) return null;
  const bare = title.replace(/^\d{3}\s*[—–-]\s*/, '').trim();
  return bare === '' ? null : bare;
}

// ── TL;DR ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The list items of the `per-spec` section that name `number` as a word of its own, continuation lines kept. */
function briefOf(perSpec: string | undefined, number: string): string | null {
  const items: string[][] = [];
  for (const line of (perSpec ?? '').split('\n')) {
    if (/^\s*[-*]\s/.test(line)) items.push([line]);
    else if (line.trim() !== '' && items.length > 0) items[items.length - 1]?.push(line);
  }
  const own = items.map((lines) => lines.join('\n')).filter((item) => new RegExp(`\\b${number}\\b`).test(item));
  return own.length > 0 ? own.join('\n') : null;
}

function tldrOf(text: string | null | undefined, row: DashboardSpecRow): SpecTldr | null {
  if (text === null || text === undefined) return null;
  const doc = parseTldr(text);
  const state = tldrState({ tldr: doc, specs: [{ number: row.id, updated: row.updated, phase: row.phase, lastRound: row.lastRound }] });
  return { brief: briefOf(doc.sections['per-spec'], row.id), generated: doc.generated, stale: state.stale };
}

// ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The dashboard row of this folder, built by the dashboard itself, so no shared counter is computed twice. */
function rowOf(input: SpecPageInput): DashboardSpecRow {
  const { texts } = input.files;
  const row = buildDashboard({
    master: texts.master ?? null,
    constitution: null,
    tldr: null,
    specs: [input.files],
    archived: input.others ?? [],
    worktreeTree: input.worktreeTree ?? null,
    ...(input.locks ? { locks: input.locks } : {}),
  }).specs[0];
  if (row === undefined) throw new Error(`buildSpecPage: ${input.files.folder} has no spec.md, so it is not a spec`);
  return row;
}

export function buildSpecPage(input: SpecPageInput): SpecPageModel {
  const row = rowOf(input);
  const { texts } = input.files;
  const spec = texts.spec ?? '';
  const fm = parseFrontmatter(spec);
  const doc = parseClaims(spec);

  // Timeline: round count, decisions, the Status tile's entries (commits only when the server passed them in).
  const timeline = buildTimeline({ files: input.files, commits: input.commits ?? [] });
  const rounds = timeline.filter((e) => e.kind === 'round');
  const roundNumbers = rounds.map((e) => Number(e.ref)).filter((n) => Number.isFinite(n));
  const newest = newestRoundLine(texts.rounds);

  // Locks of this spec's claims: the sessions holding one are the agents working here.
  const ids = new Set(doc.claims.map((c) => c.id));
  const locks: ClaimLock[] = (input.locks?.locks ?? []).filter((l) => ids.has(l.claim));
  const newestLock = locks.reduce<ClaimLock | null>((a, l) => (a === null || Date.parse(l.since) > Date.parse(a.since) ? l : a), null);
  const agentsWorking = new Set(locks.map((l) => l.session)).size;

  // Waiting on you: open operator tasks, open claims with a manual probe, the newest round's questions.
  const manual = new Set(doc.testStrategy.filter((r) => r.type.trim().toLowerCase() === 'manual').map((r) => r.isc));
  const waitingOnYou: WaitingItem[] = [
    ...taskBoxes(texts.tasks)
      .filter((t) => t.lane === OPERATOR && !t.landed)
      .map((t): WaitingItem => ({ kind: 'operator', ref: t.id, title: t.title, checked: false })),
    ...doc.claims
      .filter((c) => !c.checked && !c.dropped && manual.has(c.id))
      .map((c): WaitingItem => ({ kind: 'manual', ref: c.id, title: c.text })),
    ...questionsOf(newest),
  ];

  const gates = row.gates;
  const tasks = row.tasks ?? { landed: 0, total: 0 };
  const keyNumbers: KeyNumbers = {
    claims: { closed: row.progress.closed, total: row.progress.total, open: row.progress.total - row.progress.closed, takeable: row.takeable.length },
    tasks,
    rounds: { count: rounds.length, agentsWorking },
    gates: {
      ok: [gates.reviewed, gates.codeReviewed, gates.drift, gates.diagrams].filter((g) => g.state === 'fresh' || g.state === 'ok').length,
      total: 4,
    },
    waiting: waitingOnYou.length,
  };

  const head: SpecHead = {
    id: row.id,
    slug: row.slug,
    title: h1Of(fm.body) ?? row.title,
    type: row.type,
    stage: row.stage,
    nextCommand: row.nextCommand,
    nextReason: row.nextReason,
    phase: row.phase,
    started: fm.data.started,
    updated: row.updated,
    round: roundNumbers.length > 0 ? Math.max(...roundNumbers) : null,
    lastRound: row.lastRound,
    uncommittedFiles: null,
  };

  const reasons = [row.nextReason];
  if (PAST_REVIEW.has(row.stage)) reasons.push('the reviewed mark is fresh');
  if (row.stage !== 'done' && waitingOnYou.length > 0) {
    reasons.push(`${plural(waitingOnYou.length, 'item')} ${waitingOnYou.length === 1 ? 'waits' : 'wait'} on you`);
  }
  const next: SpecNextStep = { command: row.nextCommand, reasons: reasons.slice(0, MAX_REASONS), ...sinceOf(texts.events, row.stage) };

  const idea = ideaOf(goalOf(spec), fm.data.task);

  const areas: SpecAreas = {
    status: { timelineEntries: timeline.length, warnings: row.warnings.length },
    live: { lockSource: input.locks?.source ?? 'none', agentsWorking, lock: newestLock },
    data: { claims: row.progress, tasks: row.tasks },
    docs: {
      plan: texts.plan !== undefined,
      design: texts.design !== undefined,
      constitution: texts.constitution !== undefined,
      decisions: timeline.filter((e) => e.kind === 'decision').length,
    },
    notes: { count: null },
    board: { rounds: rounds.length, stop: newest !== null && typeof newest.stop === 'string' && newest.stop !== '' ? newest.stop : null },
  };

  return {
    head,
    keyNumbers,
    ideaQuote: idea.quote,
    ideaSource: idea.source,
    next,
    lanes: lanesOf(texts.tasks, texts.constitution),
    gates,
    warnings: row.warnings,
    waitingOnYou,
    areas,
    tldr: tldrOf(input.tldr, row),
  };
}
