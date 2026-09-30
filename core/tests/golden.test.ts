// The golden test of spec 002's models (T9, ISC-68): every fixture tree under `core/fixtures/` parses into the golden
// JSON committed beside it, byte for byte, one file per tree and model family.
//
// Families and the model each golden holds:
//
//   <tree>.golden.json           dashboard   `buildDashboard` (spec 001, ISC-6). Checked in fixtures.test.ts, not here;
//                                            this file only counts it in the inventory.
//   <tree>.specs.golden.json     specs       the spec listing of resolve.ts: `listSpecs` in its order, each folder's
//                                            present file kinds from files.ts, and what `resolveSpec` answers for the
//                                            folder's id, full name and bare slug. Tree-level master and constitution.
//   <tree>.timeline.golden.json  timeline    `buildTimeline` per spec folder, keyed by `specs/…` path, no commits.
//   <tree>.frames.golden.json    frames      `buildFrames` per spec folder (T17), keyed by `specs/…` path.
//   <tree>.live.golden.json      live        `buildLiveFrame` per spec folder (T21) at 2026-03-08T15:00:00Z with the
//                                            tree's `.spectant/activity.jsonl` reading (no LifeOS state directory).
//   <tree>.planning.golden.json  planning    `buildPlanning` (spec 003, ISC-100) over the tree's master and spec
//                                            folders, clock pinned to PLANNING_NOW (helpers/planning-model.ts).
//
// The next families join FAMILIES below, not a second harness: the spec page model (T12, spec.ts), the tasks and
// claim views (T13, tasks.ts / claim-view.ts), the derived stage entries (T15, derived-stages.ts), frames and the live
// frame after them. The private corpus (T10, `SPECTANT_PRIVATE_CORPUS`) is a separate test and has no golden here.
//
// The rule: a snapshot moves only together with the parser change that explains it. `UPDATE_GOLDEN=1 bun test
// core/tests/golden.test.ts` rewrites the snapshots; every other run compares byte-equal.
//
// Pinned: fixtures are not git repositories of their own (a `git log` would read Spectant's history and move with every
// commit), so the timeline gets no commits; the commit merge is covered by timeline.test.ts with synthetic records.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { FILE_KINDS, specFilePath } from '../src/files.ts';
import type { FileKind, LockReading, SpecFiles, SpecPageModel, TimelineEntry } from '../src/files.ts';
import { listSpecs, resolveSpec } from '../src/resolve.ts';
import type { SpecRef } from '../src/resolve.ts';
import { buildClaimViews } from '../src/claim-view.ts';
import { buildFrames } from '../src/frames.ts';
import { buildLiveFrame } from '../src/live.ts';
import { readLockSources } from '../src/locks.ts';
import { buildSpecPage } from '../src/spec.ts';
import { parseTaskLines } from '../src/tasks.ts';
import { buildTimeline } from '../src/timeline.ts';
import { docsModel } from './helpers/docs-model.ts';
import { planningModel } from './helpers/planning-model.ts';
import { DASHBOARD_FAMILY, expectGolden, goldenFiles, goldenMismatch, goldenPath, goldenText, goldenTrees } from './helpers/golden.ts';
import { FIXTURES, fixtureTrees, folders, readTreeAt } from './helpers/read-tree.ts';

const UPDATE_COMMAND = 'bun test core/tests/golden.test.ts';

/** POSIX path of `path` relative to the tree root: `specs/002-web-console`, `specs/archive/001-manifest-sync`. */
const rel = (root: string, path: string): string => relative(root, path).split(sep).join('/');

/** The file kinds a spec folder holds itself; constitution and master sit above it and are listed once per tree. */
const FOLDER_KINDS = (Object.keys(FILE_KINDS) as FileKind[]).filter((kind) => !FILE_KINDS[kind].path.startsWith('..'));

/** What `resolveSpec` answers for one ref, as a tree-relative folder or `not_found: <reason>`. */
function resolved(root: string, ref: string): string {
  const hit = resolveSpec(root, ref);
  return hit.kind === 'spec' ? rel(root, hit.dir) : `not_found: ${hit.reason}`;
}

/** The `specs` family: the listing resolve.ts produces, with file presence from files.ts. No parsing. */
function specsModel(root: string): unknown {
  return {
    master: existsSync(join(root, 'ISA.md')),
    constitution: existsSync(join(root, 'specs', 'constitution.md')),
    specs: listSpecs(root).map((ref) => ({
      id: ref.id,
      slug: ref.slug,
      folder: rel(root, ref.dir),
      archived: ref.archived,
      kinds: FOLDER_KINDS.filter((kind) => existsSync(specFilePath(ref.dir, kind))),
      resolves: {
        id: resolved(root, ref.id),
        folder: resolved(root, ref.slug),
        slug: resolved(root, ref.slug.slice(ref.id.length + 1)),
      },
    })),
  };
}

/** The texts of every spec folder, active and archived, keyed by tree-relative folder path (the read-tree reader). */
function folderTexts(root: string): Map<string, SpecFiles> {
  const out = new Map<string, SpecFiles>();
  for (const base of [join(root, 'specs'), join(root, 'specs', 'archive')]) {
    for (const files of folders(base)) out.set(rel(root, join(base, files.folder)), files);
  }
  return out;
}

/** The `timeline` family: `buildTimeline` per spec folder, in `listSpecs` order. */
function timelineModel(root: string): Record<string, TimelineEntry[]> {
  const texts = folderTexts(root);
  const refs: SpecRef[] = listSpecs(root);
  const unread = refs.map((ref) => rel(root, ref.dir)).filter((folder) => !texts.has(folder));
  if (unread.length > 0 || texts.size !== refs.length) {
    throw new Error(`listSpecs and the fixture reader disagree: ${unread.join(', ') || `${texts.size} ≠ ${refs.length}`}`);
  }
  const out: Record<string, TimelineEntry[]> = {};
  for (const ref of refs) {
    const folder = rel(root, ref.dir);
    out[folder] = buildTimeline({ files: texts.get(folder) as SpecFiles, commits: [] });
  }
  return out;
}

/**
 * The `spec` family (`<tree>.spec.golden.json`, T12): `buildSpecPage` per spec folder in `listSpecs` order, keyed by
 * `specs/…` path, with the tree's master, constitution and TL;DR and every other folder as siblings; no locks (lock
 * sources are T20), no commits, no worktree tree.
 */
function specPageModel(root: string): Record<string, SpecPageModel> {
  const tree = readTreeAt(root);
  const texts = folderTexts(root);
  const out: Record<string, SpecPageModel> = {};
  for (const ref of listSpecs(root)) {
    const folder = rel(root, ref.dir);
    const files = texts.get(folder) as SpecFiles;
    const own = { ...files.texts, ...(tree.master === null ? {} : { master: tree.master }), ...(tree.constitution === null ? {} : { constitution: tree.constitution }) };
    out[folder] = buildSpecPage({ files: { folder: files.folder, texts: own }, others: [...texts.values()].filter((f) => f !== files), tldr: tree.tldr });
  }
  return out;
}

/**
 * The `live` family (T21): a fixed clock, and each tree's lock reading from the real reader (`readLockSources`, read
 * once up front since the families are synchronous) with no LifeOS state directory, so `activity` or `none`.
 */
const LIVE_NOW = new Date('2026-03-08T15:00:00Z');
const LIVE_LOCKS = new Map(await Promise.all(fixtureTrees().map(async (tree) => [join(FIXTURES, tree), await readLockSources({ repoRoot: join(FIXTURES, tree) })] as const)));

/** Spec 002's model families, each a function of a tree root. A later task adds its model here. */
const FAMILIES: Readonly<Record<string, (root: string) => unknown>> = {
  specs: specsModel,
  timeline: timelineModel,
  spec: specPageModel,
  docs: docsModel,
  frames: (root) => ((texts) => Object.fromEntries(listSpecs(root).map((ref) => [rel(root, ref.dir), buildFrames(texts.get(rel(root, ref.dir)) as SpecFiles)])))(folderTexts(root)),
  'claim-view': (root) => ((texts) => Object.fromEntries(listSpecs(root).map((ref) => [rel(root, ref.dir), buildClaimViews({ files: texts.get(rel(root, ref.dir)) as SpecFiles })])))(folderTexts(root)),
  tasks: (root) => ((texts, constitution) => Object.fromEntries(listSpecs(root).map((ref) => ((t) => [rel(root, ref.dir), t.tasks === undefined ? null : parseTaskLines({ tasks: t.tasks, ...(constitution === null ? {} : { constitution }), ...(t.rounds === undefined ? {} : { rounds: t.rounds }) })])((texts.get(rel(root, ref.dir)) as SpecFiles).texts))))(folderTexts(root), readTreeAt(root).constitution),
  planning: planningModel,
  live: (root) => ((texts, constitution, locks) => Object.fromEntries(listSpecs(root).map((ref) => ((files) => [rel(root, ref.dir), buildLiveFrame({ files: { folder: files.folder, texts: { ...files.texts, ...(constitution === null ? {} : { constitution }) } }, locks, now: LIVE_NOW })])(texts.get(rel(root, ref.dir)) as SpecFiles))))(folderTexts(root), readTreeAt(root).constitution, LIVE_LOCKS.get(root) as LockReading),
};

/** Every string in a JSON value, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/**
 * An absolute path in a string: a leading `/segment/`, or the home, temp or fixture directory anywhere in it. A slash
 * command (`/spec-review 005`) starts with `/` too but has no second segment, and may appear (tests/dashboard.test.ts).
 */
const hasAbsolutePath = (s: string): boolean =>
  /^\/[^\s/]+\//.test(s) || [homedir(), tmpdir(), FIXTURES].some((dir) => s.includes(dir));

const trees = fixtureTrees();
const cases = Object.keys(FAMILIES).flatMap((family) => trees.map((tree) => [tree, family] as const));
const build = (tree: string, family: string): string => goldenText((FAMILIES[family] as (root: string) => unknown)(join(FIXTURES, tree)));

describe('golden inventory', () => {
  test('every golden belongs to a known family and a fixture tree; every tree has one per family', () => {
    expect(trees.length).toBeGreaterThan(0);
    const known = [DASHBOARD_FAMILY, ...Object.keys(FAMILIES)];
    expect(goldenFiles().filter((g) => !known.includes(g.family) || !trees.includes(g.tree)).map((g) => g.file)).toEqual([]);
    for (const family of known) expect({ family, trees: goldenTrees(family) }).toEqual({ family, trees });
  });

  test('every golden is two-space JSON with a trailing newline', () => {
    const misformatted = goldenFiles()
      .map((g) => g.file)
      .filter((file) => {
        const text = readFileSync(join(FIXTURES, file), 'utf8');
        return goldenText(JSON.parse(text)) !== text;
      });
    expect(misformatted).toEqual([]);
  });

  test('no golden carries an absolute path', () => {
    const offending = goldenFiles().flatMap((g) =>
      strings(JSON.parse(readFileSync(join(FIXTURES, g.file), 'utf8'))).filter(hasAbsolutePath).map((s) => `${g.file}: ${s.slice(0, 40)}`),
    );
    expect(offending).toEqual([]);
  });
});

describe('golden snapshots', () => {
  test.each(cases)('%s.%s.golden.json', (tree, family) => {
    expectGolden(goldenPath(tree, family), build(tree, family), UPDATE_COMMAND);
  });

  test('the timelines are not empty: the fixtures carry decisions, rounds and gate marks', () => {
    const kinds = new Set(trees.flatMap((tree) => Object.values(timelineModel(join(FIXTURES, tree))).flat().map((e) => e.kind)));
    expect([...kinds].sort()).toEqual(['decision', 'gate', 'round', 'stage']);
  });
});

describe('the checks bite', () => {
  test('a golden mutated in memory fails the comparison with a pointer to the first differing line', () => {
    const built = build('harbor', 'timeline');
    expect(goldenMismatch(built, built)).toBeNull();
    const lines = built.split('\n');
    const at = lines.findIndex((line) => line.includes('"kind": "round"'));
    expect(at).toBeGreaterThan(0);
    lines[at] = lines[at]?.replace('"round"', '"gate"') ?? '';
    const mismatch = goldenMismatch(lines.join('\n'), built);
    expect(mismatch).toStartWith(`golden differs at line ${at + 1}\n`);
    expect(mismatch).toContain('"kind": "gate"');
    // A missing trailing newline is a difference too.
    expect(goldenMismatch(built.slice(0, -1), built)).toStartWith('golden differs at line');
  });

  test('the path detector catches a fixture path and a /segment/ string, not a slash command', () => {
    expect([join(FIXTURES, 'harbor'), '/api/workspaces/harbor', '/spec-review 005', 'specs/002-web-console'].filter(hasAbsolutePath)).toEqual([
      join(FIXTURES, 'harbor'),
      '/api/workspaces/harbor',
    ]);
  });
});
