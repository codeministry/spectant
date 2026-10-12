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
import { parseClaims } from "../../core/src/claims.ts";
import type { ClaimLock, LockReading, LockSource, SpecFiles, Workflow, WorkflowStage } from "../../core/src/files.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { gateState, hashForGate, readGateMark, reviewedGate } from "../../core/src/gates.ts";
import { buildLiveFrame } from "../../core/src/live.ts";
import { readLockSources } from "../../core/src/locks.ts";
import type { SpecRef } from "../../core/src/resolve.ts";
import { specIdOf } from "../../core/src/spec-ref.ts";
import { mainFeatureOf, partitionClaims } from "../../core/src/status.ts";
import { type TransitionInput, planTransition } from "../../core/src/transition.ts";
import type { NotFound, ReviewedHashes, TransitionRequest } from "./spec-routes.contract.ts";
import { readBytesIfExists, readIfExists, readSpecFiles, readWorkspaceInput } from "./workspace-loader.ts";
import {
  EVENTS_PATH,
  SPEC_PATH,
  type WriteAnswer,
  type WriteOk,
  type WriteOperation,
  type WriteRefused,
  type WriteStale,
  blockingLock,
  eventAppendBytes,
  specConflict,
  writeActorOf,
} from "./writes.contract.ts";

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
}

export type WriteResult<R extends WriteOperation> = WriteAnswer<R> | { readonly status: 404; readonly body: NotFound };

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
  if (typeof read.commit !== "function") return { status: 422, body: read.commit.refused } as WriteResult<R>;
  return { status: 200, body: read.commit(reading.source) };
}

// ── the transition (spec 008, T82, ISC-121) ──────────────────────────────────────────────────────────────────────

export interface TransitionWriteInput {
  readonly root: string;
  readonly ref: Pick<SpecRef, "dir" | "slug">;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly body: TransitionRequest;
}

/** What the transition needs of the whole workspace: read before the write's one await, never between compare and write. */
interface WorkspaceContext {
  readonly workflow: Workflow;
  readonly viewer: string | null;
  readonly constitution: string | null;
  readonly worktreeTree: string | null;
  /** The active spec folders, for the open siblings of the spec's main feature. */
  readonly specs: readonly SpecFiles[];
}

/**
 * Whether an active spec holds its main feature's code review back, as `dashboard.ts` decides it for row 7 (T49):
 * not `phase: complete` and at least one claim neither checked nor dropped. Core keeps this predicate private
 * (`holdsFeatureOpen`), so it is restated here over core's parsed claims; nothing of the format is parsed in server/.
 */
function holdsFeatureOpen(files: SpecFiles): boolean {
  const spec = files.texts.spec;
  if (spec === undefined) return false;
  return parseFrontmatter(spec).data.phase !== "complete" && parseClaims(spec).claims.some((c) => !c.checked && !c.dropped);
}

/** The ids of the active specs of `feature` that still hold it open, in folder order, `self` left out (dashboard row 7). */
function featureSiblingsOpenOf(feature: string | null, self: string, specs: readonly SpecFiles[]): string[] {
  if (feature === null) return [];
  return [...specs]
    .sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0))
    .filter((f) => f.texts.spec !== undefined && mainFeatureOf(parseFrontmatter(f.texts.spec).data.isaFeature) === feature && holdsFeatureOpen(f))
    .map((f) => specIdOf(f.folder) ?? f.folder)
    .filter((id) => id !== self);
}

/**
 * `planTransition`'s input for one spec folder as just read, built the way `dashboard.ts` builds its stage input: the
 * reviewed mark's state (`reviewedGate`), the claim partition under the write's lock reading (`partitionClaims`,
 * counted as the dashboard counts it), the code-reviewed mark against the worktree tree, the open siblings.
 */
function transitionInput(files: SpecFiles, ctx: WorkspaceContext, locks: LockReading, to: WorkflowStage, now: Date): TransitionInput {
  const spec = files.texts.spec ?? "";
  const reviewed = reviewedGate(files.texts).check.state;
  const partition = partitionClaims(parseClaims(spec).claims, locks.locks, reviewed);
  const codeMark = files.texts.gateCodeReviewed === undefined ? null : readGateMark("code-reviewed", files.texts.gateCodeReviewed).mark;
  const id = specIdOf(files.folder) ?? files.folder;
  return {
    files,
    workflow: ctx.workflow,
    to,
    actor: writeActorOf(ctx.viewer),
    now,
    reviewed,
    codeReviewed: gateState("code-reviewed", codeMark, { worktreeTree: ctx.worktreeTree }).state,
    partition: {
      takeable: partition.takeable.length,
      open: partition.open.length - partition.takeable.length,
      closed: partition.closed.length - partition.dropped.length,
      dropped: partition.dropped.length,
    },
    featureSiblingsOpen: featureSiblingsOpenOf(mainFeatureOf(parseFrontmatter(spec).data.isaFeature), id, ctx.specs),
  };
}

/**
 * The stage move (T82, ISC-121): the workspace is read first (workflow, viewer, siblings, tree id), then under
 * `runWrite` the lock sources (423 while a session holds a claim of the spec), spec.md's raw sha256 against the
 * client's (409 `StaleSpec`, untouched), `planTransition` (422 `TransitionRefused`, nothing written), and on yes
 * `specText` written in place and the one event line appended to `events.jsonl`, created when absent.
 */
export async function writeTransition(input: TransitionWriteInput): Promise<WriteResult<"transition">> {
  const { ref, now, body } = input;
  const reading = await readWorkspaceInput(input.root, input.stateDir);
  if (!reading.readable) throw Object.assign(new Error(reading.error), { code: errnoOf(reading.error) });
  const ctx: WorkspaceContext = {
    workflow: reading.workflow,
    viewer: reading.viewer,
    constitution: reading.input.constitution,
    worktreeTree: reading.input.worktreeTree ?? null,
    specs: reading.input.specs,
  };
  return runWrite<"transition">({
    root: input.root,
    stateDir: input.stateDir,
    now,
    read: (locks) => {
      const path = join(ref.dir, SPEC_PATH);
      const bytes = readBytesIfExists(path);
      if (bytes === null) return null;
      const stale = specConflict(body.hash, rawSha256(bytes));
      if (stale !== null) return { stale };
      const read = readSpecFiles(ref);
      // The plan works on exactly the bytes just hashed; the other files of the folder as read beside them.
      const files: SpecFiles = { folder: read.folder, texts: { ...read.texts, spec: bytes.toString("utf8") } };
      const withConstitution = ctx.constitution === null ? files : { folder: files.folder, texts: { ...files.texts, constitution: ctx.constitution } };
      const plan = planTransition(transitionInput(files, ctx, locks, body.to, now));
      if (!plan.ok) return { files: withConstitution, claim: null, commit: { refused: { error: "transition-refused", reason: plan.reason, command: plan.command } } };
      return {
        files: withConstitution,
        claim: null,
        commit: (lockSource) => {
          writeInPlace(path, plan.specText);
          const events = join(ref.dir, EVENTS_PATH);
          appendInPlace(events, eventAppendBytes(readIfExists(events), plan.event));
          return { from: plan.from, to: plan.to, hash: rawSha256(plan.specText), event: plan.event, lockSource };
        },
      };
    },
  });
}

/** An unreadable workspace's code as the errno its route layer maps back (`unreadableCode`) to the 409 summary. */
function errnoOf(code: "missing" | "not-a-directory" | "permission-denied" | "unreadable"): string {
  return { missing: "ENOENT", "not-a-directory": "ENOTDIR", "permission-denied": "EACCES", unreadable: "EIO" }[code];
}
