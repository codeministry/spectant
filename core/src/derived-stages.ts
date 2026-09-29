// Stage transitions for the timeline (T15, ISC-36): derived from the files and marked `derived` while events.jsonl
// is absent; the recorded events replace them when present.
//
// Pure over text the caller read: no `node:*`, so the web bundle may import it beside timeline.ts.
//
// With events (the validated lines of events.jsonl, T16) the events are the stage entries, one each, in file order,
// `derived: false`, with their `actor` and `command`; nothing is derived. Without events (absent or empty) and with
// spec.md, the transitions are replayed from the files in the stage table's vocabulary (stage.ts, FORMAT.md § The
// stage table): a stage names what the spec waits for, so `/spec-review` moves it `review → build`. The stages
// before review come from `stageOf` itself, fed one file at a time, so a type that needs no plan never passes
// through `plan` and the three-claim threshold for `tasks` holds. Every derived entry carries `derived: true` and
// `actor: null`; the first one has `from: null` (the spec did not exist before).
//
// The two vocabularies (the stage table is the one events.jsonl speaks, principal decision 2026-09-29; events.ts reads
// the older lifecycle words through EVENT_VOCABULARY_ALIASES), and the date each derived transition takes, first
// source that gives one:
//
// | lifecycle (ISC-24)           | stage table (from → to)            | date source                                          |
// |------------------------------|------------------------------------|------------------------------------------------------|
// | idea → specified             | null → plan, tasks or review       | spec.md `created:`, `started:`, earliest timed context.md header |
// | specified → planned          | plan → tasks or review             | plan.md `created:`, context.md round "before the plan" |
// | planned → tasked             | tasks → review                     | tasks.md `created:`, context.md round "before the tasks" |
// | tasked → reviewed            | review → build                     | `.gates/reviewed.json` `at`                           |
// | reviewed → implementing      | — (build before and after)         | none: the first round is its own round entry          |
// | (every claim closed)         | build → code-review                | none: implied by the code-reviewed mark, always undated |
// | implementing → code-reviewed | code-review → close                | `.gates/code-reviewed.json` `at`                      |
// | → done                       | <last stage> → done                | spec.md `completed:`, `updated:` (with `phase: complete`) |
//
// A file's `updated:` is its last edit, not its creation, and is never a plan or tasks date (harbor 002's tasks.md
// says 03-08, a day after the review that hashed it). The review marks are read as far as their `at`; whether a mark
// is fresh today is the gate's question (gates.ts), so a mark gone stale still dates the transition it made.
//
// Undated: a transition whose date the files do not give has `ts: ''` and `undated: true`, and `stageInstants`
// places it right after the last dated transition before it. A date without a time (`2026-09-24`) that falls on the
// day of the transition before it sorts right after that transition too, since the day is all it says.
import type { EventLine, SpecFiles, StageName, TimelineEntry } from './files.ts';
import { parseClaims } from './claims.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { stageOf, type Stage } from './stage.ts';

/** `## Goal — confirmed <ts>` in context.md (timeline.ts reads the same header). */
export const GOAL_HEADER = /^## Goal\s+[—–-]+\s+confirmed\s+(\S+)\s*$/;
/** `## Round N — <title>, <ts>`: the time is the last comma-separated token and must start with a date. */
export const ROUND_HEADER = /^## Round (\d+)\b.*,\s*(\d{4}-\d{2}-\d{2}\S*)\s*$/;

const FENCE = /^\s*(```|~~~)/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Dated {
  /** As the source wrote it; null when no source gives one. */
  readonly ts: string | null;
  /** Where the date came from, or why there is none; the entry's body. */
  readonly source: string;
}

export function deriveStages(files: SpecFiles, events?: readonly EventLine[]): TimelineEntry[] {
  if (events !== undefined && events.length > 0) return events.map(fromEvent);
  const spec = files.texts.spec;
  if (spec === undefined) return [];

  const fm = parseFrontmatter(spec);
  const total = parseClaims(spec).claims.length;
  const type = fm.data.specType;
  const hasPlan = files.texts.plan !== undefined;
  const hasTasks = files.texts.tasks !== undefined;
  const headers = contextHeaders(files.texts.context);

  // The stage table before any review mark, as stage.ts answers it for the files present.
  const before = (plan: boolean, tasks: boolean): Stage =>
    stageOf({
      number: '',
      type,
      phase: null,
      hasPlan: plan,
      hasTasks: tasks,
      claims: { closed: 0, total },
      reviewed: 'missing',
      codeReviewed: 'missing',
      takeable: [],
      partition: { takeable: 0, open: total, closed: 0, dropped: 0 },
    });

  const out: TimelineEntry[] = [];
  const current = (): StageName | null => out.at(-1)?.to ?? null;
  const step = (to: StageName, date: Dated): void => {
    const from = current();
    if (to !== from) out.push(derivedEntry(from, to, date));
  };

  step(before(false, false), createdDate(fm.values, fm.data.started, headers));
  if (hasPlan) step(before(true, false), fileDate('plan.md', files.texts.plan, headers, 'before the plan'));
  if (hasTasks) step(before(hasPlan, true), fileDate('tasks.md', files.texts.tasks, headers, 'before the tasks'));

  if (current() === 'review') {
    const reviewed = markAt(files.texts.gateReviewed);
    if (reviewed !== undefined) step('build', dated(reviewed, '.gates/reviewed.json', '`at`'));
  }
  if (current() === 'build') {
    const codeReviewed = markAt(files.texts.gateCodeReviewed);
    if (codeReviewed !== undefined) {
      step('code-review', { ts: null, source: 'every claim closed; implied by .gates/code-reviewed.json, the files give no date' });
      step('close', dated(codeReviewed, '.gates/code-reviewed.json', '`at`'));
    }
  }
  if (fm.data.phase === 'complete') step('done', doneDate(fm.values, fm.data.updated));
  return out;
}

/**
 * The instant each stage entry sorts at, in the order `deriveStages` returned them (oldest first): its own `ts`,
 * except an undated entry and a date-only entry on its predecessor's day, which take the predecessor's instant.
 * NaN where nothing before gives one.
 */
export function stageInstants(entries: readonly TimelineEntry[]): number[] {
  const out: number[] = [];
  let previous = Number.NaN;
  for (const e of entries) {
    const own = Date.parse(e.ts);
    let at = own;
    if (e.undated === true || e.ts === '') at = previous;
    else if (DATE_ONLY.test(e.ts) && Number.isFinite(own) && previous >= own && previous < own + DAY_MS) at = previous;
    out.push(at);
    if (Number.isFinite(at)) previous = at;
  }
  return out;
}

function fromEvent(event: EventLine): TimelineEntry {
  return {
    ts: event.ts,
    kind: 'stage',
    derived: false,
    title: `${event.from ?? 'created'} → ${event.to}`,
    body: `- Command: ${event.command}`,
    ref: event.to,
    actor: event.actor,
    from: event.from,
    to: event.to,
    command: event.command,
  };
}

function derivedEntry(from: StageName | null, to: StageName, date: Dated): TimelineEntry {
  return {
    ts: date.ts ?? '',
    kind: 'stage',
    derived: true,
    title: `${from ?? 'created'} → ${to}`,
    body: date.ts === null ? `- Undated: ${date.source}` : `- Derived from: ${date.source}`,
    ref: to,
    actor: null,
    from,
    to,
    ...(date.ts === null ? { undated: true } : {}),
  };
}

// ─── date sources ────────────────────────────────────────────────────────────────────────────────────────────────

/** A frontmatter value that reads as a date or an instant; anything else is no date. */
function asDate(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const v = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}

function dated(ts: string | null, file: string, key: string): Dated {
  return ts === null ? { ts: null, source: `${file} has no ${key}` } : { ts, source: `${file} ${key}` };
}

function createdDate(values: Readonly<Record<string, string>>, started: string | null, headers: readonly Header[]): Dated {
  const created = asDate(values.created);
  if (created) return { ts: created, source: 'spec.md `created:`' };
  const start = asDate(started);
  if (start) return { ts: start, source: 'spec.md `started:`' };
  const earliest = headers.reduce<Header | null>((min, h) => (min === null || Date.parse(h.ts) < Date.parse(min.ts) ? h : min), null);
  if (earliest) return { ts: earliest.ts, source: `context.md ${earliest.label}` };
  return { ts: null, source: 'spec.md exists; neither its frontmatter nor context.md gives a date' };
}

function fileDate(file: string, text: string | undefined, headers: readonly Header[], phrase: string): Dated {
  const created = asDate(text === undefined ? null : parseFrontmatter(text).values.created);
  if (created) return { ts: created, source: `${file} \`created:\`` };
  const round = headers.find((h) => h.round && h.title.toLowerCase().includes(phrase));
  if (round) return { ts: round.ts, source: `context.md ${round.label}` };
  return { ts: null, source: `${file} exists; no \`created:\` and no context.md round "${phrase}"` };
}

function doneDate(values: Readonly<Record<string, string>>, updated: string | null): Dated {
  const completed = asDate(values.completed);
  if (completed) return { ts: completed, source: '`phase: complete`, spec.md `completed:`' };
  const last = asDate(updated);
  if (last) return { ts: last, source: '`phase: complete`, spec.md `updated:`' };
  return { ts: null, source: '`phase: complete`; spec.md has no `completed:` or `updated:`' };
}

/** A mark's `at` when the mark is a JSON object; null for an object without one; undefined without a mark. */
function markAt(text: string | undefined): string | null | undefined {
  if (text === undefined) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const at = (json as Record<string, unknown>).at;
  return typeof at === 'string' ? asDate(at) : null;
}

interface Header {
  readonly round: boolean;
  /** The header's text between the number and the time, lowercased by the caller when matching. */
  readonly title: string;
  readonly ts: string;
  /** `Round 2 "before the plan"` or `goal`, for the entry's body. */
  readonly label: string;
}

/** The timed `## Goal — confirmed` and `## Round N — …, <ts>` headers of context.md, in file order; fences skipped. */
function contextHeaders(text: string | undefined): Header[] {
  if (text === undefined) return [];
  const out: Header[] = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced) continue;
    const goal = GOAL_HEADER.exec(line);
    if (goal?.[1] && Number.isFinite(Date.parse(goal[1]))) {
      out.push({ round: false, title: 'goal', ts: goal[1], label: '`## Goal — confirmed`' });
      continue;
    }
    const round = ROUND_HEADER.exec(line);
    if (round?.[1] && round[2] && Number.isFinite(Date.parse(round[2]))) {
      const title = line.replace(/^## Round \d+\s*[—–-]*\s*/, '').replace(/,\s*\S+\s*$/, '');
      out.push({ round: true, title, ts: round[2], label: `\`## Round ${round[1]} — ${title}\`` });
    }
  }
  return out;
}
