// Spec 062, ISC-443: the rule which copy is a spec's read source stands once in core/, and the server and the plugin
// only run git and hand its answers here. These tests pin the pure rules on hand-written answers, no git and no file:
//
//   - `mainCheckoutFrom` names the main checkout from `git rev-parse --git-common-dir`, with the server's fallbacks
//     (no answer, a common directory that is no `.git` folder, a parent without its own `.git`, the main checkout
//     itself) and the caller's file system facts as predicates.
//   - `worktreeFactsToRead`, `statusToRead`, `trackedToRead` and `worktreeViewOf` assemble the `WorktreeView` both
//     lanes read, over a listing in `git worktree list --porcelain` form.
//   - `ownLiveWorktree` is the spec's own live spec worktree inside the repository, the one `copyDirFor` reads from.
//   - `mergeNeedsAncestry` is the pure part of the merge rule.
import { describe, expect, test } from 'bun:test';

import type { Worktree } from '../src/files.ts';
import { mainCheckoutFrom, mergeNeedsAncestry, statusToRead, trackedToRead, worktreeFactsToRead, worktreeViewOf } from '../src/worktree-facts.ts';
import { assignWorktrees, copyDirFor, insideRepository, liveWorktrees, ownLiveWorktree } from '../src/worktrees.ts';

const ROOT = '/srv/repo';

/** A file system where only `withGit` hold their own `.git` and no folder is reached through a link. */
const fsFacts = (withGit: readonly string[]) => ({ holdsGit: (folder: string) => withGit.includes(folder), sameFolder: (a: string, b: string) => a === b });

describe('mainCheckoutFrom names the main checkout from git common dir (spec 062, ISC-443)', () => {
  const fs = fsFacts([ROOT, `${ROOT}/.worktrees/062-x`]);

  test('a linked worktree and a subfolder answer the main checkout; the main checkout answers itself as given', () => {
    expect(mainCheckoutFrom({ cwd: `${ROOT}/.worktrees/062-x`, commonDir: `${ROOT}/.git\n`, ...fs })).toBe(ROOT);
    expect(mainCheckoutFrom({ cwd: `${ROOT}/specs`, commonDir: `${ROOT}/.git`, ...fs })).toBe(ROOT);
    expect(mainCheckoutFrom({ cwd: ROOT, commonDir: '.git', ...fs })).toBe(ROOT);
    expect(mainCheckoutFrom({ cwd: `${ROOT}/`, commonDir: '.git', ...fs })).toBe(`${ROOT}/`);
  });

  test('no answer, a bare or submodule layout, a parent without its own .git and a linked spelling keep cwd', () => {
    const cwd = `${ROOT}/.worktrees/062-x`;
    expect(mainCheckoutFrom({ cwd, commonDir: null, ...fs })).toBe(cwd);
    expect(mainCheckoutFrom({ cwd, commonDir: '  \n', ...fs })).toBe(cwd);
    expect(mainCheckoutFrom({ cwd, commonDir: '/x/modules/sub', ...fs })).toBe(cwd);
    expect(mainCheckoutFrom({ cwd, commonDir: `${ROOT}/.git`, ...fsFacts([cwd]) })).toBe(cwd);
    expect(mainCheckoutFrom({ cwd: '/link/repo', commonDir: `${ROOT}/.git`, holdsGit: () => true, sameFolder: () => true })).toBe('/link/repo');
  });
});

const LISTING = [
  `worktree ${ROOT}`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${ROOT}/.worktrees/012-harbor`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/feature/012-harbor',
  '',
  `worktree ${ROOT}/.worktrees/013-lantern`,
  'HEAD 3333333333333333333333333333333333333333',
  'branch refs/heads/feature/013-lantern',
  '',
  `worktree ${ROOT}/.claude/worktrees/agent-1`,
  'HEAD 4444444444444444444444444444444444444444',
  'branch refs/heads/worktree-agent-1',
  '',
  'worktree /srv/elsewhere/012-copy',
  'HEAD 5555555555555555555555555555555555555555',
  'branch refs/heads/fix/012-harbor',
  '',
].join('\n');

const REFS = [
  { id: '012', slug: '012-harbor', archived: false },
  { id: '013', slug: '013-lantern', archived: false },
];

describe('the worktree view is assembled once in core (spec 062, ISC-443)', () => {
  const assignment = assignWorktrees(LISTING, REFS.map((ref) => ref.slug));

  test('worktreeFactsToRead names the spec worktrees of a spec, their spec branches once and their paths', () => {
    const facts = worktreeFactsToRead(assignment);
    expect(facts.ofSpec.map((w) => w.path)).toEqual(['.worktrees/012-harbor', '.worktrees/013-lantern', null]);
    expect(facts.branches).toEqual(['feature/012-harbor', 'feature/013-lantern', 'fix/012-harbor']);
    expect(facts.paths).toEqual(['.worktrees/012-harbor', '.worktrees/013-lantern']);
  });

  test('statusToRead asks git status only of a present worktree whose branch is merged', () => {
    const { ofSpec } = worktreeFactsToRead(assignment);
    expect(statusToRead(ofSpec, ['feature/013-lantern'], ['.worktrees/012-harbor', '.worktrees/013-lantern'])).toEqual(['.worktrees/013-lantern']);
    expect(statusToRead(ofSpec, ['feature/013-lantern'], ['.worktrees/012-harbor'])).toEqual([]);
    expect(statusToRead(ofSpec, [], ['.worktrees/012-harbor', '.worktrees/013-lantern'])).toEqual([]);
  });

  test('trackedToRead and worktreeViewOf: only active specs with a live spec worktree inside the repository', () => {
    const split = liveWorktrees(assignment, { merged: ['feature/013-lantern'], present: ['.worktrees/012-harbor', '.worktrees/013-lantern'], dirty: [] });
    expect(split.ended.map((e) => [e.worktree.path, e.reason])).toEqual([['.worktrees/013-lantern', 'merged']]);
    expect(trackedToRead(split.live, REFS)).toEqual(['012-harbor']);
    expect(trackedToRead(split.live, [{ id: '012', slug: '012-harbor', archived: true }])).toEqual([]);
    const tracked = { '012-harbor': ['specs/012-harbor/spec.md'] };
    const view = worktreeViewOf({ porcelain: LISTING, assignment, split, tracked });
    expect(view).toEqual({ assignment, live: split.live, ended: split.ended, mainBranch: 'main', tracked });
    const live: Worktree[] = split.live.map((w) => ({ ...w, ahead: 1 }));
    expect(worktreeViewOf({ porcelain: LISTING, assignment, split, live, tracked }).live).toBe(live);
    expect(copyDirFor(ROOT, REFS[0] ?? { id: '', slug: '' }, view)).toBe(`${ROOT}/.worktrees/012-harbor/specs/012-harbor`);
  });
});

describe('ownLiveWorktree is the spec own live spec worktree inside the repository (spec 062, ISC-443)', () => {
  const spec = (path: string | null, id = '012'): Worktree => ({ kind: 'spec', spec: id, path, branch: `feature/${id}-x`, ahead: null, dirty: null });

  test('the first live spec worktree of the spec in git order, null when it lies outside', () => {
    const inside = spec('.worktrees/012-x');
    expect(ownLiveWorktree([spec('.worktrees/013-y', '013'), inside], '012')).toBe(inside);
    expect(ownLiveWorktree([spec(null), inside], '012')).toBeNull();
    expect(ownLiveWorktree([spec('../repo-012'), inside], '012')).toBeNull();
    expect(ownLiveWorktree([], '012')).toBeNull();
  });

  test('insideRepository refuses an absolute path, .. and a path below ../', () => {
    expect(insideRepository('.worktrees/012-x')).toBe(true);
    expect(insideRepository('/srv/other')).toBe(false);
    expect(insideRepository('..')).toBe(false);
    expect(insideRepository('../repo-012')).toBe(false);
  });
});

describe('mergeNeedsAncestry is the pure part of the merge rule (ISC-162.1; spec 062, ISC-443)', () => {
  test('no tip, no main and a tip on main first-parent line need no ancestry read; any other tip does', () => {
    const line = new Set(['a1', 'b2']);
    expect(mergeNeedsAncestry('c3', 'a1', line)).toBe(true);
    expect(mergeNeedsAncestry('b2', 'a1', line)).toBe(false);
    expect(mergeNeedsAncestry('', 'a1', line)).toBe(false);
    expect(mergeNeedsAncestry(null, 'a1', line)).toBe(false);
    expect(mergeNeedsAncestry('c3', null, line)).toBe(false);
  });
});
