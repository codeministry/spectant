/**
 * The feature-level code-review mark (spec 008, T93, ISC-122.2): `spectant gate code-reviewed F<n> [--root DIR] [--yes]`.
 * The fifth write path, `WRITE_PATHS.codeReviewFeature` of `writes.contract.ts`, triggered by the skill through the CLI
 * after the one code review of a main feature under `code_review: feature`, never by the UI.
 *
 * 1. The workspace is read (`readWorkspaceInput`), the planning tree built (`buildPlanning`) and the targets taken from
 *    core (`featureCodeReviewTargets`): the active specs whose main feature is `F<n>` and whose live claims are all
 *    closed in the master.
 * 2. Refused (exit 1, nothing written) for an unknown feature, for a block where any active spec of that main feature
 *    still holds an open claim (each named with its claims), for an empty target list, and where the worktree tree id
 *    cannot be computed (not a repository root, or git failed): a mark without a tree could never read fresh.
 * 3. Without `--yes` it prints what it would write and exits 0.
 * 4. With `--yes`, in each target folder: one event line appended to `events.jsonl` (`<stage> → close`, `from` the
 *    dashboard row's stage before the write, normally `code-review`; no line for a spec that already stands in
 *    `close`), then the tree id is computed over the worktree as it now is, then `.gates/code-reviewed.json` is written
 *    with `scope: F<n>`, that tree, `HEAD` and the branch, `code: 0`, `security: 0` (the clean state the skill records
 *    after its fixes) and the viewer's `u:` id or `VIEWER_ACTOR_FALLBACK` as the actor. Events come first so the tree
 *    the mark names includes them: the mark reads fresh as long as `.gates/` is outside the tree (ignored or
 *    excluded), as for every per-spec mark.
 *
 * Every write goes through `writes.ts`' in-place primitives (open, write, fsync, close; `.gates/` the one directory
 * created); nothing else in the repository changes, and git runs only the reads `git.ts` and the loader already run.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDashboard } from "../../core/src/dashboard.ts";
import { type EventLine, FILE_KINDS } from "../../core/src/files.ts";
import { codeReviewedMarkText, featureCodeReviewTargets } from "../../core/src/gates.ts";
import { buildPlanning } from "../../core/src/planning.ts";
import { listSpecs } from "../../core/src/resolve.ts";
import type { Stage } from "../../core/src/stage.ts";
import { commitsFor } from "./git.ts";
import { readIfExists, readWorkspaceInput, worktreeTreeId } from "./workspace-loader.ts";
import { EVENTS_PATH, WRITE_PATHS, eventAppendBytes, writeActorOf } from "./writes.contract.ts";
import { appendInPlace, ensureGatesDir, writeInPlace } from "./writes.ts";

/** `F<n>`, the master's feature block id: the only argument the subcommand takes. */
export const FEATURE_ARG = /^F\d+$/;

/** The stage every target moves to: the stage table's row 10, every claim closed and the code-reviewed mark fresh. */
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
      readonly head: string | null;
      readonly branch: string | null;
      /** The tree id the marks carry; null on a dry run, since it is computed after the event lines are appended. */
      readonly tree: string | null;
      readonly targets: readonly FeatureGateTarget[];
    };

export interface FeatureGateOptions {
  readonly yes: boolean;
  /** The mark's `at` and the events' `ts`; defaults to now. */
  readonly now?: Date;
}

const refuse = (reason: string): FeatureGateResult => ({ ok: false, reason });

/** The branch `HEAD` names, read from the `HEAD` file (no git process); null when detached or unreadable. */
function branchOf(root: string): string | null {
  try {
    let gitDir = join(root, ".git");
    if (!lstatSync(gitDir).isDirectory()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(gitDir, "utf8"))?.[1]?.trim();
      if (pointer === undefined) return null;
      gitDir = pointer.startsWith("/") ? pointer : join(root, pointer);
    }
    return /^ref: refs\/heads\/(.+)$/.exec(readFileSync(join(gitDir, "HEAD"), "utf8").trim())?.[1] ?? null;
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
  if ((await worktreeTreeId(root)) === null) {
    return refuse("the worktree tree id cannot be computed (not a git repository root, or git failed); a mark without it never reads fresh");
  }

  const now = (options.now ?? new Date()).toISOString();
  const actor = writeActorOf(reading.viewer);
  const head = (await commitsFor(root, "specs", { limit: 1 })).head;
  const branch = branchOf(root);
  const stages = new Map(buildDashboard({ ...input, services: [] }).specs.map((row) => [row.slug, row.stage]));
  const targets = folders.map((folder): FeatureGateTarget => {
    const from = stages.get(folder) ?? "code-review";
    const event = from === FEATURE_GATE_TO ? null : { ts: now, from, to: FEATURE_GATE_TO, command: featureGateEventCommand(feature), actor };
    return { folder, from, event };
  });
  if (!options.yes) return { ok: true, written: false, feature, actor, head, branch, tree: null, targets };

  const dirs = new Map(listSpecs(root).filter((ref) => !ref.archived).map((ref) => [ref.slug, ref.dir]));
  const dirOf = (folder: string): string => dirs.get(folder) ?? join(root, "specs", folder);
  for (const target of targets) {
    if (target.event === null) continue;
    const events = join(dirOf(target.folder), EVENTS_PATH);
    appendInPlace(events, eventAppendBytes(readIfExists(events), target.event));
  }
  const tree = await worktreeTreeId(root);
  if (tree === null) return refuse("the event lines are appended, but the worktree tree id could not be computed afterwards; no mark was written");
  const text = codeReviewedMarkText({ at: now, actor, scope: feature, tree, head, branch, code: 0, security: 0 });
  for (const target of targets) {
    const dir = dirOf(target.folder);
    ensureGatesDir(dir);
    writeInPlace(join(dir, FILE_KINDS.gateCodeReviewed.path), text);
  }
  return { ok: true, written: true, feature, actor, head, branch, tree, targets };
}

/** `spectant gate code-reviewed F<n>`: prints the plan or what was written; 0 on success and on a dry run, 1 on a refusal. */
export async function featureGateCommand(root: string, feature: string, yes: boolean): Promise<number> {
  const result = await codeReviewFeature(root, feature, { yes });
  if (!result.ok) {
    console.error(`spectant: gate code-reviewed ${feature} refused: ${result.reason}`);
    return 1;
  }
  const verb = result.written ? "wrote" : "would write";
  const tree = result.tree ?? "the worktree's, computed after the event lines";
  console.log(`gate code-reviewed ${feature} ${verb} the mark (scope ${feature}, tree ${tree}, head ${result.head ?? "none"}, actor ${result.actor}):`);
  for (const t of result.targets) {
    const move = t.event === null ? "already close, no event" : `${t.from} → ${FEATURE_GATE_TO} in specs/${t.folder}/${EVENTS_PATH}`;
    console.log(`  ${featureMarkPath(t.folder)} · ${move}`);
  }
  if (!result.written) console.log("run it again with --yes to write");
  return 0;
}
