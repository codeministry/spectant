import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { type LensCard, type LensColumn, type LensLane, planningMatrix, type RelationRef } from '../../../../../../core/src/relations';
import { DetailSelection, selectedLook, type SelectedLook } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { CARD_EDGE } from '../../board/board-card';

/** The milestone choice of matrix and graph in the address (`?m=<slug>`, `none` for the no-milestone lane). */
export const M_PARAM = 'm';
export const NO_MILESTONE = 'none';
const MILESTONE_PREFIX = 'milestone:';

/** A lane's `?m=` value: the milestone's slug, or `none` for the no-milestone lane. */
export const laneParam = (ref: RelationRef | null): string => (ref === null ? NO_MILESTONE : ref.slice(MILESTONE_PREFIX.length));

const idOf = (ref: RelationRef): string => ref.slice(ref.indexOf(':') + 1);

/** One column as the view draws it: the core column plus whether it is folded to a 44 px stripe. */
interface ViewColumn {
  readonly column: LensColumn;
  readonly folded: boolean;
  readonly look: SelectedLook | null;
}

interface ViewCard {
  readonly card: LensCard;
  readonly edge: string;
  readonly look: SelectedLook | null;
  readonly others: ReadonlyArray<{ readonly ref: RelationRef; readonly id: string }>;
}

/** One swimlane as the view draws it; `cells` stay index-aligned with the view's columns. */
interface ViewLane {
  readonly lane: LensLane;
  readonly key: string;
  readonly param: string;
  readonly look: SelectedLook | null;
  readonly cells: ReadonlyArray<readonly ViewCard[]>;
  readonly empty: boolean;
  readonly bare: ReadonlyArray<{ readonly ref: RelationRef; readonly id: string; readonly look: SelectedLook | null }>;
}

/**
 * The matrix lens (spec 026, `/w/:ws/planning/board`, T19 and T21; ISC-169, ISC-169.1): one swimlane per milestone of
 * the master plus "No milestone" last, one column per feature holding a card, and per spec one card in its lane and its
 * main feature's column, the spec's other features as `+F8` chips. Every lane, column, card and number is core's
 * `planningMatrix` of the planning model; the view adds layout only.
 *
 * Tiers (design.md § Viewport-übergreifend): below 640 one swimlane at a time, picked by the milestone pills (`?m=`,
 * shared with the graph, default the next due milestone); from 640 every lane stacked under a full band row; from 1120 a
 * sticky left head column. The grid scrolls in its own container (`overflow-x: auto`), never the page. Finished
 * features fold to 44 px stripes until opened (a stripe opens its column, "Finished features" opens all). A card selects
 * its spec, a lane head its milestone, a column head its feature (`DetailSelection.select`). The matrix never docks the
 * sidebar: it floats over the lens only while something is selected, and the grid leaves room to scroll a card out
 * from under it.
 */
@Component({
  selector: 'app-planning-matrix',
  imports: [NgTemplateOutlet, TranslocoPipe, UiIcon, UiMeter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'board' },
  styleUrls: ['./planning-matrix.css', '../../../layout/detail-sidebar/selection.css'],
  templateUrl: './planning-matrix.html',
})
export class PlanningMatrix {
  readonly model = input.required<PlanningModel>();

  private readonly selection = inject(DetailSelection);
  private readonly state = inject(ShellState);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly param = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.readParam()),
    ),
    { initialValue: this.readParam() },
  );

  /** Finished columns opened all at once ("Finished features") or one by one (a stripe). */
  protected readonly showDone = signal(false);
  private readonly opened = signal<ReadonlySet<RelationRef>>(new Set());

  protected readonly layout = computed(() => {
    const tier = this.state.tier();
    return tier === 'compact' ? 'single' : tier === 'medium' ? 'bands' : 'grid';
  });

  private readonly matrix = computed(() => planningMatrix(this.model()));
  protected readonly hasMilestones = computed(() => this.model().milestones.length > 0);
  protected readonly hasDone = computed(() => this.matrix().columns.some((c) => c.done));
  protected readonly hasSelection = computed(() => this.selection.selected() !== null);

  protected readonly columns = computed<readonly ViewColumn[]>(() => {
    const all = this.showDone();
    const opened = this.opened();
    return this.matrix().columns.map((column) => ({
      column,
      folded: column.done && !all && !opened.has(column.ref),
      look: selectedLook(this.selection, column.ref, 'row'),
    }));
  });

  /** The grid's tracks: the 200 px head column at wide, then 184 px (224 px at medium) per column, 44 px per stripe. */
  protected readonly tracks = computed(() => {
    const wide = this.layout() === 'grid';
    const cols = this.columns().map((c) => (c.folded ? '44px' : wide ? '184px' : '224px'));
    return [...(wide ? ['200px'] : []), ...cols].join(' ');
  });

  protected readonly lanes = computed<readonly ViewLane[]>(() =>
    this.matrix().lanes.map((lane) => {
      const cells = lane.cells.map((cell) =>
        cell.map((card) => ({
          card,
          edge: card.archived || card.stage === null ? 'var(--track)' : CARD_EDGE[card.stage],
          look: selectedLook(this.selection, card.ref, 'card'),
          others: card.otherFeatures.map((ref) => ({ ref, id: idOf(ref) })),
        })),
      );
      return {
        lane,
        key: lane.ref ?? NO_MILESTONE,
        param: laneParam(lane.ref),
        look: lane.ref === null ? null : selectedLook(this.selection, lane.ref, 'row'),
        cells,
        empty: cells.every((cell) => cell.length === 0),
        bare: lane.bare.map((ref) => ({ ref, id: idOf(ref), look: selectedLook(this.selection, ref, 'row') })),
      };
    }),
  );

  /** The lane `?m=` names, else the next due milestone (the first not complete in target order), else the first lane. */
  protected readonly active = computed<ViewLane | null>(() => {
    const lanes = this.lanes();
    const chosen = lanes.find((l) => l.param === this.param());
    if (chosen !== undefined) return chosen;
    const next = this.model().milestones.find((m) => m.state !== 'complete');
    return lanes.find((l) => next !== undefined && l.lane.ref === `${MILESTONE_PREFIX}${next.slug}`) ?? lanes.at(0) ?? null;
  });

  protected readonly visible = computed<readonly ViewLane[]>(() => {
    if (this.layout() !== 'single') return this.lanes();
    const active = this.active();
    return active === null ? [] : [active];
  });

  protected select(ref: RelationRef): void {
    void this.selection.select(ref);
  }

  protected toggleDone(): void {
    this.showDone.update((on) => !on);
  }

  protected open(ref: RelationRef): void {
    this.opened.update((set) => new Set([...set, ref]));
  }

  /** A pill writes `?m=`; below 640 that swaps the one visible lane, from 640 it also scrolls the lane into view. */
  protected async pick(lane: ViewLane): Promise<void> {
    await this.router.navigate([], { queryParams: { [M_PARAM]: lane.param }, queryParamsHandling: 'merge', replaceUrl: true });
    if (this.layout() === 'single') return;
    const target = this.host.nativeElement.querySelector<HTMLElement>(`[data-lane="${lane.key}"]`);
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  }

  private readParam(): string | null {
    return this.router.routerState.snapshot.root.queryParamMap.get(M_PARAM);
  }
}
