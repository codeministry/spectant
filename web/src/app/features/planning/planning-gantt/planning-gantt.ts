import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { type GanttGroup, type GanttLane, type GanttMark, planningGantt } from '../../../../../../core/src/gantt';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { RelationRef } from '../../../../../../core/src/relations';
import { LanguageService } from '../../../core/language.service';
import { DetailSelection, selectedLook, type SelectedLook } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import type { Tier } from '../../../layout/shell/tier';
import { UiIcon } from '../../../shared/icons/icon';
import { formatDay, formatDayMonth, formatMonth, UiTime } from '../../../shared/time';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiPriority } from '../../../shared/ui/priority/priority';
import { UiRovingItem, UiRovingList } from '../../../shared/ui/roving-list.directive';
import { UiTerm } from '../../../shared/ui/term/term';

/** Width of the label column per tier (design.md: stacked at compact, 232 px at medium, 320 px at wide). */
const LABEL_PX: Readonly<Record<Tier, number>> = { compact: 0, medium: 232, wide: 320 };
/** The axis start before the today line, not to scale: [without, with] a past milestone (design.md § Across viewports). */
const LEAD_PX: Readonly<Record<Tier, readonly [number, number]>> = { compact: [0, 40], medium: [16, 56], wide: [16, 96] };
/** Fit to width while each month keeps this much; below it the axis scrolls in its own container. Never at compact. */
const MIN_MONTH_PX: Readonly<Record<Tier, number>> = { compact: 0, medium: 64, wide: 64 };
/** The compact sheet's side padding the axis is inset by, so ticks, boundaries and bars stand on one line. */
const COMPACT_INSET_PX = 32;
/** A month label needs this much room (compact 32, wider tiers 40); under 20 px per month compact shows quarters. */
const LABEL_ROOM_PX: Readonly<Record<Tier, number>> = { compact: 32, medium: 40, wide: 40 };
const QUARTER_BELOW_PX = 20;
const AVG_MONTH_DAYS = 30.44;

/** One month tick of the axis, positioned in percent of the scale; `label` null where it has no room. */
interface ViewMonth {
  readonly month: string;
  readonly left: number;
  readonly label: string | null;
}

/** A milestone's window end on the axis. */
interface ViewBoundary {
  readonly ref: RelationRef;
  readonly name: string;
  readonly target: string;
  readonly left: number;
}

interface ViewBar {
  readonly window: 'past' | 'span';
  readonly from: number | null;
  readonly to: number | null;
  /** Percent of the scale; unused for `past`, which fills the lead. */
  readonly left: number;
  readonly width: number;
}

interface ViewLane {
  readonly lane: GanttLane;
  readonly bar: ViewBar | null;
  readonly look: SelectedLook | null;
  readonly selected: boolean;
}

interface ViewGroup {
  readonly group: GanttGroup;
  readonly key: string;
  readonly headId: string;
  readonly bar: ViewBar | null;
  /** The target in the app language (`formatDay`), for the lanes' accessible names. */
  readonly targetText: string | null;
  /** Days from the cut-off day to the target, for a window ahead. */
  readonly daysLeft: number | null;
  readonly lanes: readonly ViewLane[];
}

const markIcon = (mark: GanttMark): 'clock-alert' | 'circle-check' => (mark === 'overdue' ? 'clock-alert' : 'circle-check');

/**
 * The Gantt lens (spec 038, `/w/:ws/planning/gantt`, ISC-203 to ISC-205; design.md): the planning tree on a time axis
 * from the cut-off day to the latest milestone target, one lane per feature block in rank order under its milestone,
 * each with one bar over the milestone's window filled closed/total, and no spec. Every group, lane, window and number
 * is core's `planningGantt` of the planning model on its own `asOf`; the view adds layout only.
 *
 * Tiers (design.md § Across viewports): compact stacks label over track and squeezes the axis into the track width,
 * never scrolling, with the axis head sticky; medium and wide put a 232 / 320 px label column beside the track, fit
 * the axis to the width while each month keeps 64 px and scroll only their own container below that. The milestones
 * dated before the cut-off day share one segment before the today line, not to scale (40 / 56 / 96 px). A lane is one
 * button, one tab stop for all lanes (`uiRovingList`); a click on it or its bar selects the feature (`?sel=`), and the
 * lens docks the detail sidebar into the rail at wide (`DetailSelection.dock`).
 */
@Component({
  selector: 'app-planning-gantt',
  imports: [NgTemplateOutlet, TranslocoPipe, UiEmptyState, UiIcon, UiMeter, UiPriority, UiRovingItem, UiRovingList, UiTerm, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'gantt' },
  styleUrls: ['./planning-gantt.css', '../../../layout/detail-sidebar/selection.css'],
  templateUrl: './planning-gantt.html',
})
export class PlanningGantt {
  readonly model = input.required<PlanningModel>();

  private readonly selection = inject(DetailSelection);
  private readonly state = inject(ShellState);
  private readonly lang = inject(LanguageService).current;

  private readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  /** The scroll container's inner width in px, measured; 0 until the first layout. */
  private readonly width = signal(0);
  /** The axis is scrolled: the label column then casts its shadow (design.md § Tablet). */
  protected readonly scrolled = signal(false);

  protected readonly tier = computed(() => this.state.tier());
  protected readonly gantt = computed(() => planningGantt(this.model(), this.model().asOf));
  protected readonly axis = computed(() => this.gantt().axis);
  protected readonly past = computed(() => this.axis()?.past === true);

  protected readonly labelPx = computed(() => LABEL_PX[this.tier()]);
  protected readonly leadPx = computed(() => LEAD_PX[this.tier()][this.past() ? 1 : 0]);
  /** The least scale width: 64 px per month at medium and wide, so the sheet scrolls below it; 0 at compact. */
  protected readonly minScalePx = computed(() => {
    const days = this.axis()?.days ?? 0;
    return Math.ceil((days / AVG_MONTH_DAYS) * MIN_MONTH_PX[this.tier()]);
  });
  /** The scale's drawn width in px: the measured room, never under the minimum. */
  private readonly scalePx = computed(() => {
    const inset = this.tier() === 'compact' ? COMPACT_INSET_PX : 0;
    return Math.max(this.minScalePx(), this.width() - inset - this.labelPx() - this.leadPx());
  });

  private readonly days = computed(() => Math.max(1, this.axis()?.days ?? 1));
  private readonly pct = (day: number): number => (day / this.days()) * 100;

  protected readonly months = computed<readonly ViewMonth[]>(() => {
    const axis = this.axis();
    if (axis === null) return [];
    const tier = this.tier();
    const perDay = this.scalePx() / this.days();
    const quarters = tier === 'compact' && perDay * AVG_MONTH_DAYS < QUARTER_BELOW_PX;
    const room = LABEL_ROOM_PX[tier];
    const lang = this.lang();
    let lastLabelAt = Number.NEGATIVE_INFINITY;
    return axis.months.map((m, i): ViewMonth => {
      const year = Number(m.month.slice(0, 4));
      const index = Number(m.month.slice(5, 7)) - 1;
      const at = m.from * perDay;
      // The month the axis starts in is broken off by the today label; it gets no label of its own (design.md § Mobile).
      const partial = i === 0 && m.from === 0 && axis.asOf.slice(8) !== '01';
      const quarterStart = index % 3 === 0;
      let label: string | null = null;
      if (!partial && at - lastLabelAt >= room && (quarters ? quarterStart : m.days * perDay >= room || i === axis.months.length - 1)) {
        const short = formatMonth(m.month, lang);
        label = quarters ? `Q${String(index / 3 + 1)} ${String(year).slice(2)}` : index === 0 || lastLabelAt === Number.NEGATIVE_INFINITY ? `${short} ${String(year)}` : short;
        lastLabelAt = at;
      }
      return { month: m.month, left: this.pct(m.from), label };
    });
  });

  protected readonly boundaries = computed<readonly ViewBoundary[]>(() =>
    this.gantt().groups.flatMap((g): ViewBoundary[] =>
      g.window === 'span' && g.ref !== null && g.name !== null && g.target !== null && g.to !== null ? [{ ref: g.ref, name: g.name, target: g.target, left: this.pct(g.to) }] : [],
    ),
  );

  /** "Today · 20 Mar": the cut-off day the axis starts at. */
  protected readonly todayText = computed(() => {
    const asOf = this.axis()?.asOf ?? this.model().asOf;
    return formatDayMonth(asOf, this.lang());
  });

  protected readonly groups = computed<readonly ViewGroup[]>(() => {
    const selected = this.selection.selected();
    return this.gantt().groups.map((group): ViewGroup => {
      const key = group.ref ?? 'none';
      const bar = this.barOf(group);
      return {
        group,
        key,
        headId: `gantt-group-${key.replaceAll(':', '-')}`,
        bar,
        targetText: group.target === null ? null : formatDay(group.target, this.lang()),
        daysLeft: group.window === 'span' ? group.to : null,
        lanes: group.lanes.map((lane) => ({ lane, bar, look: selectedLook(this.selection, lane.ref, 'row'), selected: selected === lane.ref })),
      };
    });
  });

  protected readonly empty = computed(() => this.gantt().groups.length === 0);

  constructor() {
    this.selection.dock(inject(DestroyRef));
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.scroll()?.nativeElement;
      if (el === undefined || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => {
        this.width.set(el.clientWidth);
      });
      observer.observe(el);
      this.width.set(el.clientWidth);
      destroyRef.onDestroy(() => {
        observer.disconnect();
      });
    });
  }

  private barOf(group: GanttGroup): ViewBar | null {
    if (group.window === 'past') return { window: 'past', from: null, to: null, left: 0, width: 100 };
    if (group.window === 'span' && group.from !== null && group.to !== null) {
      return { window: 'span', from: group.from, to: group.to, left: this.pct(group.from), width: this.pct(group.to - group.from) };
    }
    return null;
  }

  protected markIcon = markIcon;

  protected select(ref: RelationRef): void {
    void this.selection.select(ref);
  }

  protected onScroll(event: Event): void {
    const el = event.target as HTMLElement;
    this.scrolled.set(el.scrollLeft > 0);
  }
}
