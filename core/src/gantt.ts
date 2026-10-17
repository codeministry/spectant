// The Gantt lens (spec 038, ISC-202 and ISC-202.1): the planning tree laid out on a time axis, in days and dates, never
// in pixels. It replaces the Matrix lens: one lane per feature block in rank order (spec 036) under its milestone, one
// bar over the milestone's window filled closed/total, and no spec anywhere in the model.
//
// The axis starts at the cut-off day `asOf` (the day the tree derived `late` and `upcoming` with, `PlanningModel.asOf`)
// and ends at the latest milestone target. Every milestone whose target lies before `asOf` shares one past segment at
// the axis start, by date: its width is the view's (it is not to scale), the model only says which groups stand there.
// A dated milestone from `asOf` on gets the window from the previous such target, the first one from `asOf`, to its own.
// Undated milestones and the no-milestone group come last and have no window.
//
// Pure and browser-safe: it reads a `PlanningModel` and imports types only, so the web bundle derives the lens from
// the planning body it already holds, as it did the matrix.
import type { BacklogPriority } from './backlog.ts';
import type { MilestoneState, PlanningFeature, PlanningMilestone, PlanningModel } from './planning.ts';
import type { RelationRef } from './relations.ts';

/**
 * Where a group's bars stand: `past` in the shared segment before `asOf`, `span` over `from`…`to`, `none` without a
 * window (an undated milestone, the no-milestone group).
 */
export type GanttWindow = 'past' | 'span' | 'none';

/** The marking of a group before `asOf`, carried by its lanes too: `overdue` for a `late` milestone, `done` for a `complete` one. */
export type GanttMark = 'overdue' | 'done';

/** One calendar month on the axis, clipped to it. */
export interface GanttMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  /** First day of the month on the axis, in days from `asOf` (0 for the month `asOf` falls in). */
  readonly from: number;
  /** The month's days on the axis; the months' days sum to `GanttAxis.days`. */
  readonly days: number;
}

/** The time axis, from the cut-off day to the latest milestone target. */
export interface GanttAxis {
  /** ISO `YYYY-MM-DD`, day 0 of the axis: the today line. */
  readonly asOf: string;
  /** ISO `YYYY-MM-DD`, the latest milestone target, `asOf` when every target lies before it. */
  readonly end: string;
  /** Days from `asOf` to `end`. */
  readonly days: number;
  /** At least one milestone's target lies before `asOf`: the axis starts with the past segment. */
  readonly past: boolean;
  /** The calendar months between `asOf` and `end`, in order; empty when `days` is 0. */
  readonly months: readonly GanttMonth[];
}

/** One feature block's lane. */
export interface GanttLane {
  /** `feature:F8`, the object a click selects (`?sel=`). */
  readonly ref: RelationRef;
  /** `F8`. */
  readonly id: string;
  /** The heading after `F8 ·`. */
  readonly name: string;
  /** The block's closed claims, dropped ones excluded: the bar's fill is `closed/total`. */
  readonly closed: number;
  readonly total: number;
  /** The block's priority from `specs/backlog.md`. */
  readonly priority: BacklogPriority;
  /** The block's 1-based rank (spec 036); the lanes of a group stand in this order. */
  readonly rank: number;
  /** The group's mark, carried by each of its lanes; null outside the past segment. */
  readonly mark: GanttMark | null;
}

/** One group of lanes: a milestone, or the features without one. */
export interface GanttGroup {
  /** `milestone:<slug>`; null for the no-milestone group. */
  readonly ref: RelationRef | null;
  /** The milestone's name; null for the no-milestone group. */
  readonly name: string | null;
  /** ISO `YYYY-MM-DD`; null for an undated milestone and the no-milestone group. */
  readonly target: string | null;
  /** The milestone's state; null for the no-milestone group. */
  readonly state: MilestoneState | null;
  /** The milestone's own progress, `PlanningMilestone.closed/total`; the lanes' sum for the no-milestone group. */
  readonly closed: number;
  readonly total: number;
  readonly window: GanttWindow;
  /** The window in days from `asOf`, set for `span` only. */
  readonly from: number | null;
  readonly to: number | null;
  /** `overdue` or `done` in the past segment; null otherwise. */
  readonly mark: GanttMark | null;
  /** The features of the group in rank order: a milestone's `featureIds`, the model's `unassignedFeatures`. */
  readonly lanes: readonly GanttLane[];
}

/** The Gantt lens of a planning model. */
export interface GanttModel {
  /** The cut-off day the model was derived for. */
  readonly asOf: string;
  /** The time axis; null when no milestone carries a target, and then no group has a window. */
  readonly axis: GanttAxis | null;
  /**
   * Past milestones by date, then dated milestones from `asOf` on by date, then undated ones, then the no-milestone
   * group, which stands only when it holds a feature.
   */
  readonly groups: readonly GanttGroup[];
}

/** The planning body the lens reads; a `PlanningModel` is one. */
export type GanttInput = Pick<PlanningModel, 'features' | 'milestones' | 'unassignedFeatures'>;

const DAY_MS = 86_400_000;

/** Days since the epoch of an ISO `YYYY-MM-DD` day, read as UTC so no zone moves it. */
const dayOf = (iso: string): number => Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS);

/** The calendar months between two epoch days, `[start, end)`, each clipped to the range and counted from `start`. */
function monthsOf(start: number, end: number): GanttMonth[] {
  const months: GanttMonth[] = [];
  const first = new Date(start * DAY_MS);
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  for (let at = start; at < end; ) {
    const next = Math.round(Date.UTC(year, month + 1, 1) / DAY_MS);
    const stop = Math.min(next, end);
    months.push({ month: `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}`, from: at - start, days: stop - at });
    at = stop;
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return months;
}

/**
 * The Gantt lens of `model` on the cut-off day `asOf` (ISO `YYYY-MM-DD`; the web passes `PlanningModel.asOf`). A lane
 * id the model lists under a milestone but holds no feature block for is skipped, as the views skip it.
 */
export function planningGantt(model: GanttInput, asOf: string): GanttModel {
  const today = dayOf(asOf);
  const byId = new Map(model.features.map((f) => [f.id, f]));
  const lanesOf = (ids: readonly string[], mark: GanttMark | null): GanttLane[] =>
    ids.flatMap((id): GanttLane[] => {
      const f: PlanningFeature | undefined = byId.get(id);
      return f === undefined ? [] : [{ ref: `feature:${f.id}`, id: f.id, name: f.name, closed: f.closed, total: f.total, priority: f.priority, rank: f.rank, mark }];
    });
  const dated = model.milestones.filter((m): m is PlanningMilestone & { target: string } => m.target !== null);
  const byDate = [...dated].sort((a, b) => dayOf(a.target) - dayOf(b.target));
  const past = byDate.filter((m) => dayOf(m.target) < today);
  const ahead = byDate.filter((m) => dayOf(m.target) >= today);
  const milestoneGroup = (m: PlanningMilestone, window: GanttWindow, span: { from: number; to: number } | null, mark: GanttMark | null): GanttGroup => ({
    ref: `milestone:${m.slug}`,
    name: m.name,
    target: m.target,
    state: m.state,
    closed: m.closed,
    total: m.total,
    window,
    from: span?.from ?? null,
    to: span?.to ?? null,
    mark,
    lanes: lanesOf(m.featureIds ?? [], mark),
  });
  const markOf = (m: PlanningMilestone): GanttMark | null => (m.state === 'complete' ? 'done' : m.state === 'late' ? 'overdue' : null);
  let previous = 0;
  const spans = ahead.map((m) => {
    const to = dayOf(m.target) - today;
    const group = milestoneGroup(m, 'span', { from: previous, to }, null);
    previous = to;
    return group;
  });
  const loose = lanesOf(model.unassignedFeatures ?? [], null);
  const groups: GanttGroup[] = [
    ...past.map((m) => milestoneGroup(m, 'past', null, markOf(m))),
    ...spans,
    ...model.milestones.filter((m) => m.target === null).map((m) => milestoneGroup(m, 'none', null, null)),
    ...(loose.length === 0
      ? []
      : [
          {
            ref: null,
            name: null,
            target: null,
            state: null,
            closed: loose.reduce((n, l) => n + l.closed, 0),
            total: loose.reduce((n, l) => n + l.total, 0),
            window: 'none' as const,
            from: null,
            to: null,
            mark: null,
            lanes: loose,
          },
        ]),
  ];
  const last = byDate.at(-1);
  if (last === undefined) return { asOf, axis: null, groups };
  const end = Math.max(dayOf(last.target), today);
  const axis: GanttAxis = {
    asOf,
    end: new Date(end * DAY_MS).toISOString().slice(0, 10),
    days: end - today,
    past: past.length > 0,
    months: monthsOf(today, end),
  };
  return { asOf, axis, groups };
}
