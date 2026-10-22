import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { type Density, isDensity, SettingsService } from '../../../core/settings.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { OpenState } from '../../../shared/open-state';
import { UiCard } from '../../../shared/ui/card/card';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
import { type FilterOption, UiFilterChips } from '../../../shared/ui/filter-chips/filter-chips';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';
import { guidanceEntryOf } from '../../../core/model/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import { UiRovingCompanion, UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { UiStarToggle } from '../../../shared/ui/star-toggle/star-toggle';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { type SortOption, UiSortMenu } from '../../../shared/ui/sort-menu/sort-menu';
import { toneOfStage } from '../../../shared/ui/stage-tone';
import { toneMark } from '../../../shared/ui/tone';
import { type Stage, WAITING_STAGES } from '../../../../../../core/src/stage';
import { TRACK_STAGES } from '../../../core/model/stage-track';
import { SpecRow } from './spec-row';
import { SpecTableHead } from './spec-table-head';
import { IdeaRow } from './idea-row';
import { applyIdeaQuery, type DashboardIdea, listEntries, withIdeaOption } from './idea-rows';
import {
  ALL,
  IDEA,
  applyArchivedQuery,
  applyListQuery,
  type ArchiveRow,
  FOG,
  type ListOption,
  type ListQuery,
  SORT_MENU,
  type SpecListCounts,
  type SpecTableRow,
  stageOptions,
  typeOptions,
} from './spec-table-model';

/** The rows the dashboard's spec list shows before "show all N" (spec 021, ISC-246; 10 since 2026-10-20, was 5). */
export const SPEC_ROW_CAP = 10;

/** The keys `uiRovingList` moves on; the fold's toggle keeps them (`keepToggleKeys`). */
const ROVING_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'j', 'k']);

/**
 * The Specs panel of the workspace dashboard (T63, ISC-61; `spec-table`, reworked in T89): the head "Specs n · k archived" with the `#specs` heading the `g s` jump and the spec
 * picker land on, the stage chips (plus type chips from two types and the takeable flag) and the sort menu
 * (`ui-sort-menu`: a popover, a bottom sheet at compact), the 8 px strip (one segment per active spec), the rows as one
 * roving list (↓ ↑ j k Home End, one tab stop, no wrap).
 *
 * Spec 050 (T8, ISC-289): the archived footer under `#archive` is gone; the archived specs list as rows behind the
 * head's toggle, and with no active spec and the toggle off the panel says "No active spec · K archived".
 *
 * Filter, sort and takeable are the page's query state: the panel renders `query` and asks for a new one through
 * `queryChange`, it never holds them itself. The selection is the roving list's tab stop, exposed as `selectedId`
 * and marked `data-selected` on its row.
 *
 * Spec 021 (T25, ISC-246): the head's counters are one wrapping chip row; the list shows its first `SPEC_ROW_CAP` rows,
 * filtered and sorted, the rest behind a "show all N" `ui-disclosure` (`?open=specs`), rendered only while open.
 *
 * Spec 064 (T41, T49; ISC-479, ISC-491): the stories (`ideas`) stand as rows between the active rows and the archive
 * block, under no heading, each an `app-idea-row` to its idea page; the chip "ideas" (`?stage=idea`) shows them alone.
 * Spec 064 (T62, ISC-503): the chips filter by stage (`?stage=`), one per stage present, in workflow order.
 */
@Component({
  selector: 'app-spec-table',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiCard,
    UiChip,
    UiClamp,
    UiDisclosure,
    UiFilterChips,
    UiIcon,
    GuidanceReasonPipe,
    UiRovingCompanion,
    UiRovingItem,
    UiRovingList,
    UiStarToggle,
    UiSortMenu,
    SpecRow,
    SpecTableHead,
    IdeaRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-table.html',
  styleUrls: ['./spec-table.css', '../../../layout/detail-sidebar/selection.css'],
  host: { 'data-panel': 'specs' },
})
export class SpecTable {
  private readonly transloco = inject(TranslocoService);
  private readonly settings = inject(SettingsService);
  protected readonly shell = inject(ShellState);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  /**
   * The rows' density (spec 021, ISC-254): `?density=` for this view, else the stored setting, as on the board; an
   * unknown value falls back to the setting. The list never writes the setting.
   */
  protected readonly density = computed<Density>(() => {
    const param = this.params().get('density');
    return isDensity(param) ? param : this.settings.settings().density;
  });
  // Recomputes the labels once the active language's catalogue has loaded, not only on a language switch: on the
  // Specs page (spec 058) the list renders before the catalogue arrives, and a label read then stays its raw key.
  private readonly lang = toSignal(this.transloco.selectTranslation());

  readonly ws = input.required<string>();
  readonly rows = input.required<readonly SpecTableRow[]>();
  readonly archive = input<readonly ArchiveRow[]>([]);
  /** The workspace's stories (`readIdeaRows`, spec 064 T41); the group shows those `applyIdeaQuery` keeps. */
  readonly ideas = input<readonly DashboardIdea[]>([]);
  protected readonly shownIdeas = computed(() => applyIdeaQuery(this.ideas(), this.query()));
  /** `DashboardModel.guidance` (spec 020): a row with its spec's own entry reads the entry's sentence (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);
  /**
   * The row's guidance (spec 020, T26, ISC-240; spec 021 R1): its spec's own entry and whether it stands in "Waits on
   * you" (the row then carries the mark, a Next entry the ring); null without an entry, so a spec waiting on another
   * reads its phrase. The entry's sentence is the row link's description.
   */
  protected guideOf(id: string): { readonly entry: GuidanceEntry; readonly waits: boolean } | null {
    const guidance = this.guidance();
    const entry = guidanceEntryOf(guidance, id);
    return entry && guidance ? { entry, waits: guidance.waits.includes(entry) } : null;
  }
  /** The title of every spec the list knows, active or archived, by `NNN`: a waits chip names its blocker by it (T24). */
  protected readonly titles = computed<Readonly<Record<string, string>>>(() =>
    Object.fromEntries([...this.archive(), ...this.rows()].map((spec) => [spec.id, spec.title])),
  );
  readonly query = input.required<ListQuery>();
  readonly queryChange = output<ListQuery>();
  /**
   * The spec the detail sidebar shows (`?sel=spec:<id>`, spec 026 T27, ISC-171). A row's link activates in two steps:
   * the first (Enter or a click) merges `?sel=spec:<id>` into the URL, and on the selected row it leads to the spec page
   * `/w/:ws/s/:id`, as the sidebar's "Open spec" does. The selected row carries `data-selected="row"` (the sidebar's
   * look); the roving tab stop keeps `data-selected=""` otherwise.
   */
  readonly preview = input<string | null>(null);
  /** Ids of the rows the last refresh changed (`RefreshService.changedRows`): each gets the 4 px cyan dot. */
  readonly changed = input<ReadonlySet<string>>(new Set());
  /** Ids of new specs the page holds back so the list never reflows under the reader; the pill offers them. */
  readonly pending = input<readonly string[]>([]);
  /** The reader asked for the held-back specs (the pill). */
  readonly showPending = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The rows carrying the changed dot (design.md § Live update), each kept until it is hovered or focused. */
  protected readonly dots = linkedSignal<ReadonlySet<string>, ReadonlySet<string>>({
    source: this.changed,
    computation: (changed, previous) => new Set([...(previous?.value ?? []), ...changed]),
  });

  /** Rows whose description needs more than two lines, and those the reader opened with "more…" (ISC-111). */
  protected readonly overflowing = signal<ReadonlySet<string>>(new Set());
  protected readonly moreOpen = signal<ReadonlySet<string>>(new Set());

  protected setOverflow(id: string, overflows: boolean): void {
    if (this.overflowing().has(id) === overflows) return;
    this.overflowing.update((ids) => (overflows ? new Set([...ids, id]) : new Set([...ids].filter((other) => other !== id))));
  }

  protected toggleMore(id: string): void {
    this.moreOpen.update((ids) => (ids.has(id) ? new Set([...ids].filter((other) => other !== id)) : new Set([...ids, id])));
  }

  /**
   * The favourites of the open workspace (spec 052, T18, ISC-300): `ShellData` holds the one set the spec head, this
   * list and the header's spec select read, so a click in one place shows in all three without a reload. A favourite
   * is the spec's folder name; a row without one (a hand-built row) falls back to its id, which the set never holds.
   */
  private readonly shellData = inject(ShellData);

  protected isFavorite(row: SpecTableRow): boolean {
    return this.shellData.isFavorite(row.slug ?? row.id);
  }

  protected toggleFavorite(row: SpecTableRow): void {
    void this.shellData.toggleFavorite(row.slug ?? row.id);
  }

  protected clearDot(id: string): void {
    if (!this.dots().has(id)) return;
    this.dots.update((dots) => new Set([...dots].filter((dot) => dot !== id)));
  }

  /** The pill: the page applies the held-back specs, then focus lands on the first of them (or the heading). */
  protected applyPending(): void {
    const first = this.pending().at(0);
    this.showPending.emit();
    afterNextRender(
      () => {
        if (first === undefined || !this.focusRow(first)) this.host.nativeElement.querySelector<HTMLElement>('#specs')?.focus();
      },
      { injector: this.injector },
    );
  }

  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  /** The active rows filtered and sorted, and the archived ones under `?archived=1` (spec 050, T3, ISC-287). */
  private readonly listed = computed(() => ({ active: applyListQuery(this.rows(), this.query()), archived: applyArchivedQuery(this.archive(), this.query()) }));
  /** The listed rows, the archive block after the active one: one roving list and fold over both, never interleaved. */
  protected readonly visible = computed(() => [...this.listed().active, ...this.listed().archived]);
  /** The first archived row listed (spec 050, T3): its row draws the dashed boundary hairline (`archivedFirst`). */
  protected readonly firstArchivedId = computed(() => this.visible().find((row) => row.archived !== undefined)?.id ?? null);
  /**
   * Spec 050 (T6, ISC-288): the archived rows listed, the K of the fold's "· K archived" and of the live announcement;
   * 0 while the toggle is off or a phase, fog or takeable filter hides the archive block.
   */
  protected readonly archivedShown = computed(() => this.visible().filter((row) => row.archived !== undefined).length);
  /**
   * The polite announcement of the archive toggle (spec 050, T3, ISC-287): empty on the first render (a reload with
   * `?archived=1` announces nothing), then "N archived specs shown" or "Archived specs hidden" on each flip.
   */
  protected readonly archivedLive = linkedSignal<boolean, string>({
    source: () => this.query().archived,
    computation: (on, previous) => {
      if (previous === undefined) return '';
      if (!on) return this.transloco.translate('specs.archivedHidden');
      const count = untracked(() => this.archivedShown());
      return this.transloco.translate(`specs.archivedShown.${count === 1 ? 'one' : 'other'}`, { count });
    },
  });

  private readonly openState = inject(OpenState);
  /** The workspace's archived specs (`DashboardKpis.archived`) for the head's counter; else the archive rows' count. */
  readonly archivedCount = input<number | null>(null);
  /** The filter chips' counts, the model's `kpis` (`readListCounts`, spec 021, ISC-255); without them no chips. */
  readonly counts = input<SpecListCounts | null>(null);
  protected readonly archivedTotal = computed(() => this.archivedCount() ?? this.archive().length);
  /** "Show all N" is open: `?open=specs` in the address. */
  protected readonly allOpen = computed(() => this.openState.isOpen('specs'));
  protected readonly cap = SPEC_ROW_CAP;
  /** The entries always in view, and those behind "show all N": the rows, the idea group after the active ones (T41). */
  private readonly parts = computed(() => listEntries(this.listed().active, this.shownIdeas().length, this.listed().archived, SPEC_ROW_CAP));
  protected readonly headRows = computed(() => this.parts().head);
  protected readonly restRows = computed(() => this.parts().rest);

  protected setAllOpen(open: boolean): void {
    void this.openState.set('specs', open);
  }

  /**
   * The fold's toggle sits inside the roving list's host: its arrow, Home and End keys stay the button's own instead of
   * moving the row selection. Keys from a row (inside an `li`) pass on to the list.
   */
  protected keepToggleKeys(event: KeyboardEvent): void {
    if (!ROVING_KEYS.has(event.key)) return;
    if (event.target instanceof Element && event.target.closest('li') !== null) return;
    event.stopPropagation();
  }

  private readonly roving = viewChild(UiRovingList);
  /** The selected spec: the roving list's tab stop, the first visible row until the user moves. */
  readonly selectedId = computed(() => this.roving()?.activeItem()?.element.getAttribute('data-spec-row') ?? null);
  /** The ids of the rows as listed, filtered and sorted: the order `[` `]` step through in the preview. */
  readonly visibleIds = computed(() => this.visible().map((row) => row.id));

  /** Moves focus (and with it the roving selection) to the row of `id`; false when that row is not listed. */
  focusRow(id: string): boolean {
    const row = this.host.nativeElement.querySelector<HTMLElement>(`[data-spec-row="${CSS.escape(id)}"]`);
    row?.focus();
    return row !== null;
  }

  /** A waiting spec (core's `WAITING_STAGES`) is the only one without guidance whose row reads its phrase (ISC-122.3). */
  protected isWaiting(stage: string): boolean {
    return WAITING_STAGES.has(stage as Stage);
  }

  /**
   * The row link's description (spec 021, R1): the visible "Waits on you" mark, the reason (`why-<id>`, hidden) and the
   * description line, each when the row shows it (no description line at compact density); null when it has none.
   */
  protected describedBy(row: SpecTableRow, waits: boolean, why: boolean): string | null {
    const ids = [waits ? `mark-${row.id}` : '', why ? `why-${row.id}` : '', this.descShown(row) ? `desc-${row.id}` : ''].filter(Boolean);
    return ids.length > 0 ? ids.join(' ') : null;
  }

  /** The row renders its description line: it has one and the density is not `compact` (ISC-254). */
  protected descShown(row: SpecTableRow): boolean {
    return row.description !== null && this.density() !== 'compact';
  }

  /** The row link's tooltip: the title, and the reason on its own line when the row has one (R1). */
  protected linkTitle(title: string, why: string): string {
    return why ? `${title}\n${why}` : title;
  }

  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });

  /** The sort menu's keys with their labels (`specs.sort.*`), in `SORT_MENU` order. */
  protected readonly sortOptions = computed<SortOption[]>(() => {
    this.lang();
    return SORT_MENU.map((key) => ({ key, label: this.transloco.translate(`specs.sort.${key}`) }));
  });

  protected readonly stageChips = computed<FilterOption[]>(() => {
    this.lang();
    return withIdeaOption(stageOptions(this.counts()), this.ideas().length).map((option) => this.named(this.chip(option, this.stageWord(option.key), true), 'specs.filter.allStages'));
  });
  /** The chip the query presses: All, or the one stage asked for; several (a mapped `?phase=scoping`) press none. */
  protected readonly stageValue = computed(() => this.query().stage?.join(',') ?? ALL);
  protected readonly typeChips = computed<FilterOption[]>(() => {
    this.lang();
    return typeOptions(this.counts()).map((option) => this.named(this.chip(option, option.key === ALL ? 'specs.filter.all' : null, false), 'specs.filter.allTypes'));
  });
  /** The strip under the head (`.phase-strip`): one equal segment per active spec, in its stage's tone (T62). */
  protected readonly strip = computed(() => this.rows().map((row) => ({ id: row.id, color: toneMark(toneOfStage(row.stage)) })));
  protected readonly phaseStripLabel = computed(() => {
    this.lang();
    return this.stageChips()
      .filter((chip) => chip.key !== ALL && chip.key !== FOG && chip.key !== IDEA)
      .map((chip) => `${chip.label} ${chip.count ?? 0}`)
      .join(' · ');
  });

  protected readonly noMatchPhase = computed(() => {
    this.lang();
    return (this.query().stage ?? []).map((stage) => this.transloco.translate(this.stageWord(stage))).join(', ');
  });

  /** A chip's word: All, fog, or `stages.<stage>` (`idea` included). */
  private stageWord(key: string): string {
    return key === ALL ? 'specs.filter.all' : key === FOG ? 'specs.filter.fog' : `stages.${key}`;
  }

  protected setStage(key: string | undefined): void {
    this.queryChange.emit({ ...this.query(), stage: key === undefined || key === ALL ? null : [key] });
  }

  protected setType(key: string | undefined): void {
    this.queryChange.emit({ ...this.query(), type: key === undefined || key === ALL ? null : key });
  }

  /** A pick from `ui-sort-menu`, which has already closed itself; a key outside `SORT_MENU` or the current one changes nothing. */
  protected setSort(key: string): void {
    const sort = SORT_MENU.find((menuKey) => menuKey === key);
    if (sort !== undefined && sort !== this.query().sort) this.queryChange.emit({ ...this.query(), sort });
  }

  /** The "Show archived" toggle (spec 050, T3, ISC-287): the page turns the flipped flag into `?archived=1` or nothing. */
  protected toggleArchived(): void {
    this.queryChange.emit({ ...this.query(), archived: !this.query().archived });
  }

  protected clearTakeable(): void {
    this.queryChange.emit({ ...this.query(), takeable: false });
  }

  /** Spec 064 (T4, ISC-465): the working flag's click drops the filter, the rest of the query stays. */
  protected clearWorking(): void {
    this.queryChange.emit({ ...this.query(), working: false });
  }

  protected clearFilter(): void {
    this.queryChange.emit({ ...this.query(), stage: null, type: null, takeable: false, working: false });
  }

  private chip(option: ListOption, key: string | null, toned: boolean): FilterOption {
    const tone = toned && option.key !== ALL && option.key !== IDEA ? toneOfStage(option.key) : undefined;
    return {
      key: option.key,
      label: key === null ? option.key : this.transloco.translate(key),
      count: option.count,
      ...(tone !== undefined ? { tone } : {}),
    };
  }

  /** The "all" chip named by its group ("All 23 stages" / "All 23 types", the visible "All 23" inside the name), so the two never share a name (ISC-248). */
  private named(chip: FilterOption, key: string): FilterOption {
    return chip.key === ALL ? { ...chip, name: this.transloco.translate(`${key}.${chip.count === 1 ? 'one' : 'other'}`, { count: chip.count ?? 0 }) } : chip;
  }
}
