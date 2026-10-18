import type {
  DocsPage,
  LibraryCatalog,
  LibraryDoc,
  LibraryDocType,
  LibraryFogLine,
  SpecGroupHead,
} from '../../../../../core/src/files';
import { specRefMatches } from '../../../../../core/src/spec-ref';
import { type OpenKey, sectionKey } from '../../shared/open-state';

/**
 * The library list over core's `LibraryCatalog` (spec 017, T26, ISC-156, ISC-156.2; design.md § Across viewports).
 * Pure functions, no Angular: the page holds the catalog, the filter (from the address) and the server's search hits,
 * and asks this module what to show. Nothing here re-reads a document; titles, states and heads are core's.
 *
 * - Groups: "workspace-wide" first (constitution, tech, TL;DR, ideas), then the specs in ascending number, each spec
 *   exactly once, whatever order the catalog lists its documents in.
 * - In a spec group the present documents come first, the missing ones after them, each run in catalog order.
 * - A spec's `evidence` documents never stand in the list itself: they form one collapsed subgroup with its count,
 *   revealed in blocks of `EVIDENCE_BLOCK`; a search or the type filter `evidence` opens it.
 * - Type pills only for the types the catalog of the context holds, never Decisions (`context`, a section of spec.md
 *   now) and never Notes (not in the catalog).
 */

/** `LibraryDoc.spec` of a document outside every spec folder; also the `?spec=` value of the workspace-wide group. */
export const WORKSPACE_SPEC = 'workspace';

/** The evidence subgroup reveals this many documents per block (plan 017 § Risks: ~2,300 evidence files in one spec). */
export const EVIDENCE_BLOCK = 50;

/** Every pill type in pill order; `context` (Decisions) is left out on purpose. */
export const PILL_TYPES: readonly LibraryDocType[] = [
  'spec',
  'plan',
  'tasks',
  'design',
  'prototype',
  'artifact',
  'evidence',
  'constitution',
  'tech',
  'tldr',
  'idea',
];

/** The order of the workspace-wide group (design.md: Constitution, Tech, TL;DR, ideas). */
const WORKSPACE_ORDER: readonly LibraryDocType[] = ['constitution', 'tech', 'tldr', 'idea'];

/** `?state=`: every document, the stale ones, the missing ones, or the fog lines of the specs still open. */
export type LibraryStateFilter = 'all' | 'stale' | 'missing' | 'open';

export const STATE_FILTERS: readonly LibraryStateFilter[] = ['all', 'stale', 'missing', 'open'];

/**
 * The list's filters as the address carries them: `q` the raw search text, `type` a pill type or `all`, `spec` `all`,
 * `workspace` or a spec's number (`017`, the `?spec=` form of design.md), `state` one of `STATE_FILTERS`, `archived`
 * whether the archived specs' documents are listed too (`?archived=1`; off by default).
 */
export interface LibraryFilter {
  readonly query: string;
  readonly type: LibraryDocType | 'all';
  readonly spec: string;
  readonly state: LibraryStateFilter;
  readonly archived: boolean;
}

export const NO_FILTER: LibraryFilter = { query: '', type: 'all', spec: 'all', state: 'all', archived: false };

/** The server's search answer as the list needs it: matched path → plain snippet. */
export type SearchHits = ReadonlyMap<string, string>;

/** A spec's collapsed evidence: every matching document, the count, and whether a search or the filter opens it. */
export interface EvidenceGroup {
  readonly docs: readonly LibraryDoc[];
  readonly count: number;
  readonly open: boolean;
}

/** One group of the list: the workspace-wide documents, or one spec's (with its head when core has one). */
export interface LibraryGroup {
  /** `workspace` or the spec folder (`NNN-slug`), as `LibraryDoc.spec`. */
  readonly spec: string;
  /** `?spec=` value of the group: `workspace` or the spec's number. */
  readonly key: string;
  readonly head: SpecGroupHead | null;
  /** The documents shown as rows: present ones first, then missing ones; never evidence. */
  readonly docs: readonly LibraryDoc[];
  readonly evidence: EvidenceGroup | null;
  /** Rows plus evidence count: the group's document number. */
  readonly count: number;
}

/** One spec's open points under the filter "open". */
export interface FogGroup {
  readonly spec: string;
  readonly key: string;
  readonly lines: readonly LibraryFogLine[];
}

/** A spec select option: the `?spec=` value and the folder it names (`workspace` for the workspace-wide group). */
export interface SpecOption {
  readonly value: string;
  readonly spec: string;
}

const NUMBER = /^(\d+)-/u;

/** The `?spec=` value of a `LibraryDoc.spec`: the number of a spec folder, `workspace` as it is. */
export function specKey(spec: string): string {
  return NUMBER.exec(spec)?.[1] ?? spec;
}

/** The slug of a spec folder (`017-workspace-library` → `workspace-library`); the value itself without a number. */
export function specSlug(spec: string): string {
  const match = NUMBER.exec(spec);
  return match ? spec.slice(match[0].length) : spec;
}

/** Spec folders ascending by number, then by name. */
const bySpec = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

const isPillType = (value: string): value is LibraryDocType => (PILL_TYPES as readonly string[]).includes(value);
const isState = (value: string): value is LibraryStateFilter => (STATE_FILTERS as readonly string[]).includes(value);

/**
 * The filter a query string names (`?q=`, `?type=`, `?spec=`, `?state=`, `?archived=`); an unknown type or state falls
 * back to `all`, so a hand-edited address never empties the list by a typo. `spec` is taken as it is (`specKey` form);
 * `archived` is on for `1` only.
 */
export function parseFilter(param: (name: string) => string | null): LibraryFilter {
  const type = param('type') ?? 'all';
  const state = param('state') ?? 'all';
  const spec = param('spec') ?? '';
  return {
    query: param('q') ?? '',
    type: isPillType(type) ? type : 'all',
    spec: spec === '' ? 'all' : spec,
    state: isState(state) ? state : 'all',
    archived: param('archived') === '1',
  };
}

/** The query params of a filter, defaults left out (`?q=`, `?type=`, `?spec=`, `?state=`, `?archived=`). */
export function filterParams(filter: LibraryFilter): Record<string, string> {
  const params: Record<string, string> = {};
  if (filter.query !== '') params['q'] = filter.query;
  if (filter.type !== 'all') params['type'] = filter.type;
  if (filter.spec !== 'all') params['spec'] = filter.spec;
  if (filter.state !== 'all') params['state'] = filter.state;
  if (filter.archived) params['archived'] = '1';
  return params;
}

/**
 * The type pills for the documents of the context (the whole catalog, or one spec's in the spec area): the types it
 * holds, in `PILL_TYPES` order. Depends on the catalog, not on the matches, so the set stays stable while filtering.
 */
export function typePills(docs: readonly LibraryDoc[]): readonly LibraryDocType[] {
  const present = new Set(docs.map((doc) => doc.type));
  return PILL_TYPES.filter((type) => present.has(type));
}

/** The spec select: `workspace` when there are workspace-wide documents, then every spec ascending, each once. */
export function specOptions(docs: readonly LibraryDoc[]): readonly SpecOption[] {
  const specs = [...new Set(docs.map((doc) => doc.spec))];
  const folders = specs.filter((spec) => spec !== WORKSPACE_SPEC).sort(bySpec);
  return [...(specs.includes(WORKSPACE_SPEC) ? [WORKSPACE_SPEC] : []), ...folders].map((spec) => ({ value: specKey(spec), spec }));
}

/** The documents the list draws from under `archived`: every one with it, else the active ones only. */
export const listable = (docs: readonly LibraryDoc[], archived: boolean): readonly LibraryDoc[] =>
  archived ? docs : docs.filter((doc) => doc.archived !== true);

/**
 * Whether a document passes the filter. An archived spec's document only with `archived`; a query matches the title or
 * path ignoring case, or a server search hit (the full text); `state` `stale` / `missing` keeps that state only;
 * `open` keeps no document (the fog lines stand instead).
 */
export function matches(doc: LibraryDoc, filter: LibraryFilter, hits: SearchHits | null = null): boolean {
  if (filter.state === 'open') return false;
  if (!filter.archived && doc.archived === true) return false;
  if (filter.state !== 'all' && doc.state !== filter.state) return false;
  if (filter.type !== 'all' && doc.type !== filter.type) return false;
  if (filter.spec !== 'all' && specKey(doc.spec) !== filter.spec) return false;
  const query = filter.query.trim().toLowerCase();
  if (query === '') return true;
  return hits?.has(doc.path) === true || `${doc.title} ${doc.path}`.toLowerCase().includes(query);
}

/** Whether a spec's evidence subgroup opens on its own: a search runs, or the type filter is `evidence`. */
export const evidenceOpens = (filter: LibraryFilter): boolean => filter.query.trim() !== '' || filter.type === 'evidence';

const workspaceRank = (doc: LibraryDoc): number => {
  const rank = WORKSPACE_ORDER.indexOf(doc.type);
  return rank < 0 ? WORKSPACE_ORDER.length : rank;
};

/**
 * The list: the matching documents of the catalog in groups, workspace-wide first, then the specs ascending, each
 * spec once; a group without a match is left out. Empty under the filter "open" (see `fogGroups`).
 */
export function libraryGroups(catalog: LibraryCatalog, filter: LibraryFilter, hits: SearchHits | null = null): readonly LibraryGroup[] {
  const bySpecFolder = new Map<string, LibraryDoc[]>();
  for (const doc of catalog.docs) {
    if (!matches(doc, filter, hits)) continue;
    const docs = bySpecFolder.get(doc.spec);
    if (docs) docs.push(doc);
    else bySpecFolder.set(doc.spec, [doc]);
  }
  const heads = new Map(catalog.groups.map((head) => [head.spec, head]));
  const open = evidenceOpens(filter);
  return specOptions([...bySpecFolder.values()].flat()).map(({ spec, value }) => {
    const docs = bySpecFolder.get(spec) ?? [];
    const evidence = docs.filter((doc) => doc.type === 'evidence');
    const rows = docs.filter((doc) => doc.type !== 'evidence');
    const ordered =
      spec === WORKSPACE_SPEC
        ? rows.map((doc, at) => ({ doc, at })).sort((a, b) => workspaceRank(a.doc) - workspaceRank(b.doc) || a.at - b.at).map(({ doc }) => doc)
        : [...rows.filter((doc) => doc.state !== 'missing'), ...rows.filter((doc) => doc.state === 'missing')];
    return {
      spec,
      key: value,
      head: heads.get(spec) ?? null,
      docs: ordered,
      evidence: evidence.length === 0 ? null : { docs: evidence, count: evidence.length, open },
      count: docs.length,
    };
  });
}

/**
 * The catalog of one spec's Library area (spec 017, T46, ISC-158; design.md § Across viewports): the documents of
 * the spec the route's ref `spec` names, its missing entries and its evidence included, plus the workspace's
 * constitution; no group head (the spec head above already carries stage, goal and figures); the fog lines of that
 * spec only; and the control counts of the spec's own documents, the constitution outside them. The ref is matched in
 * the three forms the server's `resolveSpec` accepts (number `002`, folder `002-web-console`, slug `web-console`)
 * through core's `specRefMatches`, so every address of the spec lists the same documents.
 */
export function specScope(catalog: LibraryCatalog, spec: string): LibraryCatalog {
  const own = catalog.docs.filter((doc) => doc.spec !== WORKSPACE_SPEC && specRefMatches(doc.spec, spec));
  const constitution = catalog.docs.filter((doc) => doc.spec === WORKSPACE_SPEC && doc.type === 'constitution');
  return {
    docs: [...own, ...constitution],
    groups: [],
    fog: catalog.fog.filter((line) => specRefMatches(line.spec, spec)),
    missing: own.filter((doc) => doc.state === 'missing').length,
    stale: own.filter((doc) => doc.state === 'stale').length,
  };
}

/** The spec area's order (design.md 017, Tablet 2.7): the spec's own group first, the workspace-wide one after it. */
export const specFirst = (groups: readonly LibraryGroup[]): readonly LibraryGroup[] => [
  ...groups.filter((group) => group.spec !== WORKSPACE_SPEC),
  ...groups.filter((group) => group.spec === WORKSPACE_SPEC),
];

/** The revealed part of an evidence subgroup after `blocks` blocks of `EVIDENCE_BLOCK`, and how many still wait. */
export function evidenceBlock(group: EvidenceGroup, blocks: number): { readonly shown: readonly LibraryDoc[]; readonly rest: number } {
  const shown = group.docs.slice(0, Math.max(0, blocks) * EVIDENCE_BLOCK);
  return { shown, rest: group.count - shown.length };
}

/**
 * The filter "open": each spec's `- fog:` lines (core lists only specs that are not complete) under its number,
 * specs ascending, narrowed by the spec filter and, ignoring case, the search text.
 */
export function fogGroups(catalog: LibraryCatalog, filter: LibraryFilter): readonly FogGroup[] {
  const query = filter.query.trim().toLowerCase();
  const bySpecFolder = new Map<string, LibraryFogLine[]>();
  for (const line of catalog.fog) {
    if (filter.spec !== 'all' && specKey(line.spec) !== filter.spec) continue;
    if (query !== '' && !line.text.toLowerCase().includes(query)) continue;
    const lines = bySpecFolder.get(line.spec);
    if (lines) lines.push(line);
    else bySpecFolder.set(line.spec, [line]);
  }
  return [...bySpecFolder.keys()].sort(bySpec).map((spec) => ({ spec, key: specKey(spec), lines: bySpecFolder.get(spec) ?? [] }));
}

/** One run of a highlighted text: `hit` marks the search match (rendered as `<mark>`). */
export interface TextRun {
  readonly text: string;
  readonly hit: boolean;
}

/** `text` split around the first match of `query` (case ignored); one plain run without a query or a match. */
export function highlight(text: string, query: string): readonly TextRun[] {
  const q = query.trim().toLowerCase();
  const at = q === '' ? -1 : text.toLowerCase().indexOf(q);
  if (at < 0) return [{ text, hit: false }];
  return [
    { text: text.slice(0, at), hit: false },
    { text: text.slice(at, at + q.length), hit: true },
    { text: text.slice(at + q.length), hit: false },
  ].filter((run) => run.text !== '');
}

// ─── Reader sections (spec 021, T40, ISC-251) ────────────────────────────────────────────────────────────────────

/**
 * One `##` section of the reader over core's rendered page; no Markdown is parsed here. Core's `DocsPage.sections`
 * names every level-2 heading with its unique id (the id its `toc` anchors carry), and the page's html holds those h2s
 * as top-level blocks; this is a display split of that html at exactly those headings. The id is the section's slug,
 * so its open state is `?open=s-<id>` (`sectionKey`).
 */
export interface ReaderSection {
  /** Core's heading id (`DocsSection.id`), unique within the page. */
  readonly id: string;
  /** Core's heading text. */
  readonly heading: string;
  /** The `?open=` key of the section. */
  readonly key: OpenKey;
  /** The first sentence of the section's first prose block, whole; empty when the section has no prose. */
  readonly sentence: string;
  /** The section's body: every block after its h2 up to the next, the h2 itself left out. */
  readonly html: string;
  /** Every heading id in the section, its own first: what a contents jump into it may name. */
  readonly anchors: readonly string[];
}

/** A page as the reader shows it: the lead before the first `##` (always visible), the sections and the long flag. */
export interface ReaderSplit {
  readonly lead: string;
  readonly sections: readonly ReaderSection[];
  /** The estimated height of the whole page expanded, in px of the 1440 × 900 reference (`estimateHeight`). */
  readonly height: number;
  /** Longer than three reference screens expanded: the page opens with its first section only. */
  readonly long: boolean;
}

/**
 * The reference the long flag is calibrated against, once (plan 021 § Risks): the 1440 × 900 window, whatever the
 * device. The decision is made here from the text, never from a layout, so the same document opens the same at 390 and
 * at 1440 px. The figures are the reader's own tokens at that width (`doc-prose.css`, design 021 § Desktop):
 *
 * - the reader column is about 690 px wide and prose blocks stop at `72ch`, so a prose line is about 650 px; Manrope
 *   at 15 px sets running text (spaces included) at about 7.6 px a character, so a line holds about 85 characters;
 * - prose lines are 26 px; a paragraph or list ends with 12 px, a blockquote with 16 px;
 * - an h2 is a 26 px line plus 24 + 8 px margin, an h3 a 24 px line, a deeper one a 26 px line, the same margin;
 * - code blocks never wrap: 20 px a source line plus 14 + 14 px padding, a 2 px border and 16 px margin;
 * - a table row is a 20 px line plus 10 + 10 px padding and a 1 px rule; a figure counts as 320 px.
 *
 * The estimate is the sum over the page's top-level blocks; three screens are 3 × 900 px.
 */
const REFERENCE = {
  charsPerLine: 85,
  line: 26,
  blockGap: 12,
  quoteGap: 16,
  headingMargin: 24 + 8,
  h2Line: 26,
  h3Line: 24,
  codeLine: 20,
  codeChrome: 14 + 14 + 2 + 16,
  tableRow: 20 + 10 + 10 + 1,
  tableChrome: 2 + 12,
  figure: 320,
  rule: 24,
} as const;

/** The reference window's height. */
const SCREEN_PX = 900;
/** The long threshold in reference px: an expanded page over three screens opens collapsed (ISC-251). */
export const LONG_PX = 3 * SCREEN_PX;

/** Collapsed whitespace of `text`. */
const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/gu, ' ').trim();

/** Prose lines of `text` at the reference measure; at least one. */
const lines = (text: string | null): number => Math.max(1, Math.ceil(squash(text).length / REFERENCE.charsPerLine));

const isList = (node: Node): boolean => node instanceof Element && (node.tagName === 'UL' || node.tagName === 'OL');

/** The text of a list item without its nested lists. */
const ownText = (item: Element): string =>
  [...item.childNodes]
    .filter((node) => !isList(node))
    .map((node) => node.textContent ?? '')
    .join('');

/** The estimated reference height of one top-level block of core's html. */
function blockHeight(el: Element): number {
  const r = REFERENCE;
  switch (el.tagName) {
    case 'H1':
      return 0; // the reader drops it: its head shows the title
    case 'H2':
      return lines(el.textContent) * r.h2Line + r.headingMargin;
    case 'H3':
      return lines(el.textContent) * r.h3Line + r.headingMargin;
    case 'H4':
    case 'H5':
    case 'H6':
      return lines(el.textContent) * r.line + r.headingMargin;
    case 'P':
      return lines(el.textContent) * r.line + r.blockGap;
    case 'UL':
    case 'OL':
      return [...el.querySelectorAll('li')].reduce((sum, item) => sum + lines(ownText(item)) * r.line, 0) + r.blockGap;
    case 'BLOCKQUOTE':
      return lines(el.textContent) * r.line + r.quoteGap;
    case 'PRE':
      return el.textContent.replace(/\n$/u, '').split('\n').length * r.codeLine + r.codeChrome;
    case 'FIGURE':
      return r.figure;
    case 'HR':
      return r.rule;
    default:
      return el.tagName === 'TABLE' || el.querySelector('table') !== null
        ? el.querySelectorAll('tr').length * r.tableRow + r.tableChrome
        : lines(el.textContent) * r.line + r.blockGap;
  }
}

/** The top-level blocks of `html`, parsed in an inert `template` (nothing loads, no script runs). */
function blocksOf(html: string, doc: Document): readonly Element[] {
  const template = doc.createElement('template');
  template.innerHTML = html;
  return [...template.content.children];
}

/** The estimated height of `page` fully expanded, in px of the 1440 × 900 reference; no device input. */
export function estimateHeight(page: Pick<DocsPage, 'html'>, doc: Document = document): number {
  return blocksOf(page.html, doc).reduce((sum, el) => sum + blockHeight(el), 0);
}

/** A `.` after these (lower case, the last dot left out) never ends a sentence; a single letter (`z. B.`) neither. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  'e.g',
  'i.e',
  'cf',
  'vs',
  'etc',
  'approx',
  'incl',
  'no',
  'nr',
  'ca',
  'bzw',
  'vgl',
  'usw',
  'inkl',
  'ggf',
  'evtl',
  'bspw',
  'z.b',
  'd.h',
  'u.a',
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
  'abb',
  'kap',
]);

/** Closing quotes and brackets that belong to the sentence their mark ends. */
const CLOSERS: ReadonlySet<string> = new Set(['"', "'", '’', '”', '“', '»', '«', ')', ']']);

/** Whether the `.` at `at` ends an abbreviation, an ordinal or list number (`1. Oktober`) or an initial (`z. B.`). */
function shortDot(text: string, at: number): boolean {
  const token = (/(\S+)$/u.exec(text.slice(0, at))?.[1] ?? '').replace(/^[("'“„»«[]+/u, '');
  return /^\d+$/u.test(token) || /^\p{L}$/u.test(token) || ABBREVIATIONS.has(token.toLowerCase());
}

/**
 * The index after the first sentence end of `text` (whitespace collapsed), or its length: a `.`, `!` or `?` with any
 * closing quotes or brackets after it, then a space and a word that does not start in lower case (a lower-case word
 * goes on, `etc. and`). A `shortDot` does not end one, and no mark inside inline code (`code[at]`) does.
 */
function sentenceEnd(text: string, code: readonly boolean[]): number {
  for (let at = 0; at < text.length; at++) {
    const mark = text[at];
    if ((mark !== '.' && mark !== '!' && mark !== '?') || code[at]) continue;
    let end = at + 1;
    while (end < text.length && CLOSERS.has(text[end] ?? '')) end++;
    if (end >= text.length) return end;
    if (text[end] !== ' ') continue;
    const next = text[end + 1] ?? '';
    if (next !== next.toUpperCase()) continue;
    if (mark === '.' && shortDot(text, at)) continue;
    return end;
  }
  return text.length;
}

/** One character of a block's text and whether it sits in inline code. */
type Marked = readonly [string, boolean];

/** The first sentence of marked characters: whitespace runs as one space, trimmed. */
function firstOf(chars: readonly Marked[]): string {
  let text = '';
  const code: boolean[] = [];
  for (const [ch, inCode] of chars) {
    const space = /\s/u.test(ch);
    if (space && (text === '' || text.endsWith(' '))) continue;
    text += space ? ' ' : ch;
    code.push(inCode);
  }
  return text.slice(0, sentenceEnd(text.trimEnd(), code)).trimEnd();
}

/** The first sentence of plain `text`, whitespace collapsed; the whole text when no sentence end is found. */
export const firstSentence = (text: string): string => firstOf(Array.from(text, (ch): Marked => [ch, false]));

/** Every character of `el`'s text, marked when it sits in inline code; nested lists left out. */
function markedText(el: Element): readonly Marked[] {
  const out: Marked[] = [];
  const walk = (node: Node, inCode: boolean): void => {
    if (node.nodeType === node.TEXT_NODE) {
      for (const ch of node.textContent ?? '') out.push([ch, inCode]);
    } else if (node instanceof Element && !isList(node)) {
      for (const child of node.childNodes) walk(child, inCode || node.tagName === 'CODE');
    }
  };
  for (const child of el.childNodes) walk(child, false);
  return out;
}

/** A section's first prose block: a paragraph, a list's first item or a quote; code, figures, tables, headings skipped. */
function firstProse(blocks: readonly Element[]): Element | null {
  for (const el of blocks) {
    if (el.tagName === 'P') return el;
    if (el.tagName === 'BLOCKQUOTE') return el.querySelector('p') ?? el;
    const item = isList(el) ? el.querySelector(':scope > li') : null;
    if (item) return item;
  }
  return null;
}

/** The outer html of `blocks`, newline-joined as core writes them. */
const htmlOf = (blocks: readonly Element[]): string => blocks.map((el) => el.outerHTML).join('\n');

const HEADING = /^H[1-6]$/u;

/**
 * `page` as the reader's sections (ISC-251): the lead before the first `##`, each level-2 section core names with its
 * first sentence and body, the estimated expanded height and the long flag. Takes the served page as it is or after
 * the reader's `rewriteProse`; an h2 core does not name (none, in core's output) stays in the block before it.
 */
export function readerSections(page: Pick<DocsPage, 'html' | 'sections'>, doc: Document = document): ReaderSplit {
  const headings = new Map(page.sections.filter((s) => s.level === 2).map((s) => [s.id, s.heading]));
  const blocks = blocksOf(page.html, doc);
  const lead: Element[] = [];
  const parts: Array<{ readonly head: Element; readonly body: Element[] }> = [];
  for (const el of blocks) {
    if (el.tagName === 'H2' && headings.has(el.id)) parts.push({ head: el, body: [] });
    else (parts.at(-1)?.body ?? lead).push(el);
  }
  const sections = parts.map(({ head, body }): ReaderSection => {
    const prose = firstProse(body);
    const nested = body.flatMap((el) => [el, ...el.querySelectorAll('h1, h2, h3, h4, h5, h6')]).filter((el) => HEADING.test(el.tagName) && el.id !== '');
    return {
      id: head.id,
      heading: headings.get(head.id) ?? squash(head.textContent),
      key: sectionKey(head.id),
      sentence: prose ? firstOf(markedText(prose)) : '',
      html: htmlOf(body),
      anchors: [head.id, ...nested.map((el) => el.id)],
    };
  });
  const height = blocks.reduce((sum, el) => sum + blockHeight(el), 0);
  return { lead: htmlOf(lead), sections, height, long: height > LONG_PX };
}

/** The section a contents entry jumps to (its own h2, or the h2 above a nested heading); null outside every section. */
export const sectionFor = (split: ReaderSplit, anchor: string): ReaderSection | null =>
  split.sections.find((section) => section.anchors.includes(anchor)) ?? null;

/** The sections open without an address: a long page its first only, a short one every section (ISC-251). */
export const defaultOpen = (split: ReaderSplit): readonly OpenKey[] =>
  (split.long ? split.sections.slice(0, 1) : split.sections).map((s) => s.key);

/**
 * The open sections under the address's `?open=` keys: exactly this page's sections the address names when it names
 * any, else `defaultOpen`. Keys of other blocks and of other pages' sections do not count.
 */
export function openSections(split: ReaderSplit, keys: readonly OpenKey[]): ReadonlySet<OpenKey> {
  const own = new Set(split.sections.map((s) => s.key));
  const named = keys.filter((key) => own.has(key));
  return new Set(named.length > 0 ? named : defaultOpen(split));
}
