import { computed, DestroyRef, effect, inject, Injectable, linkedSignal, resource, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { LibraryTabCount } from '../../layout/shell/page-tabs';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { FilterOption } from '../../shared/ui/filter-chips/filter-chips';
import {
  EVIDENCE_BLOCK,
  evidenceBlock,
  type FogGroup,
  fogGroups,
  highlight,
  type LibraryFilter,
  libraryGroups,
  listable,
  type LibraryStateFilter,
  NO_FILTER,
  PILL_TYPES,
  type SearchHits,
  STATE_FILTERS,
  specFirst,
  specKey,
  specOptions,
  specScope,
  typePills,
  WORKSPACE_SPEC,
} from './library-model';
import {
  addressParams,
  type ControlView,
  controlViews,
  filterOf,
  groupHeadView,
  type GroupView,
  type HeadDraw,
  metaRuns,
  pause,
  type RowView,
  sameFilter,
  SEARCH_DEBOUNCE_MS,
  showsPlaceholder,
  techPlaceholderOf,
  type Translate,
  withPlaceholder,
} from './library-view';
import { reloadOnRefresh } from '../../layout/shell/reload-on-refresh';

/**
 * The library list's state (spec 017, T27, T30, T32, T45, T46, T48; spec 034; spec 061, ISC-436): the catalog read
 * (`ApiClient.library`, re-read on every live refresh), in spec scope narrowed by `specScope`; the filter and the chosen
 * document from the address (`?q=`, `?type=`, `?spec=`, `?state=`, `?archived=`, `#path`) as `linkedSignal`s a
 * person's change sets ahead of the navigation; the server's full-text search; the groups, rows, evidence blocks, fog
 * lines and control counts the page draws; and the writes back into the address. Provided by `LibraryPage`, which
 * keeps the DOM work: scrolling, focus and the way back below 1120 px.
 */
@Injectable()
export class LibraryStore {
  private readonly state = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly t: Translate = (key, params) => this.transloco.translate(key, params);

  readonly ws = computed(() => this.state.ws() ?? '');
  readonly wsName = computed(() => this.data.workspaceName(this.ws()));
  readonly wide = computed(() => this.state.tier() === 'wide');

  /**
   * The spec the page is narrowed to (spec 017, T46, ISC-158): the route's spec id under `/w/:ws/s/:id/library`, the
   * spec area Library; null on `/w/:ws/library`, the workspace's. One component, two scopes, read from the route.
   */
  readonly scopeSpec = computed(() => this.state.specId());
  readonly specScoped = computed(() => this.scopeSpec() !== null);

  /** The catalog read (`GET …/:ws/library`), keyed by the workspace. */
  private readonly read = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.library(params),
  });
  private readonly result = computed(() => (this.read.hasValue() ? this.read.value() : undefined));
  /**
   * The catalog as served, in spec scope narrowed to the spec's documents plus the constitution (`specScope`); null
   * while loading and for every answer but `ok`.
   */
  readonly catalog = computed<LibraryCatalog | null>(() => {
    const result = this.result();
    if (result?.kind !== 'ok') return null;
    const spec = this.scopeSpec();
    return spec === null ? result.body : specScope(result.body, spec);
  });
  /** The workspace or the library route answered the contract's 404. */
  readonly missing = computed(() => {
    const result = this.result();
    return this.data.workspaceMissing() || (result?.kind === 'not-found' && result.served);
  });
  readonly unavailable = computed(() => this.data.workspaceUnavailable() || this.result()?.kind === 'unavailable');
  readonly failed = computed(() => {
    const result = this.result();
    return this.read.status() === 'error' || result?.kind === 'error' || (result?.kind === 'not-found' && !result.served);
  });

  readonly docs = computed<readonly LibraryDoc[]>(() => this.catalog()?.docs ?? []);
  /** How many of the catalog's documents belong to archived specs; the "Archived" pill shows only above zero. */
  readonly archivedCount = computed(() => this.docs().filter((doc) => doc.archived === true).length);

  /** The route's query params and fragment as signals (the router is the one source of the list's state). */
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  /**
   * The filter the address names (`?q=`, `?type=`, `?spec=`, `?state=`, `?archived=`); in spec scope there is no spec
   * select and no `?spec=`, and the archived documents always show (an archived spec's library is nothing but them).
   */
  private readonly addressFilter = computed(
    () => {
      const filter = filterOf(this.params());
      return this.specScoped() ? { ...filter, spec: 'all', archived: true } : filter;
    },
    { equal: sameFilter },
  );
  /**
   * The filter as shown: the address's, set ahead of it by a person's change (so a keystroke filters before the
   * navigation lands) and replaced by it whenever the address changes, by that navigation, back, forward or a link.
   */
  private readonly filter = linkedSignal<LibraryFilter>(() => this.addressFilter());
  readonly query = computed(() => this.filter().query);
  readonly type = computed(() => this.filter().type);
  readonly spec = computed(() => this.filter().spec);
  readonly stateFilter = computed(() => this.filter().state);
  readonly archived = computed(() => this.filter().archived);
  /** The documents the list draws from: the archived specs' only while `?archived=1`. Spec select and count follow it. */
  private readonly listed = computed(() => listable(this.docs(), this.archived()));
  readonly listedCount = computed(() => this.listed().length);
  readonly specs = computed(() => specOptions(this.listed()));

  /** The card's first row: the catalog's missing and stale counts, pressed while `?state=` names them (ISC-156.1). */
  readonly controls = computed<readonly ControlView[]>(() => {
    const catalog = this.catalog();
    return catalog === null ? [] : controlViews(catalog, this.filter().state);
  });
  /** The document picked by a person (row or `#path`), by its catalog path; null until one is. Follows the fragment. */
  private readonly picked = linkedSignal<string | null>(() => {
    const fragment = this.fragment();
    return fragment === null || fragment === '' ? null : fragment;
  });
  /** A spec's evidence subgroup opened or closed by hand, by group key; cleared whenever the filter changes. */
  private readonly evidenceToggled = linkedSignal<LibraryFilter, ReadonlyMap<string, boolean>>({ source: this.filter, computation: () => new Map() });
  /** How many blocks of 50 each open evidence subgroup reveals, by group key; one until "Show more"; cleared likewise. */
  private readonly evidenceBlocks = linkedSignal<LibraryFilter, ReadonlyMap<string, number>>({ source: this.filter, computation: () => new Map() });

  /**
   * The server's full-text search (`GET …/library/search?q=`), started `SEARCH_DEBOUNCE_MS` after the last change of
   * the search text; a newer text aborts the wait. Idle without a text.
   */
  private readonly search = resource({
    params: () => {
      const ws = this.state.ws();
      const q = this.query().trim();
      return ws !== null && q !== '' ? { ws, q } : undefined;
    },
    loader: async ({ params, abortSignal }) => {
      await pause(SEARCH_DEBOUNCE_MS, abortSignal);
      return this.api.librarySearch(params.ws, params.q);
    },
  });
  /** The server's hits for exactly the current search text (path → snippet); null while none has answered for it. */
  readonly hits = computed<SearchHits | null>(() => {
    const result = this.search.hasValue() ? this.search.value() : undefined;
    if (result?.kind !== 'ok' || result.body.query !== this.query().trim()) return null;
    return new Map(result.body.hits.map((hit) => [hit.path, hit.snippet]));
  });

  /** The active catalogue: the chip labels are translated here, so they follow its (lazy) arrival and every switch. */
  private readonly translation = toSignal(this.transloco.selectTranslation());

  /** "All", then a pill per type the catalog holds (never Decisions or Notes), stable while filtering. */
  readonly typeOptions = computed<readonly FilterOption[]>(() => {
    this.translation();
    return [
      { key: 'all', label: this.transloco.translate('library.filters.all') },
      ...typePills(this.docs()).map((key) => ({ key, label: this.transloco.translate(`library.types.${key}`) })),
    ];
  });

  /** The matching groups; in spec scope the spec's own group first, the constitution's after it. */
  private readonly matched = computed(() => {
    const catalog = this.catalog();
    if (catalog === null) return [];
    const groups = libraryGroups(catalog, this.filter(), this.hits());
    return this.specScoped() ? specFirst(groups) : groups;
  });

  readonly shownCount = computed(() => this.matched().reduce((sum, group) => sum + group.count, 0));

  /** The absent tech.md's row, when the catalog has documents but no tech.md (never counted); none in spec scope. */
  private readonly placeholder = computed(() => {
    const catalog = this.catalog();
    return catalog === null || this.specScoped() ? null : techPlaceholderOf(catalog);
  });

  /** Each spec group's head by spec folder, rendered once per catalog (ISC-157). */
  private readonly heads = computed<ReadonlyMap<string, HeadDraw>>(() => {
    const trust = (html: string | null): SafeHtml | null => (html === null ? null : this.sanitizer.bypassSecurityTrustHtml(html));
    return new Map(
      (this.catalog()?.groups ?? []).map((head) => {
        const view = groupHeadView(head);
        return [head.spec, { ...view, goalHtml: trust(view.goal), approachHtml: trust(view.approach) }];
      }),
    );
  });

  readonly groups = computed<readonly GroupView[]>(() => {
    const query = this.query();
    const hits = this.hits();
    const toggled = this.evidenceToggled();
    const blocks = this.evidenceBlocks();
    const heads = this.heads();
    const row = (doc: LibraryDoc): RowView => {
      const snippet = hits?.get(doc.path);
      return snippet === undefined
        ? { doc, title: highlight(doc.title, query), meta: metaRuns(doc, query, this.t), snippet: false, placeholder: false }
        : { doc, title: highlight(doc.title, query), meta: highlight(snippet, query), snippet: true, placeholder: false };
    };
    const views = this.matched().map((group): GroupView => {
      const head = group.spec === WORKSPACE_SPEC ? null : (heads.get(group.spec) ?? null);
      const evidence = group.evidence;
      if (evidence === null) return { group, head, rows: group.docs.map(row), evidence: null };
      const open = toggled.get(group.key) ?? evidence.open;
      const block = evidenceBlock(evidence, open ? (blocks.get(group.key) ?? 1) : 0);
      const rows = block.shown.map(row);
      return { group, head, rows: group.docs.map(row), evidence: { count: evidence.count, open, rows, rest: block.rest, next: Math.min(block.rest, EVIDENCE_BLOCK) } };
    });
    const placeholder = this.placeholder();
    return placeholder !== null && showsPlaceholder(this.filter()) ? withPlaceholder(views, placeholder, this.t) : views;
  });

  /** The filter "open" (ISC-157): each open spec's fog lines under its number; empty under every other state. */
  readonly fog = computed<readonly FogGroup[]>(() => {
    const catalog = this.catalog();
    return catalog === null || this.filter().state !== 'open' ? [] : fogGroups(catalog, this.filter());
  });
  readonly fogLines = computed(() => this.fog().reduce((sum, group) => sum + group.lines.length, 0));

  /** The reader's document: the picked one, else at wide the first row of the list (the prototype opens it on arrival). */
  readonly current = computed<LibraryDoc | null>(() => {
    const path = this.picked();
    const placeholder = this.placeholder();
    const known = placeholder === null ? this.docs() : [...this.docs(), placeholder];
    const picked = path === null ? undefined : known.find((doc) => doc.path === path);
    if (picked) return picked;
    if (!this.wide()) return null;
    const first = this.groups().at(0);
    return first?.rows.at(0)?.doc ?? first?.evidence?.rows.at(0)?.doc ?? null;
  });

  constructor() {
    // The spec area's one tab, Documents, counts what this page lists (spec 017, T45): the bar reads it from here.
    const tabCount = inject(LibraryTabCount);
    effect(() => {
      const spec = this.scopeSpec();
      const ws = this.state.ws();
      const catalog = this.catalog();
      tabCount.value.set(spec === null || ws === null || catalog === null ? null : { ws, spec, count: catalog.docs.length });
    });
    inject(DestroyRef).onDestroy(() => tabCount.value.set(null));
    // The live refresh (timer, "Refresh now", `r`) re-reads the catalog in place, as it did the tech page: a reload
    // keeps the last value, and the catalog route answers 304 to the `If-None-Match` `ApiClient` sends.
    reloadOnRefresh(() => this.read.reload());
    // A former Docs tab's redirect names the spec's document by its kind (`?doc=plan|design|spec`, spec 017, T48,
    // ISC-158.1): only the catalog knows the spec's folder, so once it is here the document is picked by its path and
    // the address carries that path as fragment, `?doc=` dropped and `?section=` kept, replacing the history entry.
    effect(() => {
      const kind = this.params().get('doc');
      const catalog = this.catalog();
      if (kind === null || catalog === null || !this.specScoped()) return;
      const doc = catalog.docs.find((entry) => entry.spec !== WORKSPACE_SPEC && entry.path === `${entry.spec}/${kind}.md`);
      untracked(() => {
        if (doc !== undefined) this.picked.set(doc.path);
        this.write();
      });
    });
  }

  setQuery(value: string): void {
    this.update({ query: value });
  }

  setType(value: string | undefined): void {
    if (value === 'all') this.update({ type: value });
    else {
      const type = PILL_TYPES.find((pill) => pill === value);
      if (type !== undefined) this.update({ type });
    }
  }

  setSpec(value: string): void {
    this.update({ spec: value });
  }

  /** The state select: `?state=` all, stale, missing or open (fog); an unknown value changes nothing. */
  setState(value: string): void {
    const state = STATE_FILTERS.find((option): option is LibraryStateFilter => option === value);
    if (state !== undefined) this.update({ state });
  }

  /**
   * A control count filters the list to exactly its documents (`?state=missing|stale`, the value the state select
   * shows); a second click lifts it. At zero it is `aria-disabled` and sets nothing.
   */
  toggleControl(control: ControlView): void {
    if (control.count === 0) return;
    this.update({ state: control.pressed ? 'all' : control.key });
  }

  /**
   * The pill "Archived": lists the archived specs' documents too (`?archived=1`), combined with every other filter; a
   * second click hides them again and lifts a spec select that named an archived spec, which would list nothing.
   */
  toggleArchived(): void {
    const archived = !this.archived();
    const spec = this.spec();
    const hidden = !archived && this.docs().some((doc) => doc.archived === true && specKey(doc.spec) === spec);
    this.update(hidden ? { archived, spec: 'all' } : { archived });
  }

  clear(): void {
    this.filter.set(NO_FILTER);
    this.write();
  }

  toggleEvidence(key: string, open: boolean): void {
    this.evidenceToggled.update((map) => new Map(map).set(key, !open));
  }

  moreEvidence(key: string): void {
    this.evidenceBlocks.update((map) => new Map(map).set(key, (map.get(key) ?? 1) + 1));
  }

  /** Picks the document at `path` (null: none) and writes it into the address; a new document drops `?section=`. */
  select(path: string | null): void {
    this.picked.set(path);
    this.write(true);
  }

  private update(change: Partial<LibraryFilter>): void {
    this.filter.update((filter) => ({ ...filter, ...change }));
    this.write();
  }

  /**
   * The shown filter and document into the address: the list's params merged into the others, the document as the
   * fragment (none without one), replacing the history entry so a keystroke is no step of its own. A change of the
   * document (`docChanged`) drops `?section=`, which names a section of the document it was set for (spec 017, T42).
   * `?doc=` (a former Docs tab's redirect, T48) is always dropped: the fragment names the document from here on.
   */
  private write(docChanged = false): void {
    // In spec scope `archived` is on by the scope, not by a person: it stays out of the address.
    const filter = this.specScoped() ? { ...this.filter(), archived: false } : this.filter();
    const params = { ...addressParams(filter), doc: null };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: docChanged ? { ...params, section: null } : params,
      queryParamsHandling: 'merge',
      fragment: this.picked() ?? undefined,
      replaceUrl: true,
    });
  }
}
