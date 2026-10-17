// The item state model (spec 040, T9, ISC-221): every item of a workspace — spec, idea, review mark, code-review mark,
// claim and task — stands in exactly one of five states: `open` (a command lies with the user), `waiting` (the item
// hangs on another item), `running` (a run is open), `aborted` (a run without end, older than the configured age) or
// `done`. The stage stays what stage.ts derives; the state says what is happening to it now. STATE_TABLE holds every
// kind × state as data (meaning, how it is entered, how it is left), which FORMAT.md mirrors (ISC-228).
//
// Where each state comes from:
//   spec, idea: an open run on the item (`LockReading.openRuns`, ISC-222; a spec matched by its number or folder name,
//     an idea by its slug) is `running`, or `aborted` once `now − since` passes `abortAfterMs`. An aborted run does not
//     count as running; with a running and an aborted run on one item the running one wins. Two open runs in one
//     state: the newest decides what is shown, `run.openRuns` counts them. Without a run, the state the item's stage
//     table row names (`StageRule.state`, T8): `open` with the row's command and reason, `waiting` (rows
//     `close-pending`, `blocked`) with what it waits on, `done`. An aborted run that later gets its `run-end` is no
//     longer open, so the item reads its row's state again; a newer `run-start` makes it `running` (T15, ISC-222.1).
//   review mark: an open `/spec-review` run on the spec is `running`/`aborted`; a fresh mark `done`, dated by the mark;
//     on a spec in a `done` row a missing or stale mark is `done` too, undated with its one diagnostic, never `open`
//     (reviews are optional per spec since spec 028); a missing mark while the spec stands before review (rows `plan`,
//     `tasks`) `waiting` on the spec itself; else `open` with `/spec-review NNN`.
//   code-review mark: the same with `/spec-code-review`; `waiting` while missing and the spec stands before the
//     code-review row (on the feature siblings in `close-pending`, on the spec itself before that). A spec type whose
//     workflow has no code review has no code-review mark item.
//   claim: dropped (`closedAs: 'dropped'`) and checked are `done`; a held lock is `running` (detail `taken`), `aborted`
//     past the claim stale age (ISC-35); an unresolved `(after: …)` edge or an open spec edge is `waiting`; anything
//     else is `open` with `/spec-implement NNN`.
//   task: struck (`closedAs: 'struck'`) and ticked are `done`; a last ISC-179 run state of dispatched, building,
//     patched or applied-open is `running` with that state as detail, `aborted` past the claim stale age; a task whose
//     claim waits, or which an open spec edge holds, is `waiting`; anything else is `open` with `/spec-implement NNN`.
// A claim lock and a task run name no command and no run id: both come from implement rounds, so their run shows
// `/spec-implement NNN` and the holding session as its id.
//
// Details (ISC-221.1, T13): `open` carries command and reason, `waiting` what it waits on, `running`/`aborted` the run
// (command, `since`, actor, `elapsedMs`), `done` the date where the files give one and `closedAs` for a dropped claim or
// a struck task; no state carries another state's details. A detail the files do not give is exactly one diagnostic,
// never an invented value: `item-state-no-date`, `-no-command`, `-no-waits` or `-run-time`, each naming its item.
//
// Pure and browser-safe: no clock (`now` is an input), no file system, no Bun API, so it rides the barrel whole. The
// caller passes the parsed workspace (`DashboardInput`), the model built from it (`buildDashboard`, whose functions
// stay out of the barrel) and each spec's task runs as its live frame folds them (`LiveCard.run`, from locks.ts
// `runStates`), so this module imports neither gates.ts nor locks.ts.
import { parseActor } from './actor.ts';
import { parseClaims } from './claims.ts';
import type { DashboardInput, DashboardModel, DashboardSpecRow } from './dashboard.ts';
import type { Diagnostic } from './diagnostics.ts';
import { parseEvents } from './events.ts';
import type { ClaimLock, GateState, GateView, ItemKind, ItemRun, ItemState, ItemStateInfo, ItemWaits, MarkState, OpenRun, RunState, SpecEdge, SpecFiles, TaskRun, Workflow } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { resolveEdges } from './spec-edges.ts';
import { specIdOf } from './spec-ref.ts';
import { codeReviewOf, fillReason, fillsTemplate, SPEC_RULES, storyStep } from './stage.ts';
import type { SpecStageRule, Stage } from './stage.ts';
import { heldLocks, mainFeatureOf, partitionClaims } from './status.ts';
import { parseTaskLines } from './tasks.ts';

/** A run without end older than this is `aborted` (spec 040): the default of the server's `runAbortMinutes`. */
export const DEFAULT_ABORT_AFTER_MS = 120 * 60 * 1000;

/**
 * A claim lock or task run older than this is `aborted` (ISC-35, ISC-223): the live frame's `LIVE_STALE_MS`, 45
 * minutes, repeated here because live.ts reads lock files and stays out of the browser bundle; item-state.test.ts pins
 * the two.
 */
export const DEFAULT_CLAIM_STALE_MS = 45 * 60 * 1000;

/** Everything the states are derived from, read and parsed by the caller; pure over it. */
export interface ItemStateInput {
  /** The parsed workspace as `buildDashboard` takes it: spec folders, workflow, merge state, locks and open runs. */
  readonly workspace: DashboardInput;
  /** `buildDashboard(workspace)`: each spec row's stage, step, marks and waits, and the stories. */
  readonly dashboard: DashboardModel;
  /**
   * Each spec's task runs (ISC-179) by spec number, as its live frame folds them (`LiveCard.run`); absent or without an
   * entry, no task of that spec has a run.
   */
  readonly taskRuns?: Readonly<Record<string, readonly TaskRun[]>>;
  /** The clock every age is measured against, as a Date or in milliseconds since the epoch. */
  readonly now: Date | number;
  /** An open run older than this is `aborted`; defaults to `DEFAULT_ABORT_AFTER_MS`. */
  readonly abortAfterMs?: number;
  /** A claim lock or task run older than this is `aborted`; defaults to `DEFAULT_CLAIM_STALE_MS`. */
  readonly staleAfterMs?: number;
}

/** One row of the state table: what a state means for an item kind, how the item enters it and how it leaves it. */
export interface StateTableRow {
  readonly kind: ItemKind;
  readonly state: ItemState;
  readonly meaning: string;
  readonly entered: string;
  readonly left: string;
}

const NEVER = '—';

/** The state table (ISC-228 mirrors it into FORMAT.md): every item kind with each of the five states, in that order. */
export const STATE_TABLE: readonly StateTableRow[] = [
  {
    kind: 'spec',
    state: 'open',
    meaning: "A command lies with the user: the command of the spec's stage table row, with the row's reason.",
    entered: 'The spec stands in a row with a command and no run is open on it, or its run ended.',
    left: 'A run starts on the spec, or the files move it to another row.',
  },
  {
    kind: 'spec',
    state: 'waiting',
    meaning: 'The spec hangs on other items: `close-pending` on the open specs of its main feature, `blocked` on spec edges or claims.',
    entered: 'The spec stands in row `close-pending` or `blocked` and no run is open on it.',
    left: 'What it waits on closes and the stage table moves the spec on, or a run starts on it.',
  },
  {
    kind: 'spec',
    state: 'running',
    meaning: 'A run is open on the spec: a `run-start` without `run-end`, younger than the abort age. It locks the spec.',
    entered: 'A `run-start` names the spec.',
    left: 'Its `run-end` (also a release from the app), after which the files decide; or the abort age passes.',
  },
  {
    kind: 'spec',
    state: 'aborted',
    meaning: 'A run without end, older than the abort age; it no longer locks.',
    entered: 'The abort age passes without a `run-end` for the run.',
    left: 'A `run-end` for it, after which the files decide; or a new `run-start`.',
  },
  {
    kind: 'spec',
    state: 'done',
    meaning: 'One of the two `done` rows: `phase: complete`, or a chore with every claim closed.',
    entered: 'The files put the spec in a `done` row and no run is open on it.',
    left: 'Only when the files change, or a run starts on the spec.',
  },
  {
    kind: 'idea',
    state: 'open',
    meaning: 'A story waits for its spec: `/spec new <slug>` lies with the user.',
    entered: 'A story file stands under `specs/ideas/` and no run is open on it.',
    left: 'A run starts on the idea, or its allocation turns it into a spec.',
  },
  { kind: 'idea', state: 'waiting', meaning: 'Never: a story carries no edges.', entered: NEVER, left: NEVER },
  {
    kind: 'idea',
    state: 'running',
    meaning: 'A run is open on the idea, younger than the abort age. It locks the allocation.',
    entered: 'A `run-start` names the idea.',
    left: 'Its `run-end`, or the abort age passes.',
  },
  {
    kind: 'idea',
    state: 'aborted',
    meaning: 'A run on the idea without end, older than the abort age; it no longer locks.',
    entered: 'The abort age passes without a `run-end` for the run.',
    left: 'A `run-end` for it, or a new `run-start`.',
  },
  { kind: 'idea', state: 'done', meaning: 'Never: an allocated story becomes a spec and leaves `specs/ideas/`.', entered: NEVER, left: NEVER },
  {
    kind: 'review-mark',
    state: 'open',
    meaning: '`/spec-review NNN` lies with the user: the spec stands in the review row, or the mark is stale, or missing past review.',
    entered: 'The spec reaches the review row, or a reviewed file changes after the review.',
    left: 'A `/spec-review` run starts, or a fresh mark is written.',
  },
  {
    kind: 'review-mark',
    state: 'waiting',
    meaning: 'The mark is missing and the spec stands before review (`plan`, `tasks`): it waits on the spec itself.',
    entered: 'A spec without a reviewed mark stands in row `plan` or `tasks`.',
    left: 'The spec reaches the review row.',
  },
  {
    kind: 'review-mark',
    state: 'running',
    meaning: 'A `/spec-review` run is open on the spec, younger than the abort age.',
    entered: 'A `run-start` of `/spec-review NNN`.',
    left: 'Its `run-end`, or the abort age passes.',
  },
  {
    kind: 'review-mark',
    state: 'aborted',
    meaning: 'A `/spec-review` run without end, older than the abort age.',
    entered: 'The abort age passes without a `run-end` for the run.',
    left: 'A `run-end` for it, or a new `run-start`.',
  },
  {
    kind: 'review-mark',
    state: 'done',
    meaning: "The reviewed mark is fresh; its date is the mark's. On a spec in a `done` row a missing or stale mark is done too, undated (reviews are optional per spec).",
    entered: 'A reviewed mark matching spec.md, plan.md and tasks.md is written, or the spec reaches a `done` row.',
    left: 'A reviewed file changes (stale), or a `/spec-review` run starts.',
  },
  {
    kind: 'code-review-mark',
    state: 'open',
    meaning: '`/spec-code-review NNN` lies with the user: the spec stands in the code-review row, or the mark is stale, or missing past it.',
    entered: 'The spec reaches the code-review row, or the working tree changes after the code review.',
    left: 'A `/spec-code-review` run starts, or a fresh mark is written.',
  },
  {
    kind: 'code-review-mark',
    state: 'waiting',
    meaning: 'The mark is missing and the spec stands before the code-review row: on its feature siblings in `close-pending`, else on the spec itself.',
    entered: 'A spec without a code-reviewed mark stands in a row before code review.',
    left: 'The spec reaches the code-review row.',
  },
  {
    kind: 'code-review-mark',
    state: 'running',
    meaning: 'A `/spec-code-review` run is open on the spec, younger than the abort age.',
    entered: 'A `run-start` of `/spec-code-review NNN`.',
    left: 'Its `run-end`, or the abort age passes.',
  },
  {
    kind: 'code-review-mark',
    state: 'aborted',
    meaning: 'A `/spec-code-review` run without end, older than the abort age.',
    entered: 'The abort age passes without a `run-end` for the run.',
    left: 'A `run-end` for it, or a new `run-start`.',
  },
  {
    kind: 'code-review-mark',
    state: 'done',
    meaning:
      "The code-reviewed mark is fresh; its date is the mark's. On a spec in a `done` row a missing or stale mark is done too, undated (reviews are optional per spec). A type whose workflow has no code review has no such item.",
    entered: 'A code-reviewed mark matching the working tree is written, or the spec reaches a `done` row.',
    left: 'The working tree changes (stale), or a `/spec-code-review` run starts.',
  },
  {
    kind: 'claim',
    state: 'open',
    meaning: '`/spec-implement NNN` lies with the user: the claim is takeable, or held only by the review gate.',
    entered: 'The claim is unchecked, no lock holds it and no edge is open.',
    left: 'A lock takes it, an edge holds it, or it is checked or dropped.',
  },
  {
    kind: 'claim',
    state: 'waiting',
    meaning: 'An unresolved `(after: …)` edge or an open spec edge holds the claim.',
    entered: 'The claim names an open claim or spec in its `(after: …)`.',
    left: 'Every claim and spec it names closes.',
  },
  {
    kind: 'claim',
    state: 'running',
    meaning: 'A claim lock holds it (detail `taken`), younger than the claim stale age.',
    entered: 'A `claim` line or a frontier lock takes the claim.',
    left: 'Its `release`, or the claim stale age passes.',
  },
  {
    kind: 'claim',
    state: 'aborted',
    meaning: 'A claim lock without release, older than the claim stale age.',
    entered: 'The claim stale age passes without a `release`.',
    left: 'A `release`, or a new lock.',
  },
  {
    kind: 'claim',
    state: 'done',
    meaning: 'The claim is checked; a dropped claim (tombstone) is done with `closedAs: dropped`.',
    entered: 'Its probe closes it and the box is checked, or it is dropped.',
    left: 'Only when spec.md changes.',
  },
  {
    kind: 'task',
    state: 'open',
    meaning: '`/spec-implement NNN` lies with the user: the task has no run and its claim does not wait.',
    entered: 'The task is unticked, without a run in flight and not held.',
    left: 'A `dispatch` sends it out, its claim starts waiting, or it is ticked or struck.',
  },
  {
    kind: 'task',
    state: 'waiting',
    meaning: 'Its claim waits, or an open spec edge holds the task or its claim.',
    entered: 'Its claim waits, or the task names an open spec in its `(after: …)`.',
    left: 'What its claim and the task wait on closes.',
  },
  {
    kind: 'task',
    state: 'running',
    meaning: 'Its last run event leaves it dispatched, building, patched or applied-open (ISC-179); that state is the detail.',
    entered: 'A `dispatch`, `build`, `patch` or `apply` line names the task.',
    left: 'Its box is ticked, or the claim stale age passes after its last run event.',
  },
  {
    kind: 'task',
    state: 'aborted',
    meaning: 'Its last run event is older than the claim stale age.',
    entered: 'The claim stale age passes after its last run event.',
    left: 'A new run event, or its box is ticked.',
  },
  {
    kind: 'task',
    state: 'done',
    meaning: 'The task is ticked, dated by its `apply`; a struck task is done with `closedAs: struck`.',
    entered: 'Its box is ticked, or it is struck.',
    left: 'Only when tasks.md changes.',
  },
];

// ─── The derivation ────────────────────────────────────────────────────────────────────────────────────────────────

/** The run states a task is in flight in (ISC-179): `applied-open` landed and only its tick is missing. */
const IN_FLIGHT: ReadonlySet<RunState> = new Set<RunState>(['dispatched', 'building', 'patched', 'applied-open']);

/** The rows before review, and before the code-review row: a missing mark waits on the spec there. */
const BEFORE_REVIEW: ReadonlySet<Stage> = new Set<Stage>(['plan', 'tasks']);
const BEFORE_CODE_REVIEW: ReadonlySet<Stage> = new Set<Stage>(['plan', 'tasks', 'review', 'build', 'blocked', 'close-pending']);

/** A date `YYYY-MM-DD` in a tombstone or strike note (`see Decisions 2026-03-07`, `struck 2026-09-29: …`). */
const NOTE_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

/** The key order of every item, as `ItemStateInfo` lists its fields. */
const KEYS = ['kind', 'id', 'spec', 'state', 'stage', 'command', 'reason', 'waits', 'run', 'detail', 'doneAt', 'closedAs', 'diagnostic'] as const;

const byId = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });
const sortedSet = (ids: Iterable<string>): string[] => [...new Set(ids)].sort(byId);
const markOf = (state: GateState): MarkState => (state === 'fresh' || state === 'stale' ? state : 'missing');
/** The command's first word: `/spec-review 005` → `/spec-review`. */
const headOf = (command: string): string => command.trim().split(/\s+/)[0] ?? '';

/** The item with its fields in `KEYS` order and every absent one left out, so the golden reads the same everywhere. */
function ordered(item: ItemStateInfo): ItemStateInfo {
  const out: Record<string, unknown> = {};
  for (const key of KEYS) if (item[key] !== undefined) out[key] = item[key];
  return out as unknown as ItemStateInfo;
}

const missing = (code: string, message: string): Diagnostic => ({ severity: 'warning', code, message });

const waitsOf = (waits: Partial<ItemWaits>): ItemWaits => ({ specs: sortedSet(waits.specs ?? []), claims: sortedSet(waits.claims ?? []), siblings: sortedSet(waits.siblings ?? []) });
const waitsNothing = (waits: ItemWaits): boolean => waits.specs.length === 0 && waits.claims.length === 0 && waits.siblings.length === 0;

/** What every item of the workspace is derived against. */
interface Context {
  readonly now: number;
  readonly abortAfterMs: number;
  readonly staleAfterMs: number;
  readonly openRuns: readonly OpenRun[];
  readonly locks: readonly ClaimLock[];
  readonly workflow: Workflow | undefined;
  readonly constitution: string | null;
  /** Every resolved spec edge each active spec carries, by number. */
  readonly edges: ReadonlyMap<string, readonly SpecEdge[]>;
  /** Main feature → its active specs that still hold it open (row 7's siblings), as the dashboard counts them. */
  readonly openByFeature: ReadonlyMap<string, readonly string[]>;
  readonly taskRuns: Readonly<Record<string, readonly TaskRun[]>>;
}

/**
 * The row of the stage table a dashboard row stands in: the spec rule whose command and reason the row shows. Every
 * reason is one of exactly one row's templates (`reasonOf`), so the pair names the row even where an explicit stage
 * replaced the row's stage. Throws on a row no rule gives, which only a defect in core can build.
 */
export function stageRuleOf(row: Pick<DashboardSpecRow, 'id' | 'nextCommand' | 'nextReason'>): SpecStageRule {
  const rule = SPEC_RULES.find(
    (r) => (r.next === null ? row.nextCommand === null : row.nextCommand === `${r.next} ${row.id}`) && r.reasons.some((template) => fillsTemplate(template, row.nextReason)),
  );
  if (rule === undefined) throw new Error(`spec ${row.id}: no stage table row gives ${row.nextCommand ?? '—'} with "${row.nextReason}"`);
  return rule;
}

/** The run shown for a group of open runs: the newest (by start, then by line), with the group's size. */
function runOf(runs: readonly OpenRun[], ctx: Context): { run: ItemRun; diagnostic?: Diagnostic } {
  const newest = runs.reduce((a, b) => {
    const ta = Date.parse(a.since);
    const tb = Date.parse(b.since);
    return tb > ta || (tb === ta && b.line > a.line) ? b : a;
  });
  const elapsed = ctx.now - Date.parse(newest.since);
  const run: ItemRun = {
    run: newest.run,
    command: newest.command,
    session: newest.session,
    actor: newest.actor,
    since: newest.since,
    elapsedMs: Number.isFinite(elapsed) ? elapsed : 0,
    openRuns: runs.length,
    source: 'run',
  };
  return Number.isFinite(elapsed) ? { run } : { run, diagnostic: missing('item-state-run-time', `run ${newest.run} started at "${newest.since}", which is no time; its duration is unknown.`) };
}

/**
 * The state the open runs on an item give: `running` from the runs younger than the abort age, else `aborted` from the
 * older ones; null without a run. An aborted run never counts beside a running one.
 */
function fromRuns(runs: readonly OpenRun[], ctx: Context): Pick<ItemStateInfo, 'state' | 'run' | 'diagnostic'> | null {
  if (runs.length === 0) return null;
  const aborted = (r: OpenRun): boolean => ctx.now - Date.parse(r.since) > ctx.abortAfterMs;
  const running = runs.filter((r) => !aborted(r));
  const { run, diagnostic } = runOf(running.length > 0 ? running : runs, ctx);
  return { state: running.length > 0 ? 'running' : 'aborted', run, ...(diagnostic === undefined ? {} : { diagnostic }) };
}

/** A claim lock or task run as the run of a claim or task: no run id and no command of its own (module header). */
function implementRun(spec: string, session: string, since: string, source: 'lock' | 'task-run', ctx: Context): Pick<ItemStateInfo, 'state' | 'run' | 'diagnostic'> {
  const elapsed = ctx.now - Date.parse(since);
  const run: ItemRun = {
    run: session,
    command: `/spec-implement ${spec}`,
    session,
    actor: parseActor(session),
    since,
    elapsedMs: Number.isFinite(elapsed) ? elapsed : 0,
    openRuns: 1,
    source,
  };
  if (!Number.isFinite(elapsed)) return { state: 'running', run, diagnostic: missing('item-state-run-time', `the ${source === 'lock' ? 'lock' : 'run'} of ${session} started at "${since}", which is no time; its duration is unknown.`) };
  return { state: elapsed > ctx.staleAfterMs ? 'aborted' : 'running', run };
}

/** A `done` item's date, or the one diagnostic that says the files give none. */
function doneOf(at: string | null | undefined, what: string): Pick<ItemStateInfo, 'doneAt' | 'diagnostic'> {
  return at === null || at === undefined || at === '' ? { diagnostic: missing('item-state-no-date', `${what} is done, but the files give no date for it.`) } : { doneAt: at };
}

function contextOf(input: ItemStateInput): Context {
  const { workspace } = input;
  const active = workspace.specs.filter((f) => f.texts.spec !== undefined);
  const openByFeature = new Map<string, string[]>();
  for (const f of [...active].sort((a, b) => byId(a.folder, b.folder))) {
    const spec = f.texts.spec ?? '';
    const fm = parseFrontmatter(spec).data;
    const feature = mainFeatureOf(fm.isaFeature);
    if (feature === null || fm.phase === 'complete' || !parseClaims(spec).claims.some((c) => !c.checked && !c.dropped)) continue;
    openByFeature.set(feature, [...(openByFeature.get(feature) ?? []), specIdOf(f.folder) ?? f.folder]);
  }
  const edges = new Map<string, SpecEdge[]>();
  for (const e of resolveEdges({ specs: workspace.specs, archived: workspace.archived, constitution: workspace.constitution }, workspace.mergeState ?? []).edges) {
    edges.set(e.fromSpec, [...(edges.get(e.fromSpec) ?? []), e]);
  }
  return {
    now: typeof input.now === 'number' ? input.now : input.now.getTime(),
    abortAfterMs: input.abortAfterMs ?? DEFAULT_ABORT_AFTER_MS,
    staleAfterMs: input.staleAfterMs ?? DEFAULT_CLAIM_STALE_MS,
    openRuns: workspace.locks?.openRuns ?? [],
    locks: workspace.locks?.locks ?? [],
    workflow: workspace.workflow,
    constitution: workspace.constitution,
    edges,
    openByFeature,
    taskRuns: input.taskRuns ?? {},
  };
}

/** The open runs on a spec: its run lines name its number (`037`), its folder (`037-slug`), or a ref starting so. */
const runsOnSpec = (row: DashboardSpecRow, ctx: Context): OpenRun[] =>
  ctx.openRuns.filter((r) => r.spec !== undefined && (r.spec === row.id || r.spec === row.slug || specIdOf(r.spec) === row.id));

/** The claims of one spec: done, running/aborted on a lock, waiting on edges, else open. */
function claimItems(row: DashboardSpecRow, spec: string, ctx: Context): ItemStateInfo[] {
  const { claims } = parseClaims(spec);
  const reviewed = markOf(row.gates.reviewed.state);
  const partition = partitionClaims(claims, ctx.locks, reviewed);
  const lockOf = new Map(heldLocks(ctx.locks, new Set(claims.map((c) => c.id))).map((l) => [l.claim, l]));
  const closed = new Set(partition.closed);
  const dropped = new Set(partition.dropped);
  const taken = new Set(partition.taken.map((t) => t.id));
  const takeable = new Set(partition.takeable);
  const blockers = new Map(partition.blocked.map((b) => [b.id, b.openBlockers]));
  const specHolds = new Map<string, string[]>();
  for (const e of ctx.edges.get(row.id) ?? []) {
    if (e.fromKind === 'claim' && e.state === 'open') specHolds.set(e.fromId, [...(specHolds.get(e.fromId) ?? []), e.toSpec]);
  }
  return claims.map((c): ItemStateInfo => {
    const base = { kind: 'claim' as const, id: c.id, spec: row.id };
    if (dropped.has(c.id)) return { ...base, state: 'done', closedAs: 'dropped', ...doneOf(NOTE_DATE.exec(c.droppedNote ?? '')?.[1], `claim ${c.id}`) };
    if (closed.has(c.id)) return { ...base, state: 'done', ...doneOf(null, `claim ${c.id}`) };
    const lock = taken.has(c.id) ? lockOf.get(c.id) : undefined;
    if (lock !== undefined) {
      const live = implementRun(row.id, lock.session, lock.since, 'lock', ctx);
      return { ...base, ...live, ...(live.state === 'running' ? { detail: 'taken' } : {}) };
    }
    if (blockers.has(c.id) || specHolds.has(c.id)) {
      return { ...base, state: 'waiting', waits: waitsOf({ specs: specHolds.get(c.id), claims: blockers.get(c.id) }) };
    }
    const reason = takeable.has(c.id) ? `${c.id} is takeable` : `the reviewed mark is ${reviewed}`;
    return { ...base, state: 'open', command: `/spec-implement ${row.id}`, reason };
  });
}

/** The tasks of one spec: done, running/aborted on their run, waiting with their claim or a spec edge, else open. */
function taskItems(row: DashboardSpecRow, files: SpecFiles, claims: readonly ItemStateInfo[], ctx: Context): ItemStateInfo[] {
  const { tasks, rounds } = files.texts;
  if (tasks === undefined) return [];
  const specEdges = ctx.edges.get(row.id) ?? [];
  const tab = parseTaskLines({ tasks, ...(ctx.constitution === null ? {} : { constitution: ctx.constitution }), ...(rounds === undefined ? {} : { rounds }), specEdges });
  const runOf = new Map((ctx.taskRuns[row.id] ?? []).map((r) => [r.task, r]));
  const claimOf = new Map(claims.map((c) => [c.id, c]));
  const taskHolds = new Map<string, string[]>();
  for (const e of specEdges) if (e.fromKind === 'task' && e.state === 'open') taskHolds.set(e.fromId, [...(taskHolds.get(e.fromId) ?? []), e.toSpec]);
  return tab.tasks.map((t): ItemStateInfo => {
    const base = { kind: 'task' as const, id: t.id, spec: row.id };
    const run = runOf.get(t.id);
    if (t.state === 'struck') return { ...base, state: 'done', closedAs: 'struck', ...doneOf(NOTE_DATE.exec(t.note ?? '')?.[1], `task ${t.id}`) };
    if (t.state === 'done') return { ...base, state: 'done', ...doneOf(run?.state === 'applied' ? run.ts : null, `task ${t.id}`) };
    if (run !== undefined && IN_FLIGHT.has(run.state)) {
      const live = implementRun(row.id, run.session, run.ts, 'task-run', ctx);
      return { ...base, ...live, ...(live.state === 'running' ? { detail: run.state } : {}) };
    }
    const claim = claimOf.get(t.claim);
    const held = taskHolds.get(t.id) ?? [];
    if (claim?.state === 'waiting' || held.length > 0) {
      return { ...base, state: 'waiting', waits: waitsOf({ specs: [...(claim?.waits?.specs ?? []), ...held], claims: claim?.waits?.claims }) };
    }
    return { ...base, state: 'open', command: `/spec-implement ${row.id}`, reason: t.reason ?? `task of ${t.claim}, not dispatched` };
  });
}

/** A spec without a run: the state of its stage table row, with that state's details. */
function specByRule(row: DashboardSpecRow, rule: SpecStageRule, files: SpecFiles, claims: readonly ItemStateInfo[], ctx: Context): Pick<ItemStateInfo, 'state' | 'command' | 'reason' | 'waits' | 'doneAt' | 'diagnostic'> {
  if (rule.state === 'open') {
    if (row.nextCommand === null) return { state: 'open', reason: row.nextReason, diagnostic: missing('item-state-no-command', `spec ${row.id} stands in row ${rule.stage}, which names no command.`) };
    return { state: 'open', command: row.nextCommand, reason: row.nextReason };
  }
  if (rule.state === 'waiting') {
    const waits =
      rule.stage === 'close-pending'
        ? waitsOf({ siblings: siblingsOf(row, files, ctx) })
        : waitsOf({
            specs: [...(row.waits?.blockers ?? []), ...claims.flatMap((c) => c.waits?.specs ?? [])],
            claims: claims.flatMap((c) => [...(c.waits?.claims ?? []), ...(c.state === 'running' || c.state === 'aborted' ? [c.id] : [])]),
          });
    return waitsNothing(waits)
      ? { state: 'waiting', waits, diagnostic: missing('item-state-no-waits', `spec ${row.id} waits (${row.nextReason}), but on no spec, claim or sibling the files name.`) }
      : { state: 'waiting', waits };
  }
  // `done`: the last event that moved the spec to `done`, else a complete spec's `updated:`.
  const events = files.texts.events === undefined ? [] : parseEvents(files.texts.events).events;
  const moved = events.filter((e) => e.to === 'done').at(-1)?.ts;
  return { state: 'done', ...doneOf(moved ?? (row.phase === 'complete' ? row.updated : null), `spec ${row.id}`) };
}

/** The open specs of the spec's main feature beside it (row 7's siblings). */
function siblingsOf(row: DashboardSpecRow, files: SpecFiles, ctx: Context): string[] {
  const feature = mainFeatureOf(parseFrontmatter(files.texts.spec ?? '').data.isaFeature);
  return feature === null ? [] : (ctx.openByFeature.get(feature) ?? []).filter((id) => id !== row.id);
}

/** A review or code-review mark: its runs, then fresh, waiting before its row, else open with its command. */
function markItem(
  kind: 'review-mark' | 'code-review-mark',
  row: DashboardSpecRow,
  rule: SpecStageRule,
  gate: GateView,
  runs: readonly OpenRun[],
  siblings: () => string[],
  ctx: Context,
): ItemStateInfo {
  const review = kind === 'review-mark';
  const command = review ? '/spec-review' : '/spec-code-review';
  const base = { kind, id: row.id, spec: row.id };
  const live = fromRuns(
    runs.filter((r) => headOf(r.command) === command),
    ctx,
  );
  if (live !== null) return { ...base, ...live };
  const state = markOf(gate.state);
  const mark = `the ${review ? 'reviewed' : 'code-reviewed'} mark of ${row.id}`;
  if (state === 'fresh') return { ...base, state: 'done', ...doneOf(gate.at, mark) };
  // A spec in a `done` row offers no review: reviews are optional per spec (spec 028), so a missing or stale mark is
  // done with it, undated, and its one diagnostic says the mark is absent although the spec is complete.
  if (rule.stage === 'done') return { ...base, state: 'done', diagnostic: missing('item-state-no-date', `${mark} is ${state}, although spec ${row.id} is done; the files give no date for it.`) };
  if (state === 'missing' && (review ? BEFORE_REVIEW : BEFORE_CODE_REVIEW).has(rule.stage)) {
    return { ...base, state: 'waiting', waits: rule.stage === 'close-pending' ? waitsOf({ siblings: siblings() }) : waitsOf({ specs: [row.id] }) };
  }
  // In its own row the stage table's reason; elsewhere the mark's state says why.
  const ownRow = rule.stage === (review ? 'review' : 'code-review');
  const reason = ownRow ? row.nextReason : fillReason(`the ${review ? 'reviewed' : 'code-reviewed'} mark is {state}`, { state });
  return { ...base, state: 'open', command: `${command} ${row.id}`, reason };
}

/** Every item of one spec: the spec, its marks (code review only where its workflow has one), its claims and tasks. */
function specItems(row: DashboardSpecRow, files: SpecFiles | undefined, ctx: Context): ItemStateInfo[] {
  const spec = files?.texts.spec;
  if (files === undefined || spec === undefined) return [];
  const rule = stageRuleOf(row);
  const runs = runsOnSpec(row, ctx);
  const claims = claimItems(row, spec, ctx);
  const live = fromRuns(runs, ctx);
  const own: ItemStateInfo = { kind: 'spec', id: row.id, stage: row.stage, ...(live ?? specByRule(row, rule, files, claims, ctx)) };
  const siblings = () => siblingsOf(row, files, ctx);
  const marks = [markItem('review-mark', row, rule, row.gates.reviewed, runs, siblings, ctx)];
  if (codeReviewOf(row.type, ctx.workflow) !== 'none') marks.push(markItem('code-review-mark', row, rule, row.gates.codeReviewed, runs, siblings, ctx));
  return [own, ...marks, ...claims, ...taskItems(row, files, claims, ctx)];
}

/** A story: an open run on it, else row 1's `open` with `/spec new <slug>`. */
function ideaItem(slug: string, ctx: Context): ItemStateInfo {
  const live = fromRuns(
    ctx.openRuns.filter((r) => r.idea === slug),
    ctx,
  );
  const base = { kind: 'idea' as const, id: slug, stage: 'idea' as const };
  if (live !== null) return { ...base, ...live };
  const step = storyStep(slug);
  return { ...base, state: 'open', command: step.command, reason: step.reason };
}

/**
 * Every item of the workspace with its state and details: per active spec in id order the spec, its review mark, its
 * code-review mark (where its type's workflow has a code review), its claims and its tasks in file order; then every
 * story in `readIdeas` order. Exactly one entry per item.
 */
export function itemStates(input: ItemStateInput): ItemStateInfo[] {
  const ctx = contextOf(input);
  const files = new Map(input.workspace.specs.map((f) => [f.folder, f]));
  const rows = [...input.dashboard.specs].sort((a, b) => byId(a.id, b.id));
  return [...rows.flatMap((row) => specItems(row, files.get(row.slug), ctx)), ...input.dashboard.ideas.list.map((idea) => ideaItem(idea.slug, ctx))].map(ordered);
}

// ── the run lock (spec 040, T31, ISC-225) ────────────────────────────────────────────────────────────────────────

/** The item a write lands on, as far as an open run can lock it: a spec by its number or folder name, a story by slug. */
export type RunLockTarget = { readonly spec: string } | { readonly idea: string };

/** The number a run line or a write names a spec by: `037` as written, `037-slug` by its prefix. */
const specNumberOf = (ref: string): string => specIdOf(ref) ?? ref;

/**
 * The run that locks writes on `target` (ISC-225): the newest running run on the item, its `openRuns` counting the
 * running ones; null when no run is open on it or every open one is `aborted`. The decision is `fromRuns`, the one
 * `itemStates` takes for a spec or a story, so the item's state and the server's refusal never disagree on the same
 * reading, `now` and abort age. A spec matches its runs as `runsOnSpec` does: by number, folder name or a ref so prefixed.
 */
export function runLockOf(openRuns: readonly OpenRun[], target: RunLockTarget, options: { readonly now: Date | number; readonly abortAfterMs?: number }): ItemRun | null {
  const runs =
    'spec' in target ? openRuns.filter((r) => r.spec !== undefined && specNumberOf(r.spec) === specNumberOf(target.spec)) : openRuns.filter((r) => r.idea === target.idea);
  const ctx: Context = {
    now: typeof options.now === 'number' ? options.now : options.now.getTime(),
    abortAfterMs: options.abortAfterMs ?? DEFAULT_ABORT_AFTER_MS,
    staleAfterMs: DEFAULT_CLAIM_STALE_MS,
    openRuns,
    locks: [],
    workflow: undefined,
    constitution: null,
    edges: new Map(),
    openByFeature: new Map(),
    taskRuns: {},
  };
  const live = fromRuns(runs, ctx);
  return live?.state === 'running' && live.run !== undefined ? live.run : null;
}
