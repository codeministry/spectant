import { computed, inject, Injectable, resource, type Signal, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LocationStrategy } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { DocsPage, LibraryDoc } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { type OpenKey, OpenState } from '../../shared/open-state';
import { specKey, WORKSPACE_SPEC } from './library-model';
import {
  DECISIONS_SECTION,
  figuresIn,
  folderOf,
  isTechSection,
  openEntries,
  type ProseLinks,
  type ReaderContext,
  readerOpen,
  rewriteProse,
  type SectionPart,
  tablesIn,
  type TechReading,
  techReading,
  type TechSection,
} from './library-prose';
import { readerSections, type ReaderSplit } from './library-sections';
import { reloadOnRefresh } from './reload-on-refresh';

/** What the reader hands its store: its inputs, read as they are. */
export interface ReaderInputs {
  readonly workspace: Signal<string>;
  readonly doc: Signal<LibraryDoc | null>;
  readonly docs: Signal<readonly LibraryDoc[]>;
  readonly context: Signal<ReaderContext>;
}

/**
 * The library reader's state (spec 017, T34, T42, T48; spec 021, ISC-251; spec 061, ISC-436): the open document as
 * core renders it (`ApiClient.libraryDoc`), re-read on every live refresh, with the reader's links, tech.md's four
 * sections, the `##` sections and which of them the address opens, the asset and image URLs, "Open in spec" and the
 * `?section=` the address names. Provided by `LibraryReader`, which connects its inputs once (`connect`) and keeps the
 * DOM work: drawn anchors, jumps, focus and the contents' clicks.
 */
@Injectable()
export class LibraryReaderStore {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly locationStrategy = inject(LocationStrategy);
  private readonly transloco = inject(TranslocoService);
  private readonly openState = inject(OpenState);
  private readonly translation = toSignal(this.transloco.selectTranslation());
  /** The route's query params: `?section=`, `?open=` and the filters a cross reference's href carries. */
  readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  private readonly inputs = signal<ReaderInputs | null>(null);
  readonly workspace = computed(() => this.inputs()?.workspace() ?? '');
  readonly doc = computed(() => this.inputs()?.doc() ?? null);
  private readonly docs = computed<readonly LibraryDoc[]>(() => this.inputs()?.docs() ?? []);
  private readonly context = computed<ReaderContext>(() => this.inputs()?.context() ?? 'workspace');

  /**
   * The section the address names (`?section=`): one of tech.md's four, or `decisions`, the `## Decisions` section of a
   * spec.md (the former Decisions tab redirects there, spec 017, T48, ISC-158.1); null for any other value or document.
   */
  readonly section = computed<TechSection | typeof DECISIONS_SECTION | null>(() => {
    const value = this.params().get('section');
    const type = this.doc()?.type;
    if (type === 'tech' && isTechSection(value)) return value;
    return type === 'spec' && value === DECISIONS_SECTION ? value : null;
  });

  readonly wsName = computed(() => this.data.workspaceName(this.workspace()));
  private readonly paths = computed<ReadonlySet<string>>(() => new Set(this.docs().map((doc) => doc.path)));

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
  /** The current Markdown document as core renders it (`GET …/library/doc?path=`); idle for images, prototypes, missing. */
  private readonly page = resource({
    params: () => this.target(),
    loader: ({ params }) => this.api.libraryDoc(params.ws, params.path),
  });
  /** A first read of a document; a refresh's reload keeps the shown document in place, so it is no loading state. */
  readonly loading = computed(() => this.page.status() === 'loading');
  readonly failed = computed(() => {
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
    return techReading(page, undefined, (key) => this.transloco.translate(`library.tech.sections.${key}`));
  });
  readonly prose = computed<DocsPage | null>(() => this.reading()?.page ?? null);

  /**
   * The page as its `##` sections (ISC-251, `readerSections`); null for a page without one and for tech.md, whose
   * sections are its own (`techReading`), so both read as before.
   */
  readonly split = computed<ReaderSplit | null>(() => {
    const page = this.prose();
    if (page === null || this.doc()?.type === 'tech') return null;
    const split = readerSections(page);
    return split.sections.length > 0 ? split : null;
  });
  /** What the prose itself shows: the lead before the first `##` with the whole contents, or the page as it is. */
  readonly lead = computed<DocsPage | null>(() => {
    const page = this.prose();
    const split = this.split();
    return page !== null && split !== null ? { ...page, html: split.lead, figures: figuresIn(page, split.lead) } : page;
  });
  /** Each section with its body as a page of its own, drawn through the same `ui-doc-prose`. */
  readonly sections = computed<readonly SectionPart[]>(() => {
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
  readonly opened = computed<ReadonlySet<OpenKey>>(() => {
    const split = this.split();
    return split === null ? new Set() : readerOpen(split, this.openState.keys());
  });
  /** tech.md only: the sections the file has none for, named under the prose. */
  readonly techMissing = computed<readonly TechSection[]>(() => this.reading()?.missing ?? []);
  /** The placeholder of an absent `specs/tech.md` (the page lists it dimmed): the empty state, with no command: the Spec plugin has none that writes it. */
  readonly techAbsent = computed(() => {
    const doc = this.doc();
    return doc?.type === 'tech' && doc.state === 'missing';
  });

  /** `.design/` assets of a design document (`data-spec-asset`, relative to its folder) through the same file route. */
  readonly assetUrl = computed<(path: string) => string>(() => {
    const ws = this.workspace();
    const dir = folderOf(this.doc()?.path ?? '');
    return (path) => this.api.libraryAssetUrl(ws, dir === '' ? path : `${dir}/${path}`);
  });

  /** The image document's own URL on the file route; null for every other media. */
  readonly preview = computed<string | null>(() => {
    const doc = this.doc();
    return doc?.media === 'image' ? this.api.libraryAssetUrl(this.workspace(), doc.path) : null;
  });

  /** The spec dashboard of a spec's document; none for a workspace-wide one and none in the spec context. */
  readonly openLink = computed<string[] | null>(() => {
    const doc = this.doc();
    if (doc === null || doc.spec === WORKSPACE_SPEC || this.context() === 'spec') return null;
    return specLink(this.workspace(), specKey(doc.spec));
  });

  constructor() {
    // The live refresh re-reads the open document with the catalog (ETag, so an unchanged file costs a 304); the
    // reload keeps the shown page, so the prose, its scroll position and a selection in it stay in place.
    reloadOnRefresh(() => this.page.reload());
  }

  /** The reader's inputs, once from its constructor: every derivation above reads them from here. */
  connect(inputs: ReaderInputs): void {
    this.inputs.set(inputs);
  }

  /** A section toggled: the page's open sections go into `?open=` in one change (`openEntries`). */
  setOpen(key: OpenKey, open: boolean): void {
    const split = this.split();
    if (split === null) return;
    const next = new Set(this.opened());
    if (open) next.add(key);
    else next.delete(key);
    void this.openState.assign(openEntries(split, next));
  }

  /** The library address of a catalog document: this page, its filters as they stand, the path as fragment, no section. */
  xrefHref(path: string): string {
    const tree = this.router.createUrlTree([], { relativeTo: this.route, queryParams: { section: null }, queryParamsHandling: 'merge', fragment: path });
    return this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(tree));
  }
}
