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
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SettingsService } from '../../../core/settings.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiCard } from '../../../shared/ui/card/card';
import { type FilterOption, UiFilterChips } from '../../../shared/ui/filter-chips/filter-chips';
import { UiPopover, UiPopoverTrigger } from '../../../shared/ui/overlay/popover';
import { UiSheet } from '../../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { toneMark } from '../../../shared/ui/tone';
import { specSlugOf } from '../../../../../../core/src/spec-ref';
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
  type SpecTableRow,
  typeOptions,
} from './spec-table-model';

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
 */
@Component({
  selector: 'app-spec-table',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    TranslocoPipe,
    UiCard,
    UiFilterChips,
    UiIcon,
    UiPopover,
    UiPopoverTrigger,
    UiRovingItem,
    UiRovingList,
    UiSheet,
    SpecRow,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-table.html',
  styleUrl: './spec-table.css',
  host: { 'data-panel': 'specs' },
})
export class SpecTable {
  private readonly transloco = inject(TranslocoService);
  private readonly settings = inject(SettingsService);
  private readonly shell = inject(ShellState);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly ws = input.required<string>();
  readonly rows = input.required<readonly SpecTableRow[]>();
  readonly archive = input<readonly ArchiveRow[]>([]);
  readonly query = input.required<ListQuery>();
  readonly queryChange = output<ListQuery>();
  /**
   * The spec the preview shows (`?spec=<id>`, T69). A row's link activates in two steps: the first (Enter or a click)
   * merges `?spec=<id>` into the URL, and on the previewed row it leads to the spec page `/w/:ws/s/:id`.
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
    return phaseOptions(this.rows()).map((option) => this.chip(option, option.key === ALL ? 'specs.filter.all' : option.key === FOG ? 'specs.filter.fog' : `phases.${option.key}`, true));
  });
  protected readonly typeChips = computed<FilterOption[]>(() => {
    this.lang();
    return typeOptions(this.rows()).map((option) => this.chip(option, option.key === ALL ? 'specs.filter.all' : null, false));
  });
  /** The strip under the head (prototype `.phase-strip`): one equal segment per active spec, in its phase's tone. */
  protected readonly strip = computed(() =>
    this.rows().map((row) => ({ id: row.id, color: toneMark(PHASE_TONES[row.phase ?? ''] ?? 'neutral') })),
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
}
