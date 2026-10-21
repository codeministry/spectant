/**
 * The feature-level code-review mark (spec 008, T93, ISC-122.2): `spectant gate code-reviewed F<n> [--root DIR] [--yes]`.
 * The fifth write path, `WRITE_PATHS.codeReviewFeature` of `writes.contract.ts`, triggered by the skill through the CLI
 * after the one code review of a main feature under `code_review: feature`, never by the UI.
 *
 * 1. The workspace is read (`readWorkspaceInput`), the planning tree built (`buildPlanning`) and the targets taken from
 *    core (`featureCodeReviewTargets`): the active specs whose main feature is `F<n>` and whose live claims are all
 *    closed in the master.
 * 2. Refused (exit 1, nothing written) for an unknown feature, for a block where any active spec of that main feature
 *    still holds an open claim (each named with its claims), for an empty target list, and where the tree id of a
 *    target's checkout cannot be computed (not a git checkout, or git failed): a mark without a tree could never read
 *    fresh.
 * 3. Without `yes` it plans what it would write and writes nothing (the command, `feature-gate.ts`, prints the plan).
 * 4. With `yes`, in each target's read source (spec 041, ISC-211; `readSpecSource` over one `readWorktreeView`: the
 *    copy in the spec's live worktree when git tracks `specs/` there, else the main checkout's folder): one event line
 *    appended to `events.jsonl` (`<stage> → close`, `from` the dashboard row's stage before the write, normally
 *    `code-review`; no line for a spec that already stands in `close`), then the tree id is computed over the target's
 *    checkout as it now is (its live spec worktree inside the repository, else the main checkout, ISC-176), then
 *    `.gates/code-reviewed.json` is written with `scope: F<n>`, that tree, that checkout's `HEAD` and branch, `code: 0`,
 *    `security: 0` (the clean state the skill records after its fixes) and the viewer's `u:` id or
 *    `VIEWER_ACTOR_FALLBACK` as the actor. Events come first so the tree the mark names includes them: the mark reads
 *    fresh as long as `.gates/` is outside the tree (ignored or excluded), as for every per-spec mark.
 *
 * Every write goes through the in-place primitives (`infra/fs/in-place.ts`: open, write, fsync, close; `.gates/` the
 * one directory created); nothing else in the repository changes, and git runs only the reads `infra/git/` and the
 * loader already run.
 */
import { join } from "node:path";
import { buildDashboard } from "../../../core/src/dashboard.ts";
import { type EventLine, FILE_KINDS } from "../../../core/src/files.ts";
import { codeReviewedMarkText, featureCodeReviewTargets } from "../../../core/src/gates.ts";
import { buildPlanning } from "../../../core/src/planning.ts";
import { listSpecs } from "../../../core/src/resolve.ts";
import type { Stage } from "../../../core/src/stage.ts";
import { EVENTS_PATH, WRITE_PATHS, eventAppendBytes, writeActorOf } from "../contracts/writes.contract.ts";
import { appendInPlace, writeInPlace } from "../infra/fs/in-place.ts";
import { readIfExists } from "../infra/fs/read.ts";
import { lstatOf, readTextOf } from "../infra/fs/stat.ts";
import { commitsFor } from "../infra/git/index.ts";
import { ownLiveWorktree } from "../../../core/src/worktrees.ts";
import { readSpecSource, readWorkspaceInput, readWorktreeView, worktreeTreeId } from "../workspace/index.ts";
import { ensureGatesDir } from "./run-write.ts";

/** `F<n>`, the master's feature block id: the only argument the subcommand takes. */
export const FEATURE_ARG = /^F\d+$/;

/** The stage every target moves to: the stage table's row 11, every claim closed and the code-reviewed mark fresh. */
export const FEATURE_GATE_TO: Stage = "close";

/** The repository-relative mark path of one target folder, from `WRITE_PATHS.codeReviewFeature`. */
export function featureMarkPath(folder: string): string {
  return WRITE_PATHS.codeReviewFeature.writes[0].replace("specs/NNN-slug/", `specs/${folder}/`);
}

/** The event's `command`: the CLI call that wrote it. */
export function featureGateEventCommand(feature: string): string {
  return `spectant gate code-reviewed ${feature}`;
}

export interface FeatureGateTarget {
  /** `NNN-slug`. */
  readonly folder: string;
  /**
   * Where the mark goes (spec 041, ISC-211): `worktree`, the copy in the spec's live worktree when git tracks `specs/`
   * there, else `main`, the main checkout's folder: the spec's read source, as the app reads it (`readSpecSource`).
   */
  readonly source: "main" | "worktree";
  /**
   * The checkout the mark's tree id, `HEAD` and branch are read in, relative to the root: the spec's live worktree inside
   * the repository (`.worktrees/NNN-slug`), else `.`, the main checkout (ISC-176).
   */
  readonly checkout: string;
  /** The tree id the mark carries; null on a dry run, since it is computed after the event lines are appended. */
  readonly tree: string | null;
  readonly head: string | null;
  readonly branch: string | null;
  /** The dashboard row's stage before the write. */
  readonly from: Stage;
  /** The event appended, null when the spec already stood in `close`. */
  readonly event: EventLine | null;
}

export type FeatureGateResult =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true;
      /** False on a dry run (no `--yes`): nothing was written. */
      readonly written: boolean;
      readonly feature: string;
      readonly actor: string;
      readonly targets: readonly FeatureGateTarget[];
    };

export interface FeatureGateOptions {
  readonly yes: boolean;
  /** The mark's `at` and the events' `ts`; defaults to now. */
  readonly now?: Date;
}

const refuse = (reason: string): FeatureGateResult => ({ ok: false, reason });

/** The branch `HEAD` names, read from the `HEAD` file (no git process); null when detached or unreadable. */
async function branchOf(root: string): Promise<string | null> {
  try {
    let gitDir = join(root, ".git");
    if (!(await lstatOf(gitDir)).isDirectory()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await readTextOf(gitDir))?.[1]?.trim();
      if (pointer === undefined) return null;
      gitDir = pointer.startsWith("/") ? pointer : join(root, pointer);
    }
    return /^ref: refs\/heads\/(.+)$/.exec((await readTextOf(join(gitDir, "HEAD"))).trim())?.[1] ?? null;
  } catch {
    return null;
  }
}

const plural = (n: number, word: string): string => `${word}${n === 1 ? "" : "s"}`;

/** Checks, plans and (with `yes`) writes the feature-level code-reviewed mark of `feature` into the workspace at `root`. */
export async function codeReviewFeature(root: string, feature: string, options: FeatureGateOptions): Promise<FeatureGateResult> {
  if (!FEATURE_ARG.test(feature)) return refuse(`${JSON.stringify(feature)} is not a feature id F<n>`);
  const reading = await readWorkspaceInput(root, null);
  if (!reading.readable) return refuse(`the workspace cannot be read (${reading.error})`);
  const { input } = reading;
  const planning = buildPlanning({ ...input, ideas: reading.ideas, workflow: reading.workflow });
  const block = planning.features.find((f) => f.id === feature);
  if (block === undefined) return refuse(`${feature} is not a feature block of the master`);

  // Every active spec whose main feature is the block, with its own open claims across every block it holds.
  const claims = planning.features.flatMap((f) => f.claims);
  const open = block.holders
    .filter((h) => !h.archived && h.main)
    .map((h) => ({ folder: h.slug, ids: claims.filter((c) => c.holder === h.id && !c.dropped && !c.closed).map((c) => c.id) }))
    .filter((h) => h.ids.length > 0);
  if (open.length > 0) {
    const named = open.map((h) => `${h.folder} (${plural(h.ids.length, "open claim")} ${h.ids.join(", ")})`).join(", ");
    return refuse(`${feature} still has open claims: ${named}`);
  }
  const folders = featureCodeReviewTargets(planning, feature);
  if (folders.length === 0) return refuse(`${feature} has no spec to mark: no active spec of that main feature holds a live claim`);
  // Per target its read source and its checkout, from the one worktree view the app reads (spec 041, ISC-211).
  const worktrees = await readWorktreeView(root);
  const refs = new Map(listSpecs(root).filter((ref) => !ref.archived).map((ref) => [ref.slug, ref]));
  const places = new Map<string, { dir: string; source: "main" | "worktree"; checkout: string }>();
  for (const folder of folders) {
    const ref = refs.get(folder);
    if (ref === undefined) return refuse(`${folder} is no active spec folder`);
    const { dir } = await readSpecSource(root, ref, worktrees);
    // The spec's own live spec worktree inside the repository, by `core/`'s one rule (spec 062, ISC-443).
    const checkout = ownLiveWorktree(worktrees.view.live, ref.id)?.path ?? ".";
    places.set(folder, { dir, source: dir === ref.dir ? "main" : "worktree", checkout });
  }
  const placeOf = (folder: string): { dir: string; source: "main" | "worktree"; checkout: string } =>
    places.get(folder) ?? { dir: join(root, "specs", folder), source: "main", checkout: "." };
  for (const checkout of new Set([...places.values()].map((p) => p.checkout))) {
    if ((await worktreeTreeId(join(root, checkout))) === null) {
      return refuse(`the worktree tree id cannot be computed in ${checkout} (not a git checkout, or git failed); a mark without it never reads fresh`);
    }
  }

  const now = (options.now ?? new Date()).toISOString();
  const actor = writeActorOf(reading.viewer);
  const stages = new Map(buildDashboard({ ...input, services: [] }).specs.map((row) => [row.slug, row.stage]));
  const targets: FeatureGateTarget[] = [];
  for (const folder of folders) {
    const { source, checkout } = placeOf(folder);
    const at = join(root, checkout);
    const from = stages.get(folder) ?? "code-review";
    const event = from === FEATURE_GATE_TO ? null : { ts: now, from, to: FEATURE_GATE_TO, command: featureGateEventCommand(feature), actor };
    const head = (await commitsFor(at, "specs", { limit: 1 })).head;
    targets.push({ folder, source, checkout, tree: null, head, branch: await branchOf(at), from, event });
  }
  if (!options.yes) return { ok: true, written: false, feature, actor, targets };

  for (const target of targets) {
    if (target.event === null) continue;
    const events = join(placeOf(target.folder).dir, EVENTS_PATH);
    appendInPlace(events, eventAppendBytes(readIfExists(events), target.event));
  }
  // The trees after every event line is in, one per checkout, so each mark names the tree its events are part of.
  const trees = new Map<string, string>();
  for (const checkout of new Set(targets.map((t) => t.checkout))) {
    const tree = await worktreeTreeId(join(root, checkout));
    if (tree === null) return refuse(`the event lines are appended, but the tree id of ${checkout} could not be computed afterwards; no mark was written`);
    trees.set(checkout, tree);
  }
  const written = targets.map((target): FeatureGateTarget => {
    const tree = trees.get(target.checkout) ?? "";
    const text = codeReviewedMarkText({ at: now, actor, scope: feature, tree, head: target.head, branch: target.branch, code: 0, security: 0 });
    const { dir } = placeOf(target.folder);
    ensureGatesDir(dir);
    writeInPlace(join(dir, FILE_KINDS.gateCodeReviewed.path), text);
    return { ...target, tree };
  });
  return { ok: true, written: true, feature, actor, targets: written };
}
