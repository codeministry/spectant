import { ChangeDetectionStrategy, Component, computed, inject, InjectionToken, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningMilestone, PlanningModel } from '../../../../../core/src/planning';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiRing } from '../../shared/ui/ring/ring';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Today as `YYYY-MM-DD`: the local calendar day, the one the server's `localDate()` derives `state` on
 * (`server/src/api.ts`), never the UTC day, which differs around midnight. A function, read whenever the overview
 * recomputes; tests pin it. Moved here from the retired Milestones page (spec 026, T30).
 */
export const MILESTONES_TODAY = new InjectionToken<() => string>('MILESTONES_TODAY', {
  providedIn: 'root',
  factory: () => () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  },
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
  template: `
    @if (next(); as next) {
      <section class="block" data-overview="next-milestone">
        <h2 class="eyebrow type-eyebrow">
          <span>{{ 'planning.milestones.rail.next' | transloco }}</span>
          @let days = nextDays();
          @if (days !== null) {
            <span>{{ 'planning.milestones.rail.days' | transloco: { days } }}</span>
          }
        </h2>
        <ui-card [padding]="16">
          <div class="ring-row">
            <ui-ring aria-hidden="true" [value]="next.total > 0 ? (100 * next.closed) / next.total : null" [size]="96" [stroke]="8" />
            <div>
              <div class="big">{{ next.closed }}<small>/{{ next.total }}</small></div>
              <div class="meta">{{ 'planning.milestones.rail.closed' | transloco: { name: next.name } }}</div>
            </div>
          </div>
          @if (mostOpen().length > 0) {
            <p class="eyebrow type-eyebrow sub">{{ 'planning.milestones.rail.mostOpen' | transloco }}</p>
            @for (feature of mostOpen(); track feature.id) {
              <a class="mini-row" data-overview-feature [routerLink]="treeLink()" [queryParams]="{ sel: 'feature:' + feature.id }">
                <span class="fid">{{ feature.id }}</span>
                <span class="t">{{ feature.name }}</span>
                <span class="bar" aria-hidden="true"
                  ><i [style.inline-size.%]="feature.total > 0 ? (100 * feature.closed) / feature.total : 0"></i
                ></span>
                <span class="num">{{ feature.closed }}/{{ feature.total }}</span>
              </a>
            }
          }
        </ui-card>
      </section>
    }
    @if (milestones().length > 0) {
      <section class="block" data-overview="milestones">
        <h2 class="eyebrow type-eyebrow">{{ 'planning.page.levels.milestones' | transloco }}</h2>
        <ul class="ms-list">
          @for (milestone of milestones(); track milestone.slug) {
            <li>
              <a class="ms-row" [routerLink]="treeLink()" [queryParams]="{ sel: 'milestone:' + milestone.slug }" [attr.data-overview-milestone]="milestone.slug">
                <ui-icon name="flag" [size]="14" />
                <span class="t">{{ milestone.name }}</span>
                <span class="num">{{ milestone.closed }}/{{ milestone.total }}</span>
              </a>
              <ui-meter
                [value]="milestone.closed"
                [max]="milestone.total"
                size="mini"
                [label]="'planning.milestones.meterLabel' | transloco: { name: milestone.name }"
                [valueText]="'planning.features.valueText' | transloco: { closed: milestone.closed, total: milestone.total }"
              />
            </li>
          }
        </ul>
      </section>
    } @else {
      <p class="meta" data-overview-empty>{{ 'planning.page.overviewEmpty' | transloco }}</p>
    }
  `,
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
