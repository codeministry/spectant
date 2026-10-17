// The document catalog of a workspace (spec 017, ISC-155): every document, artifact and prototype of its active specs
// plus the workspace documents, as metadata only. Per spec its five Markdown files, every image or Markdown file under
// `artifacts/`, `.evidence/` and `.design/`, and each folder in `.design/prototype/` that holds HTML pages directly as
// one `prototype` document; per workspace `specs/constitution.md`, `specs/tech.md`, `specs/tldr.md` and each story
// `specs/ideas/*.md`. An archived spec `specs/archive/NNN-slug/` is listed by the same rules after the active ones (spec
// 034, ISC-187): every path below `archive/NNN-slug/`, `spec` its folder name, `archived: true`, never `stale` or `missing`.
//
// Server-side module: it reads the file system through async node:fs/promises (readdir, lstat, readFile), like
// `listEvidence`, so the barrel `index.ts` carries its types (in `files.ts`) but not `readCatalog`. Read-only: nothing
// is opened for writing, symlinks are not followed (every file and folder is checked with lstat, so a link at a fixed
// path, in a zone or in place of a listed folder is no document and nothing is read through it), dot files are skipped
// as in the evidence listing.
//
// Titles: the H1, else frontmatter `title:` (through `frontmatter.ts`, no second parser), else the file name; a
// prototype is named after its folder. `modified` is the file's mtime as ISO 8601, a prototype's its newest file. A
// prototype's `preview` (ISC-159) is a screenshot directly in its spec's `.design/` whose name contains `prototype`.
// Every present document is listed `ok`; `stale` (ISC-155.1, a source `spec.md` modified more than
// `STALE_TOLERANCE_MS` after the document) and `missing` (ISC-155.2) are judged over the finished list in `judge`.
// `readCatalogDocs` is that list alone; `catalogDocAt` decides one path by the same rules without walking the tree. The
// group heads and open fog lines (ISC-157) come from the dashboard model and the tech page's sources in `groupsOf`.
//
// Worktree copies (spec 027, ISC-181): the caller may name, per active spec, the folder its files are read from
// (`CatalogOptions.copies`, the server's `WorkspaceReading.copies`). The kinds of `WORKTREE_COPY_KINDS` then come from
// that folder (the five own Markdown files, `spec.md` for the stale and missing rules, the texts of the stage input);
// `artifacts/`, `.evidence/`, `.design/` and the workspace documents stay on the main checkout, and every catalog path
// stays `NNN-slug/<file>` below `specs/`. `catalogSourceOf` resolves a listed path the same way.
import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseClaims } from './claims.ts';
import { buildDashboard, type DashboardInput } from './dashboard.ts';
import { mediaTypeOf } from './evidence.ts';
import type { FileKind, LibraryCatalog, LibraryDoc, LibraryDocType, LibraryFogLine, LibraryMedia, SpecFiles, SpecGroupHead, TextFileKind } from './files.ts';
import { DESIGN_ASSETS, FILE_KINDS, repoFilePath } from './files.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { readLockSources } from './locks.ts';
import { listSpecs } from './resolve.ts';
import type { Stage, StageInput } from './stage.ts';
import { SPEC_RULES } from './stage.ts';
import { techSourcesOf } from './tech.ts';
import { parseWorkflow } from './workflow.ts';
import { WORKTREE_COPY_KINDS } from './worktrees.ts';

/** The folder every catalog path is relative to, from the repository root. */
const SPECS_DIR = 'specs';

/** The archive below `specs/`; an archived spec's documents have paths below `archive/NNN-slug/` (ISC-187). */
const ARCHIVE_DIR = 'archive';

/** The per-spec read sources of a catalog read (spec 027, ISC-181); without `copies` every file comes from `specs/`. */
export interface CatalogOptions {
  /** Per active spec folder (`NNN-slug`), the absolute folder its `WORKTREE_COPY_KINDS` are read from. */
  readonly copies?: Readonly<Record<string, string>>;
}

/** The folder one kind of `spec` is read from: its copy's for a `WORKTREE_COPY_KINDS` kind named in `copies`, else main's. */
function folderOf(root: string, spec: string, kind: FileKind, copies: CatalogOptions['copies']): string {
  const copy = copies?.[spec];
  return copy !== undefined && WORKTREE_COPY_KINDS.includes(kind) ? copy : join(root, SPECS_DIR, spec);
}

/**
 * The copies whose folder still exists (spec 041, ISC-217): a worktree removed between reading the copies and reading
 * the catalog leaves its spec read from main, never briefly without documents. The check follows a link, so a copy
 * folder linked out stays a copy and is refused where its files are resolved (ISC-216.1).
 */
async function presentCopies(copies: CatalogOptions['copies']): Promise<CatalogOptions['copies']> {
  if (copies === undefined) return undefined;
  const entries = await Promise.all(
    Object.entries(copies).map(async ([spec, dir]) => {
      try {
        return (await stat(dir)).isDirectory() ? ([[spec, dir]] as const) : [];
      } catch {
        return [];
      }
    }),
  );
  return Object.fromEntries(entries.flat());
}

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

/** Whether `path` is a real directory, never a symbolic link to one. */
async function isRealDir(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The entries of a real directory, dot files dropped; an unreadable or absent directory, or a symbolic link to one,
 * has none. The entries' own types come from the listing, so a linked file or folder is neither `isFile` nor
 * `isDirectory`.
 */
async function entriesOf(dir: string): Promise<Dirent[]> {
  if (!(await isRealDir(dir))) return [];
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
  } catch {
    return [];
  }
}

/** The mtime of a regular file in ms, or null when it is absent, a symbolic link or not a regular file. */
async function mtimeMsOf(path: string): Promise<number | null> {
  try {
    const st = await lstat(path);
    return st.isFile() ? st.mtimeMs : null;
  } catch {
    return null;
  }
}

/** The mtime of a regular file as ISO 8601, or null as `mtimeMsOf`. */
async function mtimeOf(path: string): Promise<string | null> {
  const ms = await mtimeMsOf(path);
  return ms === null ? null : new Date(ms).toISOString();
}

/** The text of a regular file, or null when it is absent, a symbolic link or no regular file: nothing is read through a link. */
async function regularText(path: string): Promise<string | null> {
  if ((await mtimeMsOf(path)) === null) return null;
  try {
    return await readFile(path, 'utf-8');
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

/** One present file as a document, or null when it vanished between the listing and the read; read at `absolute`. */
async function fileDoc(
  root: string,
  path: string,
  type: LibraryDocType,
  spec: string,
  media: Exclude<LibraryMedia, 'prototype'>,
  absolute: string = join(root, SPECS_DIR, path),
): Promise<LibraryDoc | null> {
  const modified = await mtimeOf(absolute);
  if (modified === null) return null;
  const name = path.slice(path.lastIndexOf('/') + 1);
  let title = name;
  if (media === 'markdown') {
    const text = await regularText(absolute);
    if (text === null) return null;
    title = titleOf(text, name);
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
    // Null when it vanished between the listing and the read: it is no part of the prototype.
    const ms = await mtimeMsOf(join(dir, path));
    if (ms !== null && (newest === null || ms > newest)) newest = ms;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** The word a prototype screenshot's name contains (spec 017 § Constraints), lower case. */
const PREVIEW_WORD = 'prototype';

/** The viewport prefixes of a screenshot's name, in the order a preview prefers them. */
const VIEWPORTS: readonly string[] = ['desktop-', 'tablet-', 'mobile-'];

/**
 * The preview candidates of a spec (ISC-159): the image files directly in its `.design/` whose name contains
 * `prototype`, case-insensitive, in name order. Subfolders, prototype folders included, never count; dot files and
 * symbolic links are skipped as everywhere in the catalog.
 */
async function previewCandidates(specDir: string): Promise<string[]> {
  return (await entriesOf(join(specDir, DESIGN_ASSETS)))
    .filter((e) => e.isFile() && mediaOf(e.name) === 'image' && e.name.toLowerCase().includes(PREVIEW_WORD))
    .map((e) => e.name)
    .sort(byName);
}

/**
 * The preview of one prototype (ISC-159), as a path relative to `specs/`, or null without a candidate. A prototype in
 * a subfolder `.design/prototype/<sub>` keeps only the candidates whose name contains <sub> when there are any; then a
 * name starting with `desktop-` wins over `tablet-`, over `mobile-`, over any other; within one viewport the exact
 * `<viewport>prototype.<ext>` (`prototype.<ext>` without one) wins; then name order.
 */
function previewOf(candidates: readonly string[], rel: string, folder: string): string | null {
  const sub = rel === `${folder}/${PROTOTYPE_ROOT}` ? null : rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
  const own = sub === null ? [] : candidates.filter((name) => name.toLowerCase().includes(sub));
  const pool = own.length > 0 ? own : candidates;
  const tierOf = (lower: string): number => {
    const at = VIEWPORTS.findIndex((v) => lower.startsWith(v));
    return at < 0 ? VIEWPORTS.length : at;
  };
  const rank = (name: string): readonly [number, number] => {
    const lower = name.toLowerCase();
    const tier = tierOf(lower);
    const stem = lower.slice(0, lower.lastIndexOf('.'));
    return [tier, stem === `${VIEWPORTS[tier] ?? ''}${PREVIEW_WORD}` ? 0 : 1];
  };
  const best = [...pool].sort((a, b) => {
    const [ta, ea] = rank(a);
    const [tb, eb] = rank(b);
    return ta - tb || ea - eb || byName(a, b);
  })[0];
  return best === undefined ? null : `${folder}/${DESIGN_ASSETS}/${best}`;
}

/** The HTML pages directly among a folder's entries, in name order: a prototype folder has at least one. */
const pagesIn = (entries: readonly Dirent[]): string[] =>
  entries
    .filter((e) => e.isFile() && isPage(e.name))
    .map((e) => e.name)
    .sort(byName);

/** One prototype folder `dir` (relative path `rel`) with its `pages` as a document; null when no file is left in it. */
async function prototypeDoc(
  dir: string,
  rel: string,
  spec: string,
  candidates: readonly string[],
  pages: readonly string[],
  folder: string = spec,
): Promise<LibraryDoc | null> {
  const modified = await newestBelow(dir);
  if (modified === null) return null;
  const title = rel.slice(rel.lastIndexOf('/') + 1);
  const preview = previewOf(candidates, rel, folder);
  return { path: rel, type: 'prototype', spec, title, modified, state: 'ok', media: 'prototype', pages: [...pages], preview };
}

/**
 * The prototypes in or below `dir` (relative path `rel` from `specs/`): a folder holding HTML pages directly is one
 * document and everything below it belongs to it; a folder without pages is no document and none of its files is
 * an entry, while each of its subfolders is judged by the same rule. `candidates` are the spec's preview candidates.
 */
async function prototypesIn(dir: string, rel: string, spec: string, candidates: readonly string[], folder: string = spec): Promise<LibraryDoc[]> {
  const entries = await entriesOf(dir);
  const pages = pagesIn(entries);
  if (pages.length > 0) {
    const doc = await prototypeDoc(dir, rel, spec, candidates, pages, folder);
    return doc === null ? [] : [doc];
  }
  const out: LibraryDoc[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(...(await prototypesIn(join(dir, entry.name), `${rel}/${entry.name}`, spec, candidates, folder)));
  }
  return out;
}

/**
 * The documents of one spec folder in catalog order: an active spec `specs/<spec>/` with its own files from their read
 * source, or with `folder` `archive/<spec>` an archived one (ISC-187), every path below that folder and always from it.
 */
async function specDocs(root: string, spec: string, copies: CatalogOptions['copies'], folder: string = spec): Promise<LibraryDoc[]> {
  const specDir = join(root, SPECS_DIR, folder);
  const own = await Promise.all(
    SPEC_DOCS.map((kind) => {
      const file = FILE_KINDS[kind].path;
      const source = folder === spec ? folderOf(root, spec, kind, copies) : specDir;
      return fileDoc(root, `${folder}/${file}`, kind, spec, 'markdown', join(source, file));
    }),
  );

  const zoned: LibraryDoc[] = [];
  const prototypeRoot = `${folder}/${PROTOTYPE_ROOT}`;
  for (const [zone, type] of SPEC_ZONES) {
    // `.design/prototype/` is not part of the design zone: its folders are prototypes, or nothing.
    const files = await filesBelow(join(specDir, zone), `${folder}/${zone}`, new Set([prototypeRoot]));
    const docs = await Promise.all(
      files.map(async (path) => {
        const media = mediaOf(path.slice(path.lastIndexOf('/') + 1));
        return media === null ? null : fileDoc(root, path, type, spec, media);
      }),
    );
    zoned.push(...docs.filter((d): d is LibraryDoc => d !== null).sort(byPath));
  }
  const candidates = await previewCandidates(specDir);
  const prototypes = (await prototypesIn(join(specDir, PROTOTYPE_ROOT), prototypeRoot, spec, candidates, folder)).sort(byPath);

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
 * How much later than a derived document its source may have been modified before the document reads `stale`
 * (ISC-155.1): a `git checkout` rewrites every mtime within moments, in no particular order, and must not colour fresh
 * documents.
 */
export const STALE_TOLERANCE_MS = 60_000;

/** The mtime in ms of one active spec's `spec.md` (a regular file, never a link) from its read source, or null without one. */
const specMdTime = (root: string, spec: string, copies: CatalogOptions['copies']): Promise<number | null> =>
  mtimeMsOf(join(folderOf(root, spec, 'spec', copies), FILE_KINDS.spec.path));

/** The newest `spec.md` mtime of the given active specs, or null when none has one. */
async function newestSpecMdTime(root: string, specs: readonly string[], copies: CatalogOptions['copies']): Promise<number | null> {
  const known = (await Promise.all(specs.map((s) => specMdTime(root, s, copies)))).filter((t): t is number => t !== null);
  return known.length > 0 ? Math.max(...known) : null;
}

/** Which source a document derives from (ISC-155.1): its spec's `spec.md`, the newest `spec.md`, or nothing. */
function derivesFrom(d: LibraryDoc): 'spec' | 'newest' | null {
  if (d.spec === WORKSPACE) return FROM_NEWEST_SPEC.has(d.type) ? 'newest' : null;
  return FROM_SPEC.has(d.path.slice(d.spec.length + 1)) ? 'spec' : null;
}

/** `d` judged against its source's mtime: `stale` when the source was modified more than the tolerance after it. */
function judgeStale(d: LibraryDoc, source: number | null): LibraryDoc {
  const stale = d.state === 'ok' && d.modified !== null && source !== null && source - Date.parse(d.modified) > STALE_TOLERANCE_MS;
  return stale ? { ...d, state: 'stale' } : d;
}

/** The documents a spec's type can ask for (ISC-155.2), in the order of the spec's own files. */
const NEEDED: ReadonlyArray<'plan' | 'tasks'> = ['plan', 'tasks'];

/** Whether any row of the stage table for `stage` matches `input`, each row's condition taken on its own. */
const rowMatches = (stage: Stage, input: StageInput): boolean => SPEC_RULES.some((rule) => rule.stage === stage && rule.when(input));

/**
 * The documents one active spec lacks (ISC-155.2), as `missing` entries: none for a spec without `spec.md` or a done
 * one, else each of `plan.md` and `tasks.md` whose own row of the stage table (stage.ts, `plan` and `tasks`, over
 * `TYPE_NEEDS` and the three-claim threshold) would stop the spec there. The input is the one the timeline replay
 * builds from the files (derived-stages.ts): every claim line counts, dropped ones included, as the dashboard's
 * partition counts them; the review and code-review marks decide no row asked here.
 */
async function missingOf(root: string, spec: string, docs: readonly LibraryDoc[], copies: CatalogOptions['copies']): Promise<LibraryDoc[]> {
  const text = await regularText(join(folderOf(root, spec, 'spec', copies), FILE_KINDS.spec.path));
  if (text === null) return [];
  const fm = parseFrontmatter(text);
  const total = parseClaims(text).claims.length;
  const has = (kind: 'plan' | 'tasks'): boolean => docs.some((d) => d.spec === spec && d.path === `${spec}/${FILE_KINDS[kind].path}`);
  const input: StageInput = {
    number: spec.slice(0, 3),
    type: fm.data.specType,
    phase: fm.data.phase,
    hasPlan: has('plan'),
    hasTasks: has('tasks'),
    claims: { closed: 0, total },
    reviewed: 'missing',
    codeReviewed: 'missing',
    takeable: [],
    partition: { takeable: 0, open: total, closed: 0, dropped: 0 },
    explicitStage: null,
    lastEventTo: null,
    codeReview: 'spec',
    mainFeature: null,
    featureSiblingsOpen: [],
  };
  if (rowMatches('done', input)) return [];
  return NEEDED.filter((kind) => rowMatches(kind, input)).map((kind): LibraryDoc => {
    const path = `${spec}/${FILE_KINDS[kind].path}`;
    return { path, type: kind, spec, title: path.slice(path.lastIndexOf('/') + 1), modified: null, state: 'missing', media: 'markdown' };
  });
}

/** A spec's own Markdown files by their path below the spec folder, in catalog order (`SPEC_DOCS`). */
const OWN_RANK: ReadonlyMap<string, number> = new Map(SPEC_DOCS.map((kind, i) => [FILE_KINDS[kind].path, i]));

/**
 * `docs` with each `missing` entry where its file would stand: among its spec's own files in `SPEC_DOCS` order, after
 * every own file that comes before it, and before the spec's zones and prototypes.
 */
function placeMissing(docs: readonly LibraryDoc[], missing: readonly LibraryDoc[]): LibraryDoc[] {
  const out = [...docs];
  const rankOf = (d: LibraryDoc): number => (d.spec === WORKSPACE ? -1 : (OWN_RANK.get(d.path.slice(d.spec.length + 1)) ?? SPEC_DOCS.length));
  for (const m of missing) {
    const rank = rankOf(m);
    const first = out.findIndex((d) => d.spec === m.spec);
    let at = first < 0 ? out.length : first;
    while (at < out.length && out[at]?.spec === m.spec && rankOf(out[at] as LibraryDoc) < rank) at++;
    out.splice(at, 0, m);
  }
  return out;
}

/**
 * The state judgement over the finished list. `stale` (ISC-155.1): `plan.md`, `tasks.md` and `design.md` whose spec's
 * `spec.md` was modified more than `STALE_TOLERANCE_MS` after them, `tech.md` and `tldr.md` likewise against the newest
 * `spec.md` of the active specs; `events.jsonl` plays no part, since a stage event is no edit of the spec. `missing`
 * (ISC-155.2): the entries `missingOf` adds for each active spec, placed by `placeMissing`. Both read only the mtimes
 * and texts of the specs' `spec.md` files, from each spec's read source (`copies`), beside what `readCatalogDocs`
 * already listed.
 */
async function judge(
  root: string,
  specs: readonly string[],
  docs: readonly LibraryDoc[],
  copies: CatalogOptions['copies'],
): Promise<readonly LibraryDoc[]> {
  const times = new Map<string, number | null>(await Promise.all(specs.map(async (s) => [s, await specMdTime(root, s, copies)] as const)));
  const known = [...times.values()].filter((t): t is number => t !== null);
  const newest = known.length > 0 ? Math.max(...known) : null;
  const judged = docs.map((d): LibraryDoc => {
    const from = derivesFrom(d);
    return judgeStale(d, from === 'newest' ? newest : from === 'spec' ? (times.get(d.spec) ?? null) : null);
  });
  const missing = await Promise.all(specs.map((s) => missingOf(root, s, docs, copies)));
  return placeMissing(judged, missing.flat());
}

/** The text file kinds inside a spec folder, as the server's workspace loader reads each folder. */
const FOLDER_KINDS = (Object.keys(FILE_KINDS) as TextFileKind[]).filter((kind) => !FILE_KINDS[kind].directory && !FILE_KINDS[kind].path.startsWith('..'));

/** A file's text, or null when it cannot be read (absent, a directory, vanished). */
async function textOf(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * The texts of one active spec folder, a missing file an absent key, as `buildDashboard` and `readTech` take them; the
 * `WORKTREE_COPY_KINDS` from the spec's copy when `copies` names one, as the server's loader reads the folder.
 */
async function specFilesOf(root: string, spec: string, copies: CatalogOptions['copies']): Promise<SpecFiles> {
  const texts: Partial<Record<TextFileKind, string>> = {};
  await Promise.all(
    FOLDER_KINDS.map(async (kind) => {
      const text = await textOf(join(folderOf(root, spec, kind, copies), FILE_KINDS[kind].path));
      if (text !== null) texts[kind] = text;
    }),
  );
  return { folder: spec, texts };
}

/**
 * The part of the dashboard model's input a stage depends on, read from the files when the caller passes none: the
 * active spec folders, `specs/workflow.md` through `parseWorkflow` and the repository's own lock source through
 * `readLockSources` (no LifeOS directory). The worktree tree id needs git, which `core/` never runs, so it is null here
 * and a code-reviewed mark reads stale; the server passes its own reading, which carries it.
 */
async function stageInputOf(root: string, specs: readonly string[], copies: CatalogOptions['copies']): Promise<DashboardInput> {
  return {
    master: null,
    constitution: null,
    tldr: null,
    specs: await Promise.all(specs.map((s) => specFilesOf(root, s, copies))),
    archived: [],
    worktreeTree: null,
    locks: await readLockSources({ repoRoot: root, lifeosStateDir: null }),
    workflow: parseWorkflow(await textOf(repoFilePath(root, 'workflow'))),
  };
}

/**
 * The group heads and the open fog lines (ISC-157): what the former tech page's Status, Specs and Open tabs showed,
 * taken from the same two models, never derived again. Type, stage, claims and tasks are the dashboard row's
 * (`buildDashboard` over `input`), the fog count, goal, approach and fog lines the tech page's (`techSourcesOf`, the
 * Markdown sources `readTech` renders). One head per active spec with a row (a folder without spec.md has none), in
 * folder order; the fog lines of each spec not complete under its folder, in the same order.
 */
function groupsOf(input: DashboardInput): { groups: SpecGroupHead[]; fog: LibraryFogLine[] } {
  const rows = new Map(buildDashboard(input).specs.map((row) => [row.slug, row]));
  const folders = [...input.specs].sort((a, b) => byName(a.folder, b.folder));
  const groups: SpecGroupHead[] = [];
  const fog: LibraryFogLine[] = [];
  for (const f of folders) {
    const row = rows.get(f.folder);
    if (row === undefined || f.texts.spec === undefined) continue;
    const sources = techSourcesOf(f.texts.spec, f.texts.plan);
    const tasks = row.tasks ?? { landed: 0, total: 0 };
    groups.push({
      spec: f.folder,
      type: row.type,
      stage: row.stage,
      claimsClosed: row.progress.closed,
      claimsTotal: row.progress.total,
      tasksDone: tasks.landed,
      tasksTotal: tasks.total,
      fog: sources.fog.length,
      goal: sources.goal,
      approach: sources.approach,
    });
    fog.push(...sources.fog.map((text): LibraryFogLine => ({ spec: f.folder, text })));
  }
  return { groups, fog };
}

/**
 * The document catalog of the workspace at `root` (the repository root holding `specs/`): the workspace documents,
 * then each active spec in number order with its documents, then each archived spec's (ISC-187, never judged), plus one
 * group head per active spec and the open fog
 * lines. Metadata only, never a document's content (goal and approach are the heads' own short Markdown). A workspace
 * without `specs/` has an empty catalog. `input` is the dashboard model's input as the server read it for the same
 * workspace (`readWorkspaceInput`), so the heads' stages equal the dashboard's to the code-reviewed mark; without it
 * the stage input is read from the files (`stageInputOf`). Its active specs are those `listSpecs` finds. `options.copies`
 * names the worktree copies a spec's own files are read from (spec 027, ISC-181); without it, all from `specs/`.
 * Reads only.
 */
export async function readCatalog(root: string, input?: DashboardInput, options: CatalogOptions = {}): Promise<LibraryCatalog> {
  const copies = await presentCopies(options.copies);
  const docs = await readCatalogDocs(root, { copies });
  const { groups, fog } = groupsOf(input ?? (await stageInputOf(root, activeSpecs(root), copies)));
  return {
    docs,
    groups,
    fog,
    missing: docs.filter((d) => d.state === 'missing').length,
    stale: docs.filter((d) => d.state === 'stale').length,
  };
}

/** The own Markdown files of a spec by their path below its folder, each with its kind. */
const OWN_KIND: ReadonlyMap<string, TextFileKind> = new Map(SPEC_DOCS.map((kind) => [FILE_KINDS[kind].path, kind]));

/**
 * Where the file of one catalog document is read (spec 027, ISC-181), as the folder `dir` and the path `rel` below it:
 * a spec's own Markdown file from the worktree copy `copies` names for its spec, the way `readCatalog` listed it;
 * every other document, and every document without a copy, from `<root>/specs` with its catalog path.
 */
export function catalogSourceOf(
  root: string,
  doc: Pick<LibraryDoc, 'path' | 'spec'>,
  copies: CatalogOptions['copies'] = {},
): { dir: string; rel: string } {
  const own = doc.spec === WORKSPACE || !doc.path.startsWith(`${doc.spec}/`) ? undefined : OWN_KIND.get(doc.path.slice(doc.spec.length + 1));
  // A copy by the copies themselves (spec 041, ISC-217), never by comparing folder names: the spec has a copy, and the
  // kind is one the copy holds.
  const copy = own === undefined ? undefined : copies[doc.spec];
  if (own === undefined || copy === undefined || !WORKTREE_COPY_KINDS.includes(own)) return { dir: join(root, SPECS_DIR), rel: doc.path };
  return { dir: copy, rel: FILE_KINDS[own].path };
}

/** The active spec folders of the workspace at `root`, as `listSpecs` finds them (real directories, never archived). */
const activeSpecs = (root: string): string[] =>
  listSpecs(root)
    .filter((s) => !s.archived)
    .map((s) => s.slug);

/** The archived spec folders below `specs/archive/` (ISC-187), in number order, as `listSpecs` finds them. */
const archivedSpecs = (root: string): string[] =>
  listSpecs(root)
    .filter((s) => s.archived)
    .map((s) => s.slug);

/** One archived document: flagged, and never judged (ISC-187), so it stays `ok` and outside both control numbers. */
const asArchived = (d: LibraryDoc): LibraryDoc => ({ ...d, archived: true });

/** The documents of one archived spec `specs/archive/<spec>/`, by the zone rules of an active one. */
async function archivedDocs(root: string, spec: string): Promise<LibraryDoc[]> {
  return (await specDocs(root, spec, undefined, `${ARCHIVE_DIR}/${spec}`)).map(asArchived);
}

/**
 * The catalog's documents alone (`readCatalog(root).docs`): the workspace documents, then each active spec in number
 * order with its documents, each judged `ok`, `stale` or `missing`. No group head, no fog line and no dashboard
 * reading (stage input, workflow, lock sources): only the listed files, their mtimes and the specs' `spec.md` texts.
 * `options.copies` as for `readCatalog`.
 */
export async function readCatalogDocs(root: string, options: CatalogOptions = {}): Promise<readonly LibraryDoc[]> {
  const copies = await presentCopies(options.copies);
  const slugs = activeSpecs(root);
  const perSpec = await Promise.all(slugs.map((s) => specDocs(root, s, copies)));
  const judged = await judge(root, slugs, [...(await workspaceDocs(root)), ...perSpec.flat()], copies);
  // Archived specs come last and are never judged: no `stale`, no `missing` (ISC-187).
  const archived = await Promise.all(archivedSpecs(root).map((s) => archivedDocs(root, s)));
  return [...judged, ...archived.flat()];
}

/** A path segment the catalog can list at all: no empty, `.` or `..` segment, no backslash or NUL. */
const plainSegment = (s: string): boolean => s !== '' && s !== '.' && s !== '..' && !s.includes('\\') && !s.includes('\0');

/** Whether every folder from `base` down through `names` is a real directory, never a link. */
async function realDirs(base: string, names: readonly string[]): Promise<boolean> {
  let dir = base;
  if (!(await isRealDir(dir))) return false;
  for (const name of names) {
    dir = join(dir, name);
    if (!(await isRealDir(dir))) return false;
  }
  return true;
}

/**
 * The prototype at `subs` below `<spec>/.design/prototype/` (the root itself for none), by `prototypesIn`'s rule: every
 * folder on the way a real directory without a leading dot, the target holding HTML pages directly and no folder above
 * it, from the prototype root down, holding any (it would own the target). Null otherwise.
 */
async function prototypeAt(root: string, spec: string, subs: readonly string[], folder: string = spec): Promise<LibraryDoc | null> {
  const specDir = join(root, SPECS_DIR, folder);
  if (subs.some((s) => s.startsWith('.'))) return null;
  if (!(await realDirs(specDir, [DESIGN_ASSETS, 'prototype', ...subs]))) return null;
  let dir = join(specDir, PROTOTYPE_ROOT);
  for (const sub of subs) {
    if (pagesIn(await entriesOf(dir)).length > 0) return null;
    dir = join(dir, sub);
  }
  const pages = pagesIn(await entriesOf(dir));
  if (pages.length === 0) return null;
  const rel = [folder, PROTOTYPE_ROOT, ...subs].join('/');
  return prototypeDoc(dir, rel, spec, await previewCandidates(specDir), pages, folder);
}

/** The listed, unjudged document at `path` (relative to `specs/`) by the zone rules, or null. */
async function docAt(root: string, path: string, copies: CatalogOptions['copies']): Promise<LibraryDoc | null> {
  const segments = path.split('/');
  if (!segments.every(plainSegment)) return null;
  const [first = '', ...rest] = segments;
  const specsDir = join(root, SPECS_DIR);

  if (rest.length === 0) {
    const fixed = WORKSPACE_DOCS.find(([p]) => p === first);
    return fixed === undefined ? null : fileDoc(root, path, fixed[1], WORKSPACE, 'markdown');
  }
  if (first === IDEAS_DIR) {
    const name = rest[0] ?? '';
    if (rest.length !== 1 || name.startsWith('.') || name === IDEAS_INDEX || mediaOf(name) !== 'markdown') return null;
    return (await realDirs(specsDir, [IDEAS_DIR])) ? fileDoc(root, path, 'idea', WORKSPACE, 'markdown') : null;
  }
  if (first === ARCHIVE_DIR) {
    // An archived spec (ISC-187): `archive/<spec>/…` by the same rules, flagged, never judged.
    const [spec = '', ...below] = rest;
    if (below.length === 0 || !archivedSpecs(root).includes(spec)) return null;
    const doc = await specDocAt(root, spec, below, `${ARCHIVE_DIR}/${spec}`, path, copies);
    return doc === null ? null : asArchived(doc);
  }
  if (!activeSpecs(root).includes(first)) return null;
  return specDocAt(root, first, rest, first, path, copies);
}

/** The document at `rest` below one spec folder `folder` (the spec itself, or `archive/<spec>`), or null. */
async function specDocAt(
  root: string,
  spec: string,
  rest: readonly string[],
  folder: string,
  path: string,
  copies: CatalogOptions['copies'],
): Promise<LibraryDoc | null> {
  const specsDir = join(root, SPECS_DIR);
  if (rest.length === 1) {
    const kind = SPEC_DOCS.find((k) => FILE_KINDS[k].path === rest[0]);
    if (kind === undefined) return null;
    const source = folder === spec ? folderOf(root, spec, kind, copies) : join(specsDir, folder);
    return fileDoc(root, path, kind, spec, 'markdown', join(source, FILE_KINDS[kind].path));
  }
  const [zoneName = '', ...inside] = rest;
  const zone = SPEC_ZONES.find(([name]) => name === zoneName);
  if (zone === undefined) return null;
  // `.design/prototype/` is not part of the design zone: its folders are prototypes, or nothing.
  if (zoneName === DESIGN_ASSETS && inside[0] === 'prototype') return prototypeAt(root, spec, inside.slice(1), folder);
  const name = inside.at(-1) ?? '';
  const media = mediaOf(name);
  if (media === null || inside.some((s) => s.startsWith('.'))) return null;
  if (!(await realDirs(join(specsDir, folder), [zoneName, ...inside.slice(0, -1)]))) return null;
  return fileDoc(root, path, zone[1], spec, media);
}

/**
 * The one catalog document at `path` (relative to `specs/`, POSIX separators), equal to the entry `readCatalog` lists
 * for it, stale state included, or null when the catalog lists none there: a dot file, a symbolic link, a file outside
 * the zones or of another media type, a folder that is no prototype, a malformed path. An archived spec's documents
 * are found below `archive/NNN-slug/` (ISC-187), flagged and never judged. A `missing` entry names no file and is null
 * here too. Decided by the zone rules on that path alone, reading only the
 * folders on its way and the `spec.md` mtimes its stale state needs, never walking the tree. `options.copies` as for
 * `readCatalog`: a spec's own files and its `spec.md` from its worktree copy.
 */
export async function catalogDocAt(root: string, path: string, options: CatalogOptions = {}): Promise<LibraryDoc | null> {
  const copies = await presentCopies(options.copies);
  const doc = await docAt(root, path, copies);
  if (doc === null || doc.archived === true) return doc;
  const from = derivesFrom(doc);
  if (from === null) return doc;
  return judgeStale(doc, from === 'spec' ? await specMdTime(root, doc.spec, copies) : await newestSpecMdTime(root, activeSpecs(root), copies));
}
