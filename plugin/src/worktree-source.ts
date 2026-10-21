// The read source of each spec for the plugin CLI (spec 062, ISC-438): the folder `spec-check` reads a spec from, by
// the app's rule and independent of the checkout it is called from. The app gathers its git facts in
// `server/src/workspace/worktree-view.ts` and decides per spec in `server/src/workspace/spec-source.ts`; the plugin
// may import only `core/` (it is bundled), so this module gathers the same facts itself and hands them to `core/`'s
// `assignWorktrees`, `liveWorktrees` and `copyDirFor`, which decide (FORMAT.md § Worktrees):
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
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import type { SpecRef } from '../../core/src/resolve.ts';
import type { Worktree } from '../../core/src/files.ts';
import {
  type LiveWorktrees,
  type WorktreeAssignment,
  type WorktreeView,
  assignWorktrees,
  copyDirFor,
  isSpecBranch,
  liveWorktrees,
  mainBranchOf,
} from '../../core/src/worktrees.ts';

const NO_FSMONITOR = ['-c', 'core.fsmonitor=false'];

/** The output of one read-only git command run in `cwd`; null when git is missing or the command exits non-zero. */
function git(cwd: string, args: readonly string[]): string | null {
  const r = Bun.spawnSync(['git', '-C', cwd, ...args], { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** Whether `folder` still holds its own `.git` (a file in a linked worktree), not followed through a link. */
function hasOwnGit(folder: string): boolean {
  try {
    lstatSync(join(folder, '.git'));
    return true;
  } catch {
    return false;
  }
}

/** The branches of `branches` a merge brought into the local `main` (`mergedSpecBranches`, ISC-162.1). */
function mergedOf(root: string, branches: readonly string[]): string[] {
  if (branches.length === 0) return [];
  const main = git(root, ['rev-parse', '--verify', '-q', 'refs/heads/main^{commit}'])?.trim() ?? '';
  if (main === '') return [];
  const firstParent = new Set((git(root, ['rev-list', '--first-parent', main, '--']) ?? '').split('\n').filter((sha) => sha !== ''));
  return branches.filter((branch) => {
    const tip = git(root, ['rev-parse', '--verify', '-q', `refs/heads/${branch}^{commit}`])?.trim() ?? '';
    // A tip on main's first-parent line (fresh from main, or fast-forwarded) was brought in by no merge.
    if (tip === '' || firstParent.has(tip)) return false;
    return git(root, ['merge-base', '--is-ancestor', tip, main]) !== null;
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

/** The listing of the main checkout at `root`, assigned to the spec folders of `refs`, and the worktrees of a spec. */
function assigned(root: string, refs: readonly SpecRef[]): { porcelain: string; assignment: WorktreeAssignment; ofSpec: Worktree[] } {
  const porcelain = git(root, ['worktree', 'list', '--porcelain']) ?? '';
  const assignment = assignWorktrees(porcelain, refs.map((ref) => ref.slug));
  return { porcelain, assignment, ofSpec: assignment.worktrees.filter((w) => w.kind === 'spec' && w.spec !== null) };
}

/** The worktrees of `assignment` split by the rule "ended" (`liveWorktrees`), over the git facts read for `ofSpec`. */
function split(root: string, assignment: WorktreeAssignment, ofSpec: readonly Worktree[]): LiveWorktrees {
  const merged = mergedOf(root, [...new Set(ofSpec.flatMap((w) => (w.branch !== null && isSpecBranch(w.branch) ? [w.branch] : [])))]);
  const present = ofSpec.flatMap((w) => (w.path !== null && hasOwnGit(join(root, w.path)) ? [w.path] : []));
  const dirty = ofSpec.flatMap((w) =>
    w.path !== null && present.includes(w.path) && w.branch !== null && merged.includes(w.branch) && isDirty(join(root, w.path)) ? [w.path] : [],
  );
  return liveWorktrees(assignment, { merged, present, dirty });
}

/** The first live spec worktree of the spec `id` inside the repository, in git's order, as the app's view finds it. */
const liveOf = (live: readonly Worktree[], id: string): Worktree | null =>
  live.find((w) => w.kind === 'spec' && w.spec === id && w.path !== null && w.path !== '..' && !w.path.startsWith('../')) ?? null;

/**
 * Per active spec of `refs` (the main checkout's `listSpecs`) whose read source is a live spec worktree's copy, the
 * absolute folder of that copy, by spec folder name; a spec not in the answer reads from `ref.dir`. `root` is the main
 * checkout (`repoRoot`). Only `git worktree list` runs when no worktree belongs to a spec, and only one `ls-files` more
 * when git tracks no folder of such a spec: an untracked or linked `specs/` reads from the main checkout whatever the
 * worktrees' merge state, so the merge, presence and status reads are skipped.
 */
export function specReadDirs(root: string, refs: readonly SpecRef[]): Map<string, string> {
  const dirs = new Map<string, string>();
  const active = refs.filter((ref) => !ref.archived);
  if (active.length === 0) return dirs;
  const { porcelain, assignment, ofSpec } = assigned(root, refs);
  if (ofSpec.length === 0) return dirs;
  const paths = trackedSpecPaths(root);
  const trackedOf = (slug: string): string[] => paths.filter((path) => path.startsWith(`specs/${slug}/`));
  if (!active.some((ref) => ofSpec.some((w) => w.spec === ref.id) && trackedOf(ref.slug).length > 0)) return dirs;
  const { live, ended } = split(root, assignment, ofSpec);
  // `ls-files` for each active spec with a live spec worktree inside the repository, as the app's view lists it.
  const tracked: Record<string, readonly string[]> = {};
  for (const ref of active) {
    if (live.some((w) => w.kind === 'spec' && w.spec === ref.id && w.path !== null)) tracked[ref.slug] = trackedOf(ref.slug);
  }
  const view: WorktreeView = { assignment, live, ended, mainBranch: mainBranchOf(porcelain), tracked };
  for (const ref of active) {
    const copy = copyDirFor(root, ref, view);
    if (copy !== null && existsSync(join(copy, 'spec.md'))) dirs.set(ref.slug, copy);
  }
  return dirs;
}

/**
 * Per active spec of `refs` with a live spec worktree inside the repository, that worktree's absolute folder, by spec
 * folder name: the checkout whose tree a code-reviewed mark names, whatever `specs/` tracks there (spec 041, ISC-211;
 * spec 062, ISC-439), as the app's `specSourceFor` computes `read.tree`. A spec not in the answer names the main
 * checkout's tree. Read only where a tree is needed, since it reads the merge state of every spec worktree.
 */
export function specTreeDirs(root: string, refs: readonly SpecRef[]): Map<string, string> {
  const dirs = new Map<string, string>();
  const active = refs.filter((ref) => !ref.archived);
  if (active.length === 0) return dirs;
  const { assignment, ofSpec } = assigned(root, refs);
  if (ofSpec.length === 0) return dirs;
  const { live } = split(root, assignment, ofSpec);
  for (const ref of active) {
    const worktree = liveOf(live, ref.id);
    if (worktree?.path != null) dirs.set(ref.slug, join(root, worktree.path));
  }
  return dirs;
}
