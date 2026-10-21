import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, type TemplateRef, untracked, viewChild } from '@angular/core';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotFound } from '../../layout/not-found/not-found';
import { RailContent } from '../../layout/shell/rail-content';
import { TabBarSlot } from '../../layout/tab-bar/tab-bar-slot';
import { UiCard } from '../../shared/ui/card/card';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { PlanningGantt } from './planning-gantt/planning-gantt';
import { PlanningGraph } from './planning-graph/planning-graph';
import { PlanningOverview } from './planning-overview';
import { PlanningTree } from './planning-tree/planning-tree';
import { PlanningStore } from './planning.store';

/**
 * The planning page `/w/:ws/planning/<lens>` (spec 026, T15, ISC-167; design.md § Across viewports): one
 * workspace page in place of Features and Milestones, with the lenses Gantt (spec 038, where the Matrix stood), Tree and Graph in the
 * `tab-bar` (sticky under the header, route links with `aria-current="page"`, a switch keeps `?sel=` and `?m=`).
 * `/w/:ws/planning` redirects to the Gantt lens. One instance stays across lens switches: the lens routes are componentless
 * children, so the body follows `ShellState.route().lens` and no `<router-outlet>` is involved.
 *
 * The overview (the old Milestones page's next milestone, milestone list and most open claims) sits in the rail at wide
 * on the tree while nothing is selected (the page registers it with `RailContent`; the docked sidebar replaces it on a
 * selection), else in the collapsible "Overview" block above the tree, closed by default. Gantt and graph have
 * no overview: the graph takes the full width, the Gantt too until a selection docks the sidebar into the rail at wide.
 * Tree and graph hide archived specs until their archive toggle shows them (the Gantt shows no spec); the page holds that toggle, so it stays as set across lens switches, and turns it on when the selection is an
 * archived spec, so a deep link or a palette pick still finds its row. The planning helpers the old pages share stay in
 * `planning-page.ts`; the page's state lives in the `PlanningStore` it provides (spec 061), one per page instance.
 */
@Component({
  selector: 'app-planning-page',
  imports: [NotFound, PlanningGantt, PlanningGraph, PlanningOverview, PlanningTree, TabBarSlot, TranslocoPipe, UiCard, UiPageHead, UiSkeleton, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [PlanningStore],
  host: { 'data-page': 'planning', '[attr.data-active-lens]': 'lens()' },
  templateUrl: './planning-lens-page.html',
  styleUrl: './planning-lens-page.css',
})
export class PlanningPage {
  private readonly store = inject(PlanningStore);

  protected readonly ws = this.store.ws;
  protected readonly name = this.store.name;
  protected readonly lens = this.store.lens;
  protected readonly missing = this.store.missing;
  protected readonly unavailable = this.store.unavailable;
  protected readonly model = this.store.model;
  /** The tree's model: the served one with the backlog writes the route accepted (spec 037), so a move shows on the 200. */
  protected readonly treeModel = this.store.treeModel;
  protected readonly counts = this.store.counts;
  /** Archived specs shown in every lens (each lens's archive toggle), off by default. */
  protected readonly showArchived = this.store.showArchived;
  protected readonly overviewInRail = this.store.overviewInRail;

  private readonly overview = viewChild<TemplateRef<unknown>>('overview');

  constructor() {
    const selection = inject(DetailSelection);
    effect(() => {
      const ref = selection.selected();
      this.model();
      untracked(() => this.store.revealArchived(ref));
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
