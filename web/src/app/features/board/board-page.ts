import { CdkDrag, type CdkDragDrop, CdkDragHandle, type CdkDragMove, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage, WAITING_STAGES } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../shared/ui/term/term';
import { UiTime } from '../../shared/time';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { beforeFor, edgeBefore, type FeatureGroup, featureOrder, groupOf, positionOf, stepBefore, type Target } from '../backlog/backlog-order';
import { BacklogWriter, withBacklog } from '../backlog/backlog-writer.service';
import { ReorderMenu, type ReorderStep } from '../backlog/reorder-menu';
import { planningPageState } from '../planning/planning-page';
import { BoardCard, CARD_EDGE } from './board-card';
import { BoardDrag, type BoardDropEvent, provideBoardDrag, withMoves } from './board-drag';
import { BoardFilters, withoutFilters } from './board-filters';
import {
  type BoardCard as BoardCardModel,
  type BandDivider,
  type BandPlace,
  type BoardColumn,
  type BoardModel,
  type BoardQueryState,
  boardQueryParams,
  boardQueryString,
  boardRowsOf,
  buildBoard,
  type HiddenColumn,
  hiddenColumnsOf,
  hiddenLanesOf,
  parseBoardQuery,
} from './board-model';
import { AllocateDialog } from './allocate-dialog';
import { type MovedCard, MoveToMenu, stepTarget } from './move-to-menu';
import { RefusalNotice } from '../../shared/ui/refusal-notice/refusal-notice';

/** Every key the board query owns: a navigation clears the ones the next query leaves out and keeps any other param. */
const QUERY_KEYS = ['feature', 'milestone', 'type', 'assignee', 'group', 'col', 'q', 'open', 'fold'] as const;

/**
 * The router `queryParams` that turn the URL's board query into `query`: its non-default keys, and null (removed) for
 * every board key it leaves at its default, so a merge keeps foreign params and drops stale board ones.
 */
export function boardNavigationParams(query: BoardQueryState): Record<string, string | string[] | null> {
  const params: Record<string, string | string[] | null> = Object.fromEntries(QUERY_KEYS.map((key) => [key, null]));
  return { ...params, ...boardQueryParams(query) };
}

/** One glyph per workflow stage for the column head and the stub (design 008 § board, the prototype's set). */
export const STAGE_GLYPHS: Readonly<Record<WorkflowStage, IconName>> = {
  idea: 'lightbulb',
  plan: 'list',
  tasks: 'list-checks',
  review: 'eye',
  build: 'hammer',
  blocked: 'octagon-x',
  'close-pending': 'hourglass',
  'code-review': 'git-pull-request',
  close: 'check-check',
  done: 'circle-check',
};

/**
 * The gate text of the fixed gates the board marks (design 008: review "reviewed mark", done "every claim closed").
 * Core's `FIXED_GATES` also names `build`, which every row keeps but which no mark guards; it gets no `<dfn>`.
 */
const GATE_TEXT: Partial<Record<WorkflowStage, string>> = {
  review: 'board.workspace.column.gateReviewed',
  done: 'board.workspace.column.gateClosed',
};
export const gateOf = (stage: WorkflowStage): string | null => (FIXED_GATES.includes(stage) ? (GATE_TEXT[stage] ?? null) : null);

const WAITING: ReadonlySet<string> = WAITING_STAGES;

/** Two stage sets hold the same stages: the measured set only changes (and re-renders) when a column crosses the edge. */
const sameStages = (a: ReadonlySet<WorkflowStage>, b: ReadonlySet<WorkflowStage>): boolean => a.size === b.size && [...a].every((s) => b.has(s));

/** A swimlane's hint at medium (ISC-141.1): its text ("3 cards in Build and Done, right of view") and the first column to show. */
interface LaneHint {
  readonly text: string;
  readonly stage: WorkflowStage;
}

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a band head shows, from a band across the board (medium, wide) or a band of the one column (compact). */
type BandHead = Pick<BandRow, 'key' | 'label' | 'target' | 'count'>;

/**
 * A swimlane band across the whole board: its head and one cell per column, in column order. `row` is the grid row of
 * its head (its cells take the next one); `divider` is the milestone row above it, only between two move groups.
 */
interface BandRow extends BandPlace {
  readonly key: string | null;
  readonly label: string | null;
  readonly target: string | null;
  readonly count: number;
  readonly row: number;
  readonly cells: ReadonlyArray<{ readonly stage: WorkflowStage; readonly stub: boolean; readonly cards: readonly BoardCardModel[] }>;
}

/** The divider a band shows: the model's, but never above the first band shown (spec 037, design § decision 6). */
export const dividerShown = (band: BandPlace, first: boolean): BandDivider | null => (first ? null : band.divider);

/**
 * `/w/:ws/board` (spec 008, T121, ISC-129; design 008 § board layout, Tablet 820 and Desktop 1440): the workspace
 * board from `buildBoard` over the planning tree, the dashboard rows, the actor names and the URL's board query.
 *
 * - The board card fills the viewport at medium and wide and its scroller scrolls both axes, so the column heads stick
 *   to its top edge in every view: without swimlanes each column scrolls its own cards under its head, with swimlanes
 *   the column sections (head-only grid items in row 1) stick themselves. The scroller is `cdkScrollable`, so a drag
 *   near its edge scrolls it towards a column out of view. There is no separate stage strip any more.
 * - Inside the card one horizontal scroller owns the overflow (the page never scrolls sideways): 232 px columns,
 *   12 px apart, scroll-snap at column starts and edge fades. A column with no shown card is a stub (48 px at medium,
 *   56 px at wide) carrying `data-stub`: its track is fixed by that attribute, so the drag task never widens it.
 * - A column head: stage glyph, label, the gate `<dfn>` on a fixed gate (`review`, `done`), the hourglass on a waiting
 *   stage, and the full count (`stageCounts`).
 * - With `?group=feature|milestone` the bands share the column grid: one 40 px full-width band head per band, the
 *   label sticking to the scroller's start, then one cell per column.
 *
 * The query (T123, ISC-129.1) is the URL's: `app-board-filters` emits the next query and `setQuery` navigates to it
 * with `replaceUrl` (a filter click is no history entry). The bare route restores the workspace's remembered query
 * (`ShellData.boardQuery`) once per workspace, and every other query the page shows is saved through
 * `saveBoardQuery`, so the remembered query is always the last one viewed.
 *
 * The compact tier (< 640, T124, ISC-129.2) renders neither the strip nor the scroller: a wrapping `ui-segmented`
 * radio picks the one visible column (`?col`, else the model's default), a 44 px sticky bar (◂ · stage · ▸) takes the
 * control's place once it scrolled away, and the bar carries the drop tray, one placeholder per stage, which T125
 * opens during a drag (`trayOpen`).
 *
 * Drag and drop (T125, T126, ISC-130) is `@angular/cdk/drag-drop` alone (DS-APP-23): the page is the
 * `cdkDropListGroup` (a host directive), so every `cdkDropList` under it is connected: each column and stub, each band
 * cell, the strip (one list over `ui-segmented`, the segment under the drop point names the stage) and at compact the
 * one column and every tray slot. Each card is a `cdkDrag` lifted by its grip, with `BOARD_DRAG_CONFIG`'s delays.
 * Lists never sort and keep an anchor (`cdkDropListHasAnchor`), so the card's slot stays as a dashed placeholder; a
 * placeholder entering a stub, the strip or a slot is hidden, so their tracks never change. While a card is lifted
 * every list carries `data-drop` (`dropHint`): `allowed` columns get the dashed outline, `not-next` and `gate` the
 * muted hint. A drop goes to `BoardDrag.drop`; its answer moves the card or leaves a `app-refusal-notice` under it.
 */
@Component({
  selector: 'app-board-page',
  imports: [
    AllocateDialog,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    CdkDropListGroup,
    CdkScrollable,
    MoveToMenu,
    NgTemplateOutlet,
    RefusalNotice,
    ReorderMenu,
    TranslocoPipe,
    RouterLink,
    NotFound,
    BoardCard,
    BoardFilters,
    UiCard,
    UiCommandChip,
    UiEmptyState,
    UiIcon,
    UiIconButton,
    UiMeter,
    UiPageHead,
    UiSegmented,
    UiSheet,
    UiSkeleton,
    UiTerm,
    UiTime,
    UiWsBadge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkDropListGroup],
  providers: [provideBoardDrag()],
  host: {
    'data-page': 'board',
    '[attr.data-tier]': 'tier()',
    '[attr.data-dragging]': 'drag.dragging() ? "" : null',
    '[attr.data-has-selection]': 'hasSelection() ? "" : null',
  },
  templateUrl: './board-page.html',
  styleUrls: ['./board-page.css', './board-page.compact.css', './board-page.drag.css', './board-page.fill.css', './board-page.hidden.css', './board-page.parity.css'],
})
export class BoardPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  /** The drag state and the transition write (T125, T126). */
  readonly drag = inject(BoardDrag);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /**
   * The detail sidebar (spec 026, T26, ISC-171): a card click selects it. The board never docks the sidebar; it floats
   * at the right edge, and while it is open the scroller leaves room to scroll a card out from under it.
   */
  private readonly selection = inject(DetailSelection);
  protected readonly hasSelection = computed(() => this.selection.selected() !== null);
  private readonly params = toSignal(this.route.queryParams, { initialValue: this.route.snapshot.queryParams });
  /** The board query as the URL holds it (ISC-129.1). */
  protected readonly query = computed(() => parseBoardQuery(this.params()));

  protected readonly tier = this.state.tier;
  /** The compact tier (T124) shows one column through the segmented control instead of the strip and the scroller. */
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly name = computed(() => this.data.workspaceName(this.ws()));
  /** Where the columns come from (T163, ISC-122): 'file' for the workspace's own `specs/workflow.md`, 'default' without it; null while loading. */
  protected readonly workflowSource = computed(() => this.data.workflow()?.source ?? null);

  private readonly pageState = planningPageState(this.data);
  protected readonly missing = this.pageState.missing;
  protected readonly unavailable = this.pageState.unavailable;

  protected readonly glyphs = STAGE_GLYPHS;
  protected readonly edges = CARD_EDGE;
  protected readonly gateOf = gateOf;
  protected readonly waiting = (stage: WorkflowStage): boolean => WAITING.has(stage);
  /** Types the shared head templates' untyped outlet context (a column head, a band head). */
  protected readonly asColumn = (column: BoardColumn): BoardColumn => column;
  protected readonly asBand = (band: BandHead): BandHead => band;

  /**
   * The board, once the planning tree and the dashboard rows have both answered; null while loading. Accepted moves
   * the tree does not show yet are applied first (`withMoves`), so a moved card lands on the 200.
   */
  protected readonly board = computed<BoardModel | null>(() => {
    // The backlog overlay (spec 037): accepted band moves show on the 200, a move in flight already at its target.
    const served = this.writer.model();
    const dashboard = this.data.dashboard.value();
    if (served === null || dashboard === undefined) return null;
    const held = [...this.writer.held().values()].filter((op) => op.op === 'move');
    const planning = held.length === 0 ? served : withBacklog(served, held);
    return buildBoard({
      planning: withMoves(planning, this.drag.moves()),
      rows: boardRowsOf(dashboard.kind === 'ok' ? dashboard.body : null),
      actors: this.data.actorList(),
      query: this.query(),
    });
  });

  /** The compact tier's visible column (the model's `current`: `?col`, else `build` with cards, else the first). */
  protected readonly current = computed<BoardColumn | null>(() => {
    const b = this.board();
    return b?.columns.find((c) => c.stage === b.current) ?? null;
  });

  /** The columns before and after the visible one, for the sticky bar's ◂ and ▸; null at either end. */
  protected readonly neighbours = computed(() => {
    const stages = this.board()?.stages ?? [];
    const current = this.board()?.current ?? null;
    const i = current === null ? -1 : stages.indexOf(current);
    return { prev: i > 0 ? (stages[i - 1] ?? null) : null, next: i >= 0 ? (stages[i + 1] ?? null) : null };
  });

  /** The compact column switch: one radio per column, its count in the label and the violet dot when it waits on you. */
  protected readonly colOptions = computed<readonly SegmentedOption[]>(() => {
    const lang = this.lang();
    return (this.board()?.columns ?? []).map((c): SegmentedOption => {
      const stage: string = this.transloco.translate(`stages.${c.stage}`, {}, lang);
      const label: string = this.transloco.translate('board.workspace.compact.segment', { stage, count: c.cards.length }, lang);
      return { key: c.stage, label, ...(c.waitingOnYou > 0 ? { tone: 'secondary' as const } : {}) };
    });
  });

  /**
   * The page eyebrow (spec 024, ISC-151; design § Workspace board): `<WS> · BOARD · n CARDS`, the count once the board
   * is built.
   */
  protected readonly eyebrow = computed<readonly string[]>(() => {
    const lang = this.lang();
    const page: string = this.transloco.translate('shell.pages.board', {}, lang);
    const b = this.board();
    if (b === null) return [this.ws(), page];
    return [this.ws(), page, this.transloco.translate('board.workspace.eyebrowCards', { count: b.total }, lang)];
  });

  /**
   * Medium only (spec 024, design § Across viewports "Kanban stays"): the lane index over the scroll-snap
   * scroller, the compact switch's segmented as a position marker. Its value is the first column in view (measured with
   * the overflow line); picking a segment scrolls that column to the scroller's start.
   */
  protected readonly firstInView = signal<string | undefined>(undefined);

  /** The drop tray under the sticky bar; T125 opens it while a card is dragged. Closed, it is laid out but hidden. */
  readonly trayOpen = signal(false);

  /** Compact (spec 024, design § Mobile): the bottom sheet with the cards waiting on you, opened from the sheet bar. */
  protected readonly needsOpen = signal(false);
  /** The cards waiting on the principal, in board order (the sheet bar's count and the sheet's rows). */
  protected readonly needsYou = computed(() => this.board()?.cards.filter((c) => c.waitsOnYou) ?? []);
  /** The column switch has scrolled away under the header: the sticky bar shows in its place. */
  protected readonly switchAway = signal(false);
  private readonly switchRef = viewChild<ElementRef<HTMLElement>>('colswitch');
  /** The workspace whose remembered query was already considered on this page; the bare route restores once. */
  private restoredFor: string | null = null;

  /** The track of each column: a stub's fixed width, or the 232 px column. */
  protected readonly tracks = computed(() =>
    (this.board()?.columns ?? []).map((c) => (c.folded ? 'var(--board-stub)' : 'minmax(var(--board-col), 1fr)')).join(' '),
  );

  /**
   * The bands across the board in the model's lane order (spec 037, ISC-197: features by milestone, then rank; milestones
   * in target order), the one without last. Each head takes a grid row, its cells the next, and a divider one above it.
   */
  protected readonly bands = computed<readonly BandRow[]>(() => {
    const b = this.board();
    if (b === null || b.query.group === 'none') return [];
    let row = 2;
    return b.lanes.flatMap((lane, i): BandRow[] => {
      const found = b.columns.flatMap((c) => c.bands.filter((band) => band.key === lane.key));
      const count = found.reduce((n, band) => n + band.count, 0);
      if (count === 0) return [];
      const divider = dividerShown(lane, i === 0);
      if (divider !== null) row += 1;
      const head = row;
      row += 2;
      return [
        {
          key: lane.key,
          moveGroup: lane.moveGroup,
          divider,
          row: head,
          label: found[0]?.label ?? null,
          target: found[0]?.target ?? null,
          count,
          cells: b.columns.map((c) => ({
            stage: c.stage,
            stub: c.folded,
            cards: c.bands.find((band) => band.key === lane.key)?.cards ?? [],
          })),
        },
      ];
    });
  });

  /** The backlog write of a band move (spec 037, T17), shared with the tree lens. */
  protected readonly writer = inject(BacklogWriter);
  private readonly bandMenu = viewChild<ReorderMenu>('bandMenu');
  /** The band whose "Move" menu is open, or was last opened. */
  protected readonly menuBand = signal<string | null>(null);
  /** The polite live region's line after a band move: "F8 at position 2 of 10 in Free". */
  protected readonly bandNews = signal('');
  /** The band whose grip takes focus after the next render that shows it. */
  private readonly pendingBandFocus = signal<string | null>(null);
  protected readonly dividerShown = dividerShown;

  /**
   * The feature order a band moves in: every milestone of `featureOrder` with only the features the board shows a band
   * of in that move group, so a step, a menu entry and a drop gap all count the bands the user sees.
   */
  protected readonly bandOrder = computed<readonly FeatureGroup[]>(() => {
    const b = this.board();
    const model = this.writer.model();
    if (b === null || model === null || b.query.group !== 'feature') return [];
    const shown = new Map(b.lanes.flatMap((lane) => (lane.key !== null && lane.moveGroup !== null ? [[lane.key, lane.moveGroup] as const] : [])));
    return featureOrder(model).map((group) => ({ ...group, ids: group.ids.filter((id) => shown.get(id) === group.key) }));
  });

  /** The move group of a feature band; null for a feature the board shows no band of. */
  private moveGroupOf(feature: string): string | null {
    return this.board()?.lanes.find((lane) => lane.key === feature)?.moveGroup ?? null;
  }

  /** The milestone name of a move group, null for the "No milestone" group. */
  private groupName(groupKey: string | null): string | null {
    return groupKey === null ? null : (groupOf(this.bandOrder(), groupKey)?.name ?? null);
  }

  /** The grip's name, the menu's title: "Move F8 · in Free", or "· no milestone". */
  protected gripLabel(feature: string | null): string {
    const id = feature ?? '';
    const group = this.groupName(this.moveGroupOf(id));
    const lang = this.lang();
    return group === null
      ? this.transloco.translate('backlog.reorder.titleNone', { id }, lang)
      : this.transloco.translate('backlog.reorder.title', { id, group }, lang);
  }

  /** The open menu's band: its group's name, whether it can move up or down, and its place. */
  protected readonly menuState = computed(() => {
    const feature = this.menuBand() ?? '';
    const group = this.moveGroupOf(feature);
    const order = this.bandOrder();
    const at = group === null ? null : positionOf(order, group, feature);
    return {
      feature,
      group: this.groupName(group),
      canUp: at !== null && at.index > 1,
      canDown: at !== null && at.index < at.count,
      position: at?.index ?? null,
      count: at?.count ?? null,
    };
  });

  /** True while the "Move" menu is open for `feature`: its grip's `aria-expanded`. */
  protected menuOpenFor(feature: string | null): boolean {
    return feature !== null && this.menuBand() === feature && (this.bandMenu()?.expanded() ?? false);
  }

  /** The band list admits band drags only (their data is the feature id), never a card. */
  protected readonly bandsOnly = (drag: CdkDrag<unknown>): boolean => typeof drag.data === 'string';

  /** A plain click on a band's grip (no drag): its "Move" menu, anchored to the grip. */
  protected openBandMenu(feature: string | null, grip: HTMLElement): void {
    if (this.dragClick || feature === null) return;
    this.menuBand.set(feature);
    this.bandMenu()?.show(grip);
  }

  /** Alt+↑ / Alt+↓ on a band's grip, and the menu's four entries: the move within the band's milestone. */
  protected bandStep(feature: string | null, step: ReorderStep, event?: Event): void {
    event?.preventDefault();
    const group = feature === null ? null : this.moveGroupOf(feature);
    if (feature === null || group === null) return;
    const order = this.bandOrder();
    const before = step === 'up' || step === 'down' ? stepBefore(order, group, feature, step === 'up' ? -1 : 1) : edgeBefore(order, group, feature, step);
    void this.moveBand(feature, before);
  }

  /** The menu's chosen entry, for the band it was opened on. */
  protected bandMenuStep(step: ReorderStep): void {
    this.bandStep(this.menuBand(), step);
  }

  /**
   * A band dropped: the gap under the drop point among the visible heads of the band's own move group, measured at drop
   * time. A drop over another move group's band, the band without a feature, or a gap next to itself sends nothing.
   */
  protected bandDropped(event: CdkDragDrop<unknown, unknown, string>): void {
    const target = this.bandTarget(event.item.data, event.dropPoint.y);
    if (target !== null) void this.moveBand(event.item.data, target.before);
  }

  /**
   * The move a band drop at `y` would send and the head the drop line sits on (`data-band`, '' for "No feature"), or
   * null when the point lies over another move group or in a gap next to the band itself.
   */
  private bandTarget(feature: string, y: number): { before: Target; line: string } | null {
    const group = this.moveGroupOf(feature);
    if (group === null) return null;
    // The lifted band's placeholder (a clone of its head) holds its place, so the gaps count as `beforeFor` counts them.
    const all = [...this.host.querySelectorAll<HTMLElement>('.band-list > .band-head')];
    const under = all.filter((head) => head.getBoundingClientRect().top <= y).at(-1) ?? all.at(0);
    if (under?.dataset['moveGroup'] !== group) return null;
    const own = all.filter((head) => head.dataset['moveGroup'] === group);
    const gap = own.filter((head) => {
      const rect = head.getBoundingClientRect();
      return rect.top + rect.height / 2 < y;
    }).length;
    const before = beforeFor(this.bandOrder(), group, feature, gap);
    if (before === 'none') return null;
    const lineHead = own.at(gap) ?? all.at(all.indexOf(own.at(-1) ?? under) + 1);
    return { before, line: lineHead?.dataset['band'] ?? '' };
  }

  /** The move group of the lifted band, while one is lifted: other groups' bands are locked (T35). */
  protected readonly bandDragGroup = signal<string | null>(null);
  /** The head the drop line sits on while a band is dragged over a gap of its own group; null for no line. */
  protected readonly bandLine = signal<string | null>(null);
  /** The band a move just landed, for the confirmation: a tint that fades, a static dot under reduced motion (ISC-200.1). */
  protected readonly bandMoved = signal<string | null>(null);

  protected bandDragStarted(group: string | null): void {
    this.dragClick = true;
    this.bandMoved.set(null);
    this.bandDragGroup.set(group);
  }

  protected bandDragMoved(event: CdkDragMove<string | null>): void {
    const feature = event.source.data;
    this.bandLine.set(feature === null ? null : (this.bandTarget(feature, event.pointerPosition.y)?.line ?? null));
  }

  protected bandDragEnded(): void {
    this.bandDragGroup.set(null);
    this.bandLine.set(null);
    setTimeout(() => {
      this.dragClick = false;
    });
  }

  /** True for a band the lifted band cannot land among: another move group's, or the one without a feature. */
  protected bandLocked(group: string | null): boolean {
    const lifted = this.bandDragGroup();
    return lifted !== null && group !== lifted;
  }

  /** Sends the move unless it changes nothing or a write is in flight; then the grip keeps focus and the place is announced. */
  private async moveBand(feature: string, before: Target): Promise<void> {
    if (before === 'none' || this.writer.busy()) return;
    const outcome = await this.writer.move(this.ws(), feature, before);
    if (outcome === 'written') {
      this.bandMoved.set(feature);
      this.announceBand(feature);
    }
    this.pendingBandFocus.set(feature);
  }

  private announceBand(feature: string): void {
    const group = this.moveGroupOf(feature);
    const at = group === null ? null : positionOf(this.bandOrder(), group, feature);
    if (at === null) return;
    const name = this.groupName(group);
    const params = { id: feature, position: at.index, count: at.count, group: name };
    this.bandNews.set(this.transloco.translate(name === null ? 'backlog.board.movedNone' : 'backlog.board.moved', params, this.lang()));
  }

  private readonly menu = viewChild(MoveToMenu);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The card whose grip takes focus after the next render that shows it (T127, T128). */
  private readonly pendingFocus = signal<string | null>(null);
  /** True from a drag's start until the task after its end: the release's click is no menu click. */
  private dragClick = false;

  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly scrollerEl = computed(() => this.scrollerRef()?.nativeElement);
  protected readonly fadeStart = signal(false);
  protected readonly fadeEnd = signal(false);

  /**
   * The stages whose column lies right of the scroller box at medium (spec 019, ISC-141.1): a column head's left edge
   * at or past the box's right edge, measured on every render, scroll and resize of the scroller. Empty at compact
   * (its own column switch) and at wide (ISC-141 fits every column).
   */
  private readonly rightOfView = signal<ReadonlySet<WorkflowStage>>(new Set(), { equal: sameStages });
  /** The overflow line's entries: every column right of view that holds a shown card, with its count. */
  protected readonly hiddenRight = computed<readonly HiddenColumn[]>(() => {
    const b = this.board();
    return b === null || this.tier() !== 'medium' ? [] : hiddenColumnsOf(b.columns, this.rightOfView());
  });
  /** One hint per swimlane whose cards all lie right of view, by band key. */
  protected readonly laneHints = computed<ReadonlyMap<string | null, LaneHint>>(() => {
    const b = this.board();
    const hints = new Map<string | null, LaneHint>();
    if (b === null || this.tier() !== 'medium' || b.query.group === 'none') return hints;
    const lang = this.lang();
    const list = new Intl.ListFormat(lang, { type: 'conjunction' });
    for (const [key, lane] of hiddenLanesOf(b.columns, this.rightOfView())) {
      const first = lane.columns.at(0);
      if (first === undefined) continue;
      const columns = list.format(lane.columns.map((c): string => this.transloco.translate(`stages.${c.stage}`, {}, lang)));
      const id = lane.count === 1 ? 'board.workspace.hidden.lane.one' : 'board.workspace.hidden.lane.other';
      hints.set(key, { text: this.transloco.translate(id, { count: lane.count, columns }, lang), stage: first.stage });
    }
    return hints;
  });

  constructor() {
    // Focus after a move from the menu or the keys, or a closed allocation dialog: the grip, once it is rendered.
    afterRenderEffect(() => {
      const key = this.pendingFocus();
      this.board();
      this.query();
      if (key === null) return;
      const card = [...this.host.querySelectorAll<HTMLElement>('app-board-card')].find((el) => el.dataset['key'] === key);
      const grip = card?.querySelector<HTMLElement>('[data-grip]');
      if (!grip) return;
      grip.focus();
      untracked(() => this.pendingFocus.set(null));
    });
    // After a band move (spec 037): its grip keeps focus at the band's new place.
    afterRenderEffect(() => {
      const feature = this.pendingBandFocus();
      this.board();
      if (feature === null) return;
      const grip = [...this.host.querySelectorAll<HTMLElement>('[data-band-grip]')].find((el) => el.dataset['bandGrip'] === feature);
      if (!grip) return;
      grip.focus({ preventScroll: true });
      untracked(() => this.pendingBandFocus.set(null));
    });
    afterRenderEffect(() => {
      this.board();
      this.tier();
      this.updateFades();
      this.measureHidden();
    });
    // A resized scroller (panel, window, rail) can hide or show columns without a render or a scroll.
    afterRenderEffect((onCleanup) => {
      const el = this.scrollerEl();
      if (!el || typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(() => {
        this.updateFades();
        this.measureHidden();
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
    // The compact sticky bar: shown once the column switch has left the area under the 64 px sticky header row (spec 024).
    afterRenderEffect((onCleanup) => {
      const el = this.switchRef()?.nativeElement;
      if (!el || typeof IntersectionObserver !== 'function') {
        this.switchAway.set(false);
        return;
      }
      const observer = new IntersectionObserver((entries) => this.switchAway.set(entries.some((entry) => !entry.isIntersecting)), {
        rootMargin: '-64px 0px 0px 0px',
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
    // The remembered query (ISC-129.1): the bare route restores it once per workspace; any other query is saved.
    effect(() => {
      const ws = this.state.ws();
      const remembered = this.data.boardQueryText();
      const current = boardQueryString(this.query());
      if (ws === null || remembered === null || this.data.boardQuery.isLoading()) return;
      untracked(() => {
        if (this.restoredFor !== ws) {
          this.restoredFor = ws;
          if (current === '' && remembered !== '') {
            this.navigate(parseBoardQuery(remembered));
            return;
          }
        }
        if (current !== remembered) void this.data.saveBoardQuery(current);
      });
    });
  }

  /** Writes `query` to the URL, replacing the entry: a filter, lane or column change adds no history step. */
  /** Opens a folded column or folds an open one (`?open=` for a column without shown cards, `?fold=` for one with). */
  protected toggleFold(column: BoardColumn): void {
    const q = this.query();
    const key = column.cards.length === 0 ? 'open' : 'fold';
    const stages = q[key].includes(column.stage) ? q[key].filter((s) => s !== column.stage) : [...q[key], column.stage];
    this.setQuery({ ...q, [key]: stages });
  }

  protected setQuery(query: BoardQueryState): void {
    if (boardQueryString(query) === boardQueryString(this.query())) return;
    this.navigate(query);
  }

  protected clearFilters(): void {
    this.setQuery(withoutFilters(this.query()));
  }

  /** The compact switch, the bar's ◂ and ▸ and the tray (T125) pick the visible column through `?col`. */
  protected selectColumn(key: string | null | undefined): void {
    const b = this.board();
    if (b === null || key === null || key === undefined || !isWorkflowStage(key) || key === b.current) return;
    this.setQuery({ ...this.query(), col: key });
  }

  /** The bar's middle button: back to the whole column switch, its checked segment focused. */
  protected backToSwitch(): void {
    const el = this.switchRef()?.nativeElement;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus({ preventScroll: true });
  }

  /** A card is lifted: its hints show, and at compact the tray opens under the sticky bar. */
  protected dragStarted(card: BoardCardModel): void {
    this.drag.start(card);
    this.trayOpen.set(this.compact());
    this.dragClick = true;
  }

  protected dragEnded(): void {
    this.drag.end();
    this.trayOpen.set(false);
    // The click a drag's release may still send to the grip must not open the menu; the next task clears the guard.
    setTimeout(() => {
      this.dragClick = false;
    });
  }

  /**
   * A CDK drop on a column, stub, band cell, strip segment or tray slot: the one move (`BoardDrag.move`), whatever the
   * hint said: a spec's transition, or a story's allocation dialog (T128).
   */
  protected dropped(event: BoardDropEvent): void {
    void this.drag.move(this.ws(), event.item.data, this.drag.dropTarget(event));
  }

  /** The grip was clicked without a drag (T127): "Move to…" opens on it, the grip focused so Esc returns there. */
  protected openMenu(card: BoardCardModel, grip: HTMLElement): void {
    if (this.dragClick) return;
    grip.focus({ preventScroll: true });
    this.menu()?.openFor(card, grip);
  }

  /** Shift+← / Shift+→ on a card (T127): the same move to the previous or next allowed stage, no menu. */
  protected async step(card: BoardCardModel, dir: -1 | 1): Promise<void> {
    const to = stepTarget(card, this.board()?.stages ?? [], dir);
    if (to === null) return;
    const outcome = await this.drag.move(this.ws(), card, to);
    if (outcome === 'moved') this.followMove({ key: card.key, to });
    else if (outcome === 'refused') this.focusGrip(card.key);
  }

  /** After a move from the menu or the keys the grip of the moved card takes focus; at compact its column shows. */
  protected followMove(moved: MovedCard): void {
    if (this.compact()) this.selectColumn(moved.to);
    this.focusGrip(moved.key);
  }

  /** Focuses the grip of `key` once it is rendered (a moved card is a new element in its new column). */
  protected focusGrip(key: string): void {
    this.pendingFocus.set(key);
  }

  /** The stage word of the lifted card, for the "not next from …" hint. */
  protected readonly fromLabel = computed(() => {
    const card = this.drag.dragging();
    return card === null ? '' : this.transloco.translate(`stages.${card.stage}`, {}, this.lang());
  });

  private navigate(query: BoardQueryState): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: boardNavigationParams(query), queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** The scroller scrolled: the fades and the columns right of view follow. */
  protected scrolled(): void {
    this.updateFades();
    this.measureHidden();
  }

  /** Measures which columns lie right of the scroller box (ISC-141.1); nothing outside medium. */
  private measureHidden(): void {
    const el = this.scrollerEl();
    const hidden = new Set<WorkflowStage>();
    let first: string | undefined;
    if (el && untracked(this.tier) === 'medium') {
      const box = el.getBoundingClientRect();
      const right = box.right - 1;
      for (const section of el.querySelectorAll<HTMLElement>(':scope > .grid > section[data-col]')) {
        const stage = section.dataset['col'];
        const head = section.querySelector<HTMLElement>(':scope > header') ?? section;
        const rect = head.getBoundingClientRect();
        if (stage !== undefined && isWorkflowStage(stage) && rect.left >= right) hidden.add(stage);
        if (first === undefined && stage !== undefined && rect.right > box.left + 24) first = stage;
      }
    }
    this.rightOfView.set(hidden);
    this.firstInView.set(first);
  }

  /** Scrolls the column of `stage` to the scroller's start (the overflow line's entries, a lane's hint). */
  protected showColumn(stage: WorkflowStage): void {
    const section = this.scrollerEl()?.querySelector<HTMLElement>(`:scope > .grid > section[data-col="${stage}"]`);
    if (!section || typeof section.scrollIntoView !== 'function') return;
    section.scrollIntoView({ inline: 'start', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /** A card's page: the idea page for a story, the spec page otherwise (the same target as the card title). */
  protected cardLink(card: BoardCardModel): string[] {
    return card.kind === 'idea' ? ['/w', this.ws(), 'ideas', card.slug] : ['/w', this.ws(), 's', card.id ?? card.slug];
  }

  /** A swimlane's done cards, the mini meter's value (spec 024, design § Workspace board Desktop "mini bar"). */
  protected bandDone(band: BandHead): number | null {
    if (!('cells' in band)) return null;
    const cells = (band as BandRow).cells;
    return cells.find((c) => c.stage === 'done')?.cards.length ?? 0;
  }

  /**
   * The position fades' arrows (spec 024): scroll one column back or on from the first column in view, measured
   * against the scroller's start edge, so it works on every tier where the scroller overflows.
   */
  protected stepColumn(dir: 1 | -1): void {
    const el = this.scrollerEl();
    if (!el) return;
    const start = el.getBoundingClientRect().left + 24;
    const sections = [...el.querySelectorAll<HTMLElement>(':scope > .grid > section[data-col]')];
    const at = Math.max(0, sections.findIndex((s) => s.getBoundingClientRect().right > start));
    const stage = sections[Math.min(sections.length - 1, Math.max(0, at + dir))]?.dataset['col'];
    if (stage !== undefined && isWorkflowStage(stage)) this.showColumn(stage);
  }

  /** The lane index picked a column (medium): it scrolls to the scroller's start and the index follows the scroll. */
  protected selectIndex(key: string | undefined): void {
    if (key !== undefined && isWorkflowStage(key)) this.showColumn(key);
  }

  /** The edge fades show only where the scroller has more to show on that side. */
  protected updateFades(): void {
    const el = this.scrollerEl();
    if (!el) return;
    this.fadeStart.set(el.scrollLeft > 4);
    this.fadeEnd.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
}
