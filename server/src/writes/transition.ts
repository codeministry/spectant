/**
 * The stage move (spec 008, T82, ISC-121): `writeTransition` over `runWrite` (`run-write.ts`). It writes `stage:` in
 * the spec's `spec.md` and appends one line to its `events.jsonl`, both in the folder of the spec's read source
 * (spec 027, T22, ISC-181: the worktree copy's when `readSpecSource` reads the spec from it); the lock sources stay at
 * the repository `root`.
 */
import { abortAge } from "../infra/abort-age.ts";
import { join } from "node:path";
import { parseClaims } from "../../../core/src/claims.ts";
import type { LockReading, MergeState, SpecFiles, Workflow, WorkflowStage } from "../../../core/src/files.ts";
import { parseFrontmatter } from "../../../core/src/frontmatter.ts";
import { gateState, readGateMark, reviewedGate } from "../../../core/src/gates.ts";
import type { SpecRef } from "../../../core/src/resolve.ts";
import { specIdOf } from "../../../core/src/spec-ref.ts";
import { type ResolvedSpecEdges, resolveEdges } from "../../../core/src/spec-edges.ts";
import { mainFeatureOf, partitionClaims, specEdgeHolds } from "../../../core/src/status.ts";
import { type TransitionInput, planTransition } from "../../../core/src/transition.ts";
import type { TransitionRequest } from "../contracts/spec-routes.contract.ts";
import { EVENTS_PATH, SPEC_PATH, eventAppendBytes, specConflict, writeActorOf } from "../contracts/writes.contract.ts";
import { Unreadable } from "../infra/fs/errno.ts";
import { appendInPlace, writeInPlace } from "../infra/fs/in-place.ts";
import { readBytesIfExists, readIfExists } from "../infra/fs/read.ts";
import { rawSha256 } from "../infra/hash.ts";
import { readSpecFiles, readWorkspaceInput } from "../workspace/index.ts";
import { type WriteResult, runWrite } from "./run-write.ts";

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
 * Whether an active spec holds its main feature's code review back, as `dashboard.ts` decides it for row 9 (T49):
 * not `phase: complete` and at least one claim neither checked nor dropped. Core keeps this predicate private
 * (`holdsFeatureOpen`), so it is restated here over core's parsed claims; nothing of the format is parsed in server/.
 */
function holdsFeatureOpen(files: SpecFiles): boolean {
  const spec = files.texts.spec;
  if (spec === undefined) return false;
  return parseFrontmatter(spec).data.phase !== "complete" && parseClaims(spec).claims.some((c) => !c.checked && !c.dropped);
}

/** The ids of the active specs of `feature` that still hold it open, in folder order, `self` left out (dashboard row 9). */
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
  // The route layer maps the code to its 409 summary (`unreadableCode`), as it maps an errno thrown by a read.
  if (!reading.readable) throw new Unreadable(reading.error);
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
    ...abortAge(input.abortAfterMs),
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
