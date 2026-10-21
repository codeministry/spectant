/**
 * The write mechanism (T68, ISC-26, ISC-27, ISC-86; plan 002 § Interfaces "HTTP", the two writes): the only code that
 * writes into a registered repository. The gate route (`gate-route.ts`) and the checkbox route (`checkbox-route.ts`)
 * say what to read and what to write; this module runs every write the same way:
 *
 * 1. The lock sources are read (`readLockSources`: LifeOS frontier locks when a state directory is given,
 *    `.spectant/activity.jsonl` when present). This is the only await.
 * 2. From here on everything is synchronous, so nothing else in this process runs between the read, the compare and
 *    the write: the target is read and hashed (`hashForGate` for the three gate files, raw sha256 for tasks.md) and
 *    compared with the hash the client rendered. A mismatch is the 409 of `writes.contract.ts`; nothing is written.
 * 3. The locks held on this spec's claims (the live frame's `locks`, so the page and the refusal agree) go through
 *    `blockingLock`: any lock is the 423, naming the task's own claim first. With no source at all the write proceeds
 *    under the hash check alone and the answer carries `lockSource: 'none'` (ISC-86). Strictly after it (spec 040,
 *    T31, ISC-225) the open runs of the same reading go through core's `runLockOf`: a run `running` on the write's
 *    item (the spec, or the story for the allocation) is the 423 `run-locked`; an `aborted` one, older than
 *    `abortAfterMs` (the `runAbortMinutes` setting), locks nothing. The server never decides running itself.
 * 4. The target is written in place: open, write, fsync, close. No temp file, no rename, no git object; `.gates/` is
 *    the one directory that may be created. An event line is appended the same way (`eventAppendBytes`).
 *
 * Spec 027 (T22, ISC-181): the three writes on an existing spec (reviewed mark, tick, stage move) take the folder of
 * the spec's read source as `ref.dir`, the worktree copy's when `readSpecSource` reads the spec from it, so the file
 * they hash is the file the client's hash came from and the file they write; the main checkout then stays untouched.
 * The lock sources stay at the repository `root`. A source that switched between render and write needs no rule of its
 * own: the other copy's bytes fail the compare, the plain 409 with `files`. The allocation always targets `root`.
 */
import { abortAge } from "../infra/abort-age.ts";
import { join } from "node:path";
import type { ClaimLock, LockReading, LockSource, SpecFiles } from "../../../core/src/files.ts";
import { type RunLockTarget, runLockOf } from "../../../core/src/item-state.ts";
import { buildLiveFrame } from "../../../core/src/live.ts";
import { readLockSources } from "../../../core/src/locks.ts";
import type { NotFound } from "../contracts/spec-routes.contract.ts";
import {
  type RunLocked,
  type WriteAnswer,
  type WriteOk,
  type WriteOperation,
  type WriteRefused,
  type WriteStale,
  blockingLock,
  runLockedOf,
} from "../contracts/writes.contract.ts";
import { ensureDir } from "../infra/fs/in-place.ts";

/** Creates `<specDir>/.gates/` when missing (that directory only, never a parent) and returns its path. */
export function ensureGatesDir(specDir: string): string {
  const dir = join(specDir, ".gates");
  ensureDir(dir);
  return dir;
}

/** The locks held on this spec's claims, exactly as the live frame reads them (one per claim, frontier winning). */
export function specLocks(files: SpecFiles, reading: LockReading, now: Date): readonly ClaimLock[] {
  return buildLiveFrame({ files, locks: reading, now }).locks;
}

/** What a write read from disk (step 2): the 409 body, or the claim it touches and the commit that writes it. */
export type WriteRead<R extends WriteOperation> =
  | { readonly stale: WriteStale[R] }
  | {
      /** The spec folder's texts as just read, for the spec's claims. */
      readonly files: SpecFiles;
      /** The task's claim (named first in a 423); null for the gate and the transition. */
      readonly claim: string | null;
      /**
       * The 422 body of a refusable write (the workflow says no), answered after the lock check; or the commit, which
       * writes the target in place and returns the 200 body.
       */
      readonly commit: ((lockSource: LockSource) => WriteOk[R]) | { readonly refused: R extends keyof WriteRefused ? WriteRefused[R] : never };
    };

export interface WriteInput<R extends WriteOperation> {
  /** The repository root: where `.spectant/activity.jsonl` and `ISA.md` are. */
  readonly root: string;
  /** The LifeOS state directory; null reads no LifeOS path. */
  readonly stateDir: string | null;
  readonly now: Date;
  /**
   * Synchronous: reads the target, compares its hash; null when the target names nothing (404). It gets the lock
   * reading of step 1, the one the 423 is decided on, so a write that needs the claim partition (the transition)
   * partitions under the same locks.
   */
  readonly read: (locks: LockReading) => WriteRead<R> | null;
  /** The item an open run locks the write on (ISC-225); the spec of the read's `files` when absent. */
  readonly runTarget?: RunLockTarget;
  /** The age after which an open run reads `aborted` (`runAbortMinutes` × 60 000); core's default when absent. */
  readonly abortAfterMs?: number;
}

/** A write's answer: its own (`WriteAnswer`), the route layer's 404, or the run lock's 423 (spec 040, ISC-225). */
export type WriteResult<R extends WriteOperation> =
  | WriteAnswer<R>
  | { readonly status: 404; readonly body: NotFound }
  | { readonly status: 423; readonly body: RunLocked };

/**
 * Runs one write: locks read, then read + compare (409) + lock check (423) + refusal (422) + write, without yielding
 * in between.
 */
export async function runWrite<R extends WriteOperation>(input: WriteInput<R>): Promise<WriteResult<R>> {
  const reading = await readLockSources({ repoRoot: input.root, lifeosStateDir: input.stateDir, now: input.now });
  const read = input.read(reading);
  if (read === null) return { status: 404, body: { error: "not-found" } };
  if ("stale" in read) return { status: 409, body: read.stale };
  const locked = blockingLock(specLocks(read.files, reading, input.now), read.claim);
  if (locked !== null) return { status: 423, body: locked };
  const target = input.runTarget ?? { spec: read.files.folder };
  const runLocked = runLockedOf(runLockOf(reading.openRuns ?? [], target, { now: input.now, ...abortAge(input.abortAfterMs) }));
  if (runLocked !== null) return { status: 423, body: runLocked };
  if (typeof read.commit !== "function") return { status: 422, body: read.commit.refused } as WriteResult<R>;
  return { status: 200, body: read.commit(reading.source) };
}
