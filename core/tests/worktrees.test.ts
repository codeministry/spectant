// Spec 027, ISC-174 and ISC-174.1: which spec each worktree of a workspace belongs to. `assignWorktrees(porcelain,
// specs)` (core/src/worktrees.ts) takes the raw text of `git worktree list --porcelain`, as the server reads it, and the
// spec folders of the workspace (`NNN-slug`), and returns `{ worktrees: Worktree[], builders: number, diagnostics }`:
//
//   - The first record is the main worktree. Its path is the workspace root; every other path is relative to it,
//     `/`-separated, null for one outside it (spec 041, ISC-216). The main worktree itself is not listed.
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
// core part, `-t untracked` ISC-181.1 (an untracked or symlinked `specs/` keeps `main`).
//
// `symlink-specs.porcelain` is this repository's own layout: `specs/` untracked in the main checkout, and every spec
// worktree `.worktrees/NNN-slug` holding `specs` as a symbolic link to it. Its sidecar `symlink-specs.ls-files` is what
// `git ls-files -z -- specs/NNN-slug` prints in that main checkout, verbatim; git lists tracked paths only, so the
// answer is empty for every spec folder. The anti-claim's second half reads the harbor fixture tree, which has no
// tracked `specs/` either, with one spec worktree per spec: every spec keeps `main`, and the dashboard, spec and live
// families built from what the source picks are byte-identical to the committed goldens (`fixtures.test.ts`,
// `golden.test.ts`), compared without ever rewriting one. `buildDashboard` takes no worktrees yet; once it does (T12,
// T19), the same assertion moves onto that input.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { afterAll, describe, expect, test } from 'bun:test';

import { buildDashboard, type DashboardInput } from '../src/dashboard.ts';
import { FILE_KINDS, type SpecFiles, type Worktree } from '../src/files.ts';
import { catalogSourceOf, readCatalog } from '../src/library.ts';
import { MAIN_SOURCE, REPO_SOURCE_PATHS, type RepoFileCandidate, repoFileSourceOf } from '../src/repo-source.ts';
import { buildLiveFrame } from '../src/live.ts';
import { readLockSources } from '../src/locks.ts';
import { listSpecs } from '../src/resolve.ts';
import { buildSpecPage } from '../src/spec.ts';
import { itemStates, withItemStates } from '../src/item-state.ts';
import { guidanceOf, withGuidance } from '../src/guidance.ts';
import { stateInputAt } from './helpers/state-model.ts';
import {
  assignWorktrees,
  copyDirFor,
  liveWorktrees,
  mainBranchOf,
  relativeTo,
  specSourceOf,
  WORKTREE_COPY_KINDS,
  worktreeOnlySpecs,
  type WorktreeFacts,
  type WorktreeView,
} from '../src/worktrees.ts';
import { DASHBOARD_FAMILY, goldenMismatch, goldenPath, goldenText } from './helpers/golden.ts';
import { FIXTURES, readTreeAt } from './helpers/read-tree.ts';

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
  test('the fixture holds the five listings: spec worktrees, a path-branch conflict, builders, prunable worktrees, a linked specs/', () => {
    expect(LISTINGS).toEqual(['builders', 'conflict', 'prunable', 'spec-worktrees', 'symlink-specs']);
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
      expect(w.path?.startsWith('/')).not.toBe(true);
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
      expect(w.path?.startsWith('.claude/worktrees/')).toBe(true);
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

// Spec 041, ISC-216: a worktree's location never leaves the repository. `relativeTo(root, path)` resolves `.` and inner
// `..` on both sides as text before it compares them, and answers null for a path outside the root, so a path that
// climbs out through `..` is refused rather than named. `assignWorktrees` gives such a worktree `path: null` and assigns
// it by its branch alone. `-t relativeTo` runs ISC-216's core part.
describe('relativeTo: a worktree path is normalised and refused outside the root (ISC-216)', () => {
  test('a path whose inner .. climbs out of the root is refused', () => {
    expect(relativeTo('/srv/repo', '/srv/repo/a/../../b')).toBeNull();
    expect(relativeTo('/srv/repo', '/srv/repo/../repo-013')).toBeNull();
    expect(relativeTo('/srv/repo', '/srv/repo-013')).toBeNull();
    expect(relativeTo('/srv/repo', '/srv')).toBeNull();
    expect(relativeTo('/srv/repo', '/')).toBeNull();
  });

  test('. and inner .. inside the root are normalised away', () => {
    expect(relativeTo('/srv/repo', '/srv/repo/a/./b/../c')).toBe('a/c');
    expect(relativeTo('/srv/repo', '/srv/repo/.worktrees/012-harbor')).toBe('.worktrees/012-harbor');
    expect(relativeTo('/srv/repo', '/srv/repo/a/../.worktrees/./012-harbor/')).toBe('.worktrees/012-harbor');
  });

  test('a root with inner .. is normalised too', () => {
    expect(relativeTo('/srv/other/../repo', '/srv/repo/.worktrees/012-harbor')).toBe('.worktrees/012-harbor');
    expect(relativeTo('/srv/./repo/', '/srv/repo/a/b')).toBe('a/b');
    expect(relativeTo('/srv/other/../repo', '/srv/other/x')).toBeNull();
  });

  test('a worktree outside the repository gets path null and is still assigned by its branch', () => {
    const text = listingOf([
      { path: '/srv/repo-013', branch: 'fix/013-relay' },
      { path: '/srv/repo/../repo-018', branch: 'spike/018-probe' },
      { path: '/srv/repo/a/../../repo-017', branch: 'chore/017-tidy' },
      { path: '/srv/repo/.worktrees/x/../012-harbor', branch: 'feature/012-harbor' },
    ]);
    const { worktrees, diagnostics } = assignWorktrees(text, SPECS);
    expect(worktrees.map((w) => [w.path, w.spec, w.kind])).toEqual([
      [null, '013', 'spec'],
      [null, '018', 'spec'],
      [null, null, 'spec'],
      ['.worktrees/012-harbor', '012', 'spec'],
    ]);
    expect(diagnostics).toEqual([]);
    expect(JSON.stringify(worktrees)).not.toContain('repo-01');
  });

  test('spec-worktrees.porcelain names none of its three sibling worktrees', () => {
    const { worktrees } = assignWorktrees(read('spec-worktrees.porcelain'), SPECS);
    const outside = worktrees.filter((w) => w.path === null);
    expect(outside.map((w) => [w.branch, w.spec])).toEqual([
      ['fix/013-relay', '013'],
      ['chore/017-tidy', null],
      ['spike/018-probe', '018'],
    ]);
    expect(JSON.stringify(worktrees)).not.toContain('..');
  });
});

// Spec 041, ISC-212: a worktree git lists as `prunable` (its folder or its gitdir is gone) has ended. `assignWorktrees`
// marks such a spec-kind worktree `prunable: true` and leaves the key out everywhere else, so every older golden stays
// byte-identical; `liveWorktrees(assignment, facts)` then leaves it out of `live` with the reason `prunable`. When
// several reasons apply, `merged` wins over `prunable`, and `prunable` over `removed`. `-t prunable` runs ISC-212.
describe('prunable: a worktree git lists as prunable has ended (ISC-212)', () => {
  /** The facts of `prunable.porcelain`: only harbor's folder is left, nothing merged, nothing dirty. */
  const GONE = { merged: [], present: ['.worktrees/012-harbor'], dirty: [] } as const;

  test('a prunable spec worktree carries prunable: true, a listed one carries no key at all', () => {
    const { worktrees } = assignWorktrees(read('prunable.porcelain'), SPECS);
    expect(worktrees.find((w) => w.spec === '014')).toMatchObject({ kind: 'spec', prunable: true });
    expect(worktrees.find((w) => w.spec === '015')).toMatchObject({ kind: 'spec', prunable: true });
    expect(worktrees.find((w) => w.path === '.worktrees/scratch')).toMatchObject({ spec: null, prunable: true });
    expect(Object.hasOwn(worktrees.find((w) => w.spec === '012') ?? {}, 'prunable')).toBe(false);
  });

  test('a builder never carries prunable, even when git lists it as prunable', () => {
    const { worktrees } = assignWorktrees(read('builders.porcelain'), SPECS);
    const builder = worktrees.find((w) => w.path === '.claude/worktrees/agent-c3e6a9b2d5f8c1e4a');
    expect(builder).toMatchObject({ kind: 'builder', spec: null });
    expect(Object.hasOwn(builder ?? {}, 'prunable')).toBe(false);
  });

  test('liveWorktrees does not count a prunable spec worktree as live: it has ended with the reason prunable', () => {
    const { live, ended } = liveWorktrees(assignWorktrees(read('prunable.porcelain'), SPECS), GONE);
    expect(live.map((w) => w.path)).toEqual(['.worktrees/012-harbor', '.worktrees/scratch']);
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([
      ['014', 'prunable'],
      ['015', 'prunable'],
    ]);
  });

  test('prunable ends a worktree even while its folder still reads as present', () => {
    const present = ['.worktrees/012-harbor', '.worktrees/014-export', '.worktrees/015-ledger'];
    const { live, ended } = liveWorktrees(assignWorktrees(read('prunable.porcelain'), SPECS), { ...GONE, present });
    expect(live.some((w) => w.spec === '014' || w.spec === '015')).toBe(false);
    expect(ended.map(({ reason }) => reason)).toEqual(['prunable', 'prunable']);
  });

  test('merged wins over prunable, and prunable over removed', () => {
    const facts = { ...GONE, merged: ['feature/015-ledger'] };
    const { ended } = liveWorktrees(assignWorktrees(read('prunable.porcelain'), SPECS), facts);
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([
      ['014', 'prunable'],
      ['015', 'merged'],
    ]);
  });

  test('the same listing without its prunable lines keeps both worktrees live while their folders are present', () => {
    const plain = read('prunable.porcelain')
      .split('\n')
      .filter((line) => !line.startsWith('prunable'))
      .join('\n');
    const present = ['.worktrees/012-harbor', '.worktrees/014-export', '.worktrees/015-ledger'];
    const { live, ended } = liveWorktrees(assignWorktrees(plain, SPECS), { ...GONE, present });
    expect(ended).toEqual([]);
    expect(live.map((w) => w.spec)).toEqual(['012', '014', '015', null]);
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

  test('the copy holds the eight the claim names, five Markdown files, two logs and .gates/, and the two zones of spec 039', () => {
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
      'artifacts/',
      '.evidence/',
    ]);
    for (const kind of WORKTREE_COPY_KINDS) expect(FILE_KINDS[kind].scope).toBe('spec');
  });
});

/** What `git ls-files -z -- specs/NNN-slug` printed for a listing's specs (its `.ls-files` sidecar), split on NUL. */
const lsFilesOf = (listing: string): string[] =>
  read(`${listing}.ls-files`)
    .split('\0')
    .filter((path) => path !== '');

const HARBOR = join(FIXTURES, 'harbor');

/** harbor as the main checkout holds it: `readTreeAt`, the reader behind its committed goldens. */
const HARBOR_MAIN = readTreeAt(HARBOR);

/** Every spec folder of harbor, active ones first, then the archived ones. */
const HARBOR_FOLDERS = [...HARBOR_MAIN.specs, ...HARBOR_MAIN.archived].map((files) => files.folder);

/** harbor laid out like this repository: one spec worktree `.worktrees/NNN-slug` per spec folder and one builder. */
const HARBOR_LISTING = [
  { path: '/srv/repo', branch: 'main' },
  ...HARBOR_FOLDERS.map((folder) => ({ path: `/srv/repo/.worktrees/${folder}`, branch: `feature/${folder}` })),
  { path: '/srv/repo/.claude/worktrees/agent-4c7e0a3d', branch: 'worktree-agent-4c7e0a3d' },
]
  .map(({ path, branch }, i) => `worktree ${path}\nHEAD ${i.toString(16).padStart(40, '0')}\nbranch refs/heads/${branch}\n\n`)
  .join('');

/** The copy a spec keeps in its worktree before the merge: the main checkout's files with every open task ticked. */
const tickedCopy = (files: SpecFiles): SpecFiles => ({
  folder: files.folder,
  texts:
    files.texts.tasks === undefined ? files.texts : { ...files.texts, tasks: files.texts.tasks.replaceAll('- [ ]', '- [x]') },
});

/** harbor's input with each spec read from where `specSourceOf` points on git's answer `lsFiles(folder)`. */
function harborReadFrom(lsFiles: (folder: string) => readonly string[]): DashboardInput {
  const { worktrees } = assignWorktrees(HARBOR_LISTING, HARBOR_FOLDERS);
  const pick = (files: SpecFiles): SpecFiles => {
    const worktree = worktrees.find((w) => w.path === `.worktrees/${files.folder}`) ?? null;
    const source = specSourceOf({ folder: files.folder, worktree, lsFiles: lsFiles(files.folder) });
    return source === 'worktree' ? tickedCopy(files) : files;
  };
  return { ...HARBOR_MAIN, specs: HARBOR_MAIN.specs.map(pick), archived: HARBOR_MAIN.archived.map(pick) };
}

/** The clock and lock reading of the `live` family in golden.test.ts. */
const LIVE_NOW = new Date('2026-03-08T15:00:00Z');
const HARBOR_LOCKS = await readLockSources({ repoRoot: HARBOR });

/** The families the anti-claim names, as golden text, built from `input` the way the golden tests build harbor's. */
function harborFamilies(input: DashboardInput): Record<string, string> {
  const all = [...input.specs, ...input.archived];
  const byFolder = new Map(all.map((files) => [files.folder, files]));
  const keyed = <T,>(build: (files: SpecFiles) => T): Record<string, T> =>
    Object.fromEntries(
      listSpecs(HARBOR).map((ref) => [
        relative(HARBOR, ref.dir).split(sep).join('/'),
        build(byFolder.get(basename(ref.dir)) as SpecFiles),
      ]),
    );
  const master = input.master === null ? {} : { master: input.master };
  const constitution = input.constitution === null ? {} : { constitution: input.constitution };
  // The item states (spec 040) as the goldens carry them: this input with harbor's activity reading at the live clock.
  const base = stateInputAt(HARBOR);
  const workspace = { ...input, ...(base.workspace.locks === undefined ? {} : { locks: base.workspace.locks }) };
  const items = itemStates({ ...base, workspace, dashboard: buildDashboard(workspace) });
  const stateOf = (files: SpecFiles): { state?: (typeof items)[number] } =>
    ((state) => (state === undefined ? {} : { state }))(items.find((i) => i.kind === 'spec' && i.id === files.folder.slice(0, 3)));
  // The workspace guidance (spec 020) from the same items, as the dashboard and spec goldens carry it.
  const dashboard = buildDashboard(input);
  const guidance = guidanceOf({ workspace, dashboard, items });
  return {
    [DASHBOARD_FAMILY]: goldenText(withGuidance(withItemStates(dashboard, items), guidance)),
    spec: goldenText(
      keyed((files) =>
        buildSpecPage({
          files: { folder: files.folder, texts: { ...files.texts, ...master, ...constitution } },
          others: all.filter((other) => other !== files),
          tldr: input.tldr,
          ...(input.workflow ? { workflow: input.workflow } : {}),
          ...stateOf(files),
          guidance,
        }),
      ),
    ),
    live: goldenText(
      keyed((files) =>
        buildLiveFrame({
          files: { folder: files.folder, texts: { ...files.texts, ...constitution } },
          locks: HARBOR_LOCKS,
          now: LIVE_NOW,
        }),
      ),
    ),
  };
}

/** The golden families of harbor the anti-claim holds byte-identical. */
const HARBOR_GOLDEN_FAMILIES: string[] = [DASHBOARD_FAMILY, 'spec', 'live'];

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

  test('this repository: spec worktrees with specs linked to the untracked specs/ of main keep main', () => {
    const { worktrees, builders } = assignWorktrees(read('symlink-specs.porcelain'), SPECS);
    expect(builders).toBe(1);
    const own = worktrees.filter((w) => w.kind === 'spec' && w.spec !== null);
    expect(own.map((w) => w.path)).toEqual(['.worktrees/012-harbor', '.worktrees/016-audit']);
    expect(read('symlink-specs.ls-files')).toBe('');
    for (const worktree of own) {
      const folder = SPECS.find((name) => name.slice(0, 3) === worktree.spec) ?? '';
      expect(specSourceOf({ folder, worktree, lsFiles: lsFilesOf('symlink-specs') })).toBe('main');
      // The same worktree reads its copy once git tracks the folder, so `main` above comes from git's answer alone.
      expect(specSourceOf({ folder, worktree, lsFiles: [`specs/${folder}/spec.md`] })).toBe('worktree');
    }
  });

  test('harbor without a tracked specs/ and a spec worktree per spec: every spec keeps main', () => {
    const { worktrees } = assignWorktrees(HARBOR_LISTING, HARBOR_FOLDERS);
    for (const folder of HARBOR_FOLDERS) {
      const worktree = worktrees.find((w) => w.path === `.worktrees/${folder}`) ?? null;
      expect(worktree).toMatchObject({ kind: 'spec', spec: folder.slice(0, 3) });
      expect(specSourceOf({ folder, worktree, lsFiles: lsFilesOf('symlink-specs') })).toBe('main');
    }
  });

  test.each(HARBOR_GOLDEN_FAMILIES)('harbor %s golden: byte-identical with the worktrees present', (family) => {
    const built = harborFamilies(harborReadFrom(() => lsFilesOf('symlink-specs')))[family] ?? '';
    expect(goldenMismatch(readFileSync(goldenPath('harbor', family), 'utf8'), built)).toBeNull();
  });

  // Spec 039, ISC-210: the two further sources of 039 keep main as well. A linked `specs/` lists, inside a worktree,
  // nothing or the link itself, never a path under it, so no worktree carries a spec of its own; and a repository file
  // the main checkout holds untracked stays the main checkout's, whatever a worktree holds.
  test('untracked: this repository: no spec worktree carries a spec of its own, even with no folder on main', () => {
    const { worktrees } = assignWorktrees(read('symlink-specs.porcelain'), []);
    const paths = worktrees.flatMap((w) => (w.path === null ? [] : [w.path]));
    for (const listed of [lsFilesOf('symlink-specs'), ['specs'], ['specs', 'ISA.md']]) {
      const tracked = Object.fromEntries(paths.map((path) => [path, listed]));
      expect(worktreeOnlySpecs(worktrees, [], tracked)).toEqual([]);
    }
  });

  test('untracked: every repository file keeps main when the main checkout holds it untracked', () => {
    const newer = '2026-10-09T09:00:00Z';
    for (const path of [...REPO_SOURCE_PATHS.filter((p) => !p.endsWith('/')), 'specs/ideas/registry-webhooks.md']) {
      const candidates: RepoFileCandidate[] = [
        { origin: MAIN_SOURCE, present: true, tracked: false, differs: false, digest: 'main', at: null },
        // A linked specs/ in the worktree: the same file through the link, listed by git as the link at most.
        { origin: { kind: 'worktree', worktree: '.worktrees/012-harbor' }, present: true, tracked: false, differs: false, digest: 'main', at: newer },
        // Even a tracked, differing, newer version cannot move an untracked main file.
        { origin: { kind: 'worktree', worktree: '.worktrees/016-audit' }, present: true, tracked: true, differs: true, digest: 'other', at: newer },
      ];
      expect(repoFileSourceOf(path, candidates)).toEqual({ source: MAIN_SOURCE, diagnostics: [] });
    }
  });

  test('the comparison bites: a tracked specs/ would read the ticked worktree copies and move every family', () => {
    const tracked = harborFamilies(harborReadFrom((folder) => [`specs/${folder}/spec.md`]));
    for (const family of HARBOR_GOLDEN_FAMILIES) {
      const built = tracked[family] ?? '';
      expect(goldenMismatch(readFileSync(goldenPath('harbor', family), 'utf8'), built)).not.toBeNull();
    }
  });
});

// Spec 041, ISC-212.1: the folder a spec is read from, decided once for every caller. `copyDirFor(root, ref, view)`
// takes the workspace root, the spec's number and folder name, and the `WorktreeView` the server builds from one
// listing (`assignWorktrees`, `liveWorktrees`, `mainBranchOf` and the `ls-files` answers). It returns
// `<root>/<worktree>/specs/NNN-slug` only for the spec's first live spec worktree in git's order, inside the
// repository, when `specSourceOf` names `worktree` for it; null otherwise. The views below are built from the fixture's
// listings the way the server builds them, so the tests exercise the model the server hands over. `-t copyDirFor`.

/** The facts of a listing where every worktree's folder is present, nothing is merged and nothing is dirty. */
function allPresent(porcelain: string, specs: readonly string[]): WorktreeFacts {
  const present = assignWorktrees(porcelain, specs).worktrees.flatMap((w) => (w.path === null ? [] : [w.path]));
  return { merged: [], present, dirty: [] };
}

/** The view the server builds from one listing, its git facts and the `ls-files` answer per spec folder. */
function viewOf(
  porcelain: string,
  tracked: Readonly<Record<string, readonly string[]>>,
  facts: WorktreeFacts = allPresent(porcelain, SPECS),
): WorktreeView {
  const assignment = assignWorktrees(porcelain, SPECS);
  const { live, ended } = liveWorktrees(assignment, facts);
  return { assignment, live, ended, mainBranch: mainBranchOf(porcelain), tracked };
}

/** A listing at `/srv/repo` with the given worktrees after the main checkout, as git prints it. */
const listingOf = (records: ReadonlyArray<{ path: string; branch: string }>): string =>
  [{ path: '/srv/repo', branch: 'main' }, ...records]
    .map(({ path, branch }, i) => `worktree ${path}\nHEAD ${i.toString(16).padStart(40, '0')}\nbranch refs/heads/${branch}\n\n`)
    .join('');

const ROOT = '/srv/repo';
const HARBOR_REF = { id: '012', slug: '012-harbor' } as const;
const HARBOR_COPY = '/srv/repo/.worktrees/012-harbor/specs/012-harbor';

describe('copyDirFor: the worktree copy a spec is read from, over the one worktree view (ISC-212.1)', () => {
  test('a live spec worktree of the spec and a tracked path under specs/NNN-slug/ read from its copy', () => {
    const view = viewOf(read('spec-worktrees.porcelain'), { '012-harbor': HARBOR_TRACKED });
    expect(copyDirFor(ROOT, HARBOR_REF, view)).toBe(HARBOR_COPY);
  });

  test('a worktree assigned by its branch alone reads from its own path', () => {
    const view = viewOf(read('spec-worktrees.porcelain'), { '016-audit': ['specs/016-audit/spec.md'] });
    expect(copyDirFor(ROOT, { id: '016', slug: '016-audit' }, view)).toBe('/srv/repo/.worktrees/infra-ci/specs/016-audit');
  });

  test('a trailing slash on the root is not doubled', () => {
    const view = viewOf(read('spec-worktrees.porcelain'), { '012-harbor': HARBOR_TRACKED });
    expect(copyDirFor('/srv/repo/', HARBOR_REF, view)).toBe(HARBOR_COPY);
    expect(copyDirFor('/srv/repo//', HARBOR_REF, view)).toBe(HARBOR_COPY);
  });

  test('untracked: no entry, an empty answer or only the link itself keeps main', () => {
    const text = read('spec-worktrees.porcelain');
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(text, {}))).toBeNull();
    for (const lsFiles of [[], ['specs'], ['specs/012-harbor'], ['specs/012-harbor-old/spec.md'], lsFilesOf('symlink-specs')]) {
      expect(copyDirFor(ROOT, HARBOR_REF, viewOf(text, { '012-harbor': lsFiles }))).toBeNull();
    }
  });

  test("this repository's layout: specs linked into every spec worktree keeps every spec on main", () => {
    const text = read('symlink-specs.porcelain');
    const tracked = { '012-harbor': lsFilesOf('symlink-specs'), '016-audit': lsFilesOf('symlink-specs') };
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(text, tracked))).toBeNull();
    expect(copyDirFor(ROOT, { id: '016', slug: '016-audit' }, viewOf(text, tracked))).toBeNull();
  });

  test('an ended spec worktree is no source: merged, removed or prunable', () => {
    const text = read('spec-worktrees.porcelain');
    const tracked = { '012-harbor': HARBOR_TRACKED };
    const present = allPresent(text, SPECS);
    const merged = viewOf(text, tracked, { ...present, merged: ['feature/012-harbor'] });
    const removed = viewOf(text, tracked, { ...present, present: present.present.filter((p) => p !== '.worktrees/012-harbor') });
    for (const view of [merged, removed]) {
      expect(view.ended.map(({ worktree }) => worktree.spec)).toContain('012');
      expect(view.live.some((w) => w.spec === '012')).toBe(false);
      expect(copyDirFor(ROOT, HARBOR_REF, view)).toBeNull();
    }

    const prunable = read('prunable.porcelain');
    const export_ = { id: '014', slug: '014-export' } as const;
    const pruned = viewOf(prunable, { '014-export': ['specs/014-export/spec.md'] });
    expect(pruned.ended.map(({ worktree, reason }) => [worktree.spec, reason])).toContainEqual(['014', 'prunable']);
    expect(copyDirFor(ROOT, export_, pruned)).toBeNull();
    // The same listing still reads harbor's copy: only the ended worktree is left out.
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(prunable, { '012-harbor': HARBOR_TRACKED }))).toBe(HARBOR_COPY);
  });

  test('a builder is no source, even on the spec branch', () => {
    const text = listingOf([{ path: '/srv/repo/.claude/worktrees/agent-4c7e0a3d', branch: 'feature/012-harbor' }]);
    const view = viewOf(text, { '012-harbor': HARBOR_TRACKED });
    expect(view.live.map((w) => w.kind)).toEqual(['builder']);
    expect(copyDirFor(ROOT, HARBOR_REF, view)).toBeNull();
  });

  test('a worktree of another spec is no source', () => {
    const view = viewOf(read('spec-worktrees.porcelain'), { '015-ledger': ['specs/015-ledger/spec.md'] });
    expect(view.live.some((w) => w.spec === '015')).toBe(false);
    expect(copyDirFor(ROOT, { id: '015', slug: '015-ledger' }, view)).toBeNull();
    // A tracked entry filed under the wrong folder does not lend another spec's worktree either.
    const crossed = viewOf(read('spec-worktrees.porcelain'), { '015-ledger': HARBOR_TRACKED });
    expect(copyDirFor(ROOT, { id: '015', slug: '015-ledger' }, crossed)).toBeNull();
  });

  test('a worktree outside the repository is no source: /srv/repo-013 has no path and keeps main', () => {
    const view = viewOf(read('spec-worktrees.porcelain'), { '013-relay': ['specs/013-relay/spec.md'] });
    expect(view.live.find((w) => w.spec === '013')).toMatchObject({ path: null, kind: 'spec' });
    expect(copyDirFor(ROOT, { id: '013', slug: '013-relay' }, view)).toBeNull();
  });

  test('two live worktrees of the same spec: the first in git order, as the dashboard chip shows', () => {
    const tracked = { '012-harbor': HARBOR_TRACKED };
    const first = listingOf([
      { path: '/srv/repo/.worktrees/012-harbor', branch: 'feature/012-harbor' },
      { path: '/srv/repo/.worktrees/harbor-fix', branch: 'fix/012-harbor' },
    ]);
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(first, tracked))).toBe(HARBOR_COPY);
    const second = listingOf([
      { path: '/srv/repo/.worktrees/harbor-fix', branch: 'fix/012-harbor' },
      { path: '/srv/repo/.worktrees/012-harbor', branch: 'feature/012-harbor' },
    ]);
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(second, tracked))).toBe('/srv/repo/.worktrees/harbor-fix/specs/012-harbor');
  });

  test('the first live one wins once the first in git order has ended', () => {
    const text = listingOf([
      { path: '/srv/repo/.worktrees/harbor-fix', branch: 'fix/012-harbor' },
      { path: '/srv/repo/.worktrees/012-harbor', branch: 'feature/012-harbor' },
    ]);
    const facts = { ...allPresent(text, SPECS), merged: ['fix/012-harbor'] };
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(text, { '012-harbor': HARBOR_TRACKED }, facts))).toBe(HARBOR_COPY);
  });
});

// Spec 041, ISC-212.2: a merge alone does not end a spec worktree that still holds an uncommitted change. Its path in
// `facts.dirty` keeps it live, so the chip stays and its copy is still read; `prunable` and `removed` end it all the
// same, and a clean merged worktree ends as before. `-t dirty` runs these.
describe('dirty: a merged spec worktree with an uncommitted change is live (ISC-212.2)', () => {
  const text = listingOf([
    { path: '/srv/repo/.worktrees/012-harbor', branch: 'feature/012-harbor' },
    { path: '/srv/repo/.worktrees/014-export', branch: 'feature/014-export' },
  ]);
  const present = allPresent(text, SPECS);

  test('merged and dirty: live, not ended', () => {
    const { live, ended } = liveWorktrees(assignWorktrees(text, SPECS), {
      ...present,
      merged: ['feature/012-harbor'],
      dirty: ['.worktrees/012-harbor'],
    });
    expect(live.map((w) => w.spec)).toEqual(['012', '014']);
    expect(ended).toEqual([]);
  });

  test('merged and clean: still ended with the reason merged', () => {
    const { live, ended } = liveWorktrees(assignWorktrees(text, SPECS), { ...present, merged: ['feature/012-harbor'] });
    expect(live.map((w) => w.spec)).toEqual(['014']);
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([['012', 'merged']]);
  });

  test("another worktree's change does not keep a merged one live", () => {
    const { ended } = liveWorktrees(assignWorktrees(text, SPECS), {
      ...present,
      merged: ['feature/012-harbor'],
      dirty: ['.worktrees/014-export'],
    });
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([['012', 'merged']]);
  });

  test('merged, dirty and its folder gone: ended with the reason removed', () => {
    const { live, ended } = liveWorktrees(assignWorktrees(text, SPECS), {
      merged: ['feature/012-harbor'],
      present: present.present.filter((p) => p !== '.worktrees/012-harbor'),
      dirty: ['.worktrees/012-harbor'],
    });
    expect(live.some((w) => w.spec === '012')).toBe(false);
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([['012', 'removed']]);
  });

  test('merged, dirty and prunable: ended with the reason prunable', () => {
    const facts = {
      merged: ['feature/015-ledger'],
      present: ['.worktrees/012-harbor', '.worktrees/015-ledger'],
      dirty: ['.worktrees/015-ledger'],
    };
    const { live, ended } = liveWorktrees(assignWorktrees(read('prunable.porcelain'), SPECS), facts);
    expect(live.some((w) => w.spec === '015')).toBe(false);
    expect(ended.map(({ worktree, reason }) => [worktree.spec, reason])).toContainEqual(['015', 'prunable']);
  });

  test('the merged worktree with a change stays the read source of its spec', () => {
    const facts = { ...present, merged: ['feature/012-harbor'], dirty: ['.worktrees/012-harbor'] };
    expect(copyDirFor(ROOT, HARBOR_REF, viewOf(text, { '012-harbor': HARBOR_TRACKED }, facts))).toBe(HARBOR_COPY);
  });
});

// Spec 039, ISC-208: with a copy, the whole spec folder is read from it. Besides the eight kinds of ISC-181 the copy
// holds `artifacts/` and `.evidence/` (`WORKTREE_COPY_KINDS`), and the library lists and resolves every file of the
// folder, those two zones and `.design/` included, from the copy; the main checkout's folder is not read for that spec.
describe('folder copy (spec 039, ISC-208)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  const FOLDER = '012-harbor';
  const SPEC_MD = '---\ntask: "Harbor"\nslug: 012-harbor\nphase: build\nprogress: 0/1\n---\n\n# 012 — harbor\n\n## Claims\n\n- [ ] ISC-1: x\n';

  /** A workspace whose spec 012 has an `artifacts/` file in main, and a copy whose `artifacts/` and `.evidence/` differ. */
  const planted = (): { root: string; copy: string } => {
    const root = mkdtempSync(join(tmpdir(), 'spectant-folder-copy-'));
    dirs.push(root);
    const main = join(root, 'specs', FOLDER);
    mkdirSync(join(main, 'artifacts'), { recursive: true });
    writeFileSync(join(main, 'spec.md'), SPEC_MD);
    writeFileSync(join(main, 'artifacts', 'report.md'), '# Report on main\n');
    writeFileSync(join(main, 'artifacts', 'main-only.md'), '# Only on main\n');
    const copy = join(root, '.worktrees', FOLDER, 'specs', FOLDER);
    mkdirSync(join(copy, 'artifacts'), { recursive: true });
    mkdirSync(join(copy, '.evidence'), { recursive: true });
    writeFileSync(join(copy, 'spec.md'), SPEC_MD);
    writeFileSync(join(copy, 'artifacts', 'report.md'), '# Report in the copy\n');
    writeFileSync(join(copy, '.evidence', 'probe.md'), '# Probe in the copy\n');
    return { root, copy };
  };

  test('folder copy: the copy kinds hold artifacts/ and .evidence/ beside the eight of ISC-181', () => {
    expect(WORKTREE_COPY_KINDS).toContain('artifacts');
    expect(WORKTREE_COPY_KINDS).toContain('evidence');
    for (const kind of WORKTREE_COPY_KINDS) expect(FILE_KINDS[kind].scope).toBe('spec');
  });

  test('folder copy: the catalog lists artifacts/ and .evidence/ of a spec with a copy from the copy', async () => {
    const { root, copy } = planted();
    const catalog = await readCatalog(root, undefined, { copies: { [FOLDER]: copy } });
    const zoned = catalog.docs.filter((d) => d.spec === FOLDER && (d.type === 'artifact' || d.type === 'evidence'));
    expect(zoned.map((d) => [d.path, d.title])).toEqual([
      [`${FOLDER}/artifacts/report.md`, 'Report in the copy'],
      [`${FOLDER}/.evidence/probe.md`, 'Probe in the copy'],
    ]);
    // Without the copy, main's two files.
    const main = await readCatalog(root);
    expect(main.docs.filter((d) => d.spec === FOLDER && d.type === 'artifact').map((d) => d.title)).toEqual(['Only on main', 'Report on main']);
  });

  test('folder copy: catalogSourceOf resolves every file of the folder of a spec with a copy into the copy', () => {
    const { root, copy } = planted();
    const copies = { [FOLDER]: copy };
    expect(catalogSourceOf(root, { path: `${FOLDER}/artifacts/report.md`, spec: FOLDER }, copies)).toEqual({ dir: copy, rel: 'artifacts/report.md' });
    expect(catalogSourceOf(root, { path: `${FOLDER}/.evidence/probe.md`, spec: FOLDER }, copies)).toEqual({ dir: copy, rel: '.evidence/probe.md' });
    expect(catalogSourceOf(root, { path: `${FOLDER}/.design/prototype/index.html`, spec: FOLDER }, copies)).toEqual({
      dir: copy,
      rel: '.design/prototype/index.html',
    });
    // No copy: the catalog path below specs/.
    expect(catalogSourceOf(root, { path: `${FOLDER}/artifacts/report.md`, spec: FOLDER })).toEqual({
      dir: join(root, 'specs'),
      rel: `${FOLDER}/artifacts/report.md`,
    });
  });
});

// Spec 039, ISC-208.1: a spec folder only a spec worktree carries. `worktreeOnlySpecs(worktrees, mainFolders, tracked)`
// takes the listing as `assignWorktrees` assigned it against the main checkout's spec folders, those folder names, and
// per worktree path what `git ls-files -z -- specs/` printed inside that worktree. A worktree of no spec, inside the
// repository and not a builder, whose path `.worktrees/NNN-slug` (else its branch) names a folder `NNN-slug`, carries
// that folder when its own branch tracks a path below `specs/NNN-slug/`. The number must be free in the main checkout,
// which wins otherwise; one spec per number, the first worktree in git's order.
describe('worktree-only spec (spec 039, ISC-208.1)', () => {
  const text = read('spec-worktrees.porcelain');
  const listing = assignWorktrees(text, SPECS).worktrees;
  const RETIRED = ['specs/099-retired/context.md', 'specs/099-retired/spec.md'];

  test('worktree-only spec: a worktree whose branch tracks specs/NNN-slug/, which main lacks, carries that spec', () => {
    const only = worktreeOnlySpecs(listing, SPECS, { '.worktrees/099-retired': [...RETIRED, 'specs/012-harbor/spec.md'] });
    expect(only).toEqual([{ id: '099', slug: '099-retired', worktree: '.worktrees/099-retired' }]);
  });

  test('worktree-only spec: without a tracked path under the folder in that worktree, no spec', () => {
    expect(worktreeOnlySpecs(listing, SPECS, {})).toEqual([]);
    expect(worktreeOnlySpecs(listing, SPECS, { '.worktrees/099-retired': ['specs/012-harbor/spec.md'] })).toEqual([]);
    // A linked specs/ lists itself, never a path under it (ISC-181.1).
    expect(worktreeOnlySpecs(listing, SPECS, { '.worktrees/099-retired': ['specs'] })).toEqual([]);
    // Another worktree's paths name nothing for this one.
    expect(worktreeOnlySpecs(listing, SPECS, { '.worktrees/scratch': RETIRED })).toEqual([]);
  });

  test('worktree-only spec: the main checkout wins a number it has, and the assigned worktrees never count', () => {
    expect(worktreeOnlySpecs(listing, [...SPECS, '099-old'], { '.worktrees/099-retired': RETIRED })).toEqual([]);
    expect(worktreeOnlySpecs(listing, SPECS, { '.worktrees/012-harbor': ['specs/012-harbor/spec.md'] })).toEqual([]);
  });

  test('worktree-only spec: assigned against the main folders plus the found ones, the worktree belongs to the new spec', () => {
    const only = worktreeOnlySpecs(listing, SPECS, { '.worktrees/099-retired': RETIRED });
    const again = assignWorktrees(text, [...SPECS, ...only.map((s) => s.slug)]);
    expect(again.worktrees.find((w) => w.path === '.worktrees/099-retired')?.spec).toBe('099');
  });
});

// Spec 057: three regression tests for findings of the spec 027 review, each selected by its probe's filter.
//   - ISC-360 (`-t prunable`, finding 3): a worktree git lists as `prunable` has ended and no spec is assigned to it,
//     even while every folder still reads as present.
//   - ISC-368 (`-t "inner dotdot"`, hardening S1): `relativeTo` resolves an inner `..` before it compares, so a path
//     that reads as inside the repository but climbs out of it is refused, and one that stays inside is normalised.
//   - ISC-369 (`-t "external path"`, hardening S2): a worktree outside the repository reaches neither the workspace
//     answer (`buildDashboard`) nor the spec answer (`buildSpecPage`) with its location, absolute or relative.
describe('spec 057: review 027 findings on worktree paths and ends', () => {
  test('prunable: a worktree git lists as prunable has ended, and 0 specs are assigned to it (ISC-360)', () => {
    const text = read('prunable.porcelain');
    const facts = allPresent(text, SPECS);
    const view = viewOf(text, { '014-export': ['specs/014-export/spec.md'], '015-ledger': ['specs/015-ledger/spec.md'] }, facts);
    expect(view.ended.map(({ worktree, reason }) => [worktree.spec, reason])).toEqual([
      ['014', 'prunable'],
      ['015', 'prunable'],
    ]);
    // Only the worktree of no spec stays listed while prunable: it was never assigned, so it never ends here.
    expect(view.live.filter((w) => w.prunable === true).map((w) => [w.path, w.spec])).toEqual([['.worktrees/scratch', null]]);
    const assigned = view.live.filter((w) => w.kind === 'spec' && w.spec !== null).map((w) => w.spec);
    expect(assigned).toEqual(['012']);
    expect(copyDirFor(ROOT, { id: '014', slug: '014-export' }, view)).toBeNull();
    expect(copyDirFor(ROOT, { id: '015', slug: '015-ledger' }, view)).toBeNull();
  });

  test('inner dotdot: a path that climbs out of the repository through .worktrees/x is refused, a/../b is b (ISC-368)', () => {
    // Three `..` from `.worktrees/x` leave the repository; read segment by segment it would start with `.worktrees/`.
    expect(relativeTo('/srv/repo', '/srv/repo/.worktrees/x/../../../outside')).toBeNull();
    expect(relativeTo('/srv/repo', '/srv/repo/.worktrees/x/../../../repo-013/.worktrees/013-relay')).toBeNull();
    // Two `..` from `.worktrees/x` land on the root itself, so `outside` there lies inside the repository.
    expect(relativeTo('/srv/repo', '/srv/repo/.worktrees/x/../../outside')).toBe('outside');
    expect(relativeTo('/srv/repo', '/srv/repo/a/../b')).toBe('b');
    const listing = listingOf([
      { path: '/srv/repo/.worktrees/x/../../../repo-012', branch: 'feature/012-harbor' },
      { path: '/srv/repo/a/../b', branch: 'fix/013-relay' },
    ]);
    const { worktrees } = assignWorktrees(listing, SPECS);
    expect(worktrees.map((w) => [w.path, w.spec])).toEqual([
      [null, '012'],
      ['b', '013'],
    ]);
  });

  test('external path: a worktree outside the repository reaches no workspace or spec answer with its location (ISC-369)', () => {
    const [folder] = HARBOR_MAIN.specs.map((files) => files.folder);
    if (folder === undefined) throw new Error('harbor has no active spec');
    const outside = ['/srv/repo-ext', '/srv/repo/../repo-ext', '/srv/repo/.worktrees/x/../../../repo-ext'];
    for (const path of outside) {
      const assignment = assignWorktrees(listingOf([{ path, branch: `feature/${folder}` }]), HARBOR_FOLDERS);
      expect(assignment.worktrees.map((w) => [w.path, w.spec])).toEqual([[null, folder.slice(0, 3)]]);

      const dashboard = buildDashboard({ ...HARBOR_MAIN, worktrees: assignment });
      const row = dashboard.specs.find((r) => r.slug === folder);
      expect(row?.worktree).toMatchObject({ path: null, branch: `feature/${folder}`, kind: 'spec' });

      const files = HARBOR_MAIN.specs.find((f) => f.folder === folder) as SpecFiles;
      const others = [...HARBOR_MAIN.specs, ...HARBOR_MAIN.archived].filter((f) => f !== files);
      const page = buildSpecPage({ files, others, tldr: HARBOR_MAIN.tldr, worktrees: assignment });
      expect(page.head.worktree).toMatchObject({ path: null, kind: 'spec' });

      // 0 paths outside the repository in either answer, absolute or relative.
      for (const answer of [JSON.stringify(dashboard), JSON.stringify(page)]) {
        expect(answer).not.toContain('repo-ext');
        expect(answer).not.toContain('/srv/');
        expect(answer).not.toMatch(/"path":"\.\.(?:\/|")/u);
      }
    }
  });
});
