#!/usr/bin/env bun
/**
 * check-coverage — ISC-126 / ISC-128 (spec 008): every planning source entry is mapped, every Free story is a spec.
 *
 * Usage: bun run check:coverage                       (the repository in the current directory)
 *        bun scripts/check-coverage.ts [--root DIR]    (DIR instead; used by the tests)
 *        bun scripts/check-coverage.ts --free-specs [--root DIR]
 *
 * The sources are private, untracked planning material. This script names them by path only and never prints an
 * entry's text: an unmapped entry is reported by source and line, a stale mapping row by its line in coverage.md.
 *
 * Sources, relative to the root, each one optional:
 *
 *   roadmap   spectant-produktideen.md
 *   outline   specs/notes/outline.md
 *   notes     specs/notes/notizen.md
 *   view      specs/001-app-skeleton/.design/prototype/spectant-ui/*.html          (the directory's files, not deeper)
 *   doc       specs/001-app-skeleton/.design/prototype/spectant-ui/docs/0[123]-*.md (docs 01 to 03)
 *
 * The entries of a markdown source are its headings: every line of up to three spaces, one to six `#` and a space,
 * outside fenced code blocks and outside a leading frontmatter block. A heading is normalised by dropping the `#`s
 * (leading and closing), a checkbox marker `- [ ]` / `- [x]`, everything from the first ` · ` on (the annotation),
 * collapsing whitespace and lower-casing. The entries of `view` and `doc` are file basenames, lower-cased; their
 * "line" in the output is the 1-based position in the sorted listing.
 *
 * Mapping: specs/008-spectant-complete/artifacts/coverage.md (or specs/archive/008-spectant-complete/… once the spec is
 * archived; the active folder wins) holds a markdown table with the header `| Source | Entry | Target | Reason |`
 * (other tables in the file are ignored). Per row:
 *
 *   Source  one of roadmap, outline, notes, view, doc
 *   Entry   the heading text (normalised as above, so the full heading line may be pasted) or the file basename;
 *           a literal pipe is written `\|`; surrounding backticks are dropped
 *   Target  one or more of `F<n>`, `story:<slug>`, `decision:<YYYY-MM-DD>`, `spec:<NNN>`, `drop`, comma-separated
 *   Reason  free text, required when a target is `drop`
 *
 * One row maps every entry of its source with the same normalised text. A row with an unknown source, an invalid
 * target or a drop without a reason is a problem. A row whose source exists but carries no such entry is stale.
 *
 * Output: per source `<source>: N entries, M mapped` or `<source>: absent`, one `<source>:<line>: unmapped` per
 * unmapped entry, `coverage.md:<line>: <problem>` per bad or stale row, then `unmapped: N` and `stale: N`.
 * Exit 1 on any unmapped entry, stale row or bad row; 0 otherwise. When no source exists at all it prints
 * `sources absent` and exits 0 without reading the mapping. Exit 2 on a usage error.
 *
 * --free-specs (T164, ISC-128): the Free stories come from the index `specs/ideas/README.md`, every row whose
 * Milestone cell is `Free` in any table whose first header column is `Story` (one table per feature block, columns
 * Story | Milestone | Priority | Spec; FORMAT.md § idea), and from the story files. Per Free row:
 *
 *   allocated   the Spec cell names a spec (anything but blank or a dash: `009`, `009-slug`, a link to it): exactly one
 *               folder in `specs/` answers that ref (core's `specRefMatches`), holding a `context.md` and a `spec.md`
 *               without a claim line (`- [ ] ISC-…` / `- [x] ISC-…`, core's `parseClaims`);
 *   a story     the Spec cell is blank or a dash: the story file `specs/ideas/<slug>.md` exists.
 *
 * A row that is neither is a problem, and so is a story file whose frontmatter says `milestone: Free` but which no
 * row of the index names. The index is read with core's `tableCells` and `TABLE_SEP`, never a splitter of its own.
 * Prints one `<path>[:<line>]: <problem>` per problem and `free-specs: N Free stories checked, P problems`; exit 1 on
 * any problem. Without `specs/ideas/` it prints `sources absent` and exits 0.
 *
 * Pure Bun/Node fs, no shelling out, no dependency. The parsing helpers are exported for the tests.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseClaims } from '../core/src/claims.ts';
import { parseFrontmatter } from '../core/src/frontmatter.ts';
import { TABLE_SEP, tableCells } from '../core/src/markdown.ts';
import { SPEC_FOLDER, specRefMatches } from '../core/src/spec-ref.ts';

export type SourceName = 'roadmap' | 'outline' | 'notes' | 'view' | 'doc';
export type Entry = { line: number; entry: string };
export type CoverageRow = { line: number; source: SourceName; entry: string };

const PROTOTYPE = 'specs/001-app-skeleton/.design/prototype/spectant-ui';
const COVERAGE = 'specs/008-spectant-complete/artifacts/coverage.md';
// Once spec 008 is archived, its folder and the mapping move one level down.
const ARCHIVED_COVERAGE = 'specs/archive/008-spectant-complete/artifacts/coverage.md';
const IDEAS = 'specs/ideas';
const INDEX_FILE = 'README.md';
const FREE = 'Free';

const HEADING_SOURCES: ReadonlyArray<readonly [SourceName, string]> = [
  ['roadmap', 'spectant-produktideen.md'],
  ['outline', 'specs/notes/outline.md'],
  ['notes', 'specs/notes/notizen.md'],
];
const SOURCE_NAMES: readonly SourceName[] = ['roadmap', 'outline', 'notes', 'view', 'doc'];

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/;
const TARGET = /^(?:F\d+|story:[a-z0-9][a-z0-9-]*|decision:\d{4}-\d{2}-\d{2}|spec:\d{3}|drop)$/;
const DOC = /^0[123]-.*\.md$/;
const YAML_KEY = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/;

// ---------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------

/** The comparable form of a heading line or a mapping entry (see the header). */
export function normaliseHeading(raw: string): string {
  let s = raw.trim().replace(/^#{1,6}(?=\s|$)/, '').replace(/\s#+\s*$/, '').trim();
  s = s.replace(/^- \[[ xX]\]\s*/, ''); // single-core: allow — the marker of a coverage.md mapping entry, not a claim line
  const annotation = s.indexOf(' · ');
  if (annotation >= 0) s = s.slice(0, annotation);
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The non-empty headings of a markdown text with their 1-based lines; fences and leading frontmatter skipped. */
export function headingsOf(text: string): Entry[] {
  const lines = text.split(/\r?\n/);
  const out: Entry[] = [];
  let start = 0;
  // The core parser finds the block; it counts as frontmatter only when a YAML key follows the opening line, since a
  // leading thematic break before a blank line would otherwise hide every heading up to the next break.
  const frontmatter = parseFrontmatter(text);
  if (frontmatter.present && YAML_KEY.test(lines[1] ?? '')) start = frontmatter.bodyLine - 1;
  let fence: { char: string; size: number } | null = null;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const f = FENCE.exec(raw);
    if (fence) {
      const marker = f?.[1] ?? '';
      if (f && marker.startsWith(fence.char) && marker.length >= fence.size && (f[2] ?? '').trim() === '') fence = null;
      continue;
    }
    if (f) {
      const marker = f[1] ?? '';
      fence = { char: marker.charAt(0), size: marker.length };
      continue;
    }
    if (!HEADING.test(raw)) continue;
    const entry = normaliseHeading(raw);
    if (entry !== '') out.push({ line: i + 1, entry });
  }
  return out;
}

/** The cells of a table row, split on unescaped pipes, `\|` unescaped, trimmed. */
function cellsOf(row: string): string[] {
  const body = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
}

function unquote(cell: string): string {
  const m = /^`([^`]*)`$/.exec(cell);
  return m ? (m[1] ?? '') : cell;
}

function isSource(s: string): s is SourceName {
  return (SOURCE_NAMES as readonly string[]).includes(s);
}

/** The valid rows of the coverage table and one `coverage.md:<line>: <problem>` per bad row. */
export function parseCoverage(text: string): { rows: CoverageRow[]; problems: string[] } {
  const rows: CoverageRow[] = [];
  const problems: string[] = [];
  let inTable = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim().startsWith('|')) {
      inTable = false;
      return;
    }
    const cells = cellsOf(raw);
    const first = (cells[0] ?? '').toLowerCase();
    if (!inTable) {
      inTable = first === 'source' && (cells[1] ?? '').toLowerCase() === 'entry' && (cells[2] ?? '').toLowerCase() === 'target';
      return;
    }
    if (cells.every((c) => /^:?-+:?$/.test(c))) return;
    if (!isSource(first)) {
      problems.push(`coverage.md:${line}: unknown source`);
      return;
    }
    const entryCell = unquote(cells[1] ?? '');
    const entry = first === 'view' || first === 'doc' ? entryCell.trim().toLowerCase() : normaliseHeading(entryCell);
    const targets = (cells[2] ?? '').split(',').map((t) => unquote(t.trim()));
    if (entry === '') {
      problems.push(`coverage.md:${line}: empty entry`);
      return;
    }
    if (targets.some((t) => !TARGET.test(t))) {
      problems.push(`coverage.md:${line}: invalid target`);
      return;
    }
    if (targets.includes('drop') && (cells[3] ?? '') === '') {
      problems.push(`coverage.md:${line}: drop without reason`);
      return;
    }
    rows.push({ line, source: first, entry });
  });
  return { rows, problems };
}

// ---------------------------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------------------------

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listFiles(dir: string, match: (name: string) => boolean): Entry[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && match(d.name))
    .map((d) => d.name)
    .sort()
    .map((name, i) => ({ line: i + 1, entry: name.toLowerCase() }));
}

/** The entries of every source that exists under `root`; null for an absent source. */
function readSources(root: string): Map<SourceName, Entry[] | null> {
  const sources = new Map<SourceName, Entry[] | null>();
  for (const [name, path] of HEADING_SOURCES) {
    const file = join(root, path);
    sources.set(name, existsSync(file) ? headingsOf(readFileSync(file, 'utf8')) : null);
  }
  const proto = join(root, PROTOTYPE);
  sources.set('view', isDir(proto) ? listFiles(proto, (n) => n.endsWith('.html')) : null);
  const docs = join(proto, 'docs');
  sources.set('doc', isDir(docs) ? listFiles(docs, (n) => DOC.test(n)) : null);
  return sources;
}

function entries(n: number): string {
  return `${n} ${n === 1 ? 'entry' : 'entries'}`;
}

function coverage(root: string): number {
  const sources = readSources(root);
  if ([...sources.values()].every((s) => s === null)) {
    console.log('sources absent');
    return 0;
  }

  const mappingFile = [COVERAGE, ARCHIVED_COVERAGE].map((p) => join(root, p)).find((p) => existsSync(p)) ?? join(root, COVERAGE);
  let rows: CoverageRow[] = [];
  let problems: string[] = [];
  if (existsSync(mappingFile)) {
    ({ rows, problems } = parseCoverage(readFileSync(mappingFile, 'utf8')));
  } else {
    console.log('coverage.md: absent');
  }

  const unmapped: string[] = [];
  const stale: string[] = [];
  for (const name of SOURCE_NAMES) {
    const list = sources.get(name) ?? null;
    if (list === null) {
      console.log(`${name}: absent`);
      continue;
    }
    const mapped = new Set(rows.filter((r) => r.source === name).map((r) => r.entry));
    const carried = new Set(list.map((e) => e.entry));
    const missing = list.filter((e) => !mapped.has(e.entry));
    console.log(`${name}: ${entries(list.length)}, ${list.length - missing.length} mapped`);
    for (const e of missing) unmapped.push(`${name}:${e.line}: unmapped`);
    for (const r of rows) if (r.source === name && !carried.has(r.entry)) stale.push(`coverage.md:${r.line}: stale`);
  }

  for (const line of unmapped) console.error(line);
  for (const line of [...problems, ...stale].sort((a, b) => lineOf(a) - lineOf(b))) console.error(line);
  console.log(`unmapped: ${unmapped.length}`);
  console.log(`stale: ${stale.length}`);
  if (problems.length > 0) console.log(`bad rows: ${problems.length}`);
  return unmapped.length + stale.length + problems.length > 0 ? 1 : 0;
}

function lineOf(report: string): number {
  return Number(/^coverage\.md:(\d+):/.exec(report)?.[1] ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// --free-specs
// ---------------------------------------------------------------------------------------------------------------

/** The value of `key` in a leading frontmatter block (the core parser, quotes dropped); null without one. */
function frontmatterValue(text: string, key: string): string | null {
  return parseFrontmatter(text).values[key] ?? null;
}

/** One row of the ideas index: its 1-based line, the story slug, the Milestone cell and the Spec cell, each plain. */
export type IndexRow = { line: number; story: string; milestone: string; spec: string };

/** A cell as a name: a link reduced to its text, backticks dropped, trimmed, a trailing `.md` dropped. */
function plainCell(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim()
    .replace(/\.md$/, '');
}

/**
 * The rows of `specs/ideas/README.md`: every table whose header's first column is `Story` (one per feature block),
 * the Milestone and Spec columns found by their header name. Rows are split by core's `tableCells` after core's
 * `TABLE_SEP` marks a header; lines inside a fence are skipped.
 */
export function indexRowsOf(text: string): IndexRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: IndexRow[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE.test(line)) fenced = !fenced;
    if (fenced || !/^\s*\|/.test(line) || !TABLE_SEP.test(lines[i + 1] ?? '')) continue;
    const header = tableCells(line).map((c) => plainCell(c).toLowerCase());
    if (header[0] !== 'story') continue;
    const milestone = header.indexOf('milestone');
    const spec = header.indexOf('spec');
    for (i += 2; i < lines.length && /^\s*\|/.test(lines[i] ?? ''); i++) {
      const cells = tableCells(lines[i] ?? '');
      const story = plainCell(cells[0] ?? '');
      if (story === '') continue;
      rows.push({
        line: i + 1,
        story,
        milestone: milestone < 0 ? '' : plainCell(cells[milestone] ?? ''),
        spec: spec < 0 ? '' : plainCell(cells[spec] ?? ''),
      });
    }
    i -= 1;
  }
  return rows;
}

/** A Spec cell that names a spec: anything but blank or a dash. */
const namesSpec = (cell: string): boolean => !/^[\s—–-]*$/.test(cell);

/** The problems of an allocated folder: it holds `context.md` and a `spec.md` without a claim. */
function folderProblems(root: string, folder: string): string[] {
  const problems: string[] = [];
  if (!existsSync(join(root, folder, 'context.md'))) problems.push(`${folder}: no context.md`);
  const spec = join(root, folder, 'spec.md');
  if (!existsSync(spec)) return [...problems, `${folder}: no spec.md`];
  const claims = parseClaims(readFileSync(spec, 'utf8')).claims.length;
  if (claims > 0) problems.push(`${folder}/spec.md: ${claims} claim${claims === 1 ? '' : 's'}`);
  return problems;
}

function freeSpecs(root: string): number {
  const ideas = join(root, IDEAS);
  if (!isDir(ideas)) {
    console.log('sources absent');
    return 0;
  }
  const specsDir = join(root, 'specs');
  const folders = readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && SPEC_FOLDER.test(d.name))
    .map((d) => d.name);
  const stories = new Set(
    readdirSync(ideas, { withFileTypes: true })
      .filter((d) => d.isFile() && d.name.endsWith('.md') && d.name !== INDEX_FILE)
      .map((d) => d.name.slice(0, -'.md'.length)),
  );
  const indexFile = join(ideas, INDEX_FILE);
  const rows = existsSync(indexFile) ? indexRowsOf(readFileSync(indexFile, 'utf8')) : [];

  const problems: string[] = [];
  const checked = new Set<string>();
  // Each Free row of the index: an allocated row (its Spec cell names a spec) needs that folder, unique in specs/, with
  // context.md and a claimless spec.md; a row not yet allocated needs its story file.
  for (const row of rows.filter((r) => r.milestone === FREE)) {
    checked.add(row.story);
    const at = `${IDEAS}/${INDEX_FILE}:${row.line}: ${row.story}`;
    if (!namesSpec(row.spec)) {
      if (!stories.has(row.story)) problems.push(`${at}: no story file and no spec`);
      continue;
    }
    const matches = folders.filter((f) => specRefMatches(f, row.spec));
    if (matches.length !== 1) {
      problems.push(`${at}: spec ${row.spec} ${matches.length === 0 ? 'has no folder in specs/' : `names ${matches.length} folders`}`);
      continue;
    }
    problems.push(...folderProblems(root, `specs/${matches[0] ?? ''}`));
  }
  // Each Free story file the index does not name at all.
  const named = new Set(rows.map((r) => r.story));
  for (const slug of [...stories].sort()) {
    if (named.has(slug) || frontmatterValue(readFileSync(join(ideas, `${slug}.md`), 'utf8'), 'milestone') !== FREE) continue;
    checked.add(slug);
    problems.push(`${IDEAS}/${slug}.md: a Free story the index does not name`);
  }
  const count = checked.size;

  for (const p of problems) console.error(p);
  const summary = `free-specs: ${count} Free ${count === 1 ? 'story' : 'stories'} checked, ${problems.length} problem${problems.length === 1 ? '' : 's'}`;
  if (problems.length > 0) {
    console.error(summary);
    return 1;
  }
  console.log(summary);
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------

const USAGE = `Usage: bun run check:coverage
       bun scripts/check-coverage.ts [--root DIR] [--free-specs]

Checks that every heading of the planning sources and every prototype view and doc 01 to 03 is mapped in
${COVERAGE}; with --free-specs, that every Free story under specs/ideas/ has its spec folder.
Prints "sources absent" and exits 0 where the sources are missing. Exit 0 clean, 1 on a finding, 2 on a usage error.`;

function usageError(message: string): number {
  console.error(`check-coverage: ${message}`);
  console.error(USAGE);
  return 2;
}

export function main(argv: string[]): number {
  let root = process.cwd();
  let free = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      return 0;
    }
    if (arg === '--free-specs') free = true;
    else if (arg === '--root') {
      const dir = argv[++i];
      if (dir === undefined) return usageError('--root needs a directory');
      root = resolve(dir);
    } else return usageError(`unknown argument ${arg ?? ''}`);
  }
  if (!isDir(root)) return usageError('root is not a directory');
  return free ? freeSpecs(root) : coverage(root);
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
