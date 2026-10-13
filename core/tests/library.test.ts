// The document catalog of a workspace (spec 017, ISC-155): per spec its five Markdown files, every image or Markdown
// file under `artifacts/`, `.evidence/` and `.design/`, each folder in `.design/prototype/` that holds HTML pages as one
// `prototype` document; per workspace `constitution.md`, `tech.md`, `tldr.md` and `ideas/*.md`; nothing archived.
// The fixture `core/fixtures/library/` is copied to a temp directory and every mtime is set from `TIMES`, so the
// `modified` of each document is known and a checkout never changes a result. `readCatalog` only reads.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import type { LibraryCatalog, LibraryDoc } from '../src/files.ts';
import { readCatalog } from '../src/library.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const FIXTURE = join(FIXTURES, 'library');

/**
 * The file times the test sets, by path from the workspace root. Every file not named here gets `DEFAULT_TIME` plus
 * one minute per place in name order, all before 2026-03-02, so each named time is the newest of its folder; every
 * directory gets `DIRECTORY_TIME`, older than any file, so a prototype's time cannot come from its folder.
 */
const TIMES: Readonly<Record<string, string>> = {
  // 001: plan.md older than the spec's last events.jsonl line (2026-03-12T09:00Z), tasks.md and design.md newer.
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

/** The fixture copied to a temp directory with every time from `TIMES`. */
function workspaceCopy(): string {
  const root = mkdtempSync(join(tmpdir(), 'spectant-library-'));
  cpSync(FIXTURE, root, { recursive: true });
  for (const path of FILES) {
    const at = new Date(timeOf(path));
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
    expect(present.map(shape).sort(byPath)).toEqual(EXPECTED.map(shape).sort(byPath));
  });

  test('catalog: each document carries its modification time as ISO 8601, a prototype its newest file', () => {
    const times = present.map((d) => ({ path: d.path, modified: d.modified }));
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
    const prototypes = present.filter((d) => d.type === 'prototype');
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

  test('catalog: specs under specs/archive/ do not count', () => {
    expect(catalog.docs.filter((d) => d.path.startsWith('archive/') || d.spec === '000-first-light').map((d) => d.path)).toEqual(
      [],
    );
    expect(catalog.groups.filter((g) => g.spec === '000-first-light')).toEqual([]);
  });

  test('catalog: reading changes no byte of the workspace', () => {
    expect(treeHash(root)).toEqual(before);
  });
});
