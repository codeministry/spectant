import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, InjectionToken } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { PlanningHolder, PlanningMilestone } from '../../../../../core/src/planning';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../shared/ui/term/term';
import { fragmentTarget, installArrival, planningPageState, stagesByRow } from './planning-page';
import { SpecChip } from './spec-chip';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Today as `YYYY-MM-DD`: the local calendar day, the one the server's `localDate()` derives `state` on
 * (`server/src/api.ts`), never the UTC day, which differs around midnight. A function, read whenever the rows
 * recompute; tests pin it.
 */
export const MILESTONES_TODAY = new InjectionToken<() => string>('MILESTONES_TODAY', {
  providedIn: 'root',
  factory: () => () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  },
});

const DAY_MS = 86_400_000;
/** An ISO date read as a calendar day (UTC), so no time zone moves it a day (the area menu's rule). */
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

interface RowView {
  readonly milestone: PlanningMilestone;
  /** The `Intl` medium date of the target in the UI language; null for an undated entry. */
  readonly date: string | null;
  /** Calendar days between today and the target, in the direction the state reads; null without a target. */
  readonly days: number | null;
  /** The naming specs, never `main` on this page, active ones with the dashboard's stage. */
  readonly specs: readonly PlanningHolder[];
  readonly complete: boolean;
}

/**
 * `/w/:ws/milestones` (spec 003, ISC-104 / ISC-102; design.md § Milestones page at every viewport): one card per
 * milestone some spec names, in the model's order (target ascending, undated last), with the target date, the served
 * state, the cross-feature meter, the features the milestone touches as links into the Features page and the naming
 * specs as chips, archived ones included. `state` is the model's and never re-derived; only the day count is computed
 * here, from the target and today (`MILESTONES_TODAY`, the local calendar day), both read as calendar days on the UTC
 * axis so no time zone moves either one.
 *
 * While the tree answered and no spec names a milestone the page is absent: the not-found page, with a way on to
 * Features beneath it. The card and grid are the Features row's (`features-page.css`); tiers come from
 * `ShellState.tier()` as `data-tier`.
 */
@Component({
  selector: 'app-milestones-page',
  imports: [TranslocoPipe, RouterLink, NotFound, UiButton, UiCard, UiChip, UiIcon, UiMeter, UiSkeleton, UiTerm, SpecChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'milestones', '[attr.data-tier]': 'tier()' },
  templateUrl: './milestones-page.html',
  styleUrl: './milestones-page.css',
})
export class MilestonesPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly today = inject(MILESTONES_TODAY);

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly name = computed(() => this.data.workspaceName(this.ws()));
  protected readonly tier = this.state.tier;
  protected readonly wide = computed(() => this.tier() === 'wide');

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly dateFormat = computed(
    () => new Intl.DateTimeFormat(this.lang(), { dateStyle: 'medium', timeZone: 'UTC' }),
  );

  private readonly pageState = planningPageState(this.data);
  protected readonly missing = this.pageState.missing;
  protected readonly unavailable = this.pageState.unavailable;
  /** The tree has answered and no milestone names a spec: the page is absent (ISC-104). */
  protected readonly absent = computed(() => this.data.planning.value() !== undefined && !this.data.hasMilestones());
  protected readonly model = this.data.planningModel;

  private readonly stages = computed(() => stagesByRow(this.data.specRows()));

  protected readonly rows = computed<readonly RowView[]>(() => {
    const stages = this.stages();
    const format = this.dateFormat();
    const today = utcDay(this.today()).getTime();
    // Only the entries some spec names: a 0/0 block entry no spec names adds no row (the `hasMilestones` rule).
    return (this.model()?.milestones ?? [])
      .filter((milestone) => milestone.specs.length > 0)
      .map((milestone) => {
        const target = milestone.target === null ? null : utcDay(milestone.target);
        const ahead = target === null ? null : Math.round((target.getTime() - today) / DAY_MS);
        return {
          milestone,
          date: target === null ? null : format.format(target),
          days: ahead === null ? null : Math.max(0, milestone.state === 'late' ? -ahead : ahead),
          complete: milestone.state === 'complete',
          specs: milestone.specs.map((holder) =>
            holder.archived ? { ...holder, main: false } : { ...holder, main: false, stage: stages.get(holder.id) ?? holder.stage },
          ),
        };
      });
  });

  /** The summary: the count and the next milestone, the earliest not complete (the model sorts by target). */
  protected readonly meta = computed(() => {
    const rows = this.rows();
    const next = rows.find((row) => !row.complete);
    if (next === undefined) return { key: 'planning.milestones.metaNone', params: {} };
    const params = { count: rows.length, name: next.milestone.name };
    return next.date === null
      ? { key: 'planning.milestones.metaUndated', params }
      : { key: 'planning.milestones.meta', params: { ...params, date: next.date } };
  });

  protected readonly target = fragmentTarget();

  constructor() {
    // Scroll to and focus the row the fragment names (`m-<slug>`) once it is rendered; a later fragment lands again.
    installArrival(this.host, this.target, () => this.rows());
  }
}
