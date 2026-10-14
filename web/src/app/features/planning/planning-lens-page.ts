import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, type TemplateRef, untracked, viewChild } from '@angular/core';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { RailContent } from '../../layout/shell/rail-content';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { UiCard } from '../../shared/ui/card/card';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { planningCounts } from './planning-counts';
import { PlanningGraph } from './planning-graph/planning-graph';
import { PlanningMatrix } from './planning-matrix/planning-matrix';
import { PlanningOverview } from './planning-overview';
import { planningPageState } from './planning-page';
import { PlanningTree } from './planning-tree/planning-tree';

/**
 * The planning page `/w/:ws/planning/<lens>` (spec 026, T15, ISC-167; design.md § Across viewports): one
 * workspace page in place of Features and Milestones, with the lenses Tree, Matrix and Graph in the prototype
 * `tab-bar` (sticky under the header, route links with `aria-current="page"`, a switch keeps `?sel=` and `?m=`).
 * `/w/:ws/planning` redirects to the tree. One instance stays across lens switches: the lens routes are componentless
 * children, so the body follows `ShellState.route().lens` and no `<router-outlet>` is involved.
 *
 * The overview (the old Milestones page's next milestone, milestone list and most open claims) sits in the rail at wide
 * on the tree while nothing is selected (the page registers it with `RailContent`; the docked sidebar replaces it on a
 * selection), else in the collapsible "Overview" block above the tree, closed by default. Matrix and graph have
 * neither rail nor overview: they take the full width. Every lens hides archived specs until its archive toggle shows
 * them; the page holds that toggle, so it stays as set across lens switches, and turns it on when the selection is an
 * archived spec, so a deep link or a palette pick still finds its row. The planning helpers the old pages share stay in
 * `planning-page.ts`.
 */
@Component({
  selector: 'app-planning-page',
  imports: [NotFound, PlanningGraph, PlanningMatrix, PlanningOverview, PlanningTree, TabBarSlot, TranslocoPipe, UiCard, UiPageHead, UiSkeleton, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'planning', '[attr.data-active-lens]': 'lens()' },
  templateUrl: './planning-lens-page.html',
  styleUrl: './planning-lens-page.css',
})
export class PlanningPage {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly name = computed(() => this.data.workspaceName(this.ws()));
  protected readonly lens = computed(() => this.state.route().lens ?? 'tree');

  private readonly pageState = planningPageState(this.data);
  protected readonly missing = this.pageState.missing;
  protected readonly unavailable = this.pageState.unavailable;
  protected readonly model = this.data.planningModel;
  protected readonly counts = computed(() => {
    const model = this.model();
    return model === null ? null : planningCounts(model);
  });

  /** Archived specs shown in every lens (each lens's archive toggle), off by default. */
  protected readonly showArchived = signal(false);

  /** The overview stands in the rail: the tree lens at wide with the rail open; on the tree elsewhere it is the block. */
  protected readonly overviewInRail = computed(() => this.lens() === 'tree' && this.state.tier() === 'wide' && !this.state.railStrip());

  private readonly overview = viewChild<TemplateRef<unknown>>('overview');

  constructor() {
    const selection = inject(DetailSelection);
    effect(() => {
      const ref = selection.selected();
      const model = this.model();
      if (ref !== null && model?.relations?.[ref]?.archived === true && ref.startsWith('spec:')) untracked(() => this.showArchived.set(true));
    });
    inject(RailContent).register(
      {
        blocks: computed(() => (this.lens() === 'tree' ? (this.overview() ?? null) : null)),
        bar: signal(null),
        badges: signal(null),
      },
      inject(DestroyRef),
    );
  }
}
