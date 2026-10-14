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
// prototype is named after its folder. `modified` is the file's mtime as ISO 8601, a prototype's its newest file. A
// prototype's `preview` (ISC-159) is a screenshot directly in its spec's `.design/` whose name contains `prototype`.
// Every present document is listed `ok`; `stale` (ISC-155.1) and `missing` (ISC-155.2) are judged over the finished
// list in `judge`, the one place the later tasks extend. The group heads and open fog lines (ISC-157) come from the
// dashboard model and the tech page's sources in `groupsOf`.
//
// Worktree copies (spec 027, ISC-181): the caller may name, per active spec, the folder its files are read from
// (`CatalogOptions.copies`, the server's `WorkspaceReading.copies`). The kinds of `WORKTREE_COPY_KINDS` then come from
// that folder (the five own Markdown files, `events.jsonl` for the spec time, `spec.md` for the missing rule, the texts
// of the stage input); `artifacts/`, `.evidence/`, `.design/` and the workspace documents stay on the main checkout,
// and every catalog path stays `NNN-slug/<file>` below `specs/`. `catalogSourceOf` resolves a listed path the same way.
import type { Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { parseClaims } from './claims.ts';
import { buildDashboard, type DashboardInput } from './dashboard.ts';
import { parseEvents } from './events.ts';
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
function previewOf(candidates: readonly string[], rel: string, spec: string): string | null {
  const sub = rel === `${spec}/${PROTOTYPE_ROOT}` ? null : rel.slice(rel.lastIndexOf('/') + 1).toLowerCase();
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
  return best === undefined ? null : `${spec}/${DESIGN_ASSETS}/${best}`;
}

/**
 * The prototypes in or below `dir` (relative path `rel` from `specs/`): a folder holding HTML pages directly is one
 * document and everything below it belongs to it; a folder without pages is no document and none of its files is
 * an entry, while each of its subfolders is judged by the same rule. `candidates` are the spec's preview candidates.
 */
async function prototypesIn(dir: string, rel: string, spec: string, candidates: readonly string[]): Promise<LibraryDoc[]> {
  const entries = await entriesOf(dir);
  const pages = entries.filter((e) => e.isFile() && isPage(e.name)).map((e) => e.name).sort(byName);
  if (pages.length > 0) {
    const modified = await newestBelow(dir);
    if (modified === null) return [];
    const title = rel.slice(rel.lastIndexOf('/') + 1);
    const preview = previewOf(candidates, rel, spec);
    return [{ path: rel, type: 'prototype', spec, title, modified, state: 'ok', media: 'prototype', pages, preview }];
  }
  const out: LibraryDoc[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) out.push(...(await prototypesIn(join(dir, entry.name), `${rel}/${entry.name}`, spec, candidates)));
  }
  return out;
}

/** The documents of one active spec folder `specs/<spec>/`, in catalog order; its own files from their read source. */
async function specDocs(root: string, spec: string, copies: CatalogOptions['copies']): Promise<LibraryDoc[]> {
  const specDir = join(root, SPECS_DIR, spec);
  const own = await Promise.all(
    SPEC_DOCS.map((kind) => {
      const file = FILE_KINDS[kind].path;
      return fileDoc(root, `${spec}/${file}`, kind, spec, 'markdown', join(folderOf(root, spec, kind, copies), file));
    }),
  );

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
  const candidates = await previewCandidates(specDir);
  const prototypes = (await prototypesIn(join(specDir, PROTOTYPE_ROOT), prototypeRoot, spec, candidates)).sort(byPath);

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
async function specTime(root: string, spec: string, docs: readonly LibraryDoc[], copies: CatalogOptions['copies']): Promise<number | null> {
  let text = '';
  try {
    text = await readFile(join(folderOf(root, spec, 'events', copies), FILE_KINDS.events.path), 'utf-8');
  } catch {
    // No events.jsonl: the spec.md mtime stands in.
  }
  const stamps = parseEvents(text).events.map((e) => Date.parse(e.ts));
  if (stamps.length > 0) return Math.max(...stamps);
  const own = docs.find((d) => d.spec === spec && d.path === `${spec}/${FILE_KINDS.spec.path}`);
  return own?.modified == null ? null : Date.parse(own.modified);
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
  let text: string;
  try {
    text = await readFile(join(folderOf(root, spec, 'spec', copies), FILE_KINDS.spec.path), 'utf-8');
  } catch {
    return [];
  }
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
 * The state judgement over the finished list. `stale` (ISC-155.1): `plan.md`, `tasks.md` and `design.md` older than
 * the time of their spec, `tech.md` and `tldr.md` older than the newest time of any active spec; a document as old as
 * its source is fresh. `missing` (ISC-155.2): the entries `missingOf` adds for each active spec, placed by
 * `placeMissing`. Both read only what `readCatalog` already listed plus each spec's `events.jsonl` and `spec.md`, from
 * the spec's read source (`copies`).
 */
async function judge(
  root: string,
  specs: readonly string[],
  docs: readonly LibraryDoc[],
  copies: CatalogOptions['copies'],
): Promise<readonly LibraryDoc[]> {
  const times = new Map<string, number | null>(await Promise.all(specs.map(async (s) => [s, await specTime(root, s, docs, copies)] as const)));
  const known = [...times.values()].filter((t): t is number => t !== null);
  const newest = known.length > 0 ? Math.max(...known) : null;

  const sourceOf = (d: LibraryDoc): number | null => {
    if (d.spec === WORKSPACE) return FROM_NEWEST_SPEC.has(d.type) ? newest : null;
    return FROM_SPEC.has(d.path.slice(d.spec.length + 1)) ? (times.get(d.spec) ?? null) : null;
  };
  const judged = docs.map((d): LibraryDoc => {
    const source = sourceOf(d);
    const stale = d.state === 'ok' && d.modified !== null && source !== null && Date.parse(d.modified) < source;
    return stale ? { ...d, state: 'stale' } : d;
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
 * then each active spec in number order with its documents, plus one group head per active spec and the open fog
 * lines. Metadata only, never a document's content (goal and approach are the heads' own short Markdown). A workspace
 * without `specs/` has an empty catalog. `input` is the dashboard model's input as the server read it for the same
 * workspace (`readWorkspaceInput`), so the heads' stages equal the dashboard's to the code-reviewed mark; without it
 * the stage input is read from the files (`stageInputOf`). Its active specs are those `listSpecs` finds. `options.copies`
 * names the worktree copies a spec's own files are read from (spec 027, ISC-181); without it, all from `specs/`.
 * Reads only.
 */
export async function readCatalog(root: string, input?: DashboardInput, options: CatalogOptions = {}): Promise<LibraryCatalog> {
  const { copies } = options;
  const specs = listSpecs(root).filter((s) => !s.archived);
  const slugs = specs.map((s) => s.slug);
  const perSpec = await Promise.all(slugs.map((s) => specDocs(root, s, copies)));
  const docs = await judge(root, slugs, [...(await workspaceDocs(root)), ...perSpec.flat()], copies);
  const { groups, fog } = groupsOf(input ?? (await stageInputOf(root, slugs, copies)));
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
  if (own === undefined) return { dir: join(root, SPECS_DIR), rel: doc.path };
  const dir = folderOf(root, doc.spec, own, copies);
  return dir === join(root, SPECS_DIR, doc.spec) ? { dir: join(root, SPECS_DIR), rel: doc.path } : { dir, rel: FILE_KINDS[own].path };
}
