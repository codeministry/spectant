// The rules that turn git's answers about a repository's checkouts into the read source of each spec, written once
// (spec 062, ISC-443) for every caller that asks git: the server's `infra/git/` and `workspace/` and the plugin's
// `spec-check` and hook. Each caller runs its own read-only git commands and hands the answers here; this module never
// runs git, never looks at a file and never spawns a process. The file system facts a rule needs (whether a folder
// holds its own `.git`, whether two spellings name one folder) come in as the caller's predicates (FORMAT.md
// § Worktrees):
//
//   - `mainCheckoutFrom`: the main checkout of the checkout a command starts in, from `git rev-parse --git-common-dir`.
//   - `worktreeFactsToRead`, `statusToRead`, `trackedToRead`: which git facts the split into live and ended worktrees
//     and the read source need, per spec worktree; `worktreeViewOf` assembles the `WorktreeView` from them.
//   - `mergeNeedsAncestry`: the pure part of the merge rule of `mergedSpecBranches` (ISC-162.1).
//
// The spec's own live spec worktree inside the repository is `ownLiveWorktree` in `worktrees.ts`, beside `copyDirFor`.
import { basename, dirname, resolve } from 'node:path';
import type { Worktree } from './files.ts';
import { type LiveWorktrees, type WorktreeAssignment, type WorktreeView, insideRepository, isSpecBranch, mainBranchOf } from './worktrees.ts';

// ─── The main checkout (spec 062, ISC-442, ISC-443) ────────────────────────────────────────────────────────────────

/** What a caller read to name the main checkout of the checkout at `cwd`. */
export interface CommonDirFacts {
  /** The folder the command starts in, as given; relative spellings resolve against the process's directory. */
  readonly cwd: string;
  /**
   * The first line `git rev-parse --git-common-dir` printed in `cwd`; null when git was not asked (the caller's
   * discovery stops at a folder without its own `.git`), is missing, failed or hit its deadline.
   */
  readonly commonDir: string | null;
  /** Whether `folder` (absolute) holds its own `.git`, not followed through a link. */
  readonly holdsGit: (folder: string) => boolean;
  /** Whether two absolute folders name the same folder once links are resolved; false when either cannot be. */
  readonly sameFolder: (a: string, b: string) => boolean;
}

/**
 * The main checkout of the checkout at `cwd`: the parent of the repository's common git directory, which for a linked
 * worktree is the main checkout's `.git` and for the main checkout its own, so a command started in a spec worktree
 * reads and writes exactly as from the main checkout. `cwd` itself, spelled as given, when git gave no answer, when the
 * common directory is not a `.git` folder whose parent holds its own `.git` (a bare or submodule layout is not guessed
 * at), and when `cwd` already is the main checkout.
 */
export function mainCheckoutFrom({ cwd, commonDir, holdsGit, sameFolder }: CommonDirFacts): string {
  const answer = commonDir?.trim() ?? '';
  if (answer === '') return cwd;
  // Relative to `cwd` in the main checkout (`.git`), absolute in a linked worktree or a subfolder.
  const common = resolve(cwd, answer);
  if (basename(common) !== '.git') return cwd;
  const main = dirname(common);
  if (!holdsGit(main) || main === resolve(cwd) || sameFolder(main, resolve(cwd))) return cwd;
  return main;
}

// ─── The worktree view (spec 041, ISC-212.1; spec 062, ISC-443) ───────────────────────────────────────────────────

/** The spec worktrees of an assignment that belong to a spec, and what git must be asked about them first. */
export interface WorktreeFactsToRead {
  /** The worktrees of kind `spec` that belong to a spec, in git's order: the only ones `liveWorktrees` can end. */
  readonly ofSpec: readonly Worktree[];
  /** Their branches of the spec shape (`isSpecBranch`), once each: the merge state to read (`mergedSpecBranches`). */
  readonly branches: readonly string[];
  /** Their paths relative to the root: whether each folder still holds its `.git`, `WorktreeFacts.present`. */
  readonly paths: readonly string[];
}

/** What git must be asked about the spec worktrees of `assignment` before `liveWorktrees` can split it. */
export function worktreeFactsToRead(assignment: WorktreeAssignment): WorktreeFactsToRead {
  const ofSpec = assignment.worktrees.filter((w) => w.kind === 'spec' && w.spec !== null);
  return {
    ofSpec,
    branches: [...new Set(ofSpec.flatMap((w) => (w.branch !== null && isSpecBranch(w.branch) ? [w.branch] : [])))],
    paths: ofSpec.flatMap((w) => (w.path === null ? [] : [w.path])),
  };
}

/**
 * The paths of `ofSpec` whose `git status` decides `WorktreeFacts.dirty`: a present worktree whose branch is merged.
 * A merged worktree still holding uncommitted work stays the spec's (ISC-212.2); no other worktree is asked.
 */
export function statusToRead(ofSpec: readonly Worktree[], merged: readonly string[], present: readonly string[]): string[] {
  return ofSpec.flatMap((w) => (w.path !== null && present.includes(w.path) && w.branch !== null && merged.includes(w.branch) ? [w.path] : []));
}

/** The parts of a spec reference `trackedToRead` reads. */
export interface ActiveSpecRef {
  readonly id: string;
  readonly slug: string;
  readonly archived: boolean;
}

/**
 * The spec folders whose `git ls-files -z -- specs/NNN-slug` in the main checkout `WorktreeView.tracked` needs: each
 * active spec of `refs` with a live spec worktree inside the repository, once, in git's order of `live`.
 */
export function trackedToRead(live: readonly Worktree[], refs: readonly ActiveSpecRef[]): string[] {
  const listed = new Set<string>();
  for (const worktree of live) {
    const ref = worktree.kind === 'spec' ? refs.find((r) => !r.archived && r.id === worktree.spec) : undefined;
    if (ref !== undefined && worktree.path !== null && insideRepository(worktree.path)) listed.add(ref.slug);
  }
  return [...listed];
}

/** The parts `worktreeViewOf` assembles a `WorktreeView` from. */
export interface WorktreeViewParts {
  /** The text of `git worktree list --porcelain` the assignment was made on. */
  readonly porcelain: string;
  readonly assignment: WorktreeAssignment;
  /** `liveWorktrees` over the facts read for `worktreeFactsToRead`. */
  readonly split: LiveWorktrees;
  /** `split.live` with the git facts a caller read per live spec worktree (`ahead`, `dirty`); `split.live` when absent. */
  readonly live?: readonly Worktree[];
  /** Per spec folder of `trackedToRead`, what `ls-files` printed. */
  readonly tracked: Readonly<Record<string, readonly string[]>>;
}

/** The one `WorktreeView` of a workspace, from its listing, its assignment, the split and the tracked paths. */
export function worktreeViewOf({ porcelain, assignment, split, live, tracked }: WorktreeViewParts): WorktreeView {
  return { assignment, live: live ?? split.live, ended: split.ended, mainBranch: mainBranchOf(porcelain), tracked };
}

// ─── The merge rule (ISC-162.1; spec 062, ISC-443) ─────────────────────────────────────────────────────────────────

/**
 * Whether a spec branch's tip can have been brought into `main` by a merge, so that `merge-base --is-ancestor <tip>
 * <main>` decides it: false without a tip or a `main`, and for a tip on `main`'s first-parent line (a branch fresh from
 * `main`, at an older `main` commit, or fast-forwarded into it), which no merge brought in.
 */
export function mergeNeedsAncestry(tip: string | null, main: string | null, firstParent: ReadonlySet<string>): boolean {
  return tip !== null && tip !== '' && main !== null && main !== '' && !firstParent.has(tip);
}
