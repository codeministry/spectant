import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  resource,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LocationStrategy } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { DocsPage, LibraryDoc, LibraryDocType } from '../../../../../core/src/files';
import type { LibraryDocPage } from '../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../../core/refresh.service';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { type OpenKey, OpenState } from '../../shared/open-state';
import { UiDisclosure, UiDisclosureDescription } from '../../shared/ui/overlay/disclosure';
import { UiTimeLabel } from '../../shared/time';
import { UiButton } from '../../shared/ui/button/button';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiSourceChip } from '../../shared/ui/source-chip/source-chip';
import { openSections, type ReaderSection, readerSections, type ReaderSplit, sectionFor, specKey, WORKSPACE_SPEC } from './library-model';
import { PrototypeCard } from './prototype-card';

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
function namesDecisions(heading: string, id: string): boolean {
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
interface SectionPart {
  readonly section: ReaderSection;
  readonly page: DocsPage;
  /** The tables of the document before this section (the lead's and the earlier sections'): its regions number on. */
  readonly tableStart: number;
}

/** The figures of `page` whose element sits in `html` (core numbers them `data-figure="n"`). */
const figuresIn = (page: DocsPage, html: string): DocsPage['figures'] => page.figures.filter((figure) => html.includes(`data-figure="${figure.index}"`));

/** The tables in a chunk of core's HTML (core wraps each in `div.mdtable`, `core/src/markdown.ts`). */
const tablesIn = (html: string): number => html.split('<div class="mdtable">').length - 1;

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

/** Where the reader stands: the workspace library, or a spec's Library area (no "Open in spec" there). */
export type ReaderContext = 'workspace' | 'spec';

/**
 * The library's reader (spec 017, T34, ISC-156.3; design.md 017 § 7 Reader, § 2 Reader, § Across viewports): the
 * head (type tag, spec chip, path, "updated …", the title and "Open in spec NNN"), the stale notice, and the body by the
 * document's media:
 * - Markdown through `ui-doc-prose` (`ApiClient.libraryDoc`): Docs prose with "On this page" (a sticky column at wide,
 *   a disclosure below), mermaid as a figure with its toolbar (ISC-154, ISC-154.1). Relative images load from the
 *   library's file route, `.design/` assets of a design document too; a relative link to another catalog document is
 *   a cross reference `[data-library-xref]` whose click selects that document (`pick`) without leaving the page, its
 *   `href` the library address with the current filters and the target's path as fragment.
 * - An image document as a preview `[data-library-preview]`: the image at its natural size up to the column, alt its
 *   title, from the same file route.
 * - A prototype as its card (`app-prototype-card`, T38, ISC-159): the page list, each page in a new tab on the server's
 *   read route, and the preview from the spec's `.design/`; a missing document is the empty state with the command
 *   that writes it.
 *
 * "Open in spec" leads to the spec dashboard and is left out for workspace-wide documents and in the spec context.
 * Below 1120 px the back button (and Escape) emits `back`; the page restores the list. The table of contents scrolls
 * in place: the library's fragment holds the document's path, so a heading anchor never replaces it. A section of
 * tech.md is named in the address beside it as `?section=<key>` (spec 017, T42: the former tech tabs Overview and
 * Architecture redirect there): once that section is drawn the reader scrolls to it and focuses its heading, once per
 * document and section, so a later filter change does not pull the page back.
 */
@Component({
  selector: 'app-library-reader',
  imports: [
    PrototypeCard,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiChip,
    UiCommandChip,
    UiDisclosure,
    UiDisclosureDescription,
    UiDocProse,
    UiEmptyState,
    UiIcon,
    UiNotice,
    UiSkeleton,
    UiSourceChip,
    UiTimeLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-reader',
    'data-library-reader': '',
    tabindex: '-1',
    '[attr.aria-label]': 'label()',
    '[attr.data-context]': 'context()',
    '(click)': 'follow($event)',
    '(keydown.escape)': 'escape($event)',
  },
  templateUrl: './library-reader.html',
  styleUrl: './library-reader.css',
})
export class LibraryReader {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly locationStrategy = inject(LocationStrategy);
  private readonly transloco = inject(TranslocoService);
  private readonly openState = inject(OpenState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly translation = toSignal(this.transloco.selectTranslation());
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** The workspace slug the routes name. */
  readonly workspace = input.required<string>();
  /** The document shown; null shows "Pick a document". */
  readonly doc = input<LibraryDoc | null>(null);
  /** The catalog's documents: a relative link to one of them is a cross reference. */
  readonly docs = input<readonly LibraryDoc[]>([]);
  readonly context = input<ReaderContext>('workspace');
  /** The wide tier: list and reader side by side, no back button. */
  readonly wide = input(false);

  /** The back button or Escape below 1120 px. */
  readonly back = output();
  /** A cross reference was followed: the catalog path of its document. */
  readonly pick = output<string>();

  /**
   * The section the address names (`?section=`): one of tech.md's four, or `decisions`, the `## Decisions` section of a
   * spec.md (the former Decisions tab redirects there, spec 017, T48, ISC-158.1); null for any other value or document.
   */
  private readonly section = computed<TechSection | typeof DECISIONS_SECTION | null>(() => {
    const value = this.params().get('section');
    const type = this.doc()?.type;
    if (type === 'tech' && isTechSection(value)) return value;
    return type === 'spec' && value === DECISIONS_SECTION ? value : null;
  });
  /** The document and section the reader last jumped to, so the jump happens once per pair. */
  private jumped: string | null = null;

  protected readonly typeIcon = typeIcon;
  protected readonly missingCommand = missingCommand;
  protected readonly fileName = fileName;

  protected readonly label = computed(() => {
    this.translation();
    return this.transloco.translate('library.reader.label');
  });
  private readonly wsName = computed(() => this.data.workspaceName(this.workspace()));
  private readonly paths = computed<ReadonlySet<string>>(() => new Set(this.docs().map((doc) => doc.path)));

  /** The current Markdown document as core renders it (`GET …/library/doc?path=`); idle for images, prototypes, missing. */
  private readonly page = resource({
    params: () => this.target(),
    loader: ({ params }) => this.api.libraryDoc(params.ws, params.path),
  });
  /**
   * The document the page reads, equal while workspace and path are: a refreshed catalog hands the reader a new `doc`
   * object for the same file, which must not start a fresh load (that would drop the value and flash the loading state).
   */
  private readonly target = computed(
    () => {
      const doc = this.doc();
      return doc !== null && doc.media === 'markdown' && doc.state !== 'missing' ? { ws: this.workspace(), path: doc.path } : undefined;
    },
    { equal: (a, b) => a?.ws === b?.ws && a?.path === b?.path },
  );
  /** A first read of a document; a refresh's reload keeps the shown document in place, so it is no loading state. */
  protected readonly loading = computed(() => this.page.status() === 'loading');
  protected readonly failed = computed(() => {
    if (this.page.status() === 'error') return true;
    const result = this.page.hasValue() ? this.page.value() : undefined;
    return result !== undefined && result.kind !== 'ok';
  });

  /**
   * The served page with the reader's links (`rewriteProse`); its html changes only with the page or the catalog.
   * tech.md comes as its four sections (`techReading`), with the keys the file has no section for.
   */
  private readonly reading = computed<TechReading | null>(() => {
    const result = this.page.hasValue() ? this.page.value() : undefined;
    const doc = this.doc();
    if (result?.kind !== 'ok' || doc === null) return null;
    const ws = this.workspace();
    const links: ProseLinks = {
      dir: folderOf(doc.path),
      catalog: this.paths(),
      asset: (path) => this.api.libraryAssetUrl(ws, path),
      xref: (path) => untracked(() => this.xrefHref(path)),
    };
    const page = { ...result.body, html: rewriteProse(result.body.html, links) };
    if (doc.type !== 'tech') return { page, present: [], missing: [] };
    // A section without its own h2 is named in the contents by its key's label, in the current language.
    this.translation();
    return techReading(page, document, (key) => this.transloco.translate(`library.tech.sections.${key}`));
  });
  protected readonly prose = computed<DocsPage | null>(() => this.reading()?.page ?? null);

  /**
   * The page as its `##` sections (ISC-251, `readerSections`); null for a page without one and for tech.md, whose
   * sections are its own (`techReading`), so both read as before.
   */
  private readonly split = computed<ReaderSplit | null>(() => {
    const page = this.prose();
    if (page === null || this.doc()?.type === 'tech') return null;
    const split = readerSections(page);
    return split.sections.length > 0 ? split : null;
  });
  /** What the prose itself shows: the lead before the first `##` with the whole contents, or the page as it is. */
  protected readonly lead = computed<DocsPage | null>(() => {
    const page = this.prose();
    const split = this.split();
    return page !== null && split !== null ? { ...page, html: split.lead, figures: figuresIn(page, split.lead) } : page;
  });
  /** Each section with its body as a page of its own, drawn through the same `ui-doc-prose`. */
  protected readonly sections = computed<readonly SectionPart[]>(() => {
    const page = this.prose();
    const split = this.split();
    if (page === null || split === null) return [];
    let tables = tablesIn(split.lead);
    return split.sections.map((section) => {
      const tableStart = tables;
      tables += tablesIn(section.html);
      return { section, tableStart, page: { ...page, html: section.html, toc: [], figures: figuresIn(page, section.html) } };
    });
  });
  /** The open sections: what `?open=` names of this page, else a long page its first, a short one all (`readerOpen`). */
  protected readonly opened = computed<ReadonlySet<OpenKey>>(() => {
    const split = this.split();
    return split === null ? new Set() : readerOpen(split, this.openState.keys());
  });
  /** A contents jump waiting for its section to open: the section's id and the anchor to land on. */
  private readonly pending = signal<{ readonly section: string; readonly anchor: string } | null>(null);
  /** tech.md only: the sections the file has none for, named under the prose. */
  protected readonly techMissing = computed<readonly TechSection[]>(() => this.reading()?.missing ?? []);
  /** The placeholder of an absent `specs/tech.md` (the page lists it dimmed): the empty state, with no command: the Spec plugin has none that writes it. */
  protected readonly techAbsent = computed(() => {
    const doc = this.doc();
    return doc?.type === 'tech' && doc.state === 'missing';
  });

  /** `.design/` assets of a design document (`data-spec-asset`, relative to its folder) through the same file route. */
  protected readonly assetUrl = computed<(path: string) => string>(() => {
    const ws = this.workspace();
    const dir = folderOf(this.doc()?.path ?? '');
    return (path) => this.api.libraryAssetUrl(ws, dir === '' ? path : `${dir}/${path}`);
  });

  /** The image document's own URL on the file route; null for every other media. */
  protected readonly preview = computed<string | null>(() => {
    const doc = this.doc();
    return doc?.media === 'image' ? this.api.libraryAssetUrl(this.workspace(), doc.path) : null;
  });

  /** The spec dashboard of a spec's document; none for a workspace-wide one and none in the spec context. */
  protected readonly openLink = computed<string[] | null>(() => {
    const doc = this.doc();
    if (doc === null || doc.spec === WORKSPACE_SPEC || this.context() === 'spec') return null;
    return specLink(this.workspace(), specKey(doc.spec));
  });

  constructor() {
    // The live refresh re-reads the open document with the catalog (ETag, so an unchanged file costs a 304); the
    // reload keeps the shown page, so the prose, its scroll position and a selection in it stay in place.
    const refresher = inject(RefreshService);
    let seen = refresher.refreshes();
    effect(() => {
      const count = refresher.refreshes();
      if (count === seen) return;
      seen = count;
      untracked(() => this.page.reload());
    });
    // A cross reference's href follows the address's filters, set on the drawn anchors, so the prose is not redrawn.
    afterRenderEffect({
      write: () => {
        this.params();
        this.prose();
        for (const anchor of this.host.querySelectorAll<HTMLAnchorElement>('a[data-library-xref]')) {
          anchor.setAttribute('href', this.xrefHref(anchor.dataset['libraryXref'] ?? ''));
        }
      },
    });
    // `?section=` scrolls to that section of tech.md and focuses its heading once it is drawn (spec 017, T42).
    afterRenderEffect({
      write: () => {
        const section = this.section();
        this.prose();
        if (section === null) {
          this.jumped = null;
          return;
        }
        const key = `${this.doc()?.path ?? ''}#${section}`;
        if (this.jumped === key) return;
        // A spec.md drawn as sections: the Decisions section opens and takes the focus like a contents jump.
        const decisions = section === DECISIONS_SECTION ? this.sections().find((part) => namesDecisions(part.section.heading, part.section.id)) : undefined;
        if (decisions !== undefined) {
          this.jumped = key;
          untracked(() => this.jumpTo(decisions.section, decisions.section.id));
          return;
        }
        const heading =
          section === DECISIONS_SECTION
            ? decisionsHeading(this.host)
            : this.host.querySelector<HTMLElement>(`section[data-library-tech-section="${section}"] > h2, section[data-library-tech-section="${section}"][id]`);
        if (heading === null) return;
        this.jumped = key;
        heading.setAttribute('tabindex', '-1');
        heading.scrollIntoView({ block: 'start' });
        heading.focus({ preventScroll: true });
      },
    });
    // The table of contents scrolls in place, ahead of ui-doc-prose's own jump, which would put the heading's anchor
    // into the fragment that names the document (capture phase on the host: the link's own listener never runs).
    const toc = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('.docs-toc-list a[href^="#"]') : null;
      if (link === null || !this.host.contains(link)) return;
      event.preventDefault();
      event.stopPropagation();
      const anchor = (link.getAttribute('href') ?? '').slice(1);
      // Into a section (its own ## or a heading below it): the section opens first, then the jump lands (ISC-251).
      const split = this.split();
      const target = split === null ? null : sectionFor(split, anchor);
      if (target !== null) {
        this.jumpTo(target, anchor);
        return;
      }
      const heading = this.host.querySelector<HTMLElement>(`.docs-prose [id="${anchor.replaceAll('"', '')}"]`);
      if (heading === null) return;
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
    };
    // A pending jump lands once its section is drawn open (no longer inert): on the section's own toggle for its ##,
    // on the heading below it otherwise; scrolled to and focused, the focus in the arriving section (DS-APP-35).
    afterRenderEffect({
      write: () => {
        const pending = this.pending();
        const part = pending === null ? undefined : this.sections().find((entry) => entry.section.id === pending.section);
        if (pending === null || part === undefined || !this.opened().has(part.section.key)) return;
        const element = [...this.host.querySelectorAll<HTMLElement>('[data-library-section]')].find((el) => el.dataset['librarySection'] === pending.section);
        untracked(() => this.pending.set(null));
        if (element === undefined) return;
        const toggle = element.querySelector<HTMLElement>(':scope > .head .summary');
        const heading =
          pending.anchor === pending.section ? null : [...element.querySelectorAll<HTMLElement>('.docs-prose [id]')].find((el) => el.id === pending.anchor);
        const scrollTo = heading ?? element;
        const focus = heading ?? toggle;
        heading?.setAttribute('tabindex', '-1');
        scrollTo.scrollIntoView({ block: 'start' });
        focus?.focus({ preventScroll: true });
      },
    });
    this.host.addEventListener('click', toc, { capture: true });
    inject(DestroyRef).onDestroy(() => {
      this.host.removeEventListener('click', toc, { capture: true });
    });
  }

  /** The spec chip: the number, or the workspace for a workspace-wide document. */
  protected chipLabel(spec: string): string {
    return spec === WORKSPACE_SPEC ? this.wsName() : specKey(spec);
  }

  /** The document's file (or prototype folder) as the workspace names it: below `specs/`. */
  protected filePath(doc: Pick<LibraryDoc, 'path'>): string {
    return `specs/${doc.path}`;
  }

  /** A section toggled: the page's open sections go into `?open=` in one change (`openEntries`). */
  protected setOpen(key: OpenKey, open: boolean): void {
    const split = this.split();
    if (split === null) return;
    const next = new Set(this.opened());
    if (open) next.add(key);
    else next.delete(key);
    void this.openState.assign(openEntries(split, next));
  }

  /** Opens `section` if it is closed and lands on `anchor` in it once it is drawn open. */
  private jumpTo(section: ReaderSection, anchor: string): void {
    if (!this.opened().has(section.key)) this.setOpen(section.key, true);
    this.pending.set({ section: section.id, anchor });
  }

  /** A plain click on a cross reference selects its document in place; a modified click keeps the browser's way. */
  protected follow(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-library-xref]') : null;
    const path = link?.dataset['libraryXref'];
    if (path === undefined) return;
    event.preventDefault();
    this.pick.emit(path);
  }

  /** Escape below 1120 px returns to the list, unless a dialog (the diagram's full screen) takes it. */
  protected escape(event: Event): void {
    if (this.wide() || this.doc() === null || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('dialog') !== null) return;
    event.preventDefault();
    this.back.emit();
  }

  /** The library address of a catalog document: this page, its filters as they stand, the path as fragment, no section. */
  private xrefHref(path: string): string {
    const tree = this.router.createUrlTree([], { relativeTo: this.route, queryParams: { section: null }, queryParamsHandling: 'merge', fragment: path });
    return this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(tree));
  }
}
