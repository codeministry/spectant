import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningMilestone, PlanningModel } from '../../../../../core/src/planning';
import { UiIcon } from '../../shared/icons/icon';
import { localDayKey } from '../../shared/time';
import { UiCard } from '../../shared/ui/card/card';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiRing } from '../../shared/ui/ring/ring';

/**
 * Today as `YYYY-MM-DD`: the local calendar day, the one the server's `localDate()` derives `state` on
 * (`server/src/api.ts`), never the UTC day, which differs around midnight. A function, read whenever the overview
 * recomputes; tests pin it. Moved here from the retired Milestones page (spec 026, T30).
 */
export const MILESTONES_TODAY = new InjectionToken<() => string>('MILESTONES_TODAY', {
  providedIn: 'root',
  factory: () => () => localDayKey(new Date()),
});

const DAY_MS = 86_400_000;
const utcDay = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();

/** The milestones some spec names, in the model's order (target ascending, undated last): the `hasMilestones` rule. */
export const namedMilestones = (model: PlanningModel): readonly PlanningMilestone[] =>
  model.milestones.filter((milestone) => milestone.specs.length > 0);

/**
 * The next milestone's three features with the most open claims, master order within a count: the retired Milestones
 * page's rail rule, which the overview carries on (spec 026, T30).
 */
export const mostOpenFeatures = (milestone: PlanningMilestone | null): PlanningMilestone['features'] =>
  (milestone?.features ?? [])
    .map((feature, index) => ({ feature, index }))
    .filter(({ feature }) => feature.total > feature.closed)
    .sort((a, b) => b.feature.total - b.feature.closed - (a.feature.total - a.feature.closed) || a.index - b.index)
    .slice(0, 3)
    .map(({ feature }) => feature);

/**
 * The planning page's overview (spec 026, T15; design.md § Across viewports, "added by the parent"): what the old
 * Milestones page showed beside its rows, the next milestone with its ring and day count, the milestone list and the
 * next milestone's features with the most open claims. The page puts it into the rail at wide on the tree lens while
 * nothing is selected, else into its collapsible "Overview" block. Every row selects its object (`?sel=`) on the tree.
 */
@Component({
  selector: 'app-planning-overview',
  imports: [RouterLink, TranslocoPipe, UiCard, UiIcon, UiMeter, UiRing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-planning-overview': '' },
  styleUrl: './planning-overview.css',
  templateUrl: './planning-overview.html',
})
export class PlanningOverview {
  readonly ws = input.required<string>();
  readonly model = input.required<PlanningModel>();
  private readonly today = inject(MILESTONES_TODAY);

  protected readonly treeLink = computed(() => ['/w', this.ws(), 'planning', 'tree']);
  protected readonly milestones = computed(() => namedMilestones(this.model()));
  /** The next milestone: the first in target order that is not complete. */
  protected readonly next = computed(() => this.milestones().find((milestone) => milestone.state !== 'complete') ?? null);
  /** Calendar days until the next milestone's target; null when undated or late. */
  protected readonly nextDays = computed(() => {
    const next = this.next();
    if (next?.target == null || next.state === 'late') return null;
    return Math.max(0, Math.round((utcDay(next.target) - utcDay(this.today())) / DAY_MS));
  });
  protected readonly mostOpen = computed(() => mostOpenFeatures(this.next()));
}
