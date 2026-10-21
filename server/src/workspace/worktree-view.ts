/**
 * The worktrees of one workspace (spec 027, ISC-175). They come from `infra/git/`'s read-only `worktree list`,
 * `rev-list --count` and `status` in one reading every caller shares (`readWorktreeView`, spec 041): `core/`'s
 * `assignWorktrees` decides which spec each belongs to and `liveWorktrees` which have ended. A spec worktree whose
 * branch is merged into `main`, whose folder is gone or that git lists as `prunable` is no longer the spec's: the
 * dashboard, the spec tabs and their writes, the library and the timeline all leave it out, so no chip shows and the
 * spec reads from the main checkout again, and the timeline carries the derived entry instead (`timelineWorktreeOf`,
 * ISC-175.1, ISC-212.1).
 */
import { join } from "node:path";
import type { TimelineWorktreeInput, Worktree } from "../../../core/src/files.ts";
import { REPO_SOURCE_PATHS } from "../../../core/src/repo-source.ts";
import { type SpecRef, listSpecs } from "../../../core/src/resolve.ts";
import { specIdOf } from "../../../core/src/spec-ref.ts";
import { statusToRead, trackedToRead, worktreeFactsToRead, worktreeViewOf } from "../../../core/src/worktree-facts.ts";
import { type WorktreeView, assignWorktrees, insideRepository, liveWorktrees, worktreeOnlySpecs } from "../../../core/src/worktrees.ts";
import {
  type SpecBranch,
  aheadOfMain,
  changedPaths,
  dirty,
  lastCommits,
  mapBounded,
  mergeCommitOf,
  mergedSpecBranches,
  trackedPlanningPaths,
  trackedSpecPaths,
  worktreeList,
} from "../infra/git/index.ts";
import { StateMemo, repoStateOf } from "../infra/git/repo-state.ts";
import { hasGit } from "../infra/fs/read.ts";

/** The worktree view of a workspace and the spec branches it was decided on (`readWorktreeView`). */
export interface WorktreeReading {
  readonly view: WorktreeView;
  /** Every local spec branch with its merge state (`mergedSpecBranches`, ISC-162.1). */
  readonly branches: readonly SpecBranch[];
  /**
   * The spec folders only a live spec worktree carries (spec 039, ISC-208.1, `core/`'s `worktreeOnlySpecs`), as active
   * spec references whose `dir` is the folder in that worktree, `<root>/<worktree>/specs/NNN-slug`, in number order.
   */
  readonly worktreeOnly: readonly SpecRef[];
  /**
   * Per spec worktree inside the repository that holds its `.git`, by its path relative to the root: what
   * `git ls-files -z -- specs/ ISA.md` printed inside it (`trackedPlanningPaths`), the planning files its branch tracks.
   */
  readonly planning: Readonly<Record<string, readonly string[]>>;
  /**
   * The git facts the read source of a repository file is decided on (spec 039, ISC-209, `readRepoFile`): the main
   * checkout's, and those of each live spec worktree of a spec inside the repository, in git's order.
   */
  readonly repoFacts: RepoFacts;
}

/** What git says about the repository files (`REPO_SOURCE_PATHS`) in one checkout (spec 039, ISC-209). */
export interface CheckoutFacts {
  /** The paths its branch tracks below `specs/` and `ISA.md` (`trackedPlanningPaths`). */
  readonly tracked: readonly string[];
  /** The repository files `git status` lists as changed there (`changedPaths`); empty when unknown. */
  readonly changed: readonly string[];
  /** Per repository file, the committer date of the last commit there that touched it (`lastCommits`). */
  readonly lastCommit: Readonly<Record<string, string>>;
}

/** The repository file facts of the main checkout and of each live spec worktree inside the repository. */
export interface RepoFacts {
  readonly main: CheckoutFacts;
  /** By worktree path relative to the root, in git's order. */
  readonly worktrees: ReadonlyArray<{ readonly path: string; readonly facts: CheckoutFacts }>;
}

/**
 * The active spec references of `listed` (`listSpecs`) and `worktreeOnly` in number order, then the archived ones, as
 * `listSpecs` orders them (spec 039, ISC-208.1).
 */
export function withWorktreeOnly(listed: readonly SpecRef[], worktreeOnly: readonly SpecRef[]): SpecRef[] {
  if (worktreeOnly.length === 0) return [...listed];
  const active = [...listed.filter((ref) => !ref.archived), ...worktreeOnly].sort((a, b) => Number(a.id) - Number(b.id) || (a.slug < b.slug ? -1 : 1));
  return [...active, ...listed.filter((ref) => ref.archived)];
}

/** Whether `path` (relative, `/`-separated) is one of the repository files of `REPO_SOURCE_PATHS`. */
const isRepoFile = (path: string): boolean =>
  REPO_SOURCE_PATHS.some((spec) => (spec.endsWith("/") ? path.startsWith(spec) && !path.slice(spec.length).includes("/") : path === spec));

/** A worktree path inside the repository: `core/`'s rule, re-exported for the slice's callers (spec 062, ISC-443). */
export { insideRepository };

/**
 * The repository file facts (spec 039, ISC-209): in the main checkout its tracked paths, the repository files its
 * status lists and their last commits; in each live spec worktree of a spec inside the repository the tracked paths
 * read for the view (`planning`), its status listing (`statuses`) and its last commits. Every read is `infra/git/`'s,
 * read-only, kept with the view while `repoStateOf` stands.
 */
async function readRepoFacts(
  root: string,
  live: readonly Worktree[],
  planning: Readonly<Record<string, readonly string[]>>,
  statuses: ReadonlyMap<string, readonly string[]>,
): Promise<RepoFacts> {
  const own = live.flatMap((w) => (w.kind === "spec" && w.spec !== null && w.path !== null && insideRepository(w.path) && planning[w.path] !== undefined ? [w.path] : []));
  const [mainTracked, mainChanged, mainCommits, commits] = await Promise.all([
    trackedPlanningPaths(root),
    changedPaths(root, { pathspecs: REPO_SOURCE_PATHS }),
    lastCommits(root, REPO_SOURCE_PATHS),
    mapBounded(own, WORKTREE_READS, (path) => lastCommits(join(root, path), REPO_SOURCE_PATHS)),
  ]);
  return {
    main: { tracked: mainTracked, changed: mainChanged ?? [], lastCommit: mainCommits },
    worktrees: own.map((path, i) => ({
      path,
      facts: { tracked: planning[path] ?? [], changed: (statuses.get(path) ?? []).filter(isRepoFile), lastCommit: commits[i] ?? {} },
    })),
  };
}

/** Spec worktrees read at once: enough to overlap the git reads, few enough for a workspace with many (ISC-215). */
const WORKTREE_READS = 4;

/** The process's worktree readings (`readWorktreeView`), bounded. */
const WORKTREE_VIEWS = new StateMemo<WorktreeReading>();

/**
 * The one reading of the worktrees of the workspace at `root` (spec 041, ISC-212.1) that the dashboard, the spec tabs
 * with their three writes, the library and the timeline share: `git worktree list --porcelain` once, assigned to every
 * spec folder of `refs` (active and archived) by `core/`'s `assignWorktrees`, split by `core/`'s `liveWorktrees` into
 * live and ended worktrees on the merge state of the spec branches and on whether each folder still holds its `.git`.
 * Each live spec worktree of a spec gets the chip's two git facts, read inside it: `ahead` (`rev-list --count
 * main..<branch>`) and `dirty` (`status --porcelain`); a builder and a worktree of no spec keep their nulls. For each
 * live spec worktree inside the repository, `tracked` holds what `git ls-files -z -- specs/<folder>` printed in the
 * main checkout for the spec's active folder, `copyDirFor`'s input. Every git call goes through `infra/git/`: read-only,
 * no fetch, `GIT_OPTIONAL_LOCKS=0`. A listing with nothing beside the main checkout yields an empty view, as before
 * spec 027.
 *
 * Kept per root and spec folder list while `repoStateOf(root)` stands (ISC-215): a poll, a spec route, a library
 * document or a search keystroke then starts no git process for it. A commit, a moved ref, a staged change or a worktree
 * added, removed or deleted changes the state; an edit that touches no index does not, so the dirty mark follows it on
 * the next such change.
 */
export function readWorktreeView(root: string, refs: readonly SpecRef[] = listSpecs(root)): Promise<WorktreeReading> {
  const key = `${root}\0${refs.map((ref) => `${ref.archived ? "a" : ""}${ref.slug}`).join("\0")}`;
  return WORKTREE_VIEWS.get(key, repoStateOf(root), () => readWorktreeViewNow(root, refs));
}

async function readWorktreeViewNow(root: string, refs: readonly SpecRef[]): Promise<WorktreeReading> {
  const [porcelain, merge] = await Promise.all([worktreeList(root), mergedSpecBranches(root)]);
  const mainFolders = refs.map((ref) => ref.slug);
  const listedFirst = assignWorktrees(porcelain, mainFolders);
  // A worktree's folder, joined to the root; null for one outside the repository, whose location core never names.
  const folderOf = (w: Worktree): string | null => (w.path === null ? null : join(root, w.path));
  // The planning files each spec worktree's branch tracks, read inside it (spec 039): the folders only a worktree
  // carries (ISC-208.1) and the repository files of ISC-209 are decided on them.
  const readable = listedFirst.worktrees.flatMap((w) =>
    w.kind === "spec" && w.path !== null && insideRepository(w.path) && hasGit(join(root, w.path)) ? [w.path] : [],
  );
  const paths = await mapBounded(readable, WORKTREE_READS, (path) => trackedPlanningPaths(join(root, path)));
  const planning: Record<string, readonly string[]> = {};
  readable.forEach((path, i) => {
    planning[path] = paths[i] ?? [];
  });
  const only = worktreeOnlySpecs(listedFirst.worktrees, mainFolders, planning);
  // Assigned again with the found folders, so each one's worktree is its spec's like any other (its chip, its source).
  const assignment = only.length === 0 ? listedFirst : assignWorktrees(porcelain, [...mainFolders, ...only.map((s) => s.slug)]);
  // What git must be asked about each spec worktree of a spec, as `core/` names it (spec 062, ISC-443).
  const toRead = worktreeFactsToRead(assignment);
  const merged = merge.branches.filter((b) => b.merged).map((b) => b.branch);
  const present = toRead.paths.filter((path) => hasGit(join(root, path)));
  // A merged worktree still holding uncommitted work stays the spec's (ISC-212.2): only those are asked here.
  const mergedPresent = statusToRead(toRead.ofSpec, merged, present);
  const dirtyMerged = await Promise.all(mergedPresent.map((path) => dirty(join(root, path))));
  const facts = { merged, present, dirty: mergedPresent.filter((_, i) => dirtyMerged[i] === true) };
  const split = liveWorktrees(assignment, facts);
  // The live spec worktrees' git facts, a bounded number of worktrees at a time (ISC-215).
  // The status listing of each live spec worktree answers `dirty` and, below the repository files, `changed` (ISC-209).
  const statuses = new Map<string, readonly string[]>();
  const live = await mapBounded(split.live, WORKTREE_READS, async (worktree): Promise<Worktree> => {
    if (worktree.kind !== "spec" || worktree.spec === null) return worktree;
    // Outside the repository only `ahead` is read, in the main checkout: the branch names the commits, no folder is read.
    const folder = folderOf(worktree);
    const [ahead, changed] = await Promise.all([aheadOfMain(folder ?? root, worktree.branch), folder === null ? null : changedPaths(folder)]);
    if (worktree.path !== null && changed !== null) statuses.set(worktree.path, changed);
    return { ...worktree, ahead, dirty: changed === null ? null : changed.length > 0 };
  });
  const repoFacts = await readRepoFacts(root, live, planning, statuses);
  // `ls-files` for the folder of each spec with a live worktree inside the repository, the first in git's order.
  const tracked: Record<string, readonly string[]> = {};
  const listed = trackedToRead(live, refs);
  const lists = await mapBounded(listed, WORKTREE_READS, (slug) => trackedSpecPaths(root, slug));
  listed.forEach((slug, i) => {
    tracked[slug] = lists[i] ?? [];
  });
  // A folder only a worktree carries is tracked by that worktree's branch: its source is the worktree (ISC-208.1).
  for (const spec of only) tracked[spec.slug] = (planning[spec.worktree] ?? []).filter((path) => path.startsWith(`specs/${spec.slug}/`));
  const worktreeOnly = only.map((spec): SpecRef => ({ kind: "spec", id: spec.id, slug: spec.slug, dir: join(root, spec.worktree, "specs", spec.slug), archived: false }));
  const view = worktreeViewOf({ porcelain, assignment, split, live, tracked });
  return { view, branches: merge.branches, worktreeOnly, planning, repoFacts };
}

/**
 * The timeline's `worktree` input for the spec folder `folder` at `root` (spec 027, T25, ISC-175.1), from git alone:
 *
 * The spec's branches are those named for it and those its worktrees carry, as the whole workspace assigns them, so the
 * path wins over the branch here too (ISC-174.1, ISC-212.1); `reading` is the caller's `readWorktreeView`, read anew
 * when absent.
 *
 * - null while a live worktree carries the spec, on whatever branch, a merged one with uncommitted work included
 *   (ISC-212.2), and when the spec has no branch (nothing to say).
 * - `merged` when one of the spec's branches is merged into `main` (`mergedSpecBranches`, ISC-162.1), dated by its merge
 *   commit (`mergeCommitOf`); a merge commit git cannot name gives no entry rather than an undated one. A merged branch
 *   with a worktree is preferred, and branch and path always come from that one worktree (ISC-212.2).
 * - `removed` when the spec has a branch, none merged: the path and branch of the worktree git still lists for it, if
 *   any. A branch checked out in the main checkout is worked on there and counts as open. A branch that never had a
 *   worktree reads as removed too (principal, 2026-10-14): spec work runs in a worktree of its own.
 *
 * Nothing is written: the entry is derived on every read, `events.jsonl` stays byte-identical.
 */
export async function timelineWorktreeOf(root: string, folder: string, reading?: WorktreeReading): Promise<TimelineWorktreeInput | null> {
  const spec = specIdOf(folder);
  if (spec === null) return null;
  const { view, branches } = reading ?? (await readWorktreeView(root));
  // The spec's worktrees as the whole workspace assigns them, so the path wins over the branch (ISC-174.1).
  const mine = view.assignment.worktrees.filter((w) => w.kind === "spec" && w.spec === spec);
  const own = branches.filter((b) => b.spec === spec || mine.some((w) => w.branch === b.branch));
  // A live worktree of the spec, on whatever branch, means the spec is still worked on: no entry (ISC-212.2).
  if (own.length === 0 || view.live.some((w) => w.kind === "spec" && w.spec === spec)) return null;
  // Branch and path always come from one worktree when the spec has one for the branch (ISC-212.2).
  const worktreeOf = (branch: string): Worktree | undefined => mine.find((w) => w.branch === branch);
  const mergedOwn = own.filter((b) => b.merged);
  const merged = mergedOwn.find((b) => worktreeOf(b.branch) !== undefined) ?? mergedOwn[0];
  if (merged !== undefined) {
    const commit = await mergeCommitOf(root, merged.branch);
    if (commit === null) return null;
    return { merged: commit, removed: false, branch: merged.branch, path: worktreeOf(merged.branch)?.path ?? null };
  }
  if (own.some((b) => b.branch === view.mainBranch)) return null;
  const listed = mine.find((w) => w.branch !== null && own.some((b) => b.branch === w.branch)) ?? mine[0];
  if (listed !== undefined) return { merged: null, removed: true, branch: listed.branch, path: listed.path };
  return { merged: null, removed: true, branch: own[0]?.branch ?? null, path: null };
}
