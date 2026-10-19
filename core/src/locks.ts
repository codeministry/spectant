// Lock sources (spec 002 T20, ISC-37): who holds which claim of a repository, read from up to two places. Reads only,
// never writes, never throws on content: what cannot be read becomes a diagnostic.
//
// 1. LifeOS frontier locks, only when the caller passes a LifeOS state directory (the directory that holds LifeOS's
//    `isa-locks/`). LifeOS writes one file per held claim:
//
//      <stateDir>/isa-locks/<hash>/<claim-id>.lock      e.g. isa-locks/3f9c0a7d1e2b4c68/ISC-37.lock
//      {"session":"spec-002-ISC-37","ts":"2026-03-08T15:30:00.000Z","isa":"<absolute path of the ISA.md>"}
//
//    `<hash>` is the first 16 hex digits of sha1 over the ISA's real path (symbolic links resolved; the plain resolved
//    path when the file does not exist), which is how LifeOS's own frontier tool keys the directory. This module
//    computes the same hash and reads that one directory, so no other repository's locks are ever opened. The claim ID
//    is the file name; `session` and `ts` are required; `isa`, when present, must name this ISA by any path that
//    resolves to the same real file (LifeOS stores the path the session used), else the lock is skipped as foreign. Other files in the directory (LifeOS steal tombstones,
//    `<claim-id>.steal.<hex>`) are not locks. A lock older than LifeOS's stale TTL (two hours) is not held — LifeOS
//    itself lets any session take it over — and is reported instead.
// 2. `.spectant/activity.jsonl` at the repository root, written by the plugin's hooks: one JSON object per line,
//    `{ts, event: "claim" | "release", claim, session, task?, worktree?}`, replayed in order. A claim without a later
//    release by its holder is held since the claim line's `ts`.
//
//    The run events (spec 027, ISC-179): `{ts, event: "dispatch" | "build" | "patch" | "apply", task, session,
//    worktree?, claim?}`, one per step of a task in an implement round. A run event holds no claim; it is collected on
//    the reading as `runs`, and `runStates` folds them into each task's last state (dispatched → building → patched →
//    applied, `applied-open` while tasks.md has not ticked the task). A run event without `task`, `session` or `ts` is
//    malformed and skipped, and so is a `patch` or `apply` without `worktree`; a `dispatch` or `build` may name none,
//    since the builder's worktree does not exist yet when its task is dispatched (spec 035, ISC-189), and its run then
//    carries no `worktree` key. An event that is none of the six raises one `activity-event-unknown` warning per
//    file, at its first line; that line and every later unknown one are skipped, and the file is read on. A run event
//    without `claim` is assigned to a spec by its session ref `a:<kind>:spec-NNN/…`, else by its worktree
//    `.worktrees/NNN-slug` (`runSpecOf`, spec 041, ISC-213); one that names neither is kept on `runs`, counts for no
//    spec and raises a `locks-activity-unassigned` warning at its line.
//
//    The run lifecycle events (spec 040, ISC-222): `{ts, event: "run-start" | "run-end", run, command, session,
//    spec | idea, outcome?}`, one when a command starts on a spec or an idea and one when it ends. `ts`, `run`,
//    `command` and `session` are required, and exactly one of `spec` or `idea`; `outcome`, read on `run-end` only, is
//    `ok`, `error` or `released` when present. A line that breaks any of this is malformed and skipped. Starts and ends
//    pair by `run`: a `run-start` without a later `run-end` of its id is an open run, collected on the reading as
//    `openRuns` in file order. A `run-end` for a run that is not open (unknown or already ended) is one
//    `locks-activity-run-unmatched` warning, and a `run-start` reusing a run id is one `locks-activity-run-duplicate`
//    warning; both are skipped. Neither event holds a claim or names a task. `openRuns` is set only when the log holds at
//    least one `run-start` or `run-end` line, so a log without them reads exactly as before (ISC-222.2); for the same
//    reason the `activity-event-unknown` text still lists the six older events only, and an unknown event is one that is
//    none of the ten (the eight above and the two step events below).
//
//    The step events (spec 015, ISC-230): `{ts, event: "probe", task, claim, result: "red" | "green", session,
//    worktree?}` when a task's agent ran its claim's probe, and `{ts, event: "question", task, text, claim?, session,
//    worktree?}` when it asked the person something. `ts`, `task` and `session` are required on both, `claim` and a
//    `result` of `red` or `green` on a probe, `text` on a question; a line that lacks one is malformed and skipped. A
//    question's text is cut to its first line and to at most 200 characters (`questionText`). The steps are collected on
//    the reading as `steps`, their own list: never part of `runs`, so they move no task run, no item state and no lock
//    (ISC-230.1). `steps` is set only when the log holds at least one step line, so a log without them reads as before.
//
//    The releases (spec 015, ISC-231): every `release` that ended its holder's claim is kept on the reading as
//    `releases`, with its claim, session, ts and, when the line names them, task and worktree; steps.ts puts it on the
//    timeline of the claim's task. A release of a claim nobody holds, or by another session, freed nothing and is not
//    kept. `releases` is set only when the log holds at least one, so a log without them reads as before.
//
// The reading names `frontier` when a LifeOS state directory exists, else `activity` when the log exists, else `none`.
// With no state directory given, nothing outside `repoRoot` is touched (ISC-37).
//
// The holder (spec 008, T63, ISC-119): every `session` read goes through `parseActor`, and each lock carries the result
// as `actor`. A session outside the grammar is legacy: read and counted as any other, flagged with one `actor-legacy`
// warning per file (`legacyActorWarning`, actor.ts): once for the activity log, at its first legacy line and that
// line's claim, and once per frontier lock file (a file holds one session) for a lock of this ISA. Server-side module: it reads through
// `node:fs/promises` and hashes with `node:crypto`, no Bun API, so the server and the plugin can both import it.
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { legacyActorWarning, parseActor, type ActorSighting } from './actor.ts';
import { runSpecOf } from './spec-ref.ts';
import type {
  AgentLockSource,
  ClaimLock,
  LockDiagnostic,
  LockReadInput,
  LockReading,
  OpenRun,
  ProbeResult,
  RunEvent,
  RunLifecycleEvent,
  RunOutcome,
  RunState,
  ClaimRelease,
  StepEvent,
  StepKind,
  TaskRun,
} from './files.ts';

// `runSpecOf` lives in spec-ref.ts (pure, browser-safe, so steps.ts rides the barrel); kept importable from here.
export { runSpecOf };

/** LifeOS's default stale TTL for a frontier lock: a session silent this long has died or moved on. */
export const FRONTIER_STALE_MS = 2 * 60 * 60 * 1000;

const LOCK_SUFFIX = '.lock';

/** One run event as the reading carries it (`LockReading.runs`). */
type RunLine = NonNullable<LockReading['runs']>[number];

/** The state each run event leaves its task in; `apply` reads `applied-open` until tasks.md ticks the task. */
const RUN_STATE: Readonly<Record<RunEvent, RunState>> = { dispatch: 'dispatched', build: 'building', patch: 'patched', apply: 'applied' };

const isRunEvent = (event: string): event is RunEvent => Object.hasOwn(RUN_STATE, event);

const isLifecycleEvent = (event: string): event is RunLifecycleEvent => event === 'run-start' || event === 'run-end';

const OUTCOMES: ReadonlySet<string> = new Set<RunOutcome>(['ok', 'error', 'released']);

const isStepEvent = (event: string): event is StepKind => event === 'probe' || event === 'question';

const isProbeResult = (value: unknown): value is ProbeResult => value === 'red' || value === 'green';

/** The most characters of a question's text the reader keeps (spec 015, ISC-230). */
export const QUESTION_TEXT_MAX = 200;

const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * A question's text as the reader keeps it: its first line, cut to at most `QUESTION_TEXT_MAX` characters. Counted in
 * graphemes, so a cut never splits a surrogate pair or a composed emoji. Pure.
 */
export function questionText(text: string): string {
  const first = text.split(/\r?\n/u, 1)[0] ?? '';
  return Array.from(GRAPHEMES.segment(first), (s) => s.segment)
    .slice(0, QUESTION_TEXT_MAX)
    .join('');
}

const byId = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const byClaim = (a: ClaimLock, b: ClaimLock) => byId(a.claim, b.claim);

const filled = (value: unknown): value is string => typeof value === 'string' && value !== '';

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A warning, with the activity line and the claim it concerns when it has them (the dashboard routes it by claim). */
function warning(code: string, message: string, at: { readonly line?: number; readonly claim?: string } = {}): LockDiagnostic {
  return { severity: 'warning', code, message, ...(at.line === undefined ? {} : { line: at.line }), ...(at.claim === undefined ? {} : { claim: at.claim }) };
}

interface SourceRead {
  /** False when the source does not exist; its locks and diagnostics are then empty. */
  readonly present: boolean;
  readonly locks: ClaimLock[];
  readonly diagnostics: LockDiagnostic[];
  /** The run events read, in file order; only the activity log carries them. */
  readonly runs: RunLine[];
  /** The open runs (spec 040, ISC-222); absent unless the activity log holds a `run-start` or `run-end` line. */
  readonly openRuns?: OpenRun[];
  /** The step events (spec 015, ISC-230); absent unless the activity log holds a `probe` or `question` line. */
  readonly steps?: StepEvent[];
  /** The releases that ended a held claim (spec 015, ISC-231); absent unless the activity log holds one. */
  readonly releases?: ClaimRelease[];
}

const ABSENT: SourceRead = { present: false, locks: [], diagnostics: [], runs: [] };

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readFrontier(repoRoot: string, stateDir: string, now: number): Promise<SourceRead> {
  if (!(await isDirectory(stateDir))) return ABSENT;
  const isa = resolve(repoRoot, 'ISA.md');
  const real = await realpath(isa).catch(() => isa);
  const dir = join(stateDir, 'isa-locks', createHash('sha1').update(real).digest('hex').slice(0, 16));
  const locks: ClaimLock[] = [];
  const diagnostics: LockDiagnostic[] = [];

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      diagnostics.push(warning('locks-frontier-unreadable', `The frontier lock directory for this ISA could not be read (${errorCode(error) || 'error'}).`));
    }
    return { present: true, locks, diagnostics, runs: [] };
  }

  const claims = names
    .filter((n) => n.endsWith(LOCK_SUFFIX) && n.length > LOCK_SUFFIX.length)
    .map((n) => n.slice(0, -LOCK_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const claim of claims) {
    const malformed = (why: string) => diagnostics.push(warning('locks-frontier-malformed', `The frontier lock for ${claim} ${why}; it is not counted.`, { claim }));
    let data: unknown;
    try {
      data = JSON.parse(await readFile(join(dir, `${claim}${LOCK_SUFFIX}`), 'utf8'));
    } catch {
      malformed('is not readable JSON');
      continue;
    }
    if (!isRecord(data)) {
      malformed('is not a JSON object');
      continue;
    }
    const { session, ts } = data;
    if (typeof session !== 'string' || session === '') {
      malformed('names no session');
      continue;
    }
    const since = typeof ts === 'string' ? Date.parse(ts) : Number.NaN;
    if (typeof ts !== 'string' || !Number.isFinite(since)) {
      malformed('carries no valid timestamp');
      continue;
    }
    // LifeOS stores the path the session used, not the real one, so a differing string may still be this ISA.
    if (typeof data.isa === 'string' && data.isa !== isa && data.isa !== real && (await realpath(data.isa).catch(() => null)) !== real) {
      diagnostics.push(warning('locks-frontier-foreign', `The frontier lock for ${claim} names another ISA file; it is not counted.`, { claim }));
      continue;
    }
    const actor = parseActor(session);
    const legacy = legacyActorWarning([{ ref: actor }], 'session', `The frontier lock for ${claim}`);
    if (legacy !== null) diagnostics.push({ ...legacy, claim });
    if (now - since > FRONTIER_STALE_MS) {
      diagnostics.push(warning('locks-frontier-stale', `The frontier lock for ${claim} (${session}, since ${ts}) is older than two hours; LifeOS treats it as stale, so it is not counted.`, { claim }));
      continue;
    }
    locks.push({ source: 'frontier', claim, session, actor, since: ts });
  }
  return { present: true, locks, diagnostics, runs: [] };
}

/** The run lifecycle state of one activity log (spec 040, ISC-222): open runs by id in start order, every id started. */
interface LifecycleState {
  readonly open: Map<string, OpenRun>;
  readonly started: Set<string>;
}

/**
 * Reads one `run-start` or `run-end` line into `state`: a start opens its run, an end closes it. A malformed line, an
 * end without an open run and a start reusing a run id each push one warning and change nothing. Returns the session's
 * actor sighting when the line was well-formed, for the file's one `actor-legacy` warning.
 */
function readLifecycle(entry: Record<string, unknown>, event: RunLifecycleEvent, line: number, state: LifecycleState, diagnostics: LockDiagnostic[]): ActorSighting | null {
  const { ts, run, command, session, spec, idea, outcome } = entry;
  if (!filled(ts) || !filled(run) || !filled(command) || !filled(session)) {
    diagnostics.push(warning('locks-activity-malformed', `The ${event} line lacks a ts, a run, a command or a session; it is skipped.`, { line }));
    return null;
  }
  if (filled(spec) === filled(idea)) {
    const why = filled(spec) ? 'names both a spec and an idea' : 'names neither a spec nor an idea';
    diagnostics.push(warning('locks-activity-malformed', `The ${event} line of run ${run} ${why}; it is skipped.`, { line }));
    return null;
  }
  if (event === 'run-end' && outcome !== undefined && !(typeof outcome === 'string' && OUTCOMES.has(outcome))) {
    const message = `The run-end line of run ${run} carries the outcome ${JSON.stringify(outcome)}, none of ok, error or released; it is skipped.`;
    diagnostics.push(warning('locks-activity-malformed', message, { line }));
    return null;
  }
  const actor = parseActor(session);
  if (event === 'run-end') {
    if (!state.open.delete(run)) {
      diagnostics.push(warning('locks-activity-run-unmatched', `The run-end line of run ${run} ends no open run; it is skipped.`, { line }));
    }
    return { ref: actor, line };
  }
  if (state.started.has(run)) {
    diagnostics.push(warning('locks-activity-run-duplicate', `The run-start line reuses the run id ${run}; it is skipped.`, { line }));
    return { ref: actor, line };
  }
  state.started.add(run);
  state.open.set(run, { run, command, session, actor, since: ts, ...(filled(spec) ? { spec } : {}), ...(filled(idea) ? { idea } : {}), line });
  return { ref: actor, line };
}

/** The claim a malformed activity entry still names, so its warning reaches that claim's row. */
const claimOf = (entry: Record<string, unknown>): { claim?: string } => (typeof entry.claim === 'string' && entry.claim !== '' ? { claim: entry.claim } : {});

/**
 * Reads one `probe` or `question` line (spec 015, ISC-230): the step, or null after one `locks-activity-malformed`
 * warning at its line when it lacks a required field. A question's text is kept as `questionText` cuts it.
 */
function readStep(entry: Record<string, unknown>, event: StepKind, line: number, diagnostics: LockDiagnostic[]): StepEvent | null {
  const { ts, task, session, worktree, claim, result, text } = entry;
  const malformed = (why: string): null => {
    diagnostics.push(warning('locks-activity-malformed', `The ${event} line ${why}; it is skipped.`, { line, ...claimOf(entry) }));
    return null;
  };
  if (!filled(task) || !filled(session) || !filled(ts)) return malformed('lacks a task, a session or a ts');
  const place = filled(worktree) ? { worktree } : {};
  if (event === 'probe') {
    if (!filled(claim) || !isProbeResult(result)) return malformed(`of ${task} lacks a claim or a result red or green`);
    return { event, task, claim, result, session, ...place, ts };
  }
  const kept = typeof text === 'string' ? questionText(text) : '';
  if (kept.trim() === '') return malformed(`of ${task} carries no text`);
  return { event, task, ...claimOf(entry), text: kept, session, ...place, ts };
}

async function readActivity(repoRoot: string): Promise<SourceRead> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, '.spectant', 'activity.jsonl'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return ABSENT;
    return { present: false, locks: [], diagnostics: [warning('locks-activity-unreadable', `.spectant/activity.jsonl could not be read (${errorCode(error) || 'error'}).`)], runs: [] };
  }
  return parseActivity(text);
}

/** The text of `.spectant/activity.jsonl` read as its source: pure, the one parse `readActivity` and `activityReading` share. */
function parseActivity(text: string): SourceRead {
  const held = new Map<string, ClaimLock>();
  const diagnostics: LockDiagnostic[] = [];
  const runs: RunLine[] = [];
  const actors: Array<ActorSighting & { readonly claim?: string }> = [];
  let unknownSeen = false;
  const lifecycle: LifecycleState = { open: new Map(), started: new Set() };
  let lifecycleLines = 0;
  const steps: StepEvent[] = [];
  let stepLines = 0;
  const releases: ClaimRelease[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      diagnostics.push(warning('locks-activity-malformed', 'The line is not JSON; it is skipped.', { line }));
      return;
    }
    if (!isRecord(entry)) {
      diagnostics.push(warning('locks-activity-malformed', 'The line is not a JSON object; it is skipped.', { line }));
      return;
    }
    const { ts, event, claim, session } = entry;
    if (!filled(event)) {
      diagnostics.push(warning('locks-activity-malformed', 'The line names no event; it is skipped.', { line, ...claimOf(entry) }));
      return;
    }
    if (isLifecycleEvent(event)) {
      // Additive (spec 040, ISC-222.2): these lines touch neither the locks nor the task runs.
      lifecycleLines += 1;
      const sighting = readLifecycle(entry, event, line, lifecycle, diagnostics);
      if (sighting !== null) actors.push(sighting);
      return;
    }
    if (isStepEvent(event)) {
      // Additive (spec 015, ISC-230.1): a step goes to its own list and touches neither the locks nor the task runs.
      stepLines += 1;
      const step = readStep(entry, event, line, diagnostics);
      if (step !== null) {
        actors.push({ ref: parseActor(step.session), line, ...claimOf(entry) });
        steps.push(step);
      }
      return;
    }
    if (event !== 'claim' && event !== 'release' && !isRunEvent(event)) {
      // One warning per file, at the first unknown event; it and every later unknown line are skipped, the rest is read.
      // The text names the six older events only, so a log without run lines warns byte for byte as before spec 040.
      if (!unknownSeen) {
        unknownSeen = true;
        const message = `The event ${JSON.stringify(event)} is none of claim, release, dispatch, build, patch or apply; this and any later line with an unknown event is skipped, and the file is read on.`;
        diagnostics.push(warning('activity-event-unknown', message, { line, ...claimOf(entry) }));
      }
      return;
    }
    if (isRunEvent(event)) {
      // `worktree` is required only once the builder's worktree exists: on `patch` and `apply` (spec 035, ISC-189).
      const { task, worktree } = entry;
      const needsWorktree = event === 'patch' || event === 'apply';
      if (!filled(task) || !filled(session) || !filled(ts) || (needsWorktree && !filled(worktree))) {
        const fields = needsWorktree ? 'a task, a session, a worktree or a ts' : 'a task, a session or a ts';
        diagnostics.push(warning('locks-activity-malformed', `The ${event} line lacks ${fields}; it is skipped.`, { line, ...claimOf(entry) }));
        return;
      }
      actors.push({ ref: parseActor(session), line, ...claimOf(entry) });
      const run: RunLine = { event, task, session, ...(filled(worktree) ? { worktree } : {}), ts, ...claimOf(entry) };
      // Without a claim only its spec session or spec worktree assigns the line to a spec (spec 041, ISC-213).
      if (run.claim === undefined && runSpecOf(run) === null) {
        const message = `The ${event} line of ${task} names no claim, no spec session (a:<kind>:spec-NNN/…) and no spec worktree (.worktrees/NNN-slug); it counts for no spec.`;
        diagnostics.push(warning('locks-activity-unassigned', message, { line }));
      }
      runs.push(run);
      return;
    }
    if (!filled(claim) || !filled(session) || !filled(ts)) {
      diagnostics.push(warning('locks-activity-malformed', 'The line lacks a claim, a session or a ts; it is skipped.', { line, ...claimOf(entry) }));
      return;
    }
    const actor = parseActor(session);
    actors.push({ ref: actor, line, claim });
    const holder = held.get(claim);
    if (event === 'claim') {
      if (holder?.session === session) return; // a repeated claim by the holder keeps the first `since`
      if (holder !== undefined) {
        diagnostics.push(warning('locks-activity-takeover', `${claim} is claimed by ${session} while ${holder.session} holds it; the later claim holds it now.`, { line, claim }));
        held.delete(claim);
      }
      held.set(claim, { source: 'activity', claim, session, actor, since: ts });
      return;
    }
    if (holder === undefined) {
      diagnostics.push(warning('locks-activity-release-unclaimed', `${claim} is released by ${session} but is not held.`, { line, claim }));
    } else if (holder.session !== session) {
      diagnostics.push(warning('locks-activity-release-foreign', `${claim} is released by ${session} but held by ${holder.session}; it stays held.`, { line, claim }));
    } else {
      held.delete(claim);
      const { task, worktree } = entry;
      releases.push({ claim, session, ts, ...(filled(task) ? { task } : {}), ...(filled(worktree) ? { worktree } : {}) });
    }
  });
  const legacy = legacyActorWarning(actors, 'session');
  const first = actors.find((a) => a.ref.legacy);
  if (legacy !== null && first !== undefined) diagnostics.push({ ...legacy, ...(first.claim === undefined ? {} : { claim: first.claim }) });
  return {
    present: true,
    locks: [...held.values()].sort(byClaim),
    diagnostics,
    runs,
    ...(lifecycleLines > 0 ? { openRuns: [...lifecycle.open.values()] } : {}),
    ...(stepLines > 0 ? { steps } : {}),
    ...(releases.length > 0 ? { releases } : {}),
  };
}

/**
 * Each task's run as its last run event leaves it (spec 027, ISC-179): one TaskRun per task that a run event of
 * `reading` names, in task-ID order. The last event in file order decides, so a re-dispatch after an apply reads
 * `dispatched` again; `apply` is `applied` when `ticked` (the ids tasks.md checks) holds the task, else `applied-open`.
 * The run carries that last event's session, worktree and ts. Pure. Keyed by task id alone: the log is repository-wide,
 * so a caller showing one spec passes only that spec's run lines.
 */
export function runStates(reading: LockReading, ticked: ReadonlySet<string>): readonly TaskRun[] {
  const last = new Map<string, RunLine>();
  for (const run of reading.runs ?? []) last.set(run.task, run);
  return [...last.values()]
    .sort((a, b) => byId(a.task, b.task))
    .map(({ event, task, session, worktree, ts }) => ({
      task,
      state: event === 'apply' && !ticked.has(task) ? 'applied-open' : RUN_STATE[event],
      session,
      ...(worktree === undefined ? {} : { worktree }),
      ts,
    }));
}

/**
 * Reads the lock sources of the repository at `input.repoRoot`. `lifeosStateDir` absent or null: no LifeOS path is
 * read. Resolves, never rejects on file content; see the module header for both shapes and FORMAT.md § Activity and
 * lock lines for the contract.
 */
export async function readLockSources(input: LockReadInput): Promise<LockReading> {
  const now = (input.now ?? new Date()).getTime();
  const [frontier, activity] = await Promise.all([
    input.lifeosStateDir ? readFrontier(input.repoRoot, input.lifeosStateDir, now) : Promise.resolve(ABSENT),
    readActivity(input.repoRoot),
  ]);
  return readingOf(frontier, activity);
}

/**
 * The reading `readLockSources` gives for a repository whose `.spectant/activity.jsonl` holds `text` and with no
 * LifeOS state directory, without touching the file system (spec 040, T53): for a caller that holds an edited log in
 * memory, such as the e2e stub's run variants, so the locks, task runs and open runs stay this module's parse.
 */
export function activityReading(text: string): LockReading {
  return readingOf(ABSENT, parseActivity(text));
}

/** The two sources' reads as one reading: activity's locks first, frontier's last (a last-wins consumer takes it). */
function readingOf(frontier: SourceRead, activity: SourceRead): LockReading {
  const sources: AgentLockSource[] = [];
  if (frontier.present) sources.push('frontier');
  if (activity.present) sources.push('activity');
  return {
    source: sources[0] ?? 'none',
    sources,
    // Activity first, frontier last: a last-wins consumer (status.ts `partitionClaims`) takes the frontier lock.
    locks: [...activity.locks, ...frontier.locks],
    diagnostics: [...frontier.diagnostics, ...activity.diagnostics],
    runs: activity.runs,
    ...(activity.openRuns === undefined ? {} : { openRuns: activity.openRuns }),
    ...(activity.steps === undefined ? {} : { steps: activity.steps }),
    ...(activity.releases === undefined ? {} : { releases: activity.releases }),
  };
}
