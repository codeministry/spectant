import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  resource,
  untracked,
  ViewEncapsulation,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, type ParamMap, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { LibraryCatalog, LibraryDoc, SpecGroupHead, SpecType } from '../../../../../core/src/files';
import { renderDocsMarkdown } from '../../../../../core/src/markdown-docs';
import type { Stage } from '../../../../../core/src/stage';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../../core/refresh.service';
import { NotFound } from '../../layout/not-found/not-found';
import { specLink } from '../../layout/shell/areas';
import { LibraryTabCount } from '../../layout/shell/page-tabs';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { STAGE_LOOK } from '../../layout/spec-head/spec-head';
import { UiIcon } from '../../shared/icons/icon';
import { UiTime } from '../../shared/time';
import type { IconName } from '../../shared/icons/icons';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import type { Tone } from '../../shared/ui/tone';
import { TYPE_GLYPHS } from '../../shared/ui/type-glyph/type-glyph';
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
  type FogGroup,
  fogGroups,
  filterParams,
  matches,
  highlight,
  type LibraryFilter,
  type LibraryGroup,
  libraryGroups,
  listable,
  type LibraryStateFilter,
  NO_FILTER,
  parseFilter,
  PILL_TYPES,
  type SearchHits,
  STATE_FILTERS,
  specFirst,
  specKey,
  specOptions,
  specScope,
  specSlug,
  type TextRun,
  typePills,
  WORKSPACE_SPEC,
} from './library-model';

import { LibraryReader, typeIcon } from './library-reader';

export { fileName, missingCommand, typeIcon } from './library-reader';

/** The two control counts of the card's first row (design.md 017 § Across viewports; ISC-156.1), in this order. */
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
 * The row an absent `specs/tech.md` stands as (design.md 017 § 8, § Across viewports): in the workspace-wide group,
 * dimmed, without the "missing" flag and outside every count (ISC-155.2 names spec documents only); its reader is the
 * empty state, which names no command. Core never marks a tech document missing, so `tech` with `missing` names this row alone.
 */
export const TECH_PLACEHOLDER: LibraryDoc = {
  path: 'tech.md',
  type: 'tech',
  spec: WORKSPACE_SPEC,
  title: 'tech.md',
  modified: null,
  state: 'missing',
  media: 'markdown',
};

/** The tech placeholder when the catalog holds documents but no tech.md; null otherwise. */
export const techPlaceholderOf = (catalog: Pick<LibraryCatalog, 'docs'>): LibraryDoc | null =>
  catalog.docs.length === 0 || catalog.docs.some((doc) => doc.type === 'tech') ? null : TECH_PLACEHOLDER;

/** Whether the list shows the placeholder under `filter`: as a tech document would, under the state "all" only. */
export const showsPlaceholder = (filter: LibraryFilter): boolean => filter.state === 'all' && matches({ ...TECH_PLACEHOLDER, state: 'ok' }, filter);

/** A spec group's head as drawn (ISC-157): core's values, the chips' looks, and Goal and Approach rendered once. */
export interface GroupHeadView {
  readonly head: SpecGroupHead;
  /** The spec's number (`?spec=` form). */
  readonly key: string;
  readonly slug: string;
  readonly typeIcon: IconName | undefined;
  readonly stageTone: Tone;
  readonly stageIcon: IconName | undefined;
  /** The `## Goal` and the first paragraph of `## Approach` as the former tech tab Specs rendered them; null without. */
  readonly goal: string | null;
  readonly approach: string | null;
}

/**
 * The head of a spec group from core's `SpecGroupHead`: type and stage chip looks (the spec head's `STAGE_LOOK`), the
 * Goal and Approach sources through core's renderer with the ids the former tech tab gave them (`spec-NNN-goal-`).
 */
export function groupHeadView(head: SpecGroupHead): GroupHeadView {
  const key = specKey(head.spec);
  const type: SpecType | null = head.type;
  const look = Object.hasOwn(STAGE_LOOK, head.stage) ? STAGE_LOOK[head.stage as Stage] : { tone: 'neutral' as const, icon: undefined };
  const render = (source: string | null, part: string): string | null =>
    source === null ? null : renderDocsMarkdown(source, { idPrefix: `spec-${key}-${part}-` }).html;
  return {
    head,
    key,
    slug: specSlug(head.spec),
    typeIcon: type === null ? undefined : TYPE_GLYPHS[type],
    stageTone: look.tone,
    stageIcon: look.icon,
    goal: render(head.goal, 'goal'),
    approach: render(head.approach, 'approach'),
  };
}

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
 * The query params that write `filter` into the address, the ones the list owns (`q`, `type`, `spec`, `state`,
 * `archived`); a default is `null`, which removes the param. Every other param is left as it is
 * (`queryParamsHandling: merge`).
 */
export function addressParams(filter: LibraryFilter): Readonly<Record<'q' | 'type' | 'spec' | 'state' | 'archived', string | null>> {
  const params = filterParams(filter);
  return {
    q: params['q'] ?? null,
    type: params['type'] ?? null,
    spec: params['spec'] ?? null,
    state: params['state'] ?? null,
    archived: params['archived'] ?? null,
  };
}

const sameFilter = (a: LibraryFilter, b: LibraryFilter): boolean =>
  a.query === b.query && a.type === b.type && a.spec === b.spec && a.state === b.state && a.archived === b.archived;

/** The filter a route's query params name. */
const filterOf = (params: ParamMap): LibraryFilter => parseFilter((name) => params.get(name));

/** A document as one list row: the highlighted title and meta line beside the document itself. */
interface RowView {
  readonly doc: LibraryDoc;
  readonly title: readonly TextRun[];
  readonly meta: readonly TextRun[] | null;
  /** The meta line is the server's full-text snippet, not the path. */
  readonly snippet: boolean;
  /** The absent tech.md (`TECH_PLACEHOLDER`): dimmed, no flag, no `data-library-entry`, outside every count. */
  readonly placeholder: boolean;
}

/** A group head with its Goal and Approach as trusted HTML (core's renderer escapes every text). */
interface HeadDraw extends GroupHeadView {
  readonly goalHtml: SafeHtml | null;
  readonly approachHtml: SafeHtml | null;
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
  /** A spec group's head; null for the workspace-wide group (it keeps its eyebrow) and a spec core has no head for. */
  readonly head: HeadDraw | null;
  readonly rows: readonly RowView[];
  readonly evidence: EvidenceView | null;
}

/**
 * `/w/:ws/library` (spec 017, T27, ISC-156; spec 024's list and reader, prototype `library.html` / `library.js`): the
 * workspace's catalog from the server's library route (`ApiClient.library`), grouped by `library-model.ts`:
 * workspace-wide first, then each spec once in ascending number, every row with its type tag (12 px icon, family
 * colour), title, the spec it belongs to and a meta line, a spec's evidence as one collapsed subgroup with its count
 * that reveals blocks of 50 and opens under a search or the type filter Evidence. A workspace without one document is
 * the empty state with `/spec init`. No demo chip and no demo data.
 *
 * The filter and the chosen document live in the address (T32, ISC-156.2): `?q=`, `?type=`, `?spec=`, `?state=` and
 * the document's path as the fragment `#path`. The page reads them from the route as signals and writes every change
 * back with `router.navigate` (`queryParamsHandling: merge`, `replaceUrl`), so reload, back and forward land on the
 * same selection. The shown filter is a `linkedSignal` of the address: a keystroke filters at once, and the address
 * replaces it whenever it changes from outside. The search matches titles and paths at once and, 200 ms after the
 * last keystroke, the full text through `ApiClient.librarySearch`; a row found by the server shows its snippet. The
 * state select (All · Outdated · Missing · Open) sits beside the spec select and writes the same `?state=` as the
 * control counts. The archived specs' documents are left out until the pill "Archived" beside the selects turns
 * `?archived=1` on; the spec select and the count follow it. The chosen document is shown by `app-library-reader`
 * (T34, ISC-156.3), which reports a followed cross reference back as a selection.
 *
 * The card's first row (`lib-head`, T30, ISC-156.1) holds the control counts "missing" (violet, `file-x`) and
 * "outdated" (orange, `triangle-alert`) from the catalog; a click sets `?state=missing|stale`, a second lifts it, and
 * at zero a count shows `circle-check` and filters nothing. Rows carry the chip of their state; a missing row is
 * dimmed by colour and form (muted title, dashed type tag), never by opacity, and its reader is the empty state with
 * the command that writes the file.
 *
 * From 1120 px (`wide`) list and reader sit side by side and the first match opens on its own; below, the page shows
 * the list or the reader, never both: opening a document scrolls to the top and focuses the reader, and the reader's
 * back button (or Escape) returns to the list at the scroll position it had and focuses the opened row (DS-APP-35).
 * At wide a chosen document moves the focus to the reader without scrolling (design.md 017 § 7 Tastatur und Fokus).
 *
 * The same component is the spec area Library at `/w/:ws/s/:id/library` (spec 017, T46, ISC-158): the route's spec id
 * narrows the catalog to that spec's documents, its missing entries and evidence included, plus the constitution
 * (`specScope`), the spec's group first and without its head (the spec head carries it), no spec select and no
 * "Archived" pill (an archived spec's own documents always show), the control
 * counts of the spec alone, no "Open in spec" in the reader (`context` `spec`), no page head of its own; the shell
 * draws no rail there (`SpecArea.noRail`) and the tab bar's Documents count is this list's (`LibraryTabCount`).
 *
 * Not encapsulated: the row template's type tag is shared with the reader's head; every selector in the stylesheet
 * starts with `app-library-page`.
 */
@Component({
  selector: 'app-library-page',
  imports: [
    LibraryReader,
    NgTemplateOutlet,
    NotFound,
    RouterLink,
    TranslocoPipe,
    UiButton,
    UiCard,
    UiChip,
    UiCommandChip,
    UiMeter,
    UiEmptyState,
    UiFilterChips,
    UiIcon,
    UiNotice,
    UiPageHead,
    UiSkeleton,
    UiTime,
    UiWsBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    'data-page': 'library',
    '[attr.data-tier]': 'state.tier()',
    '[attr.data-reading]': 'current() ? "" : null',
    '[attr.data-scope]': 'specScoped() ? "spec" : "workspace"',
  },
  templateUrl: './library-page.html',
  styleUrls: ['./library-page.css', './library-page.control.css', './library-page.heads.css'],
})
export class LibraryPage {
  protected readonly state = inject(ShellState);
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly sanitizer = inject(DomSanitizer);
  /** Below 1120 px: the list's scroll position and the row a document was opened from, for the way back (DS-APP-35). */
  private listReturn: { readonly top: number; readonly path: string } | null = null;

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly wsName = computed(() => this.data.workspaceName(this.ws()));
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  protected readonly typeIcon = typeIcon;

  /**
   * The spec the page is narrowed to (spec 017, T46, ISC-158): the route's spec id under `/w/:ws/s/:id/library`, the
   * spec area Library; null on `/w/:ws/library`, the workspace's. One component, two scopes, read from the route.
   */
  protected readonly scopeSpec = computed(() => this.state.specId());
  protected readonly specScoped = computed(() => this.scopeSpec() !== null);

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
  protected readonly catalog = computed<LibraryCatalog | null>(() => {
    const result = this.result();
    if (result?.kind !== 'ok') return null;
    const spec = this.scopeSpec();
    return spec === null ? result.body : specScope(result.body, spec);
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
  /** How many of the catalog's documents belong to archived specs; the "Archived" pill shows only above zero. */
  protected readonly archivedCount = computed(() => this.docs().filter((doc) => doc.archived === true).length);

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
  protected readonly query = computed(() => this.filter().query);
  protected readonly type = computed(() => this.filter().type);
  protected readonly spec = computed(() => this.filter().spec);
  protected readonly stateFilter = computed(() => this.filter().state);
  protected readonly stateOptions = STATE_FILTERS;
  protected readonly archived = computed(() => this.filter().archived);
  /** The documents the list draws from: the archived specs' only while `?archived=1`. Spec select and count follow it. */
  private readonly listed = computed(() => listable(this.docs(), this.archived()));
  protected readonly listedCount = computed(() => this.listed().length);
  protected readonly specs = computed(() => specOptions(this.listed()));

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

  /** The matching groups; in spec scope the spec's own group first, the constitution's after it. */
  private readonly matched = computed(() => {
    const catalog = this.catalog();
    if (catalog === null) return [];
    const groups = libraryGroups(catalog, this.filter(), this.hits());
    return this.specScoped() ? specFirst(groups) : groups;
  });

  protected readonly shownCount = computed(() => this.matched().reduce((sum, group) => sum + group.count, 0));

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

  protected readonly groups = computed<readonly GroupView[]>(() => {
    const query = this.query();
    const hits = this.hits();
    const toggled = this.evidenceToggled();
    const blocks = this.evidenceBlocks();
    const heads = this.heads();
    const row = (doc: LibraryDoc): RowView => {
      const snippet = hits?.get(doc.path);
      return snippet === undefined
        ? { doc, title: highlight(doc.title, query), meta: this.metaRuns(doc, query), snippet: false, placeholder: false }
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
    return placeholder !== null && showsPlaceholder(this.filter()) ? this.withPlaceholder(views, placeholder) : views;
  });

  /** The filter "open" (ISC-157): each open spec's fog lines under its number; empty under every other state. */
  protected readonly fog = computed<readonly FogGroup[]>(() => {
    const catalog = this.catalog();
    return catalog === null || this.filter().state !== 'open' ? [] : fogGroups(catalog, this.filter());
  });
  protected readonly fogLines = computed(() => this.fog().reduce((sum, group) => sum + group.lines.length, 0));

  /** The reader's document: the picked one, else at wide the first row of the list (the prototype opens it on arrival). */
  protected readonly current = computed<LibraryDoc | null>(() => {
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
    const refresher = inject(RefreshService);
    let seen = refresher.refreshes();
    effect(() => {
      const count = refresher.refreshes();
      if (count === seen) return;
      seen = count;
      untracked(() => this.read.reload());
    });
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

  /** The group's label: "‹ws› · workspace-wide", else the spec's number and slug ("017 · workspace-library"). */
  protected groupLabel(spec: string): string {
    if (spec === WORKSPACE_SPEC) return this.transloco.translate('library.wsWide', { ws: this.wsName() });
    return `${specKey(spec)} · ${specSlug(spec)}`;
  }


  /** The document's file (or prototype folder) as the workspace names it: below `specs/`. */
  protected filePath(doc: Pick<LibraryDoc, 'path'>): string {
    return `specs/${doc.path}`;
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

  /**
   * The pill "Archived": lists the archived specs' documents too (`?archived=1`), combined with every other filter; a
   * second click hides them again and lifts a spec select that named an archived spec, which would list nothing.
   */
  protected toggleArchived(): void {
    const archived = !this.archived();
    const spec = this.spec();
    const hidden = !archived && this.docs().some((doc) => doc.archived === true && specKey(doc.spec) === spec);
    this.update(hidden ? { archived, spec: 'all' } : { archived });
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

  /**
   * A row or a followed cross reference opens a document. Below 1120 px the list gives way to the reader: the list's
   * scroll position and the row are kept for the way back (when the list is what was shown), the page scrolls to its
   * top and the reader takes the focus; at wide the focus moves to the reader without scrolling.
   */
  protected open(path: string): void {
    const fromList = !this.wide() && this.current() === null;
    if (fromList) this.listReturn = { top: window.scrollY, path };
    this.picked.set(path);
    this.write(true);
    if (!this.wide()) window.scrollTo({ top: 0 });
    this.afterRender(() => this.host.querySelector<HTMLElement>('[data-library-reader]')?.focus({ preventScroll: true }));
  }

  /**
   * The reader's way back below 1120 px (DS-APP-35): the list at the scroll position it had and the focus on the row
   * the document was opened from; the row of the document read last when a cross reference led elsewhere.
   */
  protected back(): void {
    const read = this.current()?.path ?? null;
    const saved = this.listReturn;
    this.listReturn = null;
    this.picked.set(null);
    this.write(true);
    this.afterRender(() => {
      if (saved !== null) window.scrollTo({ top: saved.top });
      const row = (path: string | null | undefined): HTMLElement | null =>
        path == null
          ? null
          : this.host.querySelector<HTMLElement>(`[data-library-entry="${CSS.escape(path)}"], [data-library-placeholder="${CSS.escape(path)}"]`);
      const same = row(read) ?? row(saved?.path);
      // The row the list was left from is in view once the position is back; any other row scrolls into view.
      same?.focus({ preventScroll: saved !== null && (read === saved.path || row(read) === null) });
    });
  }

  /** The spec page a group head's number and slug lead to. */
  protected specPage(key: string): string[] {
    return specLink(this.ws(), key);
  }

  /** A group head's fog count leads to the filter "open" of that spec (`?state=open&spec=NNN`), no search, no type. */
  protected fogParams(key: string): Record<string, string | null> {
    return { state: 'open', spec: key, q: null, type: null };
  }

  /** A fog line opens its spec's spec.md, where `## Not yet specified` holds the line. */
  protected openFog(spec: string): void {
    this.open(`${spec}/spec.md`);
  }

  /**
   * The tech placeholder in the workspace-wide group where tech.md would stand (after the constitution), the group
   * added in front when no workspace-wide document matched; the group's count stays the catalog's.
   */
  private withPlaceholder(views: readonly GroupView[], doc: LibraryDoc): readonly GroupView[] {
    const row: RowView = {
      doc,
      title: [{ text: doc.title, hit: false }],
      meta: [{ text: this.transloco.translate('library.tech.notCreated', { path: this.filePath(doc) }), hit: false }],
      snippet: false,
      placeholder: true,
    };
    const workspace = views.find((view) => view.group.spec === WORKSPACE_SPEC);
    if (workspace === undefined) {
      const group: LibraryGroup = { spec: WORKSPACE_SPEC, key: WORKSPACE_SPEC, head: null, docs: [], evidence: null, count: 0 };
      return [{ group, head: null, rows: [row], evidence: null }, ...views];
    }
    const at = workspace.rows.findIndex((shown) => shown.doc.type !== 'constitution');
    const rows = at < 0 ? [...workspace.rows, row] : [...workspace.rows.slice(0, at), row, ...workspace.rows.slice(at)];
    return views.map((view) => (view === workspace ? { ...view, rows } : view));
  }

  private afterRender(write: () => void): void {
    afterNextRender({ write }, { injector: this.injector });
  }

  /** The meta line under the title: the file (or folder) below `specs/`; an image says so, a prototype lists pages. */
  private metaRuns(doc: LibraryDoc, query: string): readonly TextRun[] | null {
    if (doc.media === 'prototype') {
      const pages = doc.pages ?? [];
      return [{ text: this.transloco.translate(pages.length === 1 ? 'library.meta.prototype.one' : 'library.meta.prototype.other', { count: pages.length, pages: pages.join(', ') }), hit: false }];
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
