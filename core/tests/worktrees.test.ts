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
//
// Spec 027, ISC-181 and ISC-181.1: where a spec's files are read. `specSourceOf({ folder, worktree, lsFiles })` takes
// the spec folder (`NNN-slug`), the worktree `assignWorktrees` gave the spec (or null) and the paths the server's
// `git ls-files -z -- specs/NNN-slug` printed in the main checkout, and returns `worktree` only when the worktree is a
// spec worktree of that spec and one listed path lies under `specs/NNN-slug/`; `main` otherwise. The worktrees come
// from the listings above, so the source is decided on what `assignWorktrees` really builds. `-t source` runs ISC-181's
// core part, `-t untracked` the pure part of ISC-181.1 (an untracked or symlinked `specs/` keeps `main`).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

import { FILE_KINDS, type Worktree } from '../src/files.ts';
import { assignWorktrees, specSourceOf, WORKTREE_COPY_KINDS } from '../src/worktrees.ts';
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

/** The worktree `assignWorktrees` gives spec `id` in a listing of the fixture; null when it gives none. */
function worktreeOf(listing: string, id: string): Worktree | null {
  return assignWorktrees(read(`${listing}.porcelain`), SPECS).worktrees.find((w) => w.spec === id) ?? null;
}

/** The first builder of the fixture, as `assignWorktrees` builds it: kind `builder`, `spec` null. */
function firstBuilder(): Worktree {
  const builder = assignWorktrees(read('builders.porcelain'), SPECS).worktrees.find((w) => w.kind === 'builder');
  if (builder === undefined) throw new Error('builders.porcelain lists no builder');
  return builder;
}

/** What `git ls-files -z -- specs/012-harbor` prints, split on NUL, when the folder is tracked. */
const HARBOR_TRACKED = [
  'specs/012-harbor/.gates/reviewed.json',
  'specs/012-harbor/events.jsonl',
  'specs/012-harbor/plan.md',
  'specs/012-harbor/spec.md',
  'specs/012-harbor/tasks.md',
] as const;

describe('source: where the app reads a spec, the main checkout or the copy in its worktree (ISC-181)', () => {
  test('a tracked folder and a spec worktree of that spec read from the worktree', () => {
    const worktree = worktreeOf('spec-worktrees', '012');
    expect(worktree).toMatchObject({ path: '.worktrees/012-harbor', kind: 'spec', spec: '012' });
    expect(specSourceOf({ folder: '012-harbor', worktree, lsFiles: HARBOR_TRACKED })).toBe('worktree');
  });

  test('a tracked folder without a worktree reads from main', () => {
    expect(worktreeOf('spec-worktrees', '015')).toBeNull();
    expect(specSourceOf({ folder: '015-ledger', worktree: null, lsFiles: ['specs/015-ledger/spec.md'] })).toBe('main');
  });

  test('an empty ls-files answer reads from main even with a spec worktree', () => {
    const worktree = worktreeOf('spec-worktrees', '012');
    expect(specSourceOf({ folder: '012-harbor', worktree, lsFiles: [] })).toBe('main');
  });

  test('a builder worktree only reads from main, whatever its branch names', () => {
    const builder = firstBuilder();
    expect(specSourceOf({ folder: '012-harbor', worktree: builder, lsFiles: HARBOR_TRACKED })).toBe('main');
    const onSpecBranch = { ...builder, branch: 'feature/012-harbor' };
    expect(specSourceOf({ folder: '012-harbor', worktree: onSpecBranch, lsFiles: HARBOR_TRACKED })).toBe('main');
  });

  test('a worktree that belongs to another spec reads from main', () => {
    const relay = worktreeOf('spec-worktrees', '013');
    expect(relay).toMatchObject({ kind: 'spec', spec: '013' });
    expect(specSourceOf({ folder: '012-harbor', worktree: relay, lsFiles: HARBOR_TRACKED })).toBe('main');
  });

  test('the copy holds the eight the claim names: five Markdown files, two logs and .gates/', () => {
    const paths = WORKTREE_COPY_KINDS.map((kind) => FILE_KINDS[kind].path.replace(/^\.gates\/.*$/u, '.gates/'));
    expect([...new Set(paths)]).toEqual([
      'spec.md',
      'plan.md',
      'tasks.md',
      'context.md',
      'design.md',
      'events.jsonl',
      'rounds.jsonl',
      '.gates/',
    ]);
    for (const kind of WORKTREE_COPY_KINDS) expect(FILE_KINDS[kind].scope).toBe('spec');
  });
});

describe('untracked: an untracked or symlinked specs/ keeps every spec on the main checkout (ISC-181.1)', () => {
  test('every spec worktree of the fixture keeps main when git lists nothing under its folder', () => {
    for (const name of SPECS) {
      const worktree = worktreeOf('spec-worktrees', name.slice(0, 3));
      expect(specSourceOf({ folder: name, worktree, lsFiles: [] })).toBe('main');
    }
  });

  test('a linked specs/ or spec folder: git lists the link itself, never a file under specs/NNN-slug/', () => {
    const worktree = worktreeOf('spec-worktrees', '012');
    for (const lsFiles of [['specs'], ['specs/012-harbor'], ['']]) {
      expect(specSourceOf({ folder: '012-harbor', worktree, lsFiles })).toBe('main');
    }
  });

  test('a sibling folder that shares the name as a prefix counts for nothing', () => {
    const worktree = worktreeOf('spec-worktrees', '012');
    const lsFiles = ['specs/012-harbor-old/spec.md', 'specs/012-harbor.md', 'docs/specs/012-harbor/spec.md'];
    expect(specSourceOf({ folder: '012-harbor', worktree, lsFiles })).toBe('main');
  });
});
