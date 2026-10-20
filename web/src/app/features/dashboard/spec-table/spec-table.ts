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
import { UiPopover, UiPopoverTrigger } from '../../../shared/ui/overlay/popover';
import { guidanceEntryOf } from '../../../shared/ui/guidance/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import { UiSheet } from '../../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { toneMark } from '../../../shared/ui/tone';
import { specSlugOf } from '../../../../../../core/src/spec-ref';
import { type Stage, WAITING_STAGES } from '../../../../../../core/src/stage';
import { TRACK_STAGES } from '../../spec/dashboard/dashboard-model';
import { SpecRow } from './spec-row';
import {
  ALL,
  applyListQuery,
  type ArchiveRow,
  FOG,
  type ListOption,
  type ListQuery,
  PHASE_TONES,
  phaseOptions,
  SORT_MENU,
  type SortKey,
  type SpecListCounts,
  type SpecTableRow,
  typeOptions,
} from './spec-table-model';

/** The rows the dashboard's spec list shows before "show all N" (spec 021, ISC-246; 10 since 2026-10-20, was 5). */
export const SPEC_ROW_CAP = 10;

/** The keys `uiRovingList` moves on; the fold's toggle keeps them (`keepToggleKeys`). */
const ROVING_KEYS: ReadonlySet<string> = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End', 'j', 'k']);

/**
 * The Specs panel of the workspace dashboard (T63, ISC-61), ported from the prototype's `spec-table` (T89; styles.css
 * 362-400, app.js specTable): the head "Specs n · k archived" with the `#specs` heading the `g s` jump and the spec
 * picker land on, the phase chips (plus type chips from two types and the takeable flag) and the sort menu (a
 * `ui-popover`, a bottom `ui-sheet` at compact), the 8 px phase strip (one segment per active spec), the rows as one
 * roving list (↓ ↑ j k Home End, one tab stop, no wrap) and the archived footer under `#archive`.
 *
 * Filter, sort and takeable are the page's query state: the panel renders `query` and asks for a new one through
 * `queryChange`, it never holds them itself. The selection is the roving list's tab stop, exposed as `selectedId`
 * and marked `data-selected` on its row.
 *
 * Spec 021 (T25, ISC-246): the head carries the counters (active and archived specs) as one wrapping chip row, and
 * the list shows its first `SPEC_ROW_CAP` rows; the rest stand behind a "show all N" `ui-disclosure` whose open state is
 * `?open=specs` (`OpenState`), so a reload keeps it. The cap counts the listed rows, filtered and sorted: a filter
 * narrows the list, the fold still keeps it to one picture. The folded rows are rendered only while the fold is open,
 * so the roving list never steps into a hidden row.
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
    UiPopover,
    UiPopoverTrigger,
    GuidanceReasonPipe,
    UiRovingItem,
    UiRovingList,
    UiSheet,
    SpecRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-table.html',
  styleUrls: ['./spec-table.css', '../../../layout/detail-sidebar/selection.css'],
  host: { 'data-panel': 'specs' },
})
export class SpecTable {
  private readonly transloco = inject(TranslocoService);
  private readonly settings = inject(SettingsService);
  private readonly shell = inject(ShellState);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });
  /**
   * The rows' density (spec 021, ISC-254): `?density=` for this view, else the stored setting, as on the board; an
   * unknown value falls back to the setting. The list never writes the setting.
   */
  protected readonly density = computed<Density>(() => {
    const param = this.params().get('density');
    return isDensity(param) ? param : this.settings.settings().density;
  });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly ws = input.required<string>();
  readonly rows = input.required<readonly SpecTableRow[]>();
  readonly archive = input<readonly ArchiveRow[]>([]);
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

  /**
   * The rows carrying the changed dot (design.md § Live update): every refresh adds its changed rows, and a row keeps
   * its dot until it is hovered or focused, however many quiet refreshes pass in between.
   */
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

  protected readonly sortMenuKeys = SORT_MENU;
  protected readonly compact = computed(() => this.shell.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly visible = computed(() => applyListQuery(this.rows(), this.query()));
  protected readonly sortSheetOpen = signal(false);

  private readonly openState = inject(OpenState);
  /**
   * The workspace's archived specs (`DashboardKpis.archived`) for the head's counter; without it the panel counts the
   * archive rows it lists, the same folders.
   */
  readonly archivedCount = input<number | null>(null);
  /**
   * The filter chips' counts, the model's `kpis` (`readListCounts`): the phase chips count by stage group as the Specs
   * tile does, the type chips by `byType` (spec 021, ISC-255). Without them the panel shows no chips.
   */
  readonly counts = input<SpecListCounts | null>(null);
  protected readonly archivedTotal = computed(() => this.archivedCount() ?? this.archive().length);
  /** "Show all N" is open: `?open=specs` in the address. */
  protected readonly allOpen = computed(() => this.openState.isOpen('specs'));
  protected readonly cap = SPEC_ROW_CAP;
  /** The rows always in view, and those behind "show all N". */
  protected readonly headRows = computed(() => this.visible().slice(0, SPEC_ROW_CAP));
  protected readonly restRows = computed(() => this.visible().slice(SPEC_ROW_CAP));

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

  private readonly sortPopover = viewChild(UiPopover);
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

  protected readonly sortLabel = computed(() => {
    this.lang();
    return `${this.transloco.translate('specs.sort.label')}: ${this.transloco.translate(`specs.sort.${this.query().sort}`)}`;
  });

  protected readonly phaseChips = computed<FilterOption[]>(() => {
    this.lang();
    return phaseOptions(this.counts()).map((option) => this.named(this.chip(option, option.key === ALL ? 'specs.filter.all' : option.key === FOG ? 'specs.filter.fog' : `phases.${option.key}`, true), 'specs.filter.allStages'));
  });
  protected readonly typeChips = computed<FilterOption[]>(() => {
    this.lang();
    return typeOptions(this.counts()).map((option) => this.named(this.chip(option, option.key === ALL ? 'specs.filter.all' : null, false), 'specs.filter.allTypes'));
  });
  /** The strip under the head (prototype `.phase-strip`): one equal segment per active spec, in its stage group's tone. */
  protected readonly strip = computed(() =>
    this.rows().map((row) => ({ id: row.id, color: toneMark(PHASE_TONES[row.stageGroup ?? ''] ?? 'neutral') })),
  );
  protected readonly phaseStripLabel = computed(() => {
    this.lang();
    return this.phaseChips()
      .filter((chip) => chip.key !== ALL && chip.key !== FOG)
      .map((chip) => `${chip.label} ${chip.count ?? 0}`)
      .join(' · ');
  });

  protected readonly noMatchPhase = computed(() => {
    this.lang();
    const phase = this.query().phase;
    if (phase === null) return '';
    return phase === FOG ? this.transloco.translate('specs.filter.fog') : this.transloco.translate(`phases.${phase}`);
  });

  protected setPhase(key: string | undefined): void {
    this.queryChange.emit({ ...this.query(), phase: key === undefined || key === ALL ? null : key });
  }

  protected setType(key: string | undefined): void {
    this.queryChange.emit({ ...this.query(), type: key === undefined || key === ALL ? null : key });
  }

  protected setSort(sort: SortKey): void {
    this.sortPopover()?.close();
    this.sortSheetOpen.set(false);
    if (sort !== this.query().sort) this.queryChange.emit({ ...this.query(), sort });
  }

  protected clearTakeable(): void {
    this.queryChange.emit({ ...this.query(), takeable: false });
  }

  protected clearFilter(): void {
    this.queryChange.emit({ ...this.query(), phase: null, type: null, takeable: false });
  }

  /** The footer's name for an archived spec: its slug without the number (prototype "001 manifest-sync"). */
  protected archivedName(spec: ArchiveRow): string {
    return specSlugOf(spec.slug);
  }

  private chip(option: ListOption, key: string | null, toned: boolean): FilterOption {
    const tone = toned ? PHASE_TONES[option.key] : undefined;
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
