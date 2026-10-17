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
//    file, at its first line; that line and every later unknown one are skipped, and the file is read on.
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
import type { AgentLockSource, ClaimLock, LockDiagnostic, LockReadInput, LockReading, RunEvent, RunState, TaskRun } from './files.ts';

/** LifeOS's default stale TTL for a frontier lock: a session silent this long has died or moved on. */
export const FRONTIER_STALE_MS = 2 * 60 * 60 * 1000;

const LOCK_SUFFIX = '.lock';

/** One run event as the reading carries it (`LockReading.runs`). */
type RunLine = NonNullable<LockReading['runs']>[number];

/** The state each run event leaves its task in; `apply` reads `applied-open` until tasks.md ticks the task. */
const RUN_STATE: Readonly<Record<RunEvent, RunState>> = { dispatch: 'dispatched', build: 'building', patch: 'patched', apply: 'applied' };

const isRunEvent = (event: string): event is RunEvent => Object.hasOwn(RUN_STATE, event);

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

/** The claim a malformed activity entry still names, so its warning reaches that claim's row. */
const claimOf = (entry: Record<string, unknown>): { claim?: string } => (typeof entry.claim === 'string' && entry.claim !== '' ? { claim: entry.claim } : {});

async function readActivity(repoRoot: string): Promise<SourceRead> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, '.spectant', 'activity.jsonl'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return ABSENT;
    return { present: false, locks: [], diagnostics: [warning('locks-activity-unreadable', `.spectant/activity.jsonl could not be read (${errorCode(error) || 'error'}).`)], runs: [] };
  }

  const held = new Map<string, ClaimLock>();
  const diagnostics: LockDiagnostic[] = [];
  const runs: RunLine[] = [];
  const actors: Array<ActorSighting & { readonly claim?: string }> = [];
  let unknownSeen = false;
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
    if (event !== 'claim' && event !== 'release' && !isRunEvent(event)) {
      // One warning per file, at the first unknown event; it and every later unknown line are skipped, the rest is read.
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
      runs.push({ event, task, session, ...(filled(worktree) ? { worktree } : {}), ts, ...claimOf(entry) });
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
    }
  });
  const legacy = legacyActorWarning(actors, 'session');
  const first = actors.find((a) => a.ref.legacy);
  if (legacy !== null && first !== undefined) diagnostics.push({ ...legacy, ...(first.claim === undefined ? {} : { claim: first.claim }) });
  return { present: true, locks: [...held.values()].sort(byClaim), diagnostics, runs };
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
  };
}
