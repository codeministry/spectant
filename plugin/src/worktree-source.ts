// The read source of each spec for the plugin CLI (spec 062, ISC-438): the folder `spec-check` reads a spec from, by
// the app's rule and independent of the checkout it is called from. The app gathers its git facts in
// `server/src/workspace/worktree-view.ts` and decides per spec in `server/src/workspace/spec-source.ts`; the plugin
// may import only `core/` (it is bundled), so this module runs the same git reads itself and hands their answers to
// `core/`, which decides (FORMAT.md § Worktrees; spec 062, ISC-443): `worktreeFactsToRead`, `statusToRead` and
// `trackedToRead` name what to ask, `assignWorktrees`, `liveWorktrees`, `mergeNeedsAncestry` and `worktreeViewOf`
// build the view, `copyDirFor` and `ownLiveWorktree` pick the copy and the checkout:
//
//   - the listing `git worktree list --porcelain`, read in the main checkout;
//   - the merge state of each spec worktree's branch: its tip an ancestor of `main` and not on `main`'s first-parent
//     line, as `mergedSpecBranches` reads it, and only for a branch of the spec shape (`isSpecBranch`);
//   - whether each spec worktree's folder still holds its `.git`, and, for a merged one, whether `git status` lists
//     anything (a merged worktree with uncommitted work stays live, ISC-212.2);
//   - one `git ls-files -z -- specs/` in the main checkout, split per spec folder.
//
// A spec whose copy carries no `spec.md` stays on the main checkout, as the app keeps it (ISC-181). Every git call is
// read-only: `GIT_OPTIONAL_LOCKS=0`, fsmonitor off for `ls-files` and `status`, each configured filter driver emptied
// for `status`, submodules ignored; nothing is fetched and nothing is written.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecRef } from '../../core/src/resolve.ts';
import {
  type WorktreeFactsToRead,
  mergeNeedsAncestry,
  statusToRead,
  trackedToRead,
  worktreeFactsToRead,
  worktreeViewOf,
} from '../../core/src/worktree-facts.ts';
import {
  type LiveWorktrees,
  type WorktreeAssignment,
  assignWorktrees,
  copyDirFor,
  insideRepository,
  liveWorktrees,
  ownLiveWorktree,
  worktreeOnlySpecs,
} from '../../core/src/worktrees.ts';
import { holdsGit } from './activity-log.ts';

const NO_FSMONITOR = ['-c', 'core.fsmonitor=false'];

/** The output of one read-only git command run in `cwd`; null when git is missing or the command exits non-zero. */
function git(cwd: string, args: readonly string[]): string | null {
  const r = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** The branches of `branches` a merge brought into the local `main` (`mergedSpecBranches`, ISC-162.1). */
function mergedOf(root: string, branches: readonly string[]): string[] {
  if (branches.length === 0) return [];
  const main = git(root, ['rev-parse', '--verify', '-q', 'refs/heads/main^{commit}'])?.trim() ?? '';
  if (main === '') return [];
  const firstParent = new Set((git(root, ['rev-list', '--first-parent', main, '--']) ?? '').split('\n').filter((sha) => sha !== ''));
  return branches.filter((branch) => {
    const tip = git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`])?.trim() ?? '';
    // `core/`'s rule: a tip on main's first-parent line (fresh from main, or fast-forwarded) was brought in by no merge.
    return mergeNeedsAncestry(tip, main, firstParent) && git(root, ['merge-base', '--is-ancestor', tip, main]) !== null;
  });
}

/** Whether `git status` lists anything in the worktree at `folder`; false when it cannot answer, as the app reads it. */
function isDirty(folder: string): boolean {
  const names = (git(folder, ['config', '--name-only', '--get-regexp', '^filter\\.']) ?? '')
    .split('\n')
    .flatMap((key) => (key.startsWith('filter.') && key.lastIndexOf('.') > 'filter.'.length ? [key.slice('filter.'.length, key.lastIndexOf('.'))] : []));
  const drivers = [...new Set(names)].flatMap((name) => ['-c', `filter.${name}.clean=`, '-c', `filter.${name}.process=`, '-c', `filter.${name}.required=false`]);
  const out = git(folder, [...NO_FSMONITOR, ...drivers, 'status', '--porcelain', '-z', '--ignore-submodules=all', '--untracked-files=normal']);
  return out !== null && out !== '';
}

/** The paths git tracks under `specs/` in the main checkout at `root`, one `ls-files` for every spec; empty on failure. */
function trackedSpecPaths(root: string): string[] {
  return (git(root, [...NO_FSMONITOR, 'ls-files', '-z', '--', 'specs/']) ?? '').split('\0').filter((path) => path !== '');
}

/** `git worktree list --porcelain` in the main checkout at `root`; empty on failure. */
export function worktreeListing(root: string): string {
  return git(root, ['worktree', 'list', '--porcelain']) ?? '';
}

/**
 * The spec folders only a live spec worktree carries (spec 039, ISC-208.1; spec 062, ISC-444), as active spec references
 * whose `dir` is the folder in that worktree, `<root>/<worktree>/specs/NNN-slug`, in number order, as the app's
 * `readWorktreeView` lists them: `core/`'s `worktreeOnlySpecs` over what `git ls-files -z -- specs/` prints inside each
 * spec worktree. `listed` is the main checkout's `listSpecs`, `porcelain` its `worktreeListing`. The `ls-files` runs
 * only for a spec worktree inside the repository that belongs to no main folder and holds its `.git`, so a repository
 * whose spec worktrees all carry a main folder starts no git process here.
 */
export function worktreeOnlyRefs(root: string, listed: readonly SpecRef[], porcelain: string): SpecRef[] {
  const mainFolders = listed.map((ref) => ref.slug);
  const { worktrees } = assignWorktrees(porcelain, mainFolders);
  const tracked: Record<string, string[]> = {};
  for (const w of worktrees) {
    if (w.kind !== 'spec' || w.spec !== null || w.path === null || !insideRepository(w.path) || !holdsGit(join(root, w.path))) continue;
    tracked[w.path] = trackedSpecPaths(join(root, w.path));
  }
  if (Object.keys(tracked).length === 0) return [];
  return worktreeOnlySpecs(worktrees, mainFolders, tracked).map(
    (spec): SpecRef => ({ kind: 'spec', id: spec.id, slug: spec.slug, dir: join(root, spec.worktree, 'specs', spec.slug), archived: false }),
  );
}

/** The listing of the main checkout at `root`, assigned to the spec folders of `refs`, and what git must be asked next. */
function assigned(root: string, refs: readonly SpecRef[], listing?: string): { porcelain: string; assignment: WorktreeAssignment; facts: WorktreeFactsToRead } {
  const porcelain = listing ?? worktreeListing(root);
  const assignment = assignWorktrees(porcelain, refs.map((ref) => ref.slug));
  return { porcelain, assignment, facts: worktreeFactsToRead(assignment) };
}

/** The worktrees of `assignment` split by the rule "ended" (`liveWorktrees`), over the git facts `core/` asked for. */
function splitOf(root: string, assignment: WorktreeAssignment, facts: WorktreeFactsToRead): LiveWorktrees {
  const merged = mergedOf(root, facts.branches);
  const present = facts.paths.filter((path) => holdsGit(join(root, path)));
  const dirty = statusToRead(facts.ofSpec, merged, present).filter((path) => isDirty(join(root, path)));
  return liveWorktrees(assignment, { merged, present, dirty });
}

/**
 * Per active spec of `refs` (the main checkout's `listSpecs` with `worktreeOnlyRefs`) whose read source is a live spec worktree's copy, the
 * absolute folder of that copy, by spec folder name; a spec not in the answer reads from `ref.dir`. `root` is the main
 * checkout (`repoRoot`). Only `git worktree list` runs when no worktree belongs to a spec, and only one `ls-files` more
 * when git tracks no folder of such a spec: an untracked or linked `specs/` reads from the main checkout whatever the
 * worktrees' merge state, so the merge, presence and status reads are skipped.
 */
export function specReadDirs(root: string, refs: readonly SpecRef[], listing?: string): Map<string, string> {
  const dirs = new Map<string, string>();
  const active = refs.filter((ref) => !ref.archived);
  if (active.length === 0) return dirs;
  // A spec only a worktree carries (`worktreeOnlyRefs`) reads from its folder there, as the app reads it (ISC-444).
  for (const ref of active) if (ref.dir !== join(root, 'specs', ref.slug) && existsSync(join(ref.dir, 'spec.md'))) dirs.set(ref.slug, ref.dir);
  const { porcelain, assignment, facts } = assigned(root, refs, listing);
  if (facts.ofSpec.length === 0) return dirs;
  const paths = trackedSpecPaths(root);
  const trackedOf = (slug: string): string[] => paths.filter((path) => path.startsWith(`specs/${slug}/`));
  if (!active.some((ref) => facts.ofSpec.some((w) => w.spec === ref.id) && trackedOf(ref.slug).length > 0)) return dirs;
  const split = splitOf(root, assignment, facts);
  // `ls-files` for each active spec with a live spec worktree inside the repository, as the app's view lists it.
  const tracked = Object.fromEntries(trackedToRead(split.live, active).map((slug) => [slug, trackedOf(slug)]));
  const view = worktreeViewOf({ porcelain, assignment, split, tracked });
  for (const ref of active) {
    if (dirs.has(ref.slug)) continue;
    const copy = copyDirFor(root, ref, view);
    if (copy !== null && existsSync(join(copy, 'spec.md'))) dirs.set(ref.slug, copy);
  }
  return dirs;
}

/**
 * Per active spec of `refs` with a live spec worktree inside the repository, that worktree's absolute folder, by spec
 * folder name: the checkout whose tree a code-reviewed mark names, whatever `specs/` tracks there (spec 041, ISC-211;
 * spec 062, ISC-439), as the app's `specSourceFor` computes `read.tree` (`ownLiveWorktree`). A spec not in the answer
 * names the main checkout's tree. Read only where a tree is needed, since it reads the merge state of every spec
 * worktree.
 */
export function specTreeDirs(root: string, refs: readonly SpecRef[], listing?: string): Map<string, string> {
  const dirs = new Map<string, string>();
  const active = refs.filter((ref) => !ref.archived);
  if (active.length === 0) return dirs;
  const { assignment, facts } = assigned(root, refs, listing);
  if (facts.ofSpec.length === 0) return dirs;
  const { live } = splitOf(root, assignment, facts);
  for (const ref of active) {
    const worktree = ownLiveWorktree(live, ref.id);
    if (worktree?.path != null) dirs.set(ref.slug, join(root, worktree.path));
  }
  return dirs;
}
