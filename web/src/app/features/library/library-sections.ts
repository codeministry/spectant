import type { DocsPage } from '../../../../../core/src/files';
import { type OpenKey, sectionKey } from '../../shared/open-state';

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
