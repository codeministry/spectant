// The document catalog of a workspace (spec 017, ISC-155): every document, artifact and prototype of its active specs
// plus the workspace documents, as metadata only. Per spec its five Markdown files, every image or Markdown file under
// `artifacts/`, `.evidence/` and `.design/`, and each folder in `.design/prototype/` that holds HTML pages directly as
// one `prototype` document; per workspace `specs/constitution.md`, `specs/tech.md`, `specs/tldr.md` and each story
// `specs/ideas/*.md`. Specs under `specs/archive/` never appear.
//
// Server-side module: it reads the file system through async node:fs/promises (readdir, stat, readFile), like
// `listEvidence`, so the barrel `index.ts` carries its types (in `files.ts`) but not `readCatalog`. Read-only: nothing
// is opened for writing, symlinks are not followed, dot files are skipped as in the evidence listing.
//
// Titles: the H1, else frontmatter `title:` (through `frontmatter.ts`, no second parser), else the file name; a
// prototype is named after its folder. `modified` is the file's mtime as ISO 8601, a prototype's its newest file.
// Every present document is listed `ok`; `stale` (ISC-155.1) and `missing` (ISC-155.2) are judged over the finished
// list in `judge`, the one place the later tasks extend.
import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseEvents } from './events.ts';
import { mediaTypeOf } from './evidence.ts';
import type { LibraryCatalog, LibraryDoc, LibraryDocType, LibraryMedia, TextFileKind } from './files.ts';
import { DESIGN_ASSETS, FILE_KINDS, repoFilePath } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { listSpecs } from './resolve.ts';

/** The folder every catalog path is relative to, from the repository root. */
const SPECS_DIR = 'specs';

/** A spec's own Markdown files in catalog order; the type of each is its file kind. */
const SPEC_DOCS: ReadonlyArray<TextFileKind & LibraryDocType> = ['spec', 'plan', 'tasks', 'design', 'context'];

/** The listed folders of a spec by their name on disk (from `files.ts`), each with the type of its files. */
const SPEC_ZONES: ReadonlyArray<readonly [string, LibraryDocType]> = [
  [FILE_KINDS.artifacts.path.replace(/\/$/, ''), 'artifact'],
  [FILE_KINDS.evidence.path.replace(/\/$/, ''), 'evidence'],
  [DESIGN_ASSETS, 'design'],
];

/** The prototype root below a spec folder; `.design/` is listed without it. */
const PROTOTYPE_ROOT = `${DESIGN_ASSETS}/prototype`;

/** The workspace documents below `specs/`, each with its type. */
const WORKSPACE_DOCS: ReadonlyArray<readonly [string, LibraryDocType]> = [
  [repoFilePath('', 'constitution').replace(/^specs\//, ''), 'constitution'],
  ['tech.md', 'tech'],
  ['tldr.md', 'tldr'],
];

/** The story folder below `specs/`; its `README.md` is the backlog index, not a story (as `readIdeas` reads it). */
const IDEAS_DIR = repoFilePath('', 'idea').replace(/^specs\//, '');
const IDEAS_INDEX = 'README.md';

/** The spec field of a document outside every spec folder. */
const WORKSPACE = 'workspace';

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** How a file shows in the reader by its name, or null when it is no catalog document (a log, JSON, a script). */
function mediaOf(name: string): Exclude<LibraryMedia, 'prototype'> | null {
  const type = mediaTypeOf(name);
  if (type === 'text/markdown') return 'markdown';
  return type.startsWith('image/') ? 'image' : null;
}

const isPage = (name: string): boolean => mediaTypeOf(name) === 'text/html';

/** The entries of a directory, dot files dropped; an unreadable or absent directory has none. */
async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

/** The mtime of a regular file as ISO 8601, or null when it is absent or not a regular file. */
async function mtimeOf(path: string): Promise<string | null> {
  try {
    const st = await stat(path);
    return st.isFile() ? st.mtime.toISOString() : null;
  } catch {
    return null;
  }
}

/**
 * The first ATX H1 of a Markdown body outside fenced code, trimmed, its closing `#`s dropped; null without one.
 * Only the heading line is matched; the Markdown itself is the renderer's (`markdown.ts`).
 */
function h1Of(body: string): string | null {
  let fence: string | null = null;
  for (const line of body.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence.charAt(0)) && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const title = /^ {0,3}#[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line)?.[1]?.trim();
    if (title !== undefined && title !== '') return title;
  }
  return null;
}

/** The title of a Markdown text: its H1, else frontmatter `title:`, else `name`. */
function titleOf(text: string, name: string): string {
  const fm = parseFrontmatter(text);
  const fromFrontmatter = fm.present ? fm.values.title?.trim() : undefined;
  return h1Of(fm.body) ?? (fromFrontmatter === undefined || fromFrontmatter === '' ? name : fromFrontmatter);
}

/** One present file as a document, or null when it vanished between the listing and the read. */
async function fileDoc(
  root: string,
  path: string,
  type: LibraryDocType,
  spec: string,
  media: Exclude<LibraryMedia, 'prototype'>,
): Promise<LibraryDoc | null> {
  const absolute = join(root, SPECS_DIR, path);
  const modified = await mtimeOf(absolute);
  if (modified === null) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  let title = name;
  if (media === 'markdown') {
    try {
      title = titleOf(await readFile(absolute, 'utf-8'), name);
    } catch {
      return null;
    }
  }
  return { path, type, spec, title, modified, state: 'ok', media };
}

/** Every regular file below `dir` (relative path `rel` from `specs/`), recursively; `skip` names folders left out. */
async function filesBelow(dir: string, rel: string, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await entriesOf(dir)) {
    const path = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!skip.has(path)) out.push(...(await filesBelow(join(dir, entry.name), path)));
    } else if (entry.isFile()) out.push(path);
  }
  return out;
}

/** The newest mtime of the regular files below `dir`, as ISO 8601; null without any. */
async function newestBelow(dir: string): Promise<string | null> {
  let newest: number | null = null;
  for (const path of await filesBelow(dir, '')) {
    try {
      const ms = (await stat(join(dir, path))).mtimeMs;
      if (newest === null || ms > newest) newest = ms;
    } catch {
      // Vanished between the listing and the read: it is no part of the prototype.
    }
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * The prototypes in or below `dir` (relative path `rel` from `specs/`): a folder holding HTML pages directly is one
 * document and everything below it belongs to it; a folder without pages is no document and none of its files is
 * an entry, while each of its subfolders is judged by the same rule.
 */
async function prototypesIn(dir: string, rel: string, spec: string): Promise<LibraryDoc[]> {
  const entries = await entriesOf(dir);
  const pages = entries.filter((e) => e.isFile() && isPage(e.name)).map((e) => e.name).sort(byName);
  if (pages.length > 0) {
    const modified = await newestBelow(dir);
    if (modified === null) return [];
    const title = rel.slice(rel.lastIndexOf('/') + 1);
    // `preview` (the screenshot in the spec's `.design/`) is ISC-159's to judge; left out here.
    return [{ path: rel, type: 'prototype', spec, title, modified, state: 'ok', media: 'prototype', pages }];
  }
  const out: LibraryDoc[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(...(await prototypesIn(join(dir, entry.name), `${rel}/${entry.name}`, spec)));
  }
  return out;
}

/** The documents of one active spec folder `specs/<spec>/`, in catalog order. */
async function specDocs(root: string, spec: string): Promise<LibraryDoc[]> {
  const specDir = join(root, SPECS_DIR, spec);
  const own = await Promise.all(SPEC_DOCS.map((kind) => fileDoc(root, `${spec}/${FILE_KINDS[kind].path}`, kind, spec, 'markdown')));

  const zoned: LibraryDoc[] = [];
  const prototypeRoot = `${spec}/${PROTOTYPE_ROOT}`;
  for (const [folder, type] of SPEC_ZONES) {
    // `.design/prototype/` is not part of the design zone: its folders are prototypes, or nothing.
    const files = await filesBelow(join(specDir, folder), `${spec}/${folder}`, new Set([prototypeRoot]));
    const docs = await Promise.all(
      files.map(async (path) => {
        const media = mediaOf(path.slice(path.lastIndexOf('/') + 1));
        return media === null ? null : fileDoc(root, path, type, spec, media);
      }),
    );
    zoned.push(...docs.filter((d): d is LibraryDoc => d !== null).sort(byPath));
  }
  const prototypes = (await prototypesIn(join(specDir, PROTOTYPE_ROOT), prototypeRoot, spec)).sort(byPath);

  return [...own.filter((d): d is LibraryDoc => d !== null), ...zoned, ...prototypes];
}

/** The workspace documents: the three files below `specs/`, then each story `specs/ideas/*.md` in name order. */
async function workspaceDocs(root: string): Promise<LibraryDoc[]> {
  const fixed = await Promise.all(WORKSPACE_DOCS.map(([path, type]) => fileDoc(root, path, type, WORKSPACE, 'markdown')));
  const stories = (await entriesOf(join(root, SPECS_DIR, IDEAS_DIR)))
    .filter((e) => e.isFile() && e.name !== IDEAS_INDEX && mediaOf(e.name) === 'markdown')
    .map((e) => e.name)
    .sort(byName);
  const ideas = await Promise.all(stories.map((name) => fileDoc(root, `${IDEAS_DIR}/${name}`, 'idea', WORKSPACE, 'markdown')));
  return [...fixed, ...ideas].filter((d): d is LibraryDoc => d !== null);
}

/** A spec's own documents that derive from its `spec.md` (ISC-155.1), by path below the spec folder. */
const FROM_SPEC: ReadonlySet<string> = new Set((['plan', 'tasks', 'design'] as const).map((kind) => FILE_KINDS[kind].path));

/** The workspace documents that derive from the newest spec of the workspace (ISC-155.1). */
const FROM_NEWEST_SPEC: ReadonlySet<LibraryDocType> = new Set<LibraryDocType>(['tech', 'tldr']);

/**
 * The time of one spec in ms (ISC-155.1): its newest valid `events.jsonl` line (read through `events.ts`), else the
 * mtime of its `spec.md` from the listed documents; null when it has neither.
 */
async function specTime(root: string, spec: string, docs: readonly LibraryDoc[]): Promise<number | null> {
  let text = '';
  try {
    text = await readFile(join(root, SPECS_DIR, spec, FILE_KINDS.events.path), 'utf-8');
  } catch {
    // No events.jsonl: the spec.md mtime stands in.
  }
  const stamps = parseEvents(text).events.map((e) => Date.parse(e.ts));
  if (stamps.length > 0) return Math.max(...stamps);
  const own = docs.find((d) => d.spec === spec && d.path === `${spec}/${FILE_KINDS.spec.path}`);
  return own?.modified == null ? null : Date.parse(own.modified);
}

/**
 * The state judgement over the finished list. `stale` (ISC-155.1): `plan.md`, `tasks.md` and `design.md` older than
 * the time of their spec, `tech.md` and `tldr.md` older than the newest time of any active spec; a document as old as
 * its source is fresh. ISC-155.2 adds the `missing` entries here; both read only what `readCatalog` already listed plus
 * each spec's `events.jsonl`.
 */
async function judge(root: string, specs: readonly string[], docs: readonly LibraryDoc[]): Promise<readonly LibraryDoc[]> {
  const times = new Map<string, number | null>(await Promise.all(specs.map(async (s) => [s, await specTime(root, s, docs)] as const)));
  const known = [...times.values()].filter((t): t is number => t !== null);
  const newest = known.length > 0 ? Math.max(...known) : null;

  const sourceOf = (d: LibraryDoc): number | null => {
    if (d.spec === WORKSPACE) return FROM_NEWEST_SPEC.has(d.type) ? newest : null;
    return FROM_SPEC.has(d.path.slice(d.spec.length + 1)) ? (times.get(d.spec) ?? null) : null;
  };
  return docs.map((d) => {
    const source = sourceOf(d);
    const stale = d.state === 'ok' && d.modified !== null && source !== null && Date.parse(d.modified) < source;
    return stale ? { ...d, state: 'stale' } : d;
  });
}

/**
 * The document catalog of the workspace at `root` (the repository root holding `specs/`): the workspace documents,
 * then each active spec in number order with its documents. Metadata only, never the content. A workspace without
 * `specs/` has an empty catalog. Reads only.
 */
export async function readCatalog(root: string): Promise<LibraryCatalog> {
  const specs = listSpecs(root).filter((s) => !s.archived);
  const perSpec = await Promise.all(specs.map((s) => specDocs(root, s.slug)));
  const docs = await judge(
    root,
    specs.map((s) => s.slug),
    [...(await workspaceDocs(root)), ...perSpec.flat()],
  );
  return {
    docs,
    // The group heads (ISC-157) and the open fog lines come with their own tasks.
    groups: [],
    fog: [],
    missing: docs.filter((d) => d.state === 'missing').length,
    stale: docs.filter((d) => d.state === 'stale').length,
  };
}
