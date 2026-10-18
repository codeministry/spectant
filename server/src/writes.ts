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
 * Spec 008 adds the stage move (`writeTransition`, T82) and the allocation of a story (`writeAllocate`, T86), which
 * creates `specs/NNN-slug/` (its one directory), writes three files there and removes the story file. Spec 036 adds
 * the backlog (`writeBacklog`), the one write that reads no lock source: `specs/backlog.md` belongs to no spec.
 * Spec 040 adds the run release (`writeRunRelease`, ISC-226), the eighth write path and its one file,
 * `.spectant/activity.jsonl` at the main checkout: exactly one `run-end` line with `outcome: released` and the
 * viewer's `u:` id, appended under the raw sha256 of the whole file; never a rewrite, no directory created.
 *
 * Spec 027 (T22, ISC-181): the three writes on an existing spec (reviewed mark, tick, stage move) take the folder of
 * the spec's read source as `ref.dir`, the worktree copy's when `readSpecSource` reads the spec from it, so the file
 * they hash is the file the client's hash came from and the file they write; the main checkout then stays untouched.
 * The lock sources stay at the repository `root`. A source that switched between render and write needs no rule of its
 * own: the other copy's bytes fail the compare, the plain 409 with `files`. The allocation always targets `root`.
 */
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { allocationOf, nextSpecNumber, specNumbersOf } from "../../core/src/allocate.ts";
import { backlogFeatures, planBacklogMove, planBacklogPriority } from "../../core/src/backlog.ts";
import { parseClaims } from "../../core/src/claims.ts";
import { type ClaimLock, type LockReading, type LockSource, type MergeState, type SpecFiles, type Workflow, type WorkflowStage, repoFilePath } from "../../core/src/files.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { gateState, hashForGate, readGateMark, reviewedGate } from "../../core/src/gates.ts";
import { type RunLockTarget, runLockOf } from "../../core/src/item-state.ts";
import { buildLiveFrame } from "../../core/src/live.ts";
import { activityReading, readLockSources } from "../../core/src/locks.ts";
import { readIdeas } from "../../core/src/ideas.ts";
import { type SpecRef, listSpecs } from "../../core/src/resolve.ts";
import { specIdOf } from "../../core/src/spec-ref.ts";
import { type ResolvedSpecEdges, resolveEdges } from "../../core/src/spec-edges.ts";
import { mainFeatureOf, partitionClaims, specEdgeHolds } from "../../core/src/status.ts";
import { type TransitionInput, planTransition } from "../../core/src/transition.ts";
import { takenSpecNumbers } from "./git.ts";
import type { AllocateRequest, BacklogRequest, NotFound, ReviewedHashes, TransitionRequest } from "./spec-routes.contract.ts";
import { readBytesIfExists, readIdeaFiles, readIfExists, readSpecFiles, readWorkspaceInput, viewerActorOf } from "./workspace-loader.ts";
import {
  ACTIVITY_PATH,
  BACKLOG_EVENTS_PATH,
  BACKLOG_PATH,
  CONTEXT_PATH,
  EVENTS_PATH,
  SPEC_PATH,
  type WriteAnswer,
  type WriteOk,
  type WriteOperation,
  type WriteRefused,
  type WriteStale,
  backlogConflict,
  activityConflict,
  blockingLock,
  eventAppendBytes,
  ideaConflict,
  runLockedOf,
  type RunLocked,
  runReleaseAppendBytes,
  runReleaseEvent,
  specConflict,
  writeActorOf,
  writePathsOf,
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
  const runLocked = runLockedOf(runLockOf(reading.openRuns ?? [], target, { now: input.now, ...(input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs }) }));
  if (runLocked !== null) return { status: 423, body: runLocked };
  if (typeof read.commit !== "function") return { status: 422, body: read.commit.refused } as WriteResult<R>;
  return { status: 200, body: read.commit(reading.source) };
}

// ── the transition (spec 008, T82, ISC-121) ──────────────────────────────────────────────────────────────────────

export interface TransitionWriteInput {
  readonly root: string;
  /** `dir` is the folder of the spec's read source: the worktree copy's when the spec is read from it (T22). */
  readonly ref: Pick<SpecRef, "dir" | "slug">;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly body: TransitionRequest;
  /** The run lock's abort age (`WriteInput.abortAfterMs`). */
  readonly abortAfterMs?: number;
}

/** What the transition needs of the whole workspace: read before the write's one await, never between compare and write. */
interface WorkspaceContext {
  readonly workflow: Workflow;
  readonly viewer: string | null;
  readonly constitution: string | null;
  readonly worktreeTree: string | null;
  /** The active spec folders, for the open siblings of the spec's main feature and the spec edges. */
  readonly specs: readonly SpecFiles[];
  /** The archived spec folders and the merge state, which `resolveEdges` reads as the dashboard does (spec 025). */
  readonly archived: readonly SpecFiles[];
  readonly mergeState: readonly MergeState[];
}

/**
 * The spec edges over the workspace as the dashboard resolves them (`resolveEdges` with the server's merge state), the
 * spec's own folder taken as just read, so its edges are those of the bytes the plan works on.
 */
function workspaceEdgesOf(files: SpecFiles, ctx: WorkspaceContext): ResolvedSpecEdges {
  const specs = ctx.specs.map((f) => (f.folder === files.folder ? files : f));
  return resolveEdges({ specs, archived: ctx.archived, constitution: ctx.constitution }, ctx.mergeState);
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
 * counted as the dashboard counts it), the code-reviewed mark against the worktree tree, the open siblings, and the
 * spec edges as the row reads them: a claim an open edge holds is not takeable (ISC-162.2), and a spec whose open work
 * all waits on open edges stands on `blocked` (ISC-162.3), so the move's `from` is the row's stage.
 */
function transitionInput(files: SpecFiles, ctx: WorkspaceContext, locks: LockReading, to: WorkflowStage, now: Date): TransitionInput {
  const spec = files.texts.spec ?? "";
  const reviewed = reviewedGate(files.texts).check.state;
  const partition = partitionClaims(parseClaims(spec).claims, locks.locks, reviewed);
  const codeMark = files.texts.gateCodeReviewed === undefined ? null : readGateMark("code-reviewed", files.texts.gateCodeReviewed).mark;
  const id = specIdOf(files.folder) ?? files.folder;
  const edges = workspaceEdgesOf(files, ctx);
  // dashboard.ts `specRow`: a held claim counts as open, not takeable; the specs it waits on feed the full hold.
  const edgeHeld = specEdgeHolds(
    partition.takeable,
    edges.edges.filter((e) => e.fromSpec === id),
  );
  const takeable = partition.takeable.filter((c) => !edgeHeld.has(c));
  return {
    files,
    workflow: ctx.workflow,
    to,
    actor: writeActorOf(ctx.viewer),
    now,
    reviewed,
    codeReviewed: gateState("code-reviewed", codeMark, { worktreeTree: ctx.worktreeTree }).state,
    partition: {
      takeable: takeable.length,
      open: partition.open.length - takeable.length,
      closed: partition.closed.length - partition.dropped.length,
      dropped: partition.dropped.length,
    },
    featureSiblingsOpen: featureSiblingsOpenOf(mainFeatureOf(parseFrontmatter(spec).data.isaFeature), id, ctx.specs),
    waits: edges.waits.find((w) => w.spec === id) ?? null,
    edgeHeld: [...new Set([...edgeHeld.values()].flat())].sort(),
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
  const ownTree = reading.input.perSpec?.[ref.slug]?.tree;
  const ctx: WorkspaceContext = {
    workflow: reading.workflow,
    viewer: reading.viewer,
    constitution: reading.input.constitution,
    // The tree the spec's code-reviewed mark compares with, as the row reads it: its own worktree's, else main's (ISC-176).
    worktreeTree: ownTree === undefined ? (reading.input.worktreeTree ?? null) : ownTree,
    specs: reading.input.specs,
    archived: reading.input.archived,
    mergeState: reading.mergeState,
  };
  return runWrite<"transition">({
    root: input.root,
    stateDir: input.stateDir,
    now,
    ...(input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs }),
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

// ── the allocation (spec 008, T86, ISC-130.2) ────────────────────────────────────────────────────────────────────

export interface AllocateWriteInput {
  /** The repository root. */
  readonly root: string;
  /** The story's slug: its file name in `specs/ideas/` without `.md`, as the request path names it. */
  readonly slug: string;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly body: AllocateRequest;
  /** The run lock's abort age (`WriteInput.abortAfterMs`). */
  readonly abortAfterMs?: number;
}

/** Whether anything (a file, a folder, a link) already has this name; never follows a link. */
function pathTaken(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** fsyncs a directory, so a created or removed entry in it is durable as well. */
function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Starting a story (T86, ISC-130.2; FORMAT.md § idea, Allocation). Before the write's one await: the viewer's actor
 * (`writeActorOf`, `VIEWER_ACTOR_FALLBACK` without a git address) and the numbers branch names and history have given
 * out (`takenSpecNumbers`, none without a repository). Then under `runWrite`, synchronously:
 *
 * 1. the story must be one `readIdeas` lists (404 otherwise: no path is built from the request alone); its file's raw
 *    sha256 against the client's `IdeaPage.hash` (409 `StaleIdea` with the path and the hash now, nothing written);
 * 2. the number is `nextSpecNumber` over the `NNN-slug` folders of `specs/` and `specs/archive/` (`listSpecs`) and the
 *    numbers from git; `allocationOf` plans the folder, `spec.md`, `context.md` and the creation event by the viewer;
 * 3. 422 `allocate-refused`: `not-in-index` when the index (`specs/ideas/README.md`) does not name the story (its
 *    `ideas-index` finding), `folder-exists` when anything already has the folder's name (a file or a link is no spec
 *    folder, so it took no number; a folder would have). Nothing is written;
 * 4. on yes: `specs/NNN-slug/` created (that one directory), `context.md`, `spec.md` and `events.jsonl` written in place
 *    with an fsync, the story file removed, both directories fsynced. Nothing else: no README edit. The index row's
 *    `Spec` cell, which FORMAT.md names as the mark of a started story, is the web's or the skill's to fill; until then
 *    the index names a story without a file, which `readIdeas` reports as one `ideas-index` warning.
 *
 * No claim lock's 423: a story has no claims, so no session can hold a lock on it, and the new folder's claimless
 * `spec.md` gives `blockingLock` nothing to block on. The 423 it can answer is the run lock's (spec 040, ISC-225):
 * while a run on the story is `running` (`runTarget: {idea: slug}`), 423 `run-locked`, nothing written; an `aborted`
 * run locks nothing. `lockSource` still reports the source consulted. A number above 999 has no three-digit folder:
 * `allocationOf` throws, the route answers 500.
 */
export async function writeAllocate(input: AllocateWriteInput): Promise<WriteResult<"allocate">> {
  const { root, slug, now, body } = input;
  const actor = writeActorOf(await viewerActorOf(root));
  const taken = await takenSpecNumbers(root);
  return runWrite<"allocate">({
    root,
    stateDir: input.stateDir,
    now,
    runTarget: { idea: slug },
    ...(input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs }),
    read: () => {
      const stories = readIdeaFiles(root);
      const listed = readIdeas(stories).ideas.find((ref) => ref.slug === slug);
      if (listed === undefined) return null;
      const name = `${slug}.md`;
      const storyPath = join(repoFilePath(root, "idea"), name);
      const bytes = readBytesIfExists(storyPath);
      if (bytes === null) return null;
      const stale = ideaConflict(listed.path, body.hash, rawSha256(bytes));
      if (stale !== null) return { stale };
      // The plan works on exactly the bytes just hashed; the index as read beside them.
      const text = bytes.toString("utf8");
      const reading = readIdeas({ ...stories, [name]: text });
      const idea = reading.ideas.find((ref) => ref.slug === slug);
      if (idea === undefined) return null;
      const number = nextSpecNumber([...specNumbersOf(listSpecs(root).map((ref) => ref.slug)), ...taken.numbers]);
      const plan = allocationOf(idea, text, number, now, actor);
      const paths = writePathsOf("allocate", plan.folder, slug);
      const folder = `specs/${plan.folder}/`;
      // A story has no claims and the new folder none yet: the lock check has nothing to block on (header).
      const files: SpecFiles = { folder: plan.folder, texts: {} };
      const unindexed = reading.diagnostics.some((d) => d.diagnostic.code === "ideas-index" && d.diagnostic.subject === slug);
      if (unindexed) return { files, claim: null, commit: { refused: { error: "allocate-refused", reason: "not-in-index", folder } } };
      const dir = join(root, "specs", plan.folder);
      if (pathTaken(dir)) return { files, claim: null, commit: { refused: { error: "allocate-refused", reason: "folder-exists", folder } } };
      return {
        files,
        claim: null,
        commit: (lockSource) => {
          mkdirSync(dir);
          writeInPlace(join(dir, CONTEXT_PATH), plan.contextText);
          writeInPlace(join(dir, SPEC_PATH), plan.specText);
          writeInPlace(join(dir, EVENTS_PATH), eventAppendBytes(null, plan.event));
          fsyncDir(dir);
          unlinkSync(storyPath);
          fsyncDir(repoFilePath(root, "idea"));
          return { id: String(number).padStart(3, "0"), folder, files: paths.writes, removed: paths.removes[0] ?? idea.path, lockSource };
        },
      };
    },
  });
}

/** An unreadable workspace's code as the errno its route layer maps back (`unreadableCode`) to the 409 summary. */
function errnoOf(code: "missing" | "not-a-directory" | "permission-denied" | "unreadable"): string {
  return { missing: "ENOENT", "not-a-directory": "ENOTDIR", "permission-denied": "EACCES", unreadable: "EIO" }[code];
}

// ── the backlog (spec 036, ISC-191, ISC-191.1) ───────────────────────────────────────────────────────────────────

export interface BacklogWriteInput {
  /** The repository root: the backlog lives once per repository, at the main checkout (`WRITE_TABLE.backlog.root`). */
  readonly root: string;
  readonly now: Date;
  readonly body: BacklogRequest;
}

/**
 * One backlog write (FORMAT.md § backlog, Writing). Before the write's one await: the viewer's actor (`writeActorOf`).
 * Then synchronously, with no lock source read (`specs/backlog.md` belongs to no spec, and no agent writes it, so
 * there is no claim to hold it):
 *
 * 1. `specs/backlog.md` is read once and hashed raw (the empty text when the file is missing) and compared with the
 *    client's hash: a mismatch is 409 `StaleBacklog` with the hash now, nothing written;
 * 2. core plans the write over exactly those bytes and the master's feature blocks (`backlogFeatures`,
 *    `planBacklogMove` / `planBacklogPriority`): a refusal is 422 `BacklogRefused` with core's reason, nothing written;
 * 3. on yes: `specs/backlog.md` rewritten in place with the whole list, then the one event line appended to
 *    `specs/backlog.events.jsonl` (created when missing), both with an fsync. `specs/` must exist; no directory is
 *    created (`WRITE_PATHS.backlog`). Nothing else changes, the master included.
 */
export async function writeBacklog(input: BacklogWriteInput): Promise<WriteAnswer<"backlog">> {
  const { root, now, body } = input;
  const actor = writeActorOf(await viewerActorOf(root));
  const path = join(root, BACKLOG_PATH);
  const bytes = readBytesIfExists(path);
  const stale = backlogConflict(body.hash, rawSha256(bytes ?? ""));
  if (stale !== null) return { status: 409, body: stale };
  const master = readIfExists(join(root, "ISA.md"));
  const base = { text: bytes === null ? null : bytes.toString("utf8"), features: master === null ? [] : backlogFeatures(master), feature: body.feature, actor, now };
  const plan = body.op === "move" ? planBacklogMove({ ...base, before: body.before }) : planBacklogPriority({ ...base, priority: body.priority });
  if (!plan.ok) return { status: 422, body: { error: "backlog-refused", reason: plan.reason } };
  writeInPlace(path, plan.text);
  const eventsPath = join(root, BACKLOG_EVENTS_PATH);
  const existing = readIfExists(eventsPath);
  // A log whose last line lacks its newline gets one first, so the new event never fuses with it.
  appendInPlace(eventsPath, `${existing !== null && existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${plan.line}`);
  return { status: 200, body: { hash: rawSha256(plan.text), event: plan.event } };
}

// ── the run release (spec 040, T35, ISC-226) ─────────────────────────────────────────────────────────────────────

export interface RunReleaseWriteInput {
  /** The repository root: the activity log lives once per repository, at the main checkout (`WRITE_TABLE.runRelease.root`). */
  readonly root: string;
  readonly now: Date;
  /** The run id of the route, decoded once. */
  readonly run: string;
  /** The raw sha256 of `.spectant/activity.jsonl` the client rendered (`X-Spectant-Activity-Hash`). */
  readonly hash: string;
  /** The age after which an open run reads `aborted` (`runAbortMinutes` × 60 000); core's default when absent. */
  readonly abortAfterMs?: number;
}

/**
 * One run release (`WRITE_PATHS.runRelease`). Before the write's one await: the viewer's actor (`viewerActorOf`, no
 * fallback: the release names a person or is refused). Then synchronously, so nothing in this process runs between the
 * read, the checks and the append:
 *
 * 1. `.spectant/activity.jsonl` is read once (the empty text without it) and read by core (`activityReading`): no open
 *    run with the id, unknown or already ended, is 404, nothing written;
 * 2. its raw sha256 against the client's: a mismatch is 409 `StaleActivity` with the hash now, nothing written. The
 *    hash covers the whole file, so a line the plugin appended since render is the 409, never a race;
 * 3. no `u:` viewer is 422 `no-viewer`; a run core reads `aborted` (`runLockOf` over that run alone, at `now` and the
 *    abort age) is 422 `run-aborted`: it locks nothing, so there is nothing to release. Nothing written;
 * 4. on yes: one `appendInPlace` of the one `run-end` line (`runReleaseEvent`), after a newline when the log lacks its
 *    last one. The run is then ended and the run lock of ISC-225 on its item lifted (another open run may still hold
 *    it). No other file changes, and no directory is created.
 */
export async function writeRunRelease(input: RunReleaseWriteInput): Promise<WriteResult<"runRelease">> {
  const { root, now, run, hash } = input;
  const viewer = await viewerActorOf(root);
  const path = join(root, ACTIVITY_PATH);
  const raw = readBytesIfExists(path) ?? Buffer.alloc(0);
  const text = raw.toString("utf8");
  const open = (activityReading(text).openRuns ?? []).find((r) => r.run === run);
  if (open === undefined) return { status: 404, body: { error: "not-found" } };
  const stale = activityConflict(hash, rawSha256(raw));
  if (stale !== null) return { status: 409, body: stale };
  if (viewer === null) return { status: 422, body: { error: "release-refused", reason: "no-viewer" } };
  const target: RunLockTarget = open.spec === undefined ? { idea: open.idea ?? "" } : { spec: open.spec };
  const running = runLockOf([open], target, { now, ...(input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs }) });
  if (running === null) return { status: 422, body: { error: "release-refused", reason: "run-aborted" } };
  const event = runReleaseEvent(now.toISOString(), open, viewer);
  const bytes = runReleaseAppendBytes(text, event);
  appendInPlace(path, bytes);
  return { status: 200, body: { hash: rawSha256(Buffer.concat([raw, Buffer.from(bytes, "utf8")])), event } };
}
