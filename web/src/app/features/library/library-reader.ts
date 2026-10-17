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
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LocationStrategy } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { DocsPage, LibraryDoc, LibraryDocType } from '../../../../../core/src/files';
import type { LibraryDocPage } from '../../../../../server/src/spec-routes.contract';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../../core/refresh.service';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiTimeLabel } from '../../shared/time';
import { UiButton } from '../../shared/ui/button/button';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiDocProse } from '../../shared/ui/doc-prose/doc-prose';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { specKey, WORKSPACE_SPEC } from './library-model';
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
 * The command that writes a missing document (design.md 017 § 2.2): `/spec-plan 017` for plan.md, `/spec-tasks 017`
 * for tasks.md; core marks no other type missing, so every other answers null.
 */
export function missingCommand(doc: Pick<LibraryDoc, 'type' | 'spec'>): string | null {
  return doc.type === 'plan' || doc.type === 'tasks' ? `/spec-${doc.type} ${specKey(doc.spec)}` : null;
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
  const named = (heading: Element): boolean => {
    const text = plainWords(heading.textContent);
    return DECISIONS_NAMES.some((name) => text === name || text.startsWith(`${name} `) || heading.id === name || heading.id.endsWith(`-${name}`));
  };
  return [...root.querySelectorAll<HTMLElement>('.docs-prose h2')].find(named) ?? null;
}

/** tech.md as the reader shows it: the page with the four sections in order, and the keys the file has none for. */
export interface TechReading {
  readonly page: DocsPage;
  readonly present: readonly TechSection[];
  readonly missing: readonly TechSection[];
}

interface TechChunk {
  readonly heading: Element;
  key: TechSection | null;
  readonly nodes: Node[];
}

/**
 * The served tech.md page (one `DocsPage` of the whole file, the markers gone) as its four sections (ISC-157): the
 * sections are core's (`techSections`, `techSectionHeads` over the file's `<!-- section: key -->` markers, ISC-157.2).
 * Each key's heading names a level-2 entry of the page's own toc, and that h2 (by its id) opens the section; any other
 * h2 stays in the section before it. Nothing is named from a heading's words, so a differing heading still opens its
 * section, and a page without core's heads has no section. Each section becomes `<section data-library-tech-section="key">` with its h2's id set to the key (the stable anchor),
 * in the order overview, stack, architecture, risks whatever the file's; prose before the first h2 stays in front,
 * without the h1 (the reader's head shows the title). The contents list holds exactly the present sections. Parsed in
 * an inert `template` and rebuilt from core's own nodes, so the output is as trusted as core's input.
 */
export function techReading(page: LibraryDocPage, doc: Document = document): TechReading {
  // Core's heads to the h2 ids of this page: each heading claims the first unclaimed level-2 toc entry of its text.
  const keyOfId = new Map<string, TechSection>();
  for (const head of page.techSections ?? []) {
    const entry = page.toc.find((t) => t.level === 2 && t.text === head.heading && !keyOfId.has(t.anchor));
    if (head.heading !== null && entry !== undefined) keyOfId.set(entry.anchor, head.key);
  }
  const template = doc.createElement('template');
  template.innerHTML = page.html;
  const lead: Node[] = [];
  const chunks: TechChunk[] = [];
  for (const node of [...template.content.childNodes]) {
    const tag = node instanceof Element ? node.tagName : '';
    if (tag === 'H2' && node instanceof Element) chunks.push({ heading: node, key: keyOfId.get(node.id) ?? null, nodes: [node] });
    else if (chunks.length > 0) chunks.at(-1)?.nodes.push(node);
    else if (tag !== 'H1') lead.push(node);
  }
  const sections = new Map<TechSection, TechChunk>();
  let last: Node[] = lead;
  for (const chunk of chunks) {
    if (chunk.key !== null && !sections.has(chunk.key)) {
      sections.set(chunk.key, chunk);
      last = chunk.nodes;
    } else last.push(...chunk.nodes);
  }
  const out = doc.createElement('template');
  out.content.append(...lead);
  const present = TECH_SECTIONS.filter((key) => sections.has(key));
  const toc = present.map((key) => {
    const chunk = sections.get(key) as TechChunk;
    chunk.heading.id = key;
    const element = doc.createElement('section');
    element.setAttribute('data-library-tech-section', key);
    element.append(...chunk.nodes);
    out.content.append(element);
    return { level: 2, text: chunk.heading.textContent.trim(), anchor: key };
  });
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
  imports: [PrototypeCard, RouterLink, TranslocoPipe, UiButton, UiChip, UiCommandChip, UiDocProse, UiEmptyState, UiIcon, UiNotice, UiSkeleton, UiTimeLabel],
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
    return doc.type === 'tech' ? techReading(page) : { page, present: [], missing: [] };
  });
  protected readonly prose = computed<DocsPage | null>(() => this.reading()?.page ?? null);
  /** tech.md only: the sections the file has none for, named under the prose. */
  protected readonly techMissing = computed<readonly TechSection[]>(() => this.reading()?.missing ?? []);
  /** The placeholder of an absent `specs/tech.md` (the page lists it dimmed): the empty state with `/spec-doc`. */
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
        const heading =
          section === DECISIONS_SECTION
            ? decisionsHeading(this.host)
            : this.host.querySelector<HTMLElement>(`section[data-library-tech-section="${section}"] > h2`);
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
      const heading = this.host.querySelector<HTMLElement>(`.docs-prose [id="${anchor.replaceAll('"', '')}"]`);
      if (heading === null) return;
      heading.setAttribute('tabindex', '-1');
      heading.scrollIntoView({ block: 'start' });
      heading.focus({ preventScroll: true });
    };
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
