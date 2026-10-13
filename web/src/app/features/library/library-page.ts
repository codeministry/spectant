import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, resource, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { LibraryCatalog, LibraryDoc, LibraryDocType } from '../../../../../core/src/files';
import { ApiClient } from '../../core/api.service';
import { NotFound } from '../../layout/not-found/not-found';
import { specLink } from '../../layout/shell/areas';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { type FilterOption, UiFilterChips } from '../../shared/ui/filter-chips/filter-chips';
import { UiNotice } from '../../shared/ui/notice/notice';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import {
  EVIDENCE_BLOCK,
  evidenceBlock,
  filterParams,
  highlight,
  type LibraryFilter,
  type LibraryGroup,
  libraryGroups,
  type LibraryStateFilter,
  NO_FILTER,
  parseFilter,
  PILL_TYPES,
  type SearchHits,
  STATE_FILTERS,
  specKey,
  specOptions,
  specSlug,
  type TextRun,
  typePills,
  WORKSPACE_SPEC,
} from './library-model';

/**
 * Each catalog type's tag icon (design.md 017 § Viewport-übergreifend, Mobile § 3): the Markdown kinds a page, tasks
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
 * A row's short date (design.md 017 § Viewport-übergreifend): day, month and time, the year only outside the current
 * one, in UTC as every other date of the app's fixtures. The two parts are joined by the catalogue's `library.date`,
 * so English reads "Oct 12, 14:02" and German "12.10. 14:02".
 */
export function shortDateParts(iso: string, now: Date, locale: string): { readonly date: string; readonly time: string } {
  const at = new Date(iso);
  const year = at.getUTCFullYear() === now.getUTCFullYear() ? undefined : 'numeric';
  const german = locale.startsWith('de');
  const date = new Intl.DateTimeFormat(locale, german ? { day: '2-digit', month: '2-digit', year, timeZone: 'UTC' } : { month: 'short', day: 'numeric', year, timeZone: 'UTC' }).format(at);
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(at);
  return { date, time };
}

/** The two control counts of the card's first row (design.md 017 § Viewport-übergreifend; ISC-156.1), in this order. */
export type ControlKey = 'missing' | 'stale';

/** One control count as drawn: its `?state=` value, the number, the icon, whether it filters now. */
export interface ControlView {
  readonly key: ControlKey;
  readonly count: number;
  /** `file-x` for missing, `triangle-alert` for stale; `circle-check` at zero. */
  readonly icon: IconName;
  readonly pressed: boolean;
  /** The accessible name's key: `none` at zero, else `one` / `other` by the count. */
  readonly labelKey: string;
}

const CONTROL_ICON: Readonly<Record<ControlKey, IconName>> = { missing: 'file-x', stale: 'triangle-alert' };

/** The control counts of a catalog under the current `?state=`: missing first, then stale. */
export function controlViews(catalog: Pick<LibraryCatalog, 'missing' | 'stale'>, state: LibraryFilter['state']): readonly ControlView[] {
  return (['missing', 'stale'] as const).map((key) => {
    const count = catalog[key];
    const plural = count === 0 ? 'none' : count === 1 ? 'one' : 'other';
    return { key, count, icon: count === 0 ? 'circle-check' : CONTROL_ICON[key], pressed: state === key, labelKey: `library.control.${key}.${plural}` };
  });
}

/**
 * The command that writes a missing document (design.md 017 § 2.2): `/spec-plan 017` for plan.md, `/spec-tasks 017`
 * for tasks.md; core marks no other type missing, so every other answers null.
 */
export function missingCommand(doc: Pick<LibraryDoc, 'type' | 'spec'>): string | null {
  return doc.type === 'plan' || doc.type === 'tasks' ? `/spec-${doc.type} ${specKey(doc.spec)}` : null;
}

/** The file name of a document path (`017-x/plan.md` → `plan.md`). */
const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** The server's full-text search waits this long after the last keystroke (title and path matches show at once). */
export const SEARCH_DEBOUNCE_MS = 200;

/** Resolves after `ms`, rejects as soon as `signal` aborts (a newer search text superseded this one). */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  const aborted = (): Error => new DOMException('The search text changed', 'AbortError');
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(aborted());
      },
      { once: true },
    );
  });
}

/**
 * The query params that write `filter` into the address, the ones the list owns (`q`, `type`, `spec`, `state`); a
 * default is `null`, which removes the param. Every other param is left as it is (`queryParamsHandling: merge`).
 */
export function addressParams(filter: LibraryFilter): Readonly<Record<'q' | 'type' | 'spec' | 'state', string | null>> {
  const params = filterParams(filter);
  return { q: params['q'] ?? null, type: params['type'] ?? null, spec: params['spec'] ?? null, state: params['state'] ?? null };
}

const sameFilter = (a: LibraryFilter, b: LibraryFilter): boolean => a.query === b.query && a.type === b.type && a.spec === b.spec && a.state === b.state;

/** The filter a route's query params name. */
const filterOf = (params: ParamMap): LibraryFilter => parseFilter((name) => params.get(name));

/** A document as one list row: the highlighted title and meta line beside the document itself. */
interface RowView {
  readonly doc: LibraryDoc;
  readonly title: readonly TextRun[];
  readonly meta: readonly TextRun[] | null;
  /** The meta line is the server's full-text snippet, not the path. */
  readonly snippet: boolean;
}

/** A spec's evidence subgroup as shown: whether it is open, the revealed rows and how many still wait. */
interface EvidenceView {
  readonly count: number;
  readonly open: boolean;
  readonly rows: readonly RowView[];
  readonly rest: number;
  /** What the next "Show more" reveals: a block, or the rest when less than a block waits. */
  readonly next: number;
}

interface GroupView {
  readonly group: LibraryGroup;
  readonly rows: readonly RowView[];
  readonly evidence: EvidenceView | null;
}

/**
 * `/w/:ws/library` (spec 017, T27, ISC-156; spec 024's list and reader, prototype `library.html` / `library.js`): the
 * workspace's catalog from the server's library route (`ApiClient.library`), grouped by `library-model.ts`:
 * workspace-wide first, then each spec once in ascending number, every row with its type tag (12 px icon, family
 * colour), title, the spec it belongs to and a meta line, a spec's evidence as one collapsed subgroup with its count
 * that reveals blocks of 50 and opens under a search or the type filter Evidence. A workspace without one document is
 * the empty state with `/spec-bootstrap`. No demo chip and no demo data.
 *
 * The filter and the chosen document live in the address (T32, ISC-156.2): `?q=`, `?type=`, `?spec=`, `?state=` and
 * the document's path as the fragment `#path`. The page reads them from the route as signals and writes every change
 * back with `router.navigate` (`queryParamsHandling: merge`, `replaceUrl`), so reload, back and forward land on the
 * same selection. The shown filter is a `linkedSignal` of the address: a keystroke filters at once, and the address
 * replaces it whenever it changes from outside. The search matches titles and paths at once and, 200 ms after the
 * last keystroke, the full text through `ApiClient.librarySearch`; a row found by the server shows its snippet. The
 * state select (All · Outdated · Missing · Open) sits beside the spec select and writes the same `?state=` as the
 * control counts. The reader component is T34's; the reader here loads the chosen Markdown document through
 * `ApiClient.libraryDoc` and shows core's rendered prose.
 *
 * The card's first row (`lib-head`, T30, ISC-156.1) holds the control counts "missing" (violet, `file-x`) and
 * "outdated" (orange, `triangle-alert`) from the catalog; a click sets `?state=missing|stale`, a second lifts it, and
 * at zero a count shows `circle-check` and filters nothing. Rows carry the chip of their state; a missing row is
 * dimmed by colour and form (muted title, dashed type tag), never by opacity, and its reader is the empty state with
 * the command that writes the file.
 *
 * From 1120 px (`wide`) list and reader sit side by side and the first match opens on its own; below, the page shows
 * the list or the reader, never both, and the reader's back button returns to the list.
 *
 * Not encapsulated: the prose is `[innerHTML]` from core's one renderer; every selector in the stylesheet starts with
 * `app-library-page`.
 */
@Component({
  selector: 'app-library-page',
  imports: [
    NgTemplateOutlet,
    NotFound,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChip,
    UiCommandChip,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiNotice,
    UiPageHead,
    UiSkeleton,
    UiWsBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    'data-page': 'library',
    '[attr.data-tier]': 'state.tier()',
    '[attr.data-reading]': 'current() ? "" : null',
  },
  templateUrl: './library-page.html',
  styleUrls: ['./library-page.css', './library-page.control.css'],
})
export class LibraryPage {
  protected readonly state = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly wsName = computed(() => this.data.workspaceName(this.ws()));
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  protected readonly typeIcon = typeIcon;

  /** The catalog read (`GET …/:ws/library`), keyed by the workspace. */
  private readonly read = resource({
    params: () => this.state.ws() ?? undefined,
    loader: ({ params }) => this.api.library(params),
  });
  private readonly result = computed(() => (this.read.hasValue() ? this.read.value() : undefined));
  /** The catalog as served; null while loading and for every answer but `ok`. */
  protected readonly catalog = computed<LibraryCatalog | null>(() => {
    const result = this.result();
    return result?.kind === 'ok' ? result.body : null;
  });
  /** The workspace or the library route answered the contract's 404. */
  protected readonly missing = computed(() => {
    const result = this.result();
    return this.data.workspaceMissing() || (result?.kind === 'not-found' && result.served);
  });
  protected readonly unavailable = computed(() => this.data.workspaceUnavailable() || this.result()?.kind === 'unavailable');
  protected readonly failed = computed(() => {
    const result = this.result();
    return this.read.status() === 'error' || result?.kind === 'error' || (result?.kind === 'not-found' && !result.served);
  });

  protected readonly docs = computed<readonly LibraryDoc[]>(() => this.catalog()?.docs ?? []);
  protected readonly specs = computed(() => specOptions(this.docs()));

  /** The route's query params and fragment as signals (the router is the one source of the list's state). */
  private readonly params = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });
  private readonly fragment = toSignal(this.route.fragment, { initialValue: this.route.snapshot.fragment });
  /** The filter the address names (`?q=`, `?type=`, `?spec=`, `?state=`). */
  private readonly addressFilter = computed(() => filterOf(this.params()), { equal: sameFilter });
  /**
   * The filter as shown: the address's, set ahead of it by a person's change (so a keystroke filters before the
   * navigation lands) and replaced by it whenever the address changes, by that navigation, back, forward or a link.
   */
  private readonly filter = linkedSignal<LibraryFilter>(() => this.addressFilter());
  protected readonly query = computed(() => this.filter().query);
  protected readonly type = computed(() => this.filter().type);
  protected readonly spec = computed(() => this.filter().spec);
  protected readonly stateFilter = computed(() => this.filter().state);
  protected readonly stateOptions = STATE_FILTERS;
  protected readonly missingCommand = missingCommand;
  protected readonly fileName = fileName;

  /** The card's first row: the catalog's missing and stale counts, pressed while `?state=` names them (ISC-156.1). */
  protected readonly controls = computed<readonly ControlView[]>(() => {
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
  protected readonly hits = computed<SearchHits | null>(() => {
    const result = this.search.hasValue() ? this.search.value() : undefined;
    if (result?.kind !== 'ok' || result.body.query !== this.query().trim()) return null;
    return new Map(result.body.hits.map((hit) => [hit.path, hit.snippet]));
  });

  /** The active catalogue: the chip labels are translated here, so they follow its (lazy) arrival and every switch. */
  private readonly translation = toSignal(this.transloco.selectTranslation());

  /** "All", then a pill per type the catalog holds (never Decisions or Notes), stable while filtering. */
  protected readonly typeOptions = computed<readonly FilterOption[]>(() => {
    this.translation();
    return [
      { key: 'all', label: this.transloco.translate('library.filters.all') },
      ...typePills(this.docs()).map((key) => ({ key, label: this.transloco.translate(`library.types.${key}`) })),
    ];
  });

  private readonly matched = computed(() => {
    const catalog = this.catalog();
    return catalog === null ? [] : libraryGroups(catalog, this.filter(), this.hits());
  });

  protected readonly shownCount = computed(() => this.matched().reduce((sum, group) => sum + group.count, 0));

  protected readonly groups = computed<readonly GroupView[]>(() => {
    const query = this.query();
    const hits = this.hits();
    const toggled = this.evidenceToggled();
    const blocks = this.evidenceBlocks();
    const row = (doc: LibraryDoc): RowView => {
      const snippet = hits?.get(doc.path);
      return snippet === undefined
        ? { doc, title: highlight(doc.title, query), meta: this.metaRuns(doc, query), snippet: false }
        : { doc, title: highlight(doc.title, query), meta: highlight(snippet, query), snippet: true };
    };
    return this.matched().map((group) => {
      const evidence = group.evidence;
      if (evidence === null) return { group, rows: group.docs.map(row), evidence: null };
      const open = toggled.get(group.key) ?? evidence.open;
      const block = evidenceBlock(evidence, open ? (blocks.get(group.key) ?? 1) : 0);
      const rows = block.shown.map(row);
      return { group, rows: group.docs.map(row), evidence: { count: evidence.count, open, rows, rest: block.rest, next: Math.min(block.rest, EVIDENCE_BLOCK) } };
    });
  });

  /** The reader's document: the picked one, else at wide the first row of the list (the prototype opens it on arrival). */
  protected readonly current = computed<LibraryDoc | null>(() => {
    const path = this.picked();
    const picked = path === null ? undefined : this.docs().find((doc) => doc.path === path);
    if (picked) return picked;
    if (!this.wide()) return null;
    const first = this.groups().at(0);
    return first?.rows.at(0)?.doc ?? first?.evidence?.rows.at(0)?.doc ?? null;
  });

  /** The current Markdown document as core renders it (`GET …/library/doc?path=`); idle for images, prototypes, missing. */
  private readonly page = resource({
    params: () => {
      const doc = this.current();
      const ws = this.state.ws();
      return ws !== null && doc !== null && doc.media === 'markdown' && doc.state !== 'missing' ? { ws, path: doc.path } : undefined;
    },
    loader: ({ params }) => this.api.libraryDoc(params.ws, params.path),
  });
  protected readonly pageLoading = computed(() => this.page.isLoading());
  protected readonly pageFailed = computed(() => {
    if (this.page.status() === 'error') return true;
    const result = this.page.hasValue() ? this.page.value() : undefined;
    return result !== undefined && result.kind !== 'ok';
  });

  /** Core's renderer escapes every text and passes no raw HTML (see `UiDocProse`), so its output is trusted here. */
  protected readonly prose = computed<SafeHtml | null>(() => {
    const result = this.page.hasValue() ? this.page.value() : undefined;
    return result?.kind === 'ok' ? this.sanitizer.bypassSecurityTrustHtml(result.body.html) : null;
  });

  /** The group's label: "‹ws› · workspace-wide", else the spec's number and slug ("017 · workspace-library"). */
  protected groupLabel(spec: string): string {
    if (spec === WORKSPACE_SPEC) return this.transloco.translate('library.wsWide', { ws: this.wsName() });
    return `${specKey(spec)} · ${specSlug(spec)}`;
  }

  /** The spec chip of the reader: the number, or the workspace for a workspace-wide document. */
  protected chipLabel(spec: string): string {
    return spec === WORKSPACE_SPEC ? this.wsName() : specKey(spec);
  }

  protected date(iso: string | null): string {
    if (iso === null) return this.transloco.translate('library.meta.noDate');
    return this.transloco.translate('library.date', shortDateParts(iso, new Date(), this.lang()));
  }

  /** The document's file (or prototype folder) as the workspace names it: below `specs/`. */
  protected filePath(doc: Pick<LibraryDoc, 'path'>): string {
    return `specs/${doc.path}`;
  }

  /** The spec dashboard of the document's spec; none for a workspace-wide document. */
  protected openLink(doc: LibraryDoc): string[] | null {
    return doc.spec === WORKSPACE_SPEC ? null : specLink(this.ws(), specKey(doc.spec));
  }

  protected setQuery(value: string): void {
    this.update({ query: value });
  }

  protected setType(value: string | undefined): void {
    if (value === 'all') this.update({ type: value });
    else {
      const type = PILL_TYPES.find((pill) => pill === value);
      if (type !== undefined) this.update({ type });
    }
  }

  protected setSpec(value: string): void {
    this.update({ spec: value });
  }

  /** The state select: `?state=` all, stale, missing or open (fog); an unknown value changes nothing. */
  protected setState(value: string): void {
    const state = STATE_FILTERS.find((option): option is LibraryStateFilter => option === value);
    if (state !== undefined) this.update({ state });
  }

  /**
   * A control count filters the list to exactly its documents (`?state=missing|stale`, the value the state select
   * shows); a second click lifts it. At zero it is `aria-disabled` and sets nothing.
   */
  protected toggleControl(control: ControlView): void {
    if (control.count === 0) return;
    this.update({ state: control.pressed ? 'all' : control.key });
  }

  protected clear(): void {
    this.filter.set(NO_FILTER);
    this.write();
  }

  protected toggleEvidence(key: string, open: boolean): void {
    this.evidenceToggled.update((map) => new Map(map).set(key, !open));
  }

  protected moreEvidence(key: string): void {
    this.evidenceBlocks.update((map) => new Map(map).set(key, (map.get(key) ?? 1) + 1));
  }

  protected open(path: string): void {
    this.picked.set(path);
    this.write();
    if (!this.wide()) window.scrollTo({ top: 0 });
  }

  protected back(): void {
    this.picked.set(null);
    this.write();
  }

  /** The meta line under the title: the file (or folder) below `specs/`; an image says so, a prototype lists pages. */
  private metaRuns(doc: LibraryDoc, query: string): readonly TextRun[] | null {
    if (doc.media === 'prototype') {
      const pages = doc.pages ?? [];
      return [{ text: this.transloco.translate('library.meta.prototype', { count: pages.length, pages: pages.join(', ') }), hit: false }];
    }
    const path = this.filePath(doc);
    if (doc.media === 'image') return [{ text: this.transloco.translate('library.meta.image', { path }), hit: false }];
    return highlight(path, query);
  }

  private update(change: Partial<LibraryFilter>): void {
    this.filter.update((filter) => ({ ...filter, ...change }));
    this.write();
  }

  /**
   * The shown filter and document into the address: the list's params merged into the others, the document as the
   * fragment (none without one), replacing the history entry so a keystroke is no step of its own.
   */
  private write(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: addressParams(this.filter()),
      queryParamsHandling: 'merge',
      fragment: this.picked() ?? undefined,
      replaceUrl: true,
    });
  }
}
