// The story folder `specs/ideas/*.md` (spec 008, ISC-124, ISC-125): each story with frontmatter as an `IdeaRef` of the
// stage `idea` (T51), and `README.md` as the index checked against the files in both directions (T52). FORMAT.md
// § idea is the contract. Browser-safe: no file system, the caller passes the folder's texts in; malformed input
// becomes a FileDiagnostic, never a throw. The frontmatter goes through `frontmatter.ts` and the index's tables through
// `markdown.ts`'s row splitter, so this module adds no second parser of either.
import type { Diagnostic } from './diagnostics.ts';
import type { FileDiagnostic, IdeaFiles, IdeaRef, IdeasReading } from './files.ts';
import { parseFrontmatter, SPEC_TYPES } from './frontmatter.ts';
import { TABLE_SEP, tableCells } from './markdown.ts';

/** The story folder from the repository root, as every `IdeaRef.path` and diagnostic names it. */
const IDEAS_DIR = 'specs/ideas/';

/** The index file, never a story. */
const INDEX = 'README.md';

/** `<slug>.md` directly in the folder: no sub-path, no dot file. */
const STORY_FILE = /^([^/\\.][^/\\]*)\.md$/;

const warning = (code: string, message: string, subject: string): Diagnostic => ({ severity: 'warning', code, message, subject });

/** A frontmatter value as a story key holds it: trimmed, null when absent or blank. */
function keyValue(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v === undefined || v === '' ? null : v;
}

/**
 * The lines under the first H2 whose text starts with `heading` (`## Goal (one sentence)`), up to the next heading,
 * trimmed: a blank line as `''`, a line that held only an HTML comment left out, a leading comment cut off.
 */
function sectionLines(body: string, heading: string): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${heading}\\b`).test(line));
  if (start < 0) return [];
  const out: string[] = [];
  let comment = false;
  for (const raw of lines.slice(start + 1)) {
    let line = raw.trim();
    const blank = line === '';
    if (comment) {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      comment = false;
      line = line.slice(end + 3).trim();
    }
    if (/^#{1,6}\s/.test(line)) break;
    while (line.startsWith('<!--')) {
      const end = line.indexOf('-->');
      if (end < 0) {
        comment = true;
        line = '';
        break;
      }
      line = line.slice(end + 3).trim();
    }
    if (line !== '' || blank) out.push(line);
  }
  return out;
}

/**
 * The first prose line under the H2 that starts with `Goal` (`## Goal (one sentence)`): the first non-empty line before
 * the next heading that is not an HTML comment; null when there is none.
 */
function goalLine(body: string): string | null {
  return sectionLines(body, 'Goal').find((line) => line !== '') ?? null;
}

/** The longest excerpt (spec 067, ISC-529), the ellipsis included. */
const EXCERPT_MAX = 280;

/**
 * `IdeaRef.excerpt`: the first paragraph under `## Problem`, else under `## Vision`, its lines joined by one space;
 * longer than `EXCERPT_MAX`, cut at the last space that leaves room for `…` (a hard cut without one). Null without prose.
 */
function excerptOf(body: string): string | null {
  for (const heading of ['Problem', 'Vision']) {
    const lines = sectionLines(body, heading);
    const from = lines.findIndex((line) => line !== '');
    if (from < 0) continue;
    const end = lines.indexOf('', from);
    const text = lines.slice(from, end < 0 ? undefined : end).join(' ');
    if (text.length <= EXCERPT_MAX) return text;
    const room = text.slice(0, EXCERPT_MAX - 1);
    const space = room.lastIndexOf(' ');
    return `${(space > 0 ? room.slice(0, space) : room).trimEnd()}…`;
  }
  return null;
}

/** A cell's text as a name: backticks dropped, a link reduced to its text, a trailing `.md` dropped. */
function plainName(cell: string): string {
  return cell
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim()
    .replace(/\.md$/, '');
}

/** A `Spec` cell that names a spec (anything but blank or a dash): the story was started and its file removed. */
const started = (cell: string | undefined): boolean => !/^[\s—–-]*$/.test(plainName(cell ?? ''));

/** The index's rows: every table whose header's first column is `Story`, one table per feature block. */
interface IndexRow {
  readonly name: string;
  readonly started: boolean;
}

function indexRows(text: string): IndexRow[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const rows: IndexRow[] = [];
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || !/^\s*\|/.test(line) || !TABLE_SEP.test(lines[i + 1] ?? '')) continue;
    const header = tableCells(line).map((c) => plainName(c).toLowerCase());
    if (header[0] !== 'story') continue;
    const spec = header.indexOf('spec');
    for (i += 2; i < lines.length && /^\s*\|/.test(lines[i] ?? ''); i++) {
      const cells = tableCells(lines[i] ?? '');
      const name = plainName(cells[0] ?? '');
      if (name !== '') rows.push({ name, started: spec >= 0 && started(cells[spec]) });
    }
    i -= 1;
  }
  return rows;
}

/**
 * The index checked against the stories, both directions: a story the index does not name, then a name the index
 * lists without a story file (a started row, whose `Spec` column names a spec, needs none). One `ideas-index` warning
 * each, keyed to the index, the slug as subject. A missing index names nothing.
 */
function checkIndex(index: string | undefined, slugs: readonly string[]): FileDiagnostic[] {
  const rows = index === undefined ? [] : indexRows(index);
  const named = new Set(rows.map((r) => r.name));
  const present = new Set(slugs);
  const file = `${IDEAS_DIR}${INDEX}`;
  return [
    ...slugs
      .filter((slug) => !named.has(slug))
      .map((slug) => ({ file, diagnostic: warning('ideas-index', `The story ${slug} is not named in the index ${INDEX}.`, slug) })),
    ...[...new Set(rows.filter((r) => !r.started && !present.has(r.name)).map((r) => r.name))].map((name) => ({
      file,
      diagnostic: warning('ideas-index', `The index names ${name}, but ${IDEAS_DIR}${name}.md is not a story file.`, name),
    })),
  ];
}

/** Reads the story folder: file name to text, `README.md` the index; an empty record is a repository without stories. */
export function readIdeas(files: IdeaFiles): IdeasReading {
  const ideas: IdeaRef[] = [];
  const diagnostics: FileDiagnostic[] = [];
  const names = Object.keys(files)
    .filter((name) => name !== INDEX && STORY_FILE.test(name))
    .sort();
  for (const name of names) {
    const slug = name.slice(0, -'.md'.length);
    const path = `${IDEAS_DIR}${name}`;
    const fm = parseFrontmatter(files[name] ?? '');
    for (const diagnostic of fm.diagnostics) diagnostics.push({ file: path, diagnostic });
    if (!fm.present) {
      diagnostics.push({ file: path, diagnostic: warning('ideas-frontmatter', `${path} has no frontmatter block, so it is not a story; it is skipped.`, slug) });
      continue;
    }
    // A story says `status: idea`; a frontmatter block without it is some other note in the folder (a plan export, a
    // working file whose leading `---` is a thematic break), not a story: skipped with one warning, never read as one.
    const { status: rawStatus } = fm.values;
    const status = keyValue(rawStatus);
    if (status !== 'idea') {
      const said = status === null ? 'has no `status` key' : `says status "${status}"`;
      diagnostics.push({ file: path, diagnostic: warning('ideas-status', `${path} ${said}; a story says \`status: idea\`, so it is skipped.`, slug) });
      continue;
    }
    // `type` and `feature` are story keys, not spec keys, so the frontmatter reader leaves them in `rest`.
    const { type: rawType, feature } = fm.rest;
    const type = keyValue(rawType);
    const known = SPEC_TYPES.find((t) => t === type) ?? null;
    // A `type` outside the seven spec types reads as no type, and says so once (T54): keyed to the story, the value as subject.
    if (type !== null && known === null) {
      diagnostics.push({
        file: path,
        diagnostic: warning('ideas-type', `type "${type}" is not a spec type (${SPEC_TYPES.join(', ')}); the story reads as untyped.`, type),
      });
    }
    ideas.push({
      slug,
      title: goalLine(fm.body) ?? slug,
      type: known,
      feature: keyValue(feature),
      milestone: keyValue(fm.data.milestone),
      priority: fm.data.priority,
      excerpt: excerptOf(fm.body),
      path,
    });
  }
  diagnostics.push(...checkIndex(files[INDEX], ideas.map((i) => i.slug)));
  return { ideas, diagnostics };
}
