import type { DocsPage, LibraryDoc, LibraryDocType } from '../../../../../core/src/files';
import type { LibraryDocPage } from '../../../../../server/src/contracts/spec-routes.contract';
import type { IconName } from '../../shared/icons/icons';
import type { OpenKey } from '../../shared/open-state';
import { specKey } from './library-model';
import { openSections, type ReaderSection, type ReaderSplit } from './library-sections';

/*
 * The reader's pure parts (spec 017, T34, T42, ISC-156.3, ISC-157; spec 021, ISC-251): type icons, the prose's links,
 * tech.md's sections and the open keys of a page split into sections. No Angular; the reader and its store use them.
 */

/**
 * Each catalog type's tag icon (design.md 017 § Across viewports, Mobile § 3): the Markdown kinds a page, tasks
 * the checklist, design the palette, a prototype the app window, the constitution the scale, tech the open book, an
 * idea the bulb. An image document draws `image` whatever its type (`typeIcon`).
 */
const TYPE_ICON: Readonly<Record<LibraryDocType, IconName>> = {
  spec: 'file-text',
  plan: 'file-text',
  tasks: 'list-checks',
  design: 'palette',
  context: 'file-text',
  artifact: 'file-text',
  evidence: 'file-text',
  prototype: 'app-window',
  constitution: 'scale',
  tech: 'book-open',
  tldr: 'file-text',
  idea: 'lightbulb',
};

export const typeIcon = (doc: Pick<LibraryDoc, 'type' | 'media'>): IconName => (doc.media === 'image' ? 'image' : TYPE_ICON[doc.type]);

/**
 * The command that writes a missing document (design.md 017 § 2.2): `/spec plan 017` for plan.md, `/spec tasks 017`
 * for tasks.md; core marks no other type missing, so every other answers null.
 */
export function missingCommand(doc: Pick<LibraryDoc, 'type' | 'spec'>): string | null {
  return doc.type === 'plan' || doc.type === 'tasks' ? `/spec ${doc.type} ${specKey(doc.spec)}` : null;
}

/** The file name of a document path (`017-x/plan.md` → `plan.md`). */
export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The folder of a catalog path below `specs/` (`017-x/plan.md` → `017-x`, `constitution.md` → ``). */
export const folderOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** A scheme (`https:`, `mailto:`), a protocol-relative or root path, or a bare fragment: never a sibling file. */
const NOT_RELATIVE = /^(?:[a-z][a-z\d+.-]*:|\/|#)/iu;

/**
 * A relative reference of a document in `dir` (a folder below `specs/`) as a catalog path: the query and fragment
 * dropped, decoded once like the routes decode, `.` and `..` resolved lexically. Null for an absolute or empty
 * reference, an undecodable one, and one that climbs above `specs/`.
 */
export function resolveRelative(dir: string, ref: string): string | null {
  if (ref === '' || NOT_RELATIVE.test(ref)) return null;
  const bare = ref.split(/[?#]/u, 1)[0] ?? '';
  let decoded: string;
  try {
    decoded = decodeURIComponent(bare);
  } catch {
    return null;
  }
  const out = dir === '' ? [] : dir.split('/');
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') out.push(segment);
    else if (out.pop() === undefined) return null;
  }
  return out.length === 0 ? null : out.join('/');
}

/** What the reader rewrites core's prose with: the document's folder, the catalog's paths and the two URL builders. */
export interface ProseLinks {
  /** The document's folder below `specs/` (`folderOf`). */
  readonly dir: string;
  /** Every catalog path: a relative link to one of them is a cross reference. */
  readonly catalog: ReadonlySet<string>;
  /** The file route URL of an image below `specs/`. */
  readonly asset: (path: string) => string;
  /** The library address of a catalog document (its reader anchor). */
  readonly xref: (path: string) => string;
}

/**
 * Core's rendered HTML with the reader's links (ISC-156.3): a relative image (`img[src]` as written) loads from the
 * app's file route below `specs/` (`artifacts/`, `.evidence/`, `.design/` alike), and a relative link to another
 * catalog document points at that document's reader anchor and carries `data-library-xref` with its path. Links to a
 * file outside the catalog and every absolute link stay as written. The document's first h1 is dropped: it is the
 * title core reads (`LibraryDoc.title`), which the reader's head already shows. Parsed in an inert `template` (nothing
 * loads, no script runs) and only attributes this function builds are set, so the output is as trusted as core's input.
 */
export function rewriteProse(html: string, links: ProseLinks, doc: Document = document): string {
  const template = doc.createElement('template');
  template.innerHTML = html;
  [...template.content.children].find((el) => el.tagName === 'H1')?.remove();
  for (const img of template.content.querySelectorAll<HTMLImageElement>('img[src]')) {
    const path = resolveRelative(links.dir, img.getAttribute('src') ?? '');
    if (path !== null) img.setAttribute('src', links.asset(path));
  }
  for (const anchor of template.content.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const path = resolveRelative(links.dir, anchor.getAttribute('href') ?? '');
    if (path === null || !links.catalog.has(path)) continue;
    anchor.setAttribute('href', links.xref(path));
    anchor.setAttribute('data-library-xref', path);
  }
  return template.innerHTML;
}

/** Where the reader stands: the workspace library, or a spec's Library area (no "Open in spec" there). */
export type ReaderContext = 'workspace' | 'spec';

/** The four sections of `specs/tech.md` (contract ISC-134), in the order the reader shows them; also their anchors. */
export const TECH_SECTIONS = ['overview', 'stack', 'architecture', 'risks'] as const;
export type TechSection = (typeof TECH_SECTIONS)[number];

const plainWords = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export const isTechSection = (value: unknown): value is TechSection => (TECH_SECTIONS as readonly unknown[]).includes(value);

/** `?section=decisions`: the `## Decisions` section of a spec.md (spec 017, T48, ISC-158.1). */
export const DECISIONS_SECTION = 'decisions';
const DECISIONS_NAMES: readonly string[] = ['decisions', 'entscheidungen'];

/** The drawn `## Decisions` heading of a spec.md: the h2 whose text (English or German) or id names it; null without. */
export function decisionsHeading(root: ParentNode): HTMLElement | null {
  return [...root.querySelectorAll<HTMLElement>('.docs-prose h2')].find((heading) => namesDecisions(heading.textContent, heading.id)) ?? null;
}

/** A `## Decisions` heading by its text (English or German) or its id. */
export function namesDecisions(heading: string, id: string): boolean {
  const text = plainWords(heading);
  return DECISIONS_NAMES.some((name) => text === name || text.startsWith(`${name} `) || id === name || id.endsWith(`-${name}`));
}

/**
 * The key a page writes once every one of its sections is closed (ISC-251): `s-~` and its first section's id. Without
 * it an address naming none of the page's sections means "the default", so a short page closed section by section
 * would open whole again on a reload. Core's heading ids are letters, digits and hyphens, so `~` never names a section;
 * keyed to the page's first section, it holds for this page and not for the next document the address shows.
 */
export const closedKey = (split: ReaderSplit): OpenKey | null => {
  const first = split.sections.at(0);
  return first === undefined ? null : `s-~${first.id}`;
};

/** The open sections of a page under the address's keys: none after `closedKey`, else `openSections`. */
export function readerOpen(split: ReaderSplit, keys: readonly OpenKey[]): ReadonlySet<OpenKey> {
  const own = new Set(split.sections.map((section) => section.key));
  const closed = closedKey(split);
  if (closed !== null && keys.includes(closed) && !keys.some((key) => own.has(key))) return new Set();
  return openSections(split, keys);
}

/** What the address gets for `open`: every section of the page named open or closed, and `closedKey` when none is open. */
export function openEntries(split: ReaderSplit, open: ReadonlySet<OpenKey>): ReadonlyArray<readonly [OpenKey, boolean]> {
  const entries = split.sections.map((section) => [section.key, open.has(section.key)] as const);
  const closed = closedKey(split);
  return closed === null ? entries : [...entries, [closed, open.size === 0] as const];
}

/** One section as the reader draws it: core's split and the page its body renders as (no contents, its own figures). */
export interface SectionPart {
  readonly section: ReaderSection;
  readonly page: DocsPage;
  /** The tables of the document before this section (the lead's and the earlier sections'): its regions number on. */
  readonly tableStart: number;
}

/** The figures of `page` whose element sits in `html` (core numbers them `data-figure="n"`). */
export const figuresIn = (page: DocsPage, html: string): DocsPage['figures'] => page.figures.filter((figure) => html.includes(`data-figure="${figure.index}"`));

/** The tables in a chunk of core's HTML (core wraps each in `div.mdtable`, `core/src/markdown.ts`). */
export const tablesIn = (html: string): number => html.split('<div class="mdtable">').length - 1;

/** tech.md as the reader shows it: the page with the four sections in order, and the keys the file has none for. */
export interface TechReading {
  readonly page: DocsPage;
  readonly present: readonly TechSection[];
  readonly missing: readonly TechSection[];
}

/** The attribute core wraps each marker's part of the served tech.md in (`TECH_PART_ATTRIBUTE`, `renderTechDocument`). */
const TECH_PART = 'data-tech-part';

/**
 * The served tech.md page as its four sections (ISC-157, ISC-355): the sections are core's, cut at the file's
 * `<!-- section: key -->` markers as `readTech` reads them (contract ISC-134), never at an h2. Core's route renders
 * the file once and wraps each marker's part in `<section data-tech-part="key">` (`renderTechDocument`); a repeated
 * key's parts join in file order, a part of no contract key and the text before the first marker belong to no section
 * and stay in front, without the h1 (the reader's head shows the title). Each key becomes
 * `<section data-library-tech-section="key">`, in the order overview, stack, architecture, risks whatever the file's;
 * its anchor is the key, on its first h2 or, when its part has none, on the section itself, and the contents list names
 * it by that h2 (core's `techSectionHeads` heading) or by `label`. A page without core's parts has no section. Parsed in
 * an inert `template` and rebuilt from core's own nodes, so the output is as trusted as core's input.
 */
export function techReading(page: LibraryDocPage, doc: Document = document, label: (key: TechSection) => string = (key) => key): TechReading {
  const template = doc.createElement('template');
  template.innerHTML = page.html;
  const lead: Node[] = [];
  const sections = new Map<TechSection, Node[]>();
  for (const node of [...template.content.childNodes]) {
    const part = node instanceof Element && node.tagName === 'SECTION' ? node.getAttribute(TECH_PART) : null;
    if (part === null) {
      if (!(node instanceof Element && node.tagName === 'H1')) lead.push(node);
    } else if (isTechSection(part)) sections.set(part, [...(sections.get(part) ?? []), ...node.childNodes]);
    else lead.push(...node.childNodes);
  }
  const out = doc.createElement('template');
  out.content.append(...lead);
  const present = TECH_SECTIONS.filter((key) => sections.has(key));
  const anchors = new Set<Element>();
  const toc = present.map((key) => {
    const element = doc.createElement('section');
    element.setAttribute('data-library-tech-section', key);
    element.append(...(sections.get(key) ?? []));
    out.content.append(element);
    const heading = element.querySelector(':scope > h2');
    anchors.add(heading ?? element);
    return { level: 2, text: heading?.textContent.trim() ?? label(key), anchor: key };
  });
  // The key is the section's anchor alone: an element elsewhere whose own id core slugged to it (an h2 "Stack" before
  // the first marker) gives the id up, so a jump to the key always lands on the section.
  for (const element of out.content.querySelectorAll('[id]')) if (!anchors.has(element) && isTechSection(element.id) && present.includes(element.id)) element.removeAttribute('id');
  for (const [i, anchor] of [...anchors].entries()) anchor.id = present[i] ?? anchor.id;
  return { page: { ...page, html: out.innerHTML, toc }, present, missing: TECH_SECTIONS.filter((key) => !sections.has(key)) };
}
