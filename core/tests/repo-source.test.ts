// Spec 039, ISC-209 and ISC-209.1: where a repository file is read. `repoFileSourceOf(path, candidates)`
// (core/src/repo-source.ts) takes one candidate per place the file can be read, the main checkout and each live spec
// worktree, with the facts the server read there: present, tracked by that branch, differing from the main checkout's
// bytes, a digest and the time of its last change. It reads the newest differing, tracked version when it is newer
// than the main checkout's; an untracked file in the main checkout always stays there. `-t "repo files"` runs ISC-209,
// `-t conflict` ISC-209.1.
import { describe, expect, test } from 'bun:test';

import type { RepoFileSource } from '../src/files.ts';
import { MAIN_SOURCE, type RepoFileCandidate, repoFileSourceOf } from '../src/repo-source.ts';

const TLDR = 'specs/tldr.md';
const wt = (worktree: string): RepoFileSource => ({ kind: 'worktree', worktree });

/** The main checkout's candidate: present and tracked, last committed at `at`. */
const main = (at: string | null, over: Partial<RepoFileCandidate> = {}): RepoFileCandidate => ({
  origin: MAIN_SOURCE,
  present: true,
  tracked: true,
  differs: false,
  digest: 'main',
  at,
  ...over,
});

/** A worktree's candidate: present, tracked and differing, with its own digest, changed at `at`. */
const copy = (worktree: string, at: string | null, over: Partial<RepoFileCandidate> = {}): RepoFileCandidate => ({
  origin: wt(worktree),
  present: true,
  tracked: true,
  differs: true,
  digest: worktree,
  at,
  ...over,
});

describe('repo files (spec 039, ISC-209)', () => {
  test('repo files: the newest differing version of a worktree is read, with its source', () => {
    const decision = repoFileSourceOf(TLDR, [
      main('2026-10-01T09:00:00Z'),
      copy('.worktrees/012-harbor', '2026-10-03T09:00:00Z'),
      copy('.worktrees/014-export', '2026-10-02T09:00:00Z', { digest: '.worktrees/012-harbor' }),
    ]);
    expect(decision.source).toEqual(wt('.worktrees/012-harbor'));
  });

  test('repo files: an uncommitted change dated by its mtime wins over an older commit on main', () => {
    const decision = repoFileSourceOf('specs/ideas/a.md', [main('2026-10-01T09:00:00Z'), copy('.worktrees/012-harbor', '2026-10-05T12:30:00Z')]);
    expect(decision.source).toEqual(wt('.worktrees/012-harbor'));
  });

  test('repo files: the main checkout wins when it changed last, and on a tie', () => {
    expect(repoFileSourceOf(TLDR, [main('2026-10-04T09:00:00Z'), copy('.worktrees/012-harbor', '2026-10-03T09:00:00Z')]).source).toEqual(MAIN_SOURCE);
    expect(repoFileSourceOf(TLDR, [main('2026-10-03T09:00:00Z'), copy('.worktrees/012-harbor', '2026-10-03T09:00:00Z')]).source).toEqual(MAIN_SOURCE);
  });

  test('repo files: a version that is equal, untracked, absent or undated never competes', () => {
    const at = '2026-10-09T09:00:00Z';
    for (const over of [{ differs: false }, { tracked: false }, { present: false, digest: null }, { at: null }]) {
      expect(repoFileSourceOf(TLDR, [main('2026-10-01T09:00:00Z'), copy('.worktrees/012-harbor', at, over)]).source).toEqual(MAIN_SOURCE);
    }
  });

  test('repo files: a file the main checkout holds untracked stays the main checkout\'s, a linked specs/ included', () => {
    const untracked = main(null, { tracked: false });
    expect(repoFileSourceOf(TLDR, [untracked, copy('.worktrees/012-harbor', '2026-10-09T09:00:00Z')]).source).toEqual(MAIN_SOURCE);
  });

  test('repo files: a file only a worktree tracks is read from it; without any candidate, main', () => {
    const absent = main(null, { present: false, tracked: false, digest: null });
    expect(repoFileSourceOf(TLDR, [absent, copy('.worktrees/012-harbor', '2026-10-09T09:00:00Z')]).source).toEqual(wt('.worktrees/012-harbor'));
    expect(repoFileSourceOf(TLDR, [])).toEqual({ source: MAIN_SOURCE, diagnostics: [] });
  });

  test('repo files: one worktree alone raises no warning', () => {
    expect(repoFileSourceOf(TLDR, [main('2026-10-01T09:00:00Z'), copy('.worktrees/012-harbor', '2026-10-03T09:00:00Z')]).diagnostics).toEqual([]);
  });
});
