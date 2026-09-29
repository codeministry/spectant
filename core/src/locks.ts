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
// The reading names `frontier` when a LifeOS state directory exists, else `activity` when the log exists, else `none`.
// With no state directory given, nothing outside `repoRoot` is touched (ISC-37). Server-side module: it reads through
// `node:fs/promises` and hashes with `node:crypto`, no Bun API, so the server and the plugin can both import it.
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Diagnostic } from './diagnostics.ts';
import type { AgentLockSource, ClaimLock, LockReadInput, LockReading } from './files.ts';

/** LifeOS's default stale TTL for a frontier lock: a session silent this long has died or moved on. */
export const FRONTIER_STALE_MS = 2 * 60 * 60 * 1000;

const LOCK_SUFFIX = '.lock';

const byClaim = (a: ClaimLock, b: ClaimLock) => a.claim.localeCompare(b.claim, 'en', { numeric: true });

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function warning(code: string, message: string, line?: number): Diagnostic {
  return line === undefined ? { severity: 'warning', code, message } : { severity: 'warning', code, message, line };
}

interface SourceRead {
  /** False when the source does not exist; its locks and diagnostics are then empty. */
  readonly present: boolean;
  readonly locks: ClaimLock[];
  readonly diagnostics: Diagnostic[];
}

const ABSENT: SourceRead = { present: false, locks: [], diagnostics: [] };

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
  const diagnostics: Diagnostic[] = [];

  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') {
      diagnostics.push(warning('locks-frontier-unreadable', `The frontier lock directory for this ISA could not be read (${errorCode(error) || 'error'}).`));
    }
    return { present: true, locks, diagnostics };
  }

  const claims = names
    .filter((n) => n.endsWith(LOCK_SUFFIX) && n.length > LOCK_SUFFIX.length)
    .map((n) => n.slice(0, -LOCK_SUFFIX.length))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const claim of claims) {
    const malformed = (why: string) => diagnostics.push(warning('locks-frontier-malformed', `The frontier lock for ${claim} ${why}; it is not counted.`));
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
      diagnostics.push(warning('locks-frontier-foreign', `The frontier lock for ${claim} names another ISA file; it is not counted.`));
      continue;
    }
    if (now - since > FRONTIER_STALE_MS) {
      diagnostics.push(warning('locks-frontier-stale', `The frontier lock for ${claim} (${session}, since ${ts}) is older than two hours; LifeOS treats it as stale, so it is not counted.`));
      continue;
    }
    locks.push({ source: 'frontier', claim, session, since: ts });
  }
  return { present: true, locks, diagnostics };
}

async function readActivity(repoRoot: string): Promise<SourceRead> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, '.spectant', 'activity.jsonl'), 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT' || errorCode(error) === 'ENOTDIR') return ABSENT;
    return { present: false, locks: [], diagnostics: [warning('locks-activity-unreadable', `.spectant/activity.jsonl could not be read (${errorCode(error) || 'error'}).`)] };
  }

  const held = new Map<string, ClaimLock>();
  const diagnostics: Diagnostic[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;
    let entry: unknown;
    try {
      entry = JSON.parse(raw);
    } catch {
      diagnostics.push(warning('locks-activity-malformed', 'The line is not JSON; it is skipped.', line));
      return;
    }
    if (!isRecord(entry)) {
      diagnostics.push(warning('locks-activity-malformed', 'The line is not a JSON object; it is skipped.', line));
      return;
    }
    const { ts, event, claim, session } = entry;
    if (event !== 'claim' && event !== 'release') {
      diagnostics.push(warning('locks-activity-malformed', `The event is not "claim" or "release"; the line is skipped.`, line));
      return;
    }
    if (typeof claim !== 'string' || claim === '' || typeof session !== 'string' || session === '' || typeof ts !== 'string' || ts === '') {
      diagnostics.push(warning('locks-activity-malformed', 'The line lacks a claim, a session or a ts; it is skipped.', line));
      return;
    }
    const holder = held.get(claim);
    if (event === 'claim') {
      if (holder?.session === session) return; // a repeated claim by the holder keeps the first `since`
      if (holder !== undefined) {
        diagnostics.push(warning('locks-activity-takeover', `${claim} is claimed by ${session} while ${holder.session} holds it; the later claim holds it now.`, line));
        held.delete(claim);
      }
      held.set(claim, { source: 'activity', claim, session, since: ts });
      return;
    }
    if (holder === undefined) {
      diagnostics.push(warning('locks-activity-release-unclaimed', `${claim} is released by ${session} but is not held.`, line));
    } else if (holder.session !== session) {
      diagnostics.push(warning('locks-activity-release-foreign', `${claim} is released by ${session} but held by ${holder.session}; it stays held.`, line));
    } else {
      held.delete(claim);
    }
  });
  return { present: true, locks: [...held.values()].sort(byClaim), diagnostics };
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
  };
}
