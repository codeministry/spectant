// The document catalog of a workspace (spec 017, ISC-155): per spec its five Markdown files, every image or Markdown
// file under `artifacts/`, `.evidence/` and `.design/`, each folder in `.design/prototype/` that holds HTML pages as one
// `prototype` document; per workspace `constitution.md`, `tech.md`, `tldr.md` and `ideas/*.md`. An archived spec's documents
// (spec 034, ISC-187) are listed below `archive/NNN-slug/` with `archived: true`, never `stale` or `missing`.
// The fixture `core/fixtures/library/` is copied to a temp directory and every mtime is set from `TIMES`, so the
// `modified` of each document is known and a checkout never changes a result. `readCatalog` only reads.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { buildDashboard, type DashboardInput } from '../src/dashboard.ts';
import type { LibraryCatalog, LibraryDoc, SpecType } from '../src/files.ts';
import { catalogDocAt, catalogSourceOf, readCatalog, readCatalogDocs, STALE_TOLERANCE_MS } from '../src/library.ts';
import { readLockSources } from '../src/locks.ts';
import { renderDocsMarkdown } from '../src/markdown-docs.ts';
import { stageOf, type StageInput } from '../src/stage.ts';
import { readTech } from '../src/tech.ts';
import { FIXTURES, readTreeAt } from './helpers/read-tree.ts';

const FIXTURE = join(FIXTURES, 'library');

/**
 * The file times the test sets, by path from the workspace root. Every file not named here gets `DEFAULT_TIME` plus
 * one minute per place in name order, all before 2026-03-02, so each named time is the newest of its folder; every
 * directory gets `DIRECTORY_TIME`, older than any file, so a prototype's time cannot come from its folder.
 */
const TIMES: Readonly<Record<string, string>> = {
  // 001: plan.md older than its spec.md, tasks.md and design.md newer.
  'specs/001-lighthouse-map/spec.md': '2026-03-12T08:00:00Z',
  'specs/001-lighthouse-map/plan.md': '2026-03-05T10:00:00Z',
  'specs/001-lighthouse-map/tasks.md': '2026-03-13T10:00:00Z',
  'specs/001-lighthouse-map/design.md': '2026-03-13T11:00:00Z',
  // The prototype `.design/prototype/` itself: its page is its newest file.
  'specs/001-lighthouse-map/.design/prototype/index.html': '2026-03-11T08:00:00Z',
  'specs/002-tide-board/spec.md': '2026-03-09T10:00:00Z',
  // The prototype `board/`: detail.html is its newest file.
  'specs/002-tide-board/.design/prototype/board/index.html': '2026-03-10T14:00:00Z',
  'specs/002-tide-board/.design/prototype/board/detail.html': '2026-03-10T15:00:00Z',
  // tech.md newer than the newest spec, tldr.md older.
  'specs/tech.md': '2026-03-14T09:00:00Z',
  'specs/tldr.md': '2026-03-08T12:00:00Z',
};
const DEFAULT_TIME = Date.parse('2026-03-01T00:00:00Z');
const DIRECTORY_TIME = Date.parse('2026-02-01T00:00:00Z');

/** Every file below `dir`, as POSIX paths relative to `base`, in name order. */
function filesBelow(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...filesBelow(path, base));
    else out.push(relative(base, path).split(sep).join('/'));
  }
  return out.sort();
}

/** Every directory below `dir`, deepest first, so setting a child's time never moves its parent's afterwards. */
function directoriesBelow(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const path = join(dir, e.name);
    out.push(...directoriesBelow(path), path);
  }
  return out;
}

const FILES = filesBelow(FIXTURE);

/** The time the test sets on a file (path from the workspace root), in ms. */
function timeOf(path: string): number {
  const named = TIMES[path];
  if (named !== undefined) return Date.parse(named);
  const index = FILES.indexOf(path);
  if (index < 0) throw new Error(`no fixture file ${path}`);
  return DEFAULT_TIME + index * 60_000;
}

/**
 * The fixture copied to a temp directory with every time from `TIMES`; `overrides` sets other times on named files
 * (path from the workspace root) and `removed` deletes files from the copy, never from the fixture.
 */
function workspaceCopy(overrides: Readonly<Record<string, string>> = {}, removed: readonly string[] = []): string {
  const root = mkdtempSync(join(tmpdir(), 'spectant-library-'));
  cpSync(FIXTURE, root, { recursive: true });
  for (const path of removed) rmSync(join(root, path));
  for (const path of FILES) {
    if (removed.includes(path)) continue;
    const named = overrides[path];
    const at = new Date(named === undefined ? timeOf(path) : Date.parse(named));
    utimesSync(join(root, path), at, at);
  }
  for (const dir of [...directoriesBelow(root), root]) {
    const at = new Date(DIRECTORY_TIME);
    utimesSync(dir, at, at);
  }
  return root;
}

/** Path, size and sha256 of every file below `root`: what a read may not change. */
function treeHash(root: string): string[] {
  return filesBelow(root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return `${path} ${bytes.length} ${createHash('sha256').update(bytes).digest('hex')}`;
  });
}

/** One expected document; `newest` is the file (from the workspace root) whose time is the document's `modified`. */
interface Expected {
  readonly path: string;
  readonly type: LibraryDoc['type'];
  readonly spec: string;
  readonly title: string;
  readonly media: LibraryDoc['media'];
  readonly pages?: readonly string[];
  readonly newest?: string;
}

const S1 = '001-lighthouse-map';
const S2 = '002-tide-board';
const S3 = '003-buoy-colors';
const S4 = '004-fog-horn';

/** Every document of the fixture, exactly once. Titles: the H1, else frontmatter `title:`, else the file or folder name. */
const EXPECTED: readonly Expected[] = [
  // The workspace.
  { path: 'constitution.md', type: 'constitution', spec: 'workspace', title: 'Constitution — Beacon', media: 'markdown' },
  // Frontmatter `title:` and no H1.
  { path: 'tech.md', type: 'tech', spec: 'workspace', title: 'Beacon', media: 'markdown' },
  { path: 'tldr.md', type: 'tldr', spec: 'workspace', title: 'TL;DR — beacon', media: 'markdown' },
  { path: 'ideas/night-mode.md', type: 'idea', spec: 'workspace', title: 'Night mode', media: 'markdown' },
  { path: 'ideas/offline-tiles.md', type: 'idea', spec: 'workspace', title: 'Offline tiles', media: 'markdown' },

  // 001: every zone.
  { path: `${S1}/spec.md`, type: 'spec', spec: S1, title: '001 — Lighthouse map', media: 'markdown' },
  { path: `${S1}/plan.md`, type: 'plan', spec: S1, title: 'Plan 001 — lighthouse-map', media: 'markdown' },
  { path: `${S1}/tasks.md`, type: 'tasks', spec: S1, title: 'Tasks 001 — lighthouse-map', media: 'markdown' },
  // Frontmatter `title: Map design` and an H1: the H1 wins.
  { path: `${S1}/design.md`, type: 'design', spec: S1, title: 'Design 001 — lighthouse-map', media: 'markdown' },
  { path: `${S1}/context.md`, type: 'context', spec: S1, title: 'Context log 001 — lighthouse-map', media: 'markdown' },
  { path: `${S1}/artifacts/coverage.md`, type: 'artifact', spec: S1, title: 'Coverage report', media: 'markdown' },
  { path: `${S1}/artifacts/map-overview.png`, type: 'artifact', spec: S1, title: 'map-overview.png', media: 'image' },
  { path: `${S1}/.evidence/summary.md`, type: 'evidence', spec: S1, title: 'Evidence summary', media: 'markdown' },
  { path: `${S1}/.evidence/ISC-1/map.png`, type: 'evidence', spec: S1, title: 'map.png', media: 'image' },
  // No H1 (an H2 only) and no frontmatter: the file name.
  { path: `${S1}/.evidence/ISC-2/notes.md`, type: 'evidence', spec: S1, title: 'notes.md', media: 'markdown' },
  { path: `${S1}/.design/sketch.md`, type: 'design', spec: S1, title: 'Sketch notes', media: 'markdown' },
  { path: `${S1}/.design/desktop.jpg`, type: 'design', spec: S1, title: 'desktop.jpg', media: 'image' },
  { path: `${S1}/.design/views/mobile.png`, type: 'design', spec: S1, title: 'mobile.png', media: 'image' },
  // `.design/prototype/` itself holds an HTML page: one document; its CSS and `assets/` belong to it.
  {
    path: `${S1}/.design/prototype`,
    type: 'prototype',
    spec: S1,
    title: 'prototype',
    media: 'prototype',
    pages: ['index.html'],
    newest: `specs/${S1}/.design/prototype/index.html`,
  },

  // 002: no plan.md, no tasks.md; a prototype folder with two pages beside a code folder without HTML.
  { path: `${S2}/spec.md`, type: 'spec', spec: S2, title: '002 — Tide board', media: 'markdown' },
  { path: `${S2}/context.md`, type: 'context', spec: S2, title: 'Context log 002 — tide-board', media: 'markdown' },
  // The prototype's screenshot lies in `.design/`, outside the prototype folder: a design image of its own.
  { path: `${S2}/.design/prototype-board.png`, type: 'design', spec: S2, title: 'prototype-board.png', media: 'image' },
  {
    path: `${S2}/.design/prototype/board`,
    type: 'prototype',
    spec: S2,
    title: 'board',
    media: 'prototype',
    pages: ['detail.html', 'index.html'],
    newest: `specs/${S2}/.design/prototype/board/detail.html`,
  },

  // 003 (complete) and 004 (bug): what they have.
  { path: `${S3}/spec.md`, type: 'spec', spec: S3, title: '003 — Buoy colors', media: 'markdown' },
  { path: `${S3}/context.md`, type: 'context', spec: S3, title: 'Context log 003 — buoy-colors', media: 'markdown' },
  { path: `${S4}/spec.md`, type: 'spec', spec: S4, title: '004 — Fog horn timing', media: 'markdown' },
];

/** The archived spec of the fixture (spec 034, ISC-187): its documents below `archive/`, by the same zone rules. */
const A0 = '000-first-light';
const ARCHIVED: ReadonlyArray<Pick<LibraryDoc, 'path' | 'type' | 'spec' | 'title' | 'media' | 'pages'>> = [
  { path: `archive/${A0}/spec.md`, type: 'spec', spec: A0, title: '000 — First light', media: 'markdown' },
  { path: `archive/${A0}/plan.md`, type: 'plan', spec: A0, title: 'Plan 000 — first-light', media: 'markdown' },
  { path: `archive/${A0}/context.md`, type: 'context', spec: A0, title: 'Context log 000 — first-light', media: 'markdown' },
  { path: `archive/${A0}/artifacts/old.png`, type: 'artifact', spec: A0, title: 'old.png', media: 'image' },
  { path: `archive/${A0}/.evidence/old.md`, type: 'evidence', spec: A0, title: 'Old evidence', media: 'markdown' },
  { path: `archive/${A0}/.design/first.png`, type: 'design', spec: A0, title: 'first.png', media: 'image' },
  { path: `archive/${A0}/.design/prototype`, type: 'prototype', spec: A0, title: 'prototype', media: 'prototype', pages: ['index.html'] },
];

/** The comparable fields of a document; `pages` only where the document has them. */
const shape = (d: Pick<LibraryDoc, 'path' | 'type' | 'spec' | 'title' | 'media' | 'pages'>) => ({
  path: d.path,
  type: d.type,
  spec: d.spec,
  title: d.title,
  media: d.media,
  ...(d.pages === undefined ? {} : { pages: [...d.pages] }),
});
const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

describe('catalog (ISC-155)', () => {
  let root = '';
  let before: string[] = [];
  let catalog: LibraryCatalog;
  /** The documents whose file exists; `missing` entries (ISC-155.2) name files that do not. */
  let present: LibraryDoc[] = [];

  beforeAll(async () => {
    root = workspaceCopy();
    before = treeHash(root);
    catalog = await readCatalog(root);
    present = catalog.docs.filter((d) => d.state !== 'missing');
  });

  afterAll(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
  });

  test('catalog: every fixture document exactly once with type, spec, title and path, 0 foreign', () => {
    const paths = present.map((d) => d.path);
    expect(paths.filter((p, i) => paths.indexOf(p) !== i)).toEqual([]);
    expect(present.filter((d) => d.archived !== true).map(shape).sort(byPath)).toEqual(EXPECTED.map(shape).sort(byPath));
  });

  test('catalog: each document carries its modification time as ISO 8601, a prototype its newest file', () => {
    const times = present.filter((d) => d.archived !== true).map((d) => ({ path: d.path, modified: d.modified }));
    expect(times.filter((t) => t.modified === null || !ISO_8601.test(t.modified))).toEqual([]);
    const want = EXPECTED.map((e) => ({ path: e.path, ms: timeOf(e.newest ?? `specs/${e.path}`) })).sort(byPath);
    const got = times.map((t) => ({ path: t.path, ms: t.modified === null ? null : Date.parse(t.modified) })).sort(byPath);
    expect(got).toEqual(want);
  });

  test('catalog: a present document is ok or stale; a missing entry names a file that does not exist', () => {
    expect(present.filter((d) => d.state !== 'ok' && d.state !== 'stale').map((d) => d.path)).toEqual([]);
    const missing = catalog.docs.filter((d) => d.state === 'missing');
    expect(missing.filter((d) => existsSync(join(root, 'specs', d.path))).map((d) => d.path)).toEqual([]);
  });

  test('catalog: a prototype folder is one document; its files and a folder without HTML are no entries', () => {
    const prototypes = present.filter((d) => d.type === 'prototype' && d.archived !== true);
    expect(prototypes.map((d) => [d.path, d.pages ?? null]).sort()).toEqual([
      [`${S1}/.design/prototype`, ['index.html']],
      [`${S2}/.design/prototype/board`, ['detail.html', 'index.html']],
    ]);
    // Nothing inside a prototype folder is an entry of its own: not its Markdown, not its images, not its assets.
    const inside = present.filter((d) => prototypes.some((p) => d.path.startsWith(`${p.path}/`)));
    expect(inside.map((d) => d.path)).toEqual([]);
    // The code folder `src/` holds Markdown and an image but no HTML page: neither it nor its content appears.
    expect(catalog.docs.filter((d) => d.path.startsWith(`${S2}/.design/prototype/src`)).map((d) => d.path)).toEqual([]);
  });

  test('archived: every document of an archived spec exactly once below archive/NNN-slug/, flagged archived', () => {
    const archived = catalog.docs.filter((d) => d.path.startsWith('archive/') || d.spec === A0);
    expect(archived.map((d) => ({ ...shape(d), archived: d.archived ?? false })).sort(byPath)).toEqual(
      ARCHIVED.map((e) => ({ ...shape(e), archived: true })).sort(byPath),
    );
    expect(archived.filter((d) => d.modified === null || !ISO_8601.test(d.modified)).map((d) => d.path)).toEqual([]);
    // Active documents carry no flag; an archived spec has no group head.
    expect(catalog.docs.filter((d) => !d.path.startsWith('archive/') && d.archived !== undefined).map((d) => d.path)).toEqual([]);
    expect(catalog.groups.filter((g) => g.spec === A0)).toEqual([]);
  });

  test('archived: after the active specs, in number order', () => {
    const firstArchived = catalog.docs.findIndex((d) => d.archived === true);
    expect(firstArchived).toBeGreaterThan(0);
    expect(catalog.docs.slice(firstArchived).filter((d) => d.archived !== true).map((d) => d.path)).toEqual([]);
  });

  test('catalog: reading changes no byte of the workspace', () => {
    expect(treeHash(root)).toEqual(before);
  });
});

// ISC-155.1: a document is `stale` when the file it derives from was modified more than `STALE_TOLERANCE_MS` (60 s)
// after it. plan.md, tasks.md and design.md derive from the spec.md of their spec, tech.md and tldr.md from the newest
// spec.md of the workspace's active specs. events.jsonl plays no part: a stage event is no edit of the spec. The
// tolerance keeps a `git checkout`, which rewrites every mtime within moments, from colouring fresh documents. Each case
// reads its own copy with the times it needs.
describe('stale (ISC-155.1)', () => {
  const roots: string[] = [];

  /** The paths of the stale documents of a fresh copy, sorted; every other present document must be `ok`. */
  async function staleOf(overrides: Readonly<Record<string, string>> = {}, removed: readonly string[] = []): Promise<string[]> {
    const root = workspaceCopy(overrides, removed);
    roots.push(root);
    const before = treeHash(root);
    const catalog = await readCatalog(root);
    expect(treeHash(root)).toEqual(before);
    const present = catalog.docs.filter((d) => d.state !== 'missing');
    expect(present.filter((d) => d.state !== 'ok' && d.state !== 'stale').map((d) => d.path)).toEqual([]);
    expect(catalog.stale).toBe(catalog.docs.filter((d) => d.state === 'stale').length);
    return present
      .filter((d) => d.state === 'stale')
      .map((d) => d.path)
      .sort();
  }

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  test('stale: the tolerance is 60 seconds', () => {
    expect(STALE_TOLERANCE_MS).toBe(60_000);
  });

  test('stale: plan.md older than its spec.md and tldr.md older than the newest spec.md; every fresh document ok', async () => {
    // 001's spec.md is from 03-12T08:00: plan.md (03-05) is stale, tasks.md and design.md (03-13) are not, nor are the
    // images in its `.design/` folder, which derive from nothing. The newest spec.md is 001's, so tldr.md (03-08) is
    // stale and tech.md (03-14) is not. 002 has no plan, tasks or design; 003 and 004 neither.
    expect(await staleOf()).toEqual([`${S1}/plan.md`, 'tldr.md']);
  });

  test('stale: plan.md older than spec.md by more than 60 s is stale, by 60 s or less it is not', async () => {
    expect(await staleOf({ [`specs/${S1}/plan.md`]: '2026-03-12T07:58:59Z' })).toEqual([`${S1}/plan.md`, 'tldr.md']);
    expect(await staleOf({ [`specs/${S1}/plan.md`]: '2026-03-12T07:59:00Z' })).toEqual(['tldr.md']);
    expect(await staleOf({ [`specs/${S1}/plan.md`]: '2026-03-12T07:59:30Z' })).toEqual(['tldr.md']);
  });

  test('stale: a stage event after plan.md does not make it stale', async () => {
    // plan.md (03-12T08:30) is newer than spec.md (03-12T08:00) and older than 001's events.jsonl line (03-12T09:00).
    const root = workspaceCopy({ [`specs/${S1}/plan.md`]: '2026-03-12T08:30:00Z' });
    roots.push(root);
    const events = join(root, 'specs', S1, 'events.jsonl');
    const later = '{"ts":"2026-03-20T10:00:00Z","type":"stage","from":"plan","to":"build","actor":"agent"}\n';
    writeFileSync(events, readFileSync(events, 'utf-8') + later);
    const catalog = await readCatalog(root);
    expect(catalog.docs.filter((d) => d.state === 'stale').map((d) => d.path)).toEqual(['tldr.md']);
  });

  test('stale: spec.md edited after plan.md with no events.jsonl makes plan.md stale', async () => {
    const overrides = { [`specs/${S1}/plan.md`]: '2026-03-12T07:00:00Z' };
    expect(await staleOf(overrides, [`specs/${S1}/events.jsonl`])).toEqual([`${S1}/plan.md`, 'tldr.md']);
  });

  test('stale: a spec.md edit after the last events.jsonl line makes its documents and tech.md stale', async () => {
    // spec.md (03-14T12:00) is newer than tasks.md, design.md (03-13) and tech.md (03-14T09:00); the mtime decides.
    expect(await staleOf({ [`specs/${S1}/spec.md`]: '2026-03-14T12:00:00Z' })).toEqual([
      `${S1}/design.md`,
      `${S1}/plan.md`,
      `${S1}/tasks.md`,
      'tech.md',
      'tldr.md',
    ]);
  });

  test('stale: tech.md against the newest spec.md of any active spec', async () => {
    // 004's spec.md from 03-14T10:00 is the newest, an hour after tech.md (03-14T09:00).
    expect(await staleOf({ [`specs/${S4}/spec.md`]: '2026-03-14T10:00:00Z' })).toEqual([`${S1}/plan.md`, 'tech.md', 'tldr.md']);
    // 30 s after tech.md is within the tolerance.
    expect(await staleOf({ [`specs/${S4}/spec.md`]: '2026-03-14T09:00:30Z' })).toEqual([`${S1}/plan.md`, 'tldr.md']);
  });

  test('archived: never stale or missing, and outside the control counts', async () => {
    // plan.md an hour older than the archived spec.md would be stale for an active spec.
    const root = workspaceCopy({ [`specs/archive/${A0}/plan.md`]: '2026-03-01T00:00:00Z', [`specs/archive/${A0}/spec.md`]: '2026-03-01T01:00:00Z' });
    roots.push(root);
    const catalog = await readCatalog(root);
    const archived = catalog.docs.filter((d) => d.archived === true);
    expect(archived.length).toBe(ARCHIVED.length);
    expect(archived.filter((d) => d.state !== 'ok').map((d) => `${d.path}: ${d.state}`)).toEqual([]);
    expect(catalog.stale).toBe(catalog.docs.filter((d) => d.state === 'stale' && d.archived !== true).length);
    expect(catalog.missing).toBe(catalog.docs.filter((d) => d.state === 'missing' && d.archived !== true).length);
  });

  test('stale: an archived spec is no spec of the workspace for tech.md and tldr.md', async () => {
    expect(await staleOf({ 'specs/archive/000-first-light/spec.md': '2026-03-20T00:00:00Z' })).toEqual([`${S1}/plan.md`, 'tldr.md']);
  });

  test('stale: a document level with its source is fresh', async () => {
    const level = { [`specs/${S1}/plan.md`]: '2026-03-12T08:00:00Z', 'specs/tldr.md': '2026-03-12T08:00:00Z' };
    expect(await staleOf(level)).toEqual([]);
  });

  test('stale: a checkout that rewrites every mtime within seconds colours nothing', async () => {
    // Every file gets a time within 30 s of 03-20, in name order: spec.md files may land after their plans.
    const start = Date.parse('2026-03-20T00:00:00Z');
    const step = Math.floor(30_000 / FILES.length);
    const checkout = Object.fromEntries(FILES.map((path, i) => [path, new Date(start + i * step).toISOString()]));
    expect(await staleOf(checkout)).toEqual([]);
  });
});

// ISC-155.2: a spec that is not complete lists each document its type asks for and lacks as a `missing` entry, by the
// stage table's own rule (stage.ts, rows `plan` and `tasks`): `plan.md` for feature, infra and project; `tasks.md` for
// refactor, feature and project once the spec has three or more claim lines, dropped ones included. A complete spec
// lists none. The fixture covers 002 (open feature) and 003 (complete refactor); a generated workspace covers every
// type at two, three and four claims, open and complete.
describe('missing (ISC-155.2)', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** A `missing` entry as the catalog carries it: the file that should exist, no time, the file name as title. */
  const entry = (spec: string, kind: 'plan' | 'tasks'): LibraryDoc => ({
    path: `${spec}/${kind}.md`,
    type: kind,
    spec,
    title: `${kind}.md`,
    modified: null,
    state: 'missing',
    media: 'markdown',
  });

  const missingOf = (catalog: LibraryCatalog): LibraryDoc[] => catalog.docs.filter((d) => d.state === 'missing');

  test('missing: the fixture lists plan.md and tasks.md of the open feature 002, nothing of the complete 003', async () => {
    const root = workspaceCopy();
    roots.push(root);
    const before = treeHash(root);
    const catalog = await readCatalog(root);
    expect(treeHash(root)).toEqual(before);
    expect(missingOf(catalog)).toEqual([entry(S2, 'plan'), entry(S2, 'tasks')]);
    expect(catalog.missing).toBe(2);
    expect(catalog.stale).toBe(catalog.docs.filter((d) => d.state === 'stale').length);
    // A missing entry stands where the file would: after spec.md, before context.md, in the spec's own order.
    const own = catalog.docs.filter((d) => d.spec === S2 && /^[^/]+\/[^/]+\.md$/.test(d.path)).map((d) => d.path);
    expect(own).toEqual([`${S2}/spec.md`, `${S2}/plan.md`, `${S2}/tasks.md`, `${S2}/context.md`]);
  });

  test('missing: a document that exists is no missing entry', async () => {
    // 001 (feature, building) has both files; with plan.md removed it lacks exactly that one, listed after spec.md.
    const root = workspaceCopy({}, [`specs/${S1}/plan.md`]);
    roots.push(root);
    const catalog = await readCatalog(root);
    expect(missingOf(catalog).map((d) => d.path)).toEqual([`${S1}/plan.md`, `${S2}/plan.md`, `${S2}/tasks.md`]);
    expect(catalog.missing).toBe(3);
    const own = catalog.docs.filter((d) => d.spec === S1 && /^[^/]+\/[^/]+\.md$/.test(d.path)).map((d) => d.path);
    expect(own).toEqual([`${S1}/spec.md`, `${S1}/plan.md`, `${S1}/tasks.md`, `${S1}/design.md`, `${S1}/context.md`]);
  });

  /** One generated spec: its type, its phase, its open claim lines and its dropped ones. */
  interface Case {
    readonly folder: string;
    readonly type: string;
    readonly phase: string;
    readonly claims: number;
    readonly dropped?: number;
  }

  function specText(c: Case): string {
    const lines = Array.from({ length: c.claims }, (_, i) => `- [ ] ISC-${i + 1}: Claim ${i + 1} of the case holds.`);
    for (let i = 0; i < (c.dropped ?? 0); i++) lines.push(`- [x] ISC-${c.claims + i + 1}: [DROPPED] Claim of the case.`);
    return ['---', `slug: ${c.folder}`, `spec_type: ${c.type}`, `phase: ${c.phase}`, '---', '', `# ${c.folder}`, '', '## Claims', '', ...lines, ''].join(
      '\n',
    );
  }

  /** A workspace holding exactly `cases`, each with spec.md only. */
  function generated(cases: readonly Case[]): string {
    const root = mkdtempSync(join(tmpdir(), 'spectant-library-missing-'));
    roots.push(root);
    for (const c of cases) {
      mkdirSync(join(root, 'specs', c.folder), { recursive: true });
      writeFileSync(join(root, 'specs', c.folder, 'spec.md'), specText(c));
    }
    return root;
  }

  const TYPES: readonly SpecType[] = ['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore'];
  /** The rule in the claim's own words: which types need plan.md, which need tasks.md from three claims on. */
  const PLAN_TYPES: ReadonlySet<string> = new Set(['feature', 'infra', 'project']);
  const TASKS_TYPES: ReadonlySet<string> = new Set(['refactor', 'feature', 'project']);

  /** Every type at two, three and four claims, open and complete: folders `100-…` to `165-…`. */
  const CASES: readonly Case[] = TYPES.flatMap((type, t) =>
    [2, 3, 4].flatMap((claims, k) =>
      ['implement', 'complete'].map(
        (phase, p): Case => ({ folder: `${100 + t * 10 + k * 2 + p}-${type}-${claims}-${phase}`, type, phase, claims }),
      ),
    ),
  );

  test('missing: each type and claim count as the claim names them; complete specs list none', async () => {
    const catalog = await readCatalog(generated(CASES));
    const want = CASES.filter((c) => c.phase !== 'complete').flatMap((c) => [
      ...(PLAN_TYPES.has(c.type) ? [entry(c.folder, 'plan')] : []),
      ...(TASKS_TYPES.has(c.type) && c.claims >= 3 ? [entry(c.folder, 'tasks')] : []),
    ]);
    expect(missingOf(catalog)).toEqual(want);
    expect(catalog.missing).toBe(want.length);
    // A complete spec lists its spec.md and nothing else.
    const complete = CASES.filter((c) => c.phase === 'complete').map((c) => c.folder);
    expect(catalog.docs.filter((d) => complete.includes(d.spec)).map((d) => d.path)).toEqual(complete.map((f) => `${f}/spec.md`));
  });

  test('missing: equal to the stage rule of core/ for every type and claim count', async () => {
    const catalog = await readCatalog(generated(CASES));
    const missing = new Set(missingOf(catalog).map((d) => d.path));
    for (const c of CASES) {
      const input = (hasPlan: boolean, hasTasks: boolean): StageInput => ({
        number: c.folder.slice(0, 3),
        type: c.type as SpecType,
        phase: c.phase,
        hasPlan,
        hasTasks,
        claims: { closed: 0, total: c.claims },
        reviewed: 'missing',
        codeReviewed: 'missing',
        takeable: [],
        partition: { takeable: 0, open: c.claims, closed: 0, dropped: 0 },
        explicitStage: null,
        lastEventTo: null,
        codeReview: 'spec',
        mainFeature: null,
        featureSiblingsOpen: [],
      });
      // The stage table stops at `plan` exactly when plan.md is needed and absent, at `tasks` likewise for tasks.md.
      const got = { folder: c.folder, plan: missing.has(`${c.folder}/plan.md`), tasks: missing.has(`${c.folder}/tasks.md`) };
      expect(got).toEqual({ folder: c.folder, plan: stageOf(input(false, true)) === 'plan', tasks: stageOf(input(true, false)) === 'tasks' });
    }
  });

  test('missing: a dropped claim line counts toward the three-claim threshold; an unknown type needs nothing', async () => {
    const cases: Case[] = [
      { folder: '201-refactor-dropped', type: 'refactor', phase: 'implement', claims: 2, dropped: 1 },
      { folder: '202-refactor-two', type: 'refactor', phase: 'implement', claims: 2 },
      { folder: '203-untyped', type: 'unknown', phase: 'implement', claims: 5 },
    ];
    const catalog = await readCatalog(generated(cases));
    expect(missingOf(catalog).map((d) => d.path)).toEqual(['201-refactor-dropped/tasks.md']);
    expect(catalog.missing).toBe(1);
  });
});

// ISC-157: one group head per active spec and the open fog lines, the former tech page's Status, Specs and Open tabs.
// Type, stage, claims and tasks are the dashboard row's, fog count, goal, approach and fog lines the tech page's, so
// each head is compared with both models over the same tree rather than with a second derivation.
describe('groups (ISC-157)', () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** The library fixture with fog lines: two in the open 002, one in the complete 003 (never shown). */
  function foggy(): string {
    const root = workspaceCopy();
    roots.push(root);
    const addFog = (spec: string, lines: readonly string[]): void => {
      const path = join(root, 'specs', spec, 'spec.md');
      const text = readFileSync(path, 'utf-8').replace('## Not yet specified\n', `## Not yet specified\n\n${lines.map((l) => `- fog: ${l}`).join('\n')}\n`);
      writeFileSync(path, text);
    };
    addFog(S2, ['Which tide source counts for a river harbour.', 'How far ahead the board looks.']);
    addFog(S3, ['Whether the night palette shares the table.']);
    return root;
  }

  /** The dashboard input a server would read for `root`: the test helper's tree plus the repository's own locks. */
  async function serverInput(root: string, worktreeTree: string | null = null): Promise<DashboardInput> {
    return { ...readTreeAt(root, worktreeTree), locks: await readLockSources({ repoRoot: root, lifeosStateDir: null }) };
  }

  test('groups: one head per active spec in number order with type, stage, claims, tasks, fog, goal and approach', async () => {
    const root = foggy();
    const before = treeHash(root);
    const catalog = await readCatalog(root);
    expect(catalog.groups).toEqual([
      {
        spec: S1,
        type: 'feature',
        stage: 'review',
        claimsClosed: 2,
        claimsTotal: 3,
        tasksDone: 2,
        tasksTotal: 3,
        fog: 0,
        goal: 'Every lighthouse in the list stands on the map at its position.',
        approach: 'Read the list once, project each position onto the tile grid.',
      },
      { spec: S2, type: 'feature', stage: 'plan', claimsClosed: 0, claimsTotal: 3, tasksDone: 0, tasksTotal: 0, fog: 2, goal: 'The tide board shows high and low water of the next day for every harbour.', approach: null },
      { spec: S3, type: 'refactor', stage: 'done', claimsClosed: 3, claimsTotal: 3, tasksDone: 0, tasksTotal: 0, fog: 0, goal: 'Every buoy colour comes from one table; the map looks the same.', approach: null },
      { spec: S4, type: 'bug', stage: 'review', claimsClosed: 0, claimsTotal: 1, tasksDone: 0, tasksTotal: 0, fog: 0, goal: 'The fog horn interval reads in seconds.', approach: null },
    ]);
    // The filter "open": every fog line of a spec not complete, under its folder; the complete 003 adds none.
    expect(catalog.fog).toEqual([
      { spec: S2, text: 'Which tide source counts for a river harbour.' },
      { spec: S2, text: 'How far ahead the board looks.' },
    ]);
    expect(treeHash(root)).toEqual(before);
  });

  test('groups: equal the dashboard rows and the tech model of the same tree (library, harbor, lantern)', async () => {
    for (const root of [foggy(), join(FIXTURES, 'harbor'), join(FIXTURES, 'lantern')]) {
      const input = await serverInput(root);
      const catalog = await readCatalog(root);
      const rows = buildDashboard(input).specs;
      const tech = readTech({ specs: input.specs });
      expect(catalog.groups.map((g) => g.spec)).toEqual(rows.map((r) => r.slug).sort());
      expect(catalog.groups.map((g) => g.spec)).toEqual(tech.specs.map((s) => s.slug));
      for (const g of catalog.groups) {
        const row = rows.find((r) => r.slug === g.spec);
        const spec = tech.specs.find((s) => s.slug === g.spec);
        expect({ spec: g.spec, type: g.type, stage: g.stage, claims: [g.claimsClosed, g.claimsTotal], tasks: [g.tasksDone, g.tasksTotal] }).toEqual({
          spec: row?.slug ?? '',
          type: row?.type ?? null,
          stage: row?.stage ?? '',
          claims: [row?.progress.closed ?? -1, row?.progress.total ?? -1],
          tasks: [row?.tasks?.landed ?? 0, row?.tasks?.total ?? 0],
        });
        // Goal and approach are the Markdown the tech page renders: rendered the same way, they are its pages.
        const id = spec?.id ?? '';
        const page = (text: string | null, part: string) => (text === null ? null : renderDocsMarkdown(text, { idPrefix: `spec-${id}-${part}-` }));
        expect({ spec: g.spec, fog: g.fog, goal: page(g.goal, 'goal'), approach: page(g.approach, 'approach') }).toEqual({
          spec: spec?.slug ?? '',
          fog: spec?.fog.length ?? -1,
          goal: spec?.goal ?? null,
          approach: spec?.approach ?? null,
        });
      }
      expect(catalog.fog).toEqual(tech.specs.flatMap((s) => s.fog.map((text) => ({ spec: s.slug, text }))));
    }
    // The fixtures carry what the tabs show: fog lines, goals and approaches.
    const harbor = await readCatalog(join(FIXTURES, 'harbor'));
    expect(harbor.fog.length).toBeGreaterThan(0);
    expect(harbor.groups.filter((g) => g.approach !== null).length).toBeGreaterThan(0);
  });

  test('groups: the server reading decides the stage, a fresh code-reviewed mark included', async () => {
    const root = join(FIXTURES, 'harbor');
    const mark = JSON.parse(readFileSync(join(root, 'specs', '004-retention-policies', '.gates', 'code-reviewed.json'), 'utf-8')) as { tree?: string };
    const input = await serverInput(root, mark.tree ?? null);
    const want = buildDashboard(input).specs.map((r) => [r.slug, r.stage]).sort();
    const given = (await readCatalog(root, input)).groups;
    expect(given.map((g) => [g.spec, g.stage])).toEqual(want);
    expect(given.find((g) => g.spec === '004-retention-policies')?.stage).toBe('close');
    // Without the tree id the mark proves nothing and reads stale, as the dashboard reads it then.
    const without = buildDashboard(await serverInput(root)).specs.map((r) => [r.slug, r.stage]).sort();
    const read = (await readCatalog(root)).groups;
    expect(read.map((g) => [g.spec, g.stage])).toEqual(without);
    expect(read.find((g) => g.spec === '004-retention-policies')?.stage).toBe('code-review');
  });

  test('groups: a workspace without specs has no head and no fog line; a folder without spec.md has no head', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'spectant-library-'));
    roots.push(empty);
    expect(await readCatalog(empty)).toMatchObject({ groups: [], fog: [] });
    const root = workspaceCopy({}, ['specs/004-fog-horn/spec.md']);
    roots.push(root);
    expect((await readCatalog(root)).groups.map((g) => g.spec)).toEqual([S1, S2, S3]);
  });
});

// ISC-159: a prototype document's preview is a screenshot directly in its spec's `.design/` whose name contains
// `prototype`. Images in subfolders or inside a prototype folder never count. Among the candidates a prototype in
// `.design/prototype/<sub>` prefers names containing <sub>, then a `desktop-`, `tablet-`, `mobile-` name in that order,
// within one viewport the exact `<viewport>-prototype.<ext>`, then name order.
describe('preview (ISC-159)', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /**
   * The preview of every prototype of a fresh copy, by path; `added` writes files (path from the workspace root) into
   * the copy, `removed` deletes them from it. Reading changes no byte of the copy.
   */
  async function previewsOf(added: readonly string[] = [], removed: readonly string[] = []): Promise<Record<string, string | null>> {
    const root = workspaceCopy({}, removed);
    roots.push(root);
    for (const path of added) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), path.endsWith('.html') ? '<!doctype html><title>x</title>' : 'x');
    }
    const before = treeHash(root);
    const catalog = await readCatalog(root);
    expect(treeHash(root)).toEqual(before);
    const out: Record<string, string | null> = {};
    for (const d of catalog.docs.filter((doc) => doc.type === 'prototype' && doc.archived !== true)) {
      expect(d.preview).not.toBeUndefined();
      out[d.path] = d.preview ?? null;
    }
    return out;
  }

  const P1 = `${S1}/.design/prototype`;
  const P2 = `${S2}/.design/prototype/board`;
  const in1 = (names: readonly string[]): string[] => names.map((n) => `specs/${S1}/.design/${n}`);

  test('preview: the fixture screenshot prototype-board.png belongs to 002; 001 has no candidate and reads null', async () => {
    expect(await previewsOf()).toEqual({ [P1]: null, [P2]: `${S2}/.design/prototype-board.png` });
  });

  test('preview: no candidate is null; a subfolder image, a Markdown file or a dot file named prototype is none', async () => {
    const design = `specs/${S2}/.design`;
    const added = [`${design}/views/desktop-prototype.png`, `${design}/prototype-notes.md`, `${design}/.prototype.png`];
    expect(await previewsOf(added, [`${design}/prototype-board.png`])).toEqual({ [P1]: null, [P2]: null });
  });

  test('preview: images inside a prototype folder never count, at any depth', async () => {
    const added = [
      `specs/${S1}/.design/prototype/prototype.png`,
      `specs/${S1}/.design/prototype/assets/desktop-prototype.png`,
      `specs/${S2}/.design/prototype/board/img/desktop-prototype.png`,
      `specs/${S2}/.design/prototype/src/prototype.png`,
    ];
    expect(await previewsOf(added)).toEqual({ [P1]: null, [P2]: `${S2}/.design/prototype-board.png` });
  });

  test('preview: desktop before tablet before mobile before any other name, case-insensitive', async () => {
    const all = ['a-prototype.png', 'mobile-prototype.png', 'tablet-prototype.png', 'Desktop-Prototype.PNG'];
    expect((await previewsOf(in1(all)))[P1]).toBe(`${S1}/.design/Desktop-Prototype.PNG`);
    const rest = ['a-prototype.png', 'mobile-prototype.png', 'tablet-prototype.webp'];
    expect((await previewsOf(in1(rest)))[P1]).toBe(`${S1}/.design/tablet-prototype.webp`);
    expect((await previewsOf(in1(['b-prototype.png', 'a-prototype.jpg'])))[P1]).toBe(`${S1}/.design/a-prototype.jpg`);
  });

  test('preview: the exact <viewport>-prototype.<ext> wins over a longer name of the same viewport', async () => {
    // The shape of real repositories: `desktop-prototype-help.png` sorts before `desktop-prototype.png` by name.
    const real = ['desktop-prototype-help.png', 'desktop-prototype.png', 'mobile-prototype.png'];
    expect((await previewsOf(in1(real)))[P1]).toBe(`${S1}/.design/desktop-prototype.png`);
    expect((await previewsOf(in1(['mobile-prototype-a.png', 'mobile-prototype.png'])))[P1]).toBe(`${S1}/.design/mobile-prototype.png`);
  });

  test('preview: a prototype subfolder prefers names containing its folder name, else the whole candidate set', async () => {
    const design = `specs/${S2}/.design`;
    const added = [
      `${design}/desktop-prototype.png`,
      `${design}/mobile-prototype-board.png`,
      `${design}/prototype/list/index.html`,
      `${design}/desktop-prototype-list.png`,
      `${design}/tablet-prototype-list.png`,
      `${design}/prototype/detail/index.html`,
    ];
    expect(await previewsOf(added)).toEqual({
      [P1]: null,
      [P2]: `${S2}/.design/mobile-prototype-board.png`,
      [`${S2}/.design/prototype/detail`]: `${S2}/.design/desktop-prototype.png`,
      [`${S2}/.design/prototype/list`]: `${S2}/.design/desktop-prototype-list.png`,
    });
  });
});

// Symlinks are not followed (code review #6): a symbolic link at a fixed document path (spec.md, tech.md, …) or inside
// a zone is no document, wherever it points, and nothing is read through it.
describe('symlinks', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  test('symlinks: a linked tech.md or context.md is not in the catalog and lends it no title', async () => {
    const root = workspaceCopy();
    const outside = mkdtempSync(join(tmpdir(), 'spectant-outside-'));
    dirs.push(root, outside);
    writeFileSync(join(outside, 'secret.md'), '# Outside secret\n');
    rmSync(join(root, 'specs', 'tech.md'));
    symlinkSync(join(outside, 'secret.md'), join(root, 'specs', 'tech.md'));
    rmSync(join(root, 'specs', S1, 'context.md'));
    symlinkSync(join(outside, 'secret.md'), join(root, 'specs', S1, 'context.md'));
    const catalog = await readCatalog(root);
    expect(catalog.docs.filter((d) => d.path === 'tech.md' || d.path === `${S1}/context.md`)).toEqual([]);
    expect(catalog.docs.filter((d) => d.title === 'Outside secret').map((d) => d.path)).toEqual([]);
    expect(await catalogDocAt(root, 'tech.md')).toBeNull();
    expect(await catalogDocAt(root, `${S1}/context.md`)).toBeNull();
  });
});

// The documents alone (code review #8): `readCatalogDocs` lists exactly `readCatalog`'s documents without the
// dashboard reading, and `catalogDocAt` decides one path by the same zone rules without walking the tree.
describe('lookup', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** A copy with extra entries no rule lists: dot files, a backlog index, links to files and folders outside. */
  function trickyCopy(overrides: Readonly<Record<string, string>> = {}): string {
    const root = workspaceCopy(overrides);
    const outside = mkdtempSync(join(tmpdir(), 'spectant-outside-'));
    dirs.push(root, outside);
    writeFileSync(join(outside, 'secret.md'), '# Outside secret\n');
    mkdirSync(join(outside, 'folder'));
    writeFileSync(join(outside, 'folder', 'inner.md'), '# Inner secret\n');
    const specs = join(root, 'specs');
    writeFileSync(join(specs, 'ideas', 'README.md'), '# Backlog\n');
    writeFileSync(join(specs, S1, 'artifacts', '.hidden.md'), '# Hidden\n');
    writeFileSync(join(specs, S1, '.design', '.secret.png'), 'png');
    mkdirSync(join(specs, S1, '.evidence', '.cache'));
    writeFileSync(join(specs, S1, '.evidence', '.cache', 'x.md'), '# Cached\n');
    symlinkSync(join(outside, 'secret.md'), join(specs, S1, 'artifacts', 'link.md'));
    symlinkSync(join(outside, 'folder'), join(specs, S1, 'artifacts', 'linked'));
    symlinkSync(join(outside, 'secret.md'), join(specs, 'ideas', 'linked.md'));
    return root;
  }

  /** Every entry below `specs/` (files, folders and links, never followed), as paths relative to `specs/`. */
  function entriesBelow(dir: string, rel = ''): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      out.push(path);
      if (e.isDirectory()) out.push(...entriesBelow(join(dir, e.name), path));
    }
    return out;
  }

  test('lookup: readCatalogDocs lists exactly the documents of readCatalog', async () => {
    for (const root of [trickyCopy(), trickyCopy({ [`specs/${S1}/spec.md`]: '2026-03-14T12:00:00Z' })]) {
      expect(await readCatalogDocs(root)).toEqual((await readCatalog(root)).docs);
    }
  });

  test('lookup: catalogDocAt returns each listed document equal to the catalog entry, stale state included', async () => {
    for (const root of [trickyCopy(), trickyCopy({ [`specs/${S1}/spec.md`]: '2026-03-14T12:00:00Z' })]) {
      const docs = (await readCatalog(root)).docs.filter((d) => d.state !== 'missing');
      expect(docs.some((d) => d.state === 'stale')).toBe(true);
      for (const doc of docs) expect({ path: doc.path, doc: await catalogDocAt(root, doc.path) }).toEqual({ path: doc.path, doc });
    }
  });

  test('lookup: every entry below specs/ is a document exactly when the catalog lists it', async () => {
    const root = trickyCopy();
    const listed = new Map((await readCatalog(root)).docs.filter((d) => d.state !== 'missing').map((d) => [d.path, d]));
    const paths = entriesBelow(join(root, 'specs'));
    expect(paths.length).toBeGreaterThan(listed.size);
    for (const path of paths) expect({ path, doc: await catalogDocAt(root, path) }).toEqual({ path, doc: listed.get(path) ?? null });
  });

  test('lookup: archived: catalogDocAt finds each archived document as the catalog lists it', async () => {
    const root = trickyCopy();
    const docs = (await readCatalog(root)).docs.filter((d) => d.archived === true);
    expect(docs.length).toBe(ARCHIVED.length);
    for (const doc of docs) expect({ path: doc.path, doc: await catalogDocAt(root, doc.path) }).toEqual({ path: doc.path, doc });
  });

  test('lookup: unlisted paths are null — dot files, archive non-documents, links, other media, missing entries, malformed paths', async () => {
    const root = trickyCopy();
    const unlisted = [
      `${S1}/artifacts/.hidden.md`,
      `${S1}/.design/.secret.png`,
      `${S1}/.evidence/.cache/x.md`,
      `${S1}/.gates/reviewed.json`,
      `${S1}/events.jsonl`,
      `${S1}/report.html`,
      `${S1}/.evidence/ISC-1/run.log`,
      `${S1}/artifacts/data.json`,
      `${S1}/artifacts/link.md`,
      `${S1}/artifacts/linked`,
      `${S1}/artifacts/linked/inner.md`,
      `${S1}/.design/prototype/index.html`,
      `${S1}/.design/prototype/assets`,
      `${S1}/.design/prototype/assets/logo.png`,
      `${S2}/.design/prototype`,
      `${S2}/.design/prototype/src`,
      `${S2}/.design/prototype/src/README.md`,
      `${S2}/.design/prototype/board/notes.md`,
      `${S2}/plan.md`,
      `${S2}/tasks.md`,
      'archive',
      `archive/${A0}`,
      `archive/${A0}/events.jsonl`,
      'archive/999-nowhere/spec.md',
      `archive/${A0}/.design/prototype/index.html`,
      'tech/arch.png',
      'workflow.md',
      'tokens.jsonl',
      'ideas/README.md',
      'ideas/notes.txt',
      'ideas/linked.md',
      'ideas',
      S1,
      `${S1}/.design`,
      '',
      '/tech.md',
      '../README.md',
      `${S1}/../tech.md`,
      './tech.md',
      'tech.md/',
      `${S1}/.design/prototype/`,
      `${S1}//spec.md`,
      `${S1}\\spec.md`,
      '999-nowhere/spec.md',
    ];
    const missing = (await readCatalog(root)).docs.filter((d) => d.state === 'missing').map((d) => d.path);
    expect(missing).toEqual([`${S2}/plan.md`, `${S2}/tasks.md`]);
    for (const path of unlisted) expect({ path, doc: await catalogDocAt(root, path) }).toEqual({ path, doc: null });
  });
});

describe('worktree copy (spec 027, ISC-181)', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  /** Sets a file's time (ISO 8601). */
  const touch = (path: string, iso: string): void => {
    const at = new Date(Date.parse(iso));
    utimesSync(path, at, at);
  };

  /**
   * The fixture beside a copy of 001 and of 002 in a sibling folder, named in `copies` as the server's reading names a
   * worktree copy. 001's copy: spec.md edited on 2026-03-20, a retitled plan.md newer than it, a tasks.md with one more
   * ticked task older than it, no `artifacts/`. 002's copy: spec.md at `phase: complete`, so it lacks nothing.
   */
  const planted = (): { root: string; copies: Record<string, string> } => {
    const root = workspaceCopy();
    const sibling = mkdtempSync(join(tmpdir(), 'spectant-library-copy-'));
    dirs.push(root, sibling);
    const copies: Record<string, string> = {};
    for (const spec of [S1, S2]) {
      const copy = join(sibling, spec);
      cpSync(join(root, 'specs', spec), copy, { recursive: true });
      for (const path of filesBelow(copy)) touch(join(copy, path), new Date(timeOf(`specs/${spec}/${path}`)).toISOString());
      copies[spec] = copy;
    }
    const main = (spec: string, name: string): string => readFileSync(join(root, 'specs', spec, name), 'utf-8');
    const c1 = copies[S1] as string;
    writeFileSync(join(c1, 'plan.md'), main(S1, 'plan.md').replace('# Plan 001 — lighthouse-map', '# Plan 001 — lighthouse-map (copy)'));
    writeFileSync(join(c1, 'tasks.md'), main(S1, 'tasks.md').replace('- [ ] T3', '- [x] T3'));
    rmSync(join(c1, 'artifacts'), { recursive: true });
    touch(join(c1, 'plan.md'), '2026-03-21T09:00:00Z');
    touch(join(c1, 'tasks.md'), '2026-03-19T09:00:00Z');
    touch(join(c1, 'spec.md'), '2026-03-20T09:00:00Z');
    const c2 = copies[S2] as string;
    writeFileSync(join(c2, 'spec.md'), main(S2, 'spec.md').replace('phase: scoping', 'phase: complete'));
    touch(join(c2, 'spec.md'), '2026-03-09T10:00:00Z');
    return { root, copies };
  };

  const docOf = (catalog: LibraryCatalog, path: string): LibraryDoc | undefined => catalog.docs.find((d) => d.path === path);

  test('worktree copy: a spec named in copies lists its own files, stale, missing and heads from the copy', async () => {
    const { root, copies } = planted();
    const before = [treeHash(root), ...Object.values(copies).map((c) => treeHash(c))];
    const main = await readCatalog(root);
    const catalog = await readCatalog(root, undefined, { copies });
    expect([treeHash(root), ...Object.values(copies).map((c) => treeHash(c))]).toEqual(before);

    // specDocs: title and time of the copy's plan.md and tasks.md; the catalog path stays the spec's own.
    expect(docOf(catalog, `${S1}/plan.md`)).toMatchObject({ title: 'Plan 001 — lighthouse-map (copy)', modified: '2026-03-21T09:00:00.000Z', state: 'ok' });
    expect(docOf(main, `${S1}/plan.md`)).toMatchObject({ title: 'Plan 001 — lighthouse-map', state: 'stale' });
    // specMdTime: the copy's spec.md (2026-03-20) makes its tasks.md, design.md and the workspace's tech.md stale.
    expect(docOf(catalog, `${S1}/tasks.md`)).toMatchObject({ modified: '2026-03-19T09:00:00.000Z', state: 'stale' });
    expect(docOf(main, `${S1}/tasks.md`)?.state).toBe('ok');
    expect(docOf(catalog, `${S1}/design.md`)?.state).toBe('stale');
    expect(docOf(catalog, 'tech.md')?.state).toBe('stale');
    expect(docOf(main, 'tech.md')?.state).toBe('ok');
    // missingOf: the copy's spec.md is complete, so 002 lacks nothing; main's still lacks plan.md and tasks.md.
    expect(catalog.docs.filter((d) => d.spec === S2 && d.state === 'missing')).toEqual([]);
    expect(main.docs.filter((d) => d.spec === S2 && d.state === 'missing').map((d) => d.path)).toEqual([`${S2}/plan.md`, `${S2}/tasks.md`]);
    // specFilesOf: the head counts the copy's one more ticked task.
    const done = (c: LibraryCatalog): number | undefined => c.groups.find((g) => g.spec === S1)?.tasksDone;
    expect(done(main)).toBe(2);
    expect(done(catalog)).toBe(3);
    // `artifacts/` stays on the main checkout although the copy has none.
    const zone = (c: LibraryCatalog): LibraryDoc[] => c.docs.filter((d) => d.path.startsWith(`${S1}/artifacts/`));
    expect(zone(catalog)).toEqual(zone(main));
    expect(zone(catalog).length).toBeGreaterThan(0);
  });

  test('worktree copy: without copies, or with copies naming no active spec, the catalog is unchanged', async () => {
    const { root, copies } = planted();
    const main = await readCatalog(root);
    expect(await readCatalog(root, undefined, {})).toEqual(main);
    expect(await readCatalog(root, undefined, { copies: { '009-gone': copies[S1] as string } })).toEqual(main);
  });

  test('worktree copy: catalogSourceOf reads a spec own file from the copy, everything else from specs/', () => {
    const root = join(tmpdir(), 'w');
    const copy = join(root, '.worktrees', 'one', 'specs', S1);
    const copies = { [S1]: copy };
    const specs = join(root, 'specs');
    expect(catalogSourceOf(root, { path: `${S1}/plan.md`, spec: S1 }, copies)).toEqual({ dir: copy, rel: 'plan.md' });
    expect(catalogSourceOf(root, { path: `${S1}/spec.md`, spec: S1 }, copies)).toEqual({ dir: copy, rel: 'spec.md' });
    expect(catalogSourceOf(root, { path: `${S1}/artifacts/coverage.md`, spec: S1 }, copies)).toEqual({ dir: specs, rel: `${S1}/artifacts/coverage.md` });
    expect(catalogSourceOf(root, { path: `${S2}/plan.md`, spec: S2 }, copies)).toEqual({ dir: specs, rel: `${S2}/plan.md` });
    expect(catalogSourceOf(root, { path: 'tech.md', spec: 'workspace' }, copies)).toEqual({ dir: specs, rel: 'tech.md' });
    expect(catalogSourceOf(root, { path: `${S1}/plan.md`, spec: S1 })).toEqual({ dir: specs, rel: `${S1}/plan.md` });
  });
});
