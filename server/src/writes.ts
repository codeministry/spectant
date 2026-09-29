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
 *    under the hash check alone and the answer carries `lockSource: 'none'` (ISC-86).
 * 4. The target is written in place: open, write, fsync, close. No temp file, no rename, no git object; `.gates/` is
 *    the one directory that may be created. An event line is appended the same way (`eventAppendBytes`).
 */
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { ClaimLock, LockReading, LockSource, SpecFiles } from "../../core/src/files.ts";
import { hashForGate } from "../../core/src/gates.ts";
import { buildLiveFrame } from "../../core/src/live.ts";
import { readLockSources } from "../../core/src/locks.ts";
import type { NotFound, ReviewedHashes } from "./spec-routes.contract.ts";
import { type WriteAnswer, type WriteOk, type WriteRoute, type WriteStale, blockingLock } from "./writes.contract.ts";

/** sha256 hex of raw bytes: tasks.md's hash (`X-Spectant-Tasks-Hash`). */
export function rawSha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** The three gate hashes of a spec folder's texts (`hashForGate`); null for a file that does not exist. */
export function gateHashes(texts: SpecFiles["texts"]): ReviewedHashes {
  const hash = (file: "spec.md" | "plan.md" | "tasks.md", text: string | undefined): string | null => (text === undefined ? null : hashForGate(file, text));
  return { spec: hash("spec.md", texts.spec), plan: hash("plan.md", texts.plan), tasks: hash("tasks.md", texts.tasks) };
}

function writeAll(fd: number, data: string | Uint8Array): void {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
}

/** Replaces the file's bytes in place (same inode, same mode) and fsyncs it; creates it when missing. */
export function writeInPlace(path: string, data: string | Uint8Array): void {
  const fd = openSync(path, "w");
  try {
    writeAll(fd, data);
  } finally {
    closeSync(fd);
  }
}

/** Appends to the file in place and fsyncs it; creates it when missing. */
export function appendInPlace(path: string, data: string): void {
  const fd = openSync(path, "a");
  try {
    writeAll(fd, data);
  } finally {
    closeSync(fd);
  }
}

/** Creates `<specDir>/.gates/` when missing (that directory only, never a parent) and returns its path. */
export function ensureGatesDir(specDir: string): string {
  const dir = join(specDir, ".gates");
  try {
    mkdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return dir;
}

/** The locks held on this spec's claims, exactly as the live frame reads them (one per claim, frontier winning). */
export function specLocks(files: SpecFiles, reading: LockReading, now: Date): readonly ClaimLock[] {
  return buildLiveFrame({ files, locks: reading, now }).locks;
}

/** What a write read from disk (step 2): the 409 body, or the claim it touches and the commit that writes it. */
export type WriteRead<R extends WriteRoute> =
  | { readonly stale: WriteStale[R] }
  | {
      /** The spec folder's texts as just read, for the spec's claims. */
      readonly files: SpecFiles;
      /** The task's claim (named first in a 423); null for the gate. */
      readonly claim: string | null;
      /** Writes the target in place and returns the 200 body. */
      readonly commit: (lockSource: LockSource) => WriteOk[R];
    };

export interface WriteInput<R extends WriteRoute> {
  /** The repository root: where `.spectant/activity.jsonl` and `ISA.md` are. */
  readonly root: string;
  /** The LifeOS state directory; null reads no LifeOS path. */
  readonly stateDir: string | null;
  readonly now: Date;
  /** Synchronous: reads the target, compares its hash; null when the target names nothing (404). */
  readonly read: () => WriteRead<R> | null;
}

export type WriteResult<R extends WriteRoute> = WriteAnswer<R> | { readonly status: 404; readonly body: NotFound };

/** Runs one write: locks read, then read + compare (409) + lock check (423) + write, without yielding in between. */
export async function runWrite<R extends WriteRoute>(input: WriteInput<R>): Promise<WriteResult<R>> {
  const reading = await readLockSources({ repoRoot: input.root, lifeosStateDir: input.stateDir, now: input.now });
  const read = input.read();
  if (read === null) return { status: 404, body: { error: "not-found" } };
  if ("stale" in read) return { status: 409, body: read.stale };
  const locked = blockingLock(specLocks(read.files, reading, input.now), read.claim);
  if (locked !== null) return { status: 423, body: locked };
  return { status: 200, body: read.commit(reading.source) };
}
