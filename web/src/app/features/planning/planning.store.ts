import { computed, inject, Injectable, signal } from '@angular/core';
import type { RelationRef } from '../../../../../core/src/relations';
import { planningCounts } from '../../core/model/planning-counts';
import { planningPageState } from '../../core/model/planning-page-state';
import { BacklogWriter } from '../../layout/shell/backlog-writer.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';

/**
 * The planning page's state (spec 026; spec 061, ISC-436): the workspace, the lens the route names, the served model
 * with the backlog writes the route accepted, the counts of the page head and the archive toggle every lens shares.
 * Provided by the planning page, so one instance lives as long as the page does, across lens switches. No DOM: the
 * rail registration and the overview template stay in the page.
 */
@Injectable()
export class PlanningStore {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly writer = inject(BacklogWriter);

  readonly ws = computed(() => this.state.ws() ?? '');
  readonly name = computed(() => this.data.workspaceName(this.ws()));
  readonly lens = computed(() => this.state.route().lens ?? 'gantt');

  private readonly pageState = planningPageState(this.data);
  readonly missing = this.pageState.missing;
  readonly unavailable = this.pageState.unavailable;
  readonly model = this.data.planningModel;
  /** The tree's model: the served one with the backlog writes the route accepted (spec 037), so a move shows on the 200. */
  readonly treeModel = computed(() => this.writer.model() ?? this.model());
  readonly counts = computed(() => {
    const model = this.model();
    return model === null ? null : planningCounts(model);
  });

  /** Archived specs shown in every lens (each lens's archive toggle), off by default. */
  readonly showArchived = signal(false);

  /** The overview stands in the rail: the tree lens at wide with the rail open; on the tree elsewhere it is the block. */
  readonly overviewInRail = computed(() => this.lens() === 'tree' && this.state.tier() === 'wide' && !this.state.railStrip());

  /** A selected archived spec turns the archive toggle on, so a deep link or a palette pick still finds its row. */
  revealArchived(ref: RelationRef | null): void {
    if (ref !== null && this.model()?.relations?.[ref]?.archived === true && ref.startsWith('spec:')) this.showArchived.set(true);
  }
}
