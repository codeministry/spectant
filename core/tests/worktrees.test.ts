// Spec 027, ISC-174 and ISC-174.1: which spec each worktree of a workspace belongs to. `assignWorktrees(porcelain,
// specs)` (core/src/worktrees.ts) takes the raw text of `git worktree list --porcelain`, as the server reads it, and the
// spec folders of the workspace (`NNN-slug`), and returns `{ worktrees: Worktree[], builders: number, diagnostics }`:
//
//   - The first record is the main worktree. Its path is the workspace root; every other path is relative to it,
//     `/`-separated (`../repo-013` outside it). The main worktree itself is not listed.
//   - Every other record is listed in the order git prints it. One under `.claude/worktrees/` is a `builder`: counted
//     in `builders`, never assigned (`spec: null`), never read.
//   - A spec worktree belongs to the spec its path `.worktrees/NNN-slug` names, else to the one its branch
//     `feature/`, `fix/`, `spike/` or `infra/` plus `NNN-slug` names, matched on `NNN` against the spec folders; a
//     number no spec folder carries assigns nothing. When path and branch name two different specs, the path wins and
//     one warning `worktree-branch-mismatch` names the path's spec (`subject`) and the record's `worktree` line.
//   - `ahead` and `dirty` stay null here: the server reads them per spec worktree (ISC-175).
//
// The goldens beside the listings in core/fixtures/worktrees/ are hand-written: two-space JSON, keys sorted, one
// trailing newline. The model is compared with them byte for byte after its keys are sorted the same way, so the order
// in which `worktrees.ts` builds an object does not matter. `-t assign` runs ISC-174, `-t mismatch` ISC-174.1.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { assignWorktrees } from '../src/worktrees.ts';
import { goldenText } from './helpers/golden.ts';

const DIR = join(import.meta.dir, '..', 'fixtures', 'worktrees');

/** The spec folders of the invented workspace at `/srv/repo` that every listing belongs to. */
const SPECS = ['012-harbor', '013-relay', '014-export', '015-ledger', '016-audit', '017-tidy', '018-probe'] as const;

/** Every listing in the fixture, by name without `.porcelain`, in name order. */
const LISTINGS = readdirSync(DIR)
  .filter((file) => file.endsWith('.porcelain'))
  .map((file) => file.slice(0, -'.porcelain'.length))
  .sort();

const read = (file: string): string => readFileSync(join(DIR, file), 'utf8');

/** The same value with every object's keys in code-unit order, so `goldenText` of it is canonical. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  );
}

/** The `worktree <path>` line of every record in a listing, the main worktree's first. */
const recordPaths = (text: string): string[] =>
  text
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));

describe('assign: worktrees from git worktree list --porcelain to the specs of the workspace (ISC-174)', () => {
  test('the fixture holds the three listings: spec worktrees, a path-branch conflict, builders', () => {
    expect(LISTINGS).toEqual(['builders', 'conflict', 'spec-worktrees']);
  });

  test.each(LISTINGS)('%s.porcelain has the shape git prints: main first, one blank line after every record', (name) => {
    const text = read(`${name}.porcelain`);
    expect(text.endsWith('\n\n')).toBe(true);
    expect(text.endsWith('\n\n\n')).toBe(false);
    const records = text.slice(0, -2).split('\n\n');
    expect(records[0]).toMatch(/^worktree \/srv\/repo\nHEAD [0-9a-f]{40}\nbranch refs\/heads\/main$/);
    for (const record of records) {
      expect(record).toMatch(
        /^worktree \/srv\/repo\S*\nHEAD [0-9a-f]{40}\n(?:branch refs\/heads\/\S+|detached)(?:\n(?:locked|prunable)(?: [^\n]*)?)*$/,
      );
    }
  });

  test.each(LISTINGS)('%s.golden.json is canonical: keys sorted, two-space JSON, one trailing newline', (name) => {
    const text = read(`${name}.golden.json`);
    expect(goldenText(sortKeys(JSON.parse(text)))).toBe(text);
  });

  test.each(LISTINGS)('%s.porcelain yields its golden byte for byte', (name) => {
    const built = assignWorktrees(read(`${name}.porcelain`), SPECS);
    expect(goldenText(sortKeys(built))).toBe(read(`${name}.golden.json`));
  });

  test.each(LISTINGS)('%s.porcelain: the main worktree is left out, every other path is relative to it', (name) => {
    const text = read(`${name}.porcelain`);
    const { worktrees } = assignWorktrees(text, SPECS);
    expect(worktrees).toHaveLength(recordPaths(text).length - 1);
    for (const w of worktrees) {
      expect(w.path.startsWith('/')).toBe(false);
      expect(w.path).not.toBe('');
    }
  });

  test('builders under .claude/worktrees/ are counted and never assigned', () => {
    const text = read('builders.porcelain');
    const listed = recordPaths(text).filter((path) => path.startsWith('/srv/repo/.claude/worktrees/')).length;
    expect(listed).toBe(3);
    const { worktrees, builders } = assignWorktrees(text, SPECS);
    expect(builders).toBe(listed);
    const kept = worktrees.filter((w) => w.kind === 'builder');
    expect(kept).toHaveLength(listed);
    for (const w of kept) {
      expect(w.path.startsWith('.claude/worktrees/')).toBe(true);
      expect(w).toMatchObject({ spec: null, ahead: null, dirty: null });
    }
  });
});

describe('mismatch: the path and the branch of a worktree name two different specs (ISC-174.1)', () => {
  test('the path wins, and the spec of the path carries exactly one worktree-branch-mismatch warning', () => {
    const { worktrees, diagnostics } = assignWorktrees(read('conflict.porcelain'), SPECS);
    expect(worktrees.find((w) => w.path === '.worktrees/015-ledger')).toMatchObject({
      branch: 'feature/016-audit',
      kind: 'spec',
      spec: '015',
    });
    const found = diagnostics.filter((d) => d.code === 'worktree-branch-mismatch');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: 'warning', subject: '015', line: 5 });
  });

  test('a worktree without a spec number in path or branch belongs to no spec and raises no diagnostic', () => {
    const conflict = assignWorktrees(read('conflict.porcelain'), SPECS);
    expect(conflict.worktrees.find((w) => w.path === '.worktrees/notes')).toMatchObject({ kind: 'spec', spec: null });
    expect(conflict.diagnostics).toHaveLength(1);

    const plain = assignWorktrees(read('spec-worktrees.porcelain'), SPECS);
    expect(plain.worktrees.find((w) => w.path === '.worktrees/scratch')).toMatchObject({ kind: 'spec', spec: null });
    expect(plain.diagnostics).toEqual([]);
  });
});
