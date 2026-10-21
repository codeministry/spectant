import { computed, effect, inject, Injectable, resource, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage } from '../../../../../core/src/stage';
import { ApiClient } from '../../core/api.service';
import { buildBoard } from '../../core/model/board';
import { type BoardQueryState, boardQueryString, parseBoardQuery } from '../../core/model/board-query';
import { boardRowsOf } from '../../core/model/board-rows';
import type { BoardCard, BoardColumn, BoardModel } from '../../core/model/board-types';
import { edgeBefore, groupOf, positionOf, stepBefore, type Target } from '../../core/model/backlog-order';
import { type FeatureGroup, featureOrder } from '../../core/model/feature-order';
import { guidanceOfBody } from '../../core/model/guidance-entry';
import { planningPageState } from '../../core/model/planning-page-state';
import type { ReorderStep } from '../../layout/backlog-menu/reorder-menu';
import { BacklogWriter, withBacklog } from '../../layout/shell/backlog-writer.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { SegmentedOption } from '../../shared/ui/segmented/segmented';
import { BoardDrag, type MoveOutcome, withMoves } from './board-drag';
import { withoutFilters } from './board-filters';
import { type HiddenColumn, hiddenColumnsOf, hiddenLanesOf } from './board-model';
import { allocPathsOf, bandsOf, boardNavigationParams, cardLinkOf, type LaneHint, sameStages, tracksOf } from './board-view';
import { stepTarget } from './board-view';

/**
 * The state of one workspace board (spec 061, ISC-436): the URL's board query, the board `buildBoard` derives from the
 * planning tree, the dashboard rows, the actor names and the accepted moves, its columns and bands, and the actions that
 * change them: a query navigation, a band move, a card move and a story's allocation. It composes `BoardDrag`, the drag
 * state and the transition write. DOM work (measuring, observers, focus, scrolling) stays in `BoardPage`, which
 * provides one store per page instance.
 */
@Injectable()
export class BoardStore {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** The drag state and the transition write (T125, T126). */
  readonly drag = inject(BoardDrag);
  /** The backlog write of a band move (spec 037, T17), shared with the tree lens. */
  readonly writer = inject(BacklogWriter);

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly params = toSignal(this.route.queryParams, { initialValue: this.route.snapshot.queryParams });
  /** The board query as the URL holds it (ISC-129.1). */
  readonly query = computed(() => parseBoardQuery(this.params()));

  readonly tier = this.state.tier;
  /** The compact tier (T124) shows one column through the segmented control instead of the strip and the scroller. */
  readonly compact = computed(() => this.tier() === 'compact');
  readonly ws = computed(() => this.state.ws() ?? '');
  readonly name = computed(() => this.data.workspaceName(this.ws()));
  /** Where the columns come from (T163, ISC-122): 'file' for the workspace's own `specs/workflow.md`, 'default' without it; null while loading. */
  readonly workflowSource = computed(() => this.data.workflow()?.source ?? null);

  private readonly pageState = planningPageState(this.data);
  readonly missing = this.pageState.missing;
  readonly unavailable = this.pageState.unavailable;

  /** `DashboardModel.guidance` of the workspace (spec 020); undefined from a server without a clock. */
  readonly guidance = computed(() => {
    const dashboard = this.data.dashboard.value();
    return guidanceOfBody(dashboard?.kind === 'ok' ? dashboard.body : null);
  });

  /**
   * The board, once the planning tree and the dashboard rows have both answered; null while loading. Accepted moves
   * the tree does not show yet are applied first (`withMoves`), so a moved card lands on the 200.
   */
  readonly board = computed<BoardModel | null>(() => {
    // The backlog overlay (spec 037): accepted band moves show on the 200, a move in flight already at its target.
    const served = this.writer.model();
    const dashboard = this.data.dashboard.value();
    if (served === null || dashboard === undefined) return null;
    const held = [...this.writer.held().values()].filter((op) => op.op === 'move');
    const planning = held.length === 0 ? served : withBacklog(served, held);
    const guidance = this.guidance();
    return buildBoard({
      planning: withMoves(planning, this.drag.moves()),
      rows: boardRowsOf(dashboard.kind === 'ok' ? dashboard.body : null),
      ...(guidance ? { guidance } : {}),
      actors: this.data.actorList(),
      query: this.query(),
    });
  });

  /** The compact tier's visible column (the model's `current`: `?col`, else `build` with cards, else the first). */
  readonly current = computed<BoardColumn | null>(() => {
    const b = this.board();
    return b?.columns.find((c) => c.stage === b.current) ?? null;
  });

  /** The columns before and after the visible one, for the sticky bar's ◂ and ▸; null at either end. */
  readonly neighbours = computed(() => {
    const stages = this.board()?.stages ?? [];
    const current = this.board()?.current ?? null;
    const i = current === null ? -1 : stages.indexOf(current);
    return { prev: i > 0 ? (stages[i - 1] ?? null) : null, next: i >= 0 ? (stages[i + 1] ?? null) : null };
  });

  /** The compact column switch: one radio per column, its count in the label and the violet dot when it waits on you. */
  readonly colOptions = computed<readonly SegmentedOption[]>(() => {
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
  readonly eyebrow = computed<readonly string[]>(() => {
    const lang = this.lang();
    const page: string = this.transloco.translate('shell.pages.board', {}, lang);
    const b = this.board();
    if (b === null) return [this.ws(), page];
    return [this.ws(), page, this.transloco.translate(b.total === 1 ? 'board.workspace.eyebrowCards.one' : 'board.workspace.eyebrowCards.other', { count: b.total }, lang)];
  });

  /** The first column in view at medium, the lane index's value; the page measures it. */
  readonly firstInView = signal<string | undefined>(undefined);
  /** The drop tray under the sticky bar; T125 opens it while a card is dragged. Closed, it is laid out but hidden. */
  readonly trayOpen = signal(false);
  /** Compact (spec 024, design § Mobile): the bottom sheet with the cards waiting on you, opened from the sheet bar. */
  readonly needsOpen = signal(false);

  /** The cards waiting on the principal, in board order (the sheet bar's count and the sheet's rows). */
  readonly needsYou = computed(() => {
    const cards = this.board()?.cards ?? [];
    // Spec 020 (T24): with guidance, the cards whose spec stands in `guidance.waits`; without a clock, the stage's guess.
    return this.guidance() ? cards.filter((c) => c.marked) : cards.filter((c) => c.waitsOnYou);
  });
  /** The sheet bar's "Waits on you n" (spec 020, T24): every entry of `guidance.waits`, else the cards waiting on you. */
  readonly waitsCount = computed(() => this.guidance()?.waits.length ?? this.needsYou().length);

  readonly tracks = computed(() => tracksOf(this.board()));
  readonly bands = computed(() => bandsOf(this.board()));

  /**
   * The stages whose column lies right of the scroller box at medium (spec 019, ISC-141.1), as the page measured them on
   * every render, scroll and resize of the scroller. Empty at compact and at wide.
   */
  readonly rightOfView = signal<ReadonlySet<WorkflowStage>>(new Set(), { equal: sameStages });
  /** The overflow line's entries: every column right of view that holds a shown card, with its count. */
  readonly hiddenRight = computed<readonly HiddenColumn[]>(() => {
    const b = this.board();
    return b === null || this.tier() !== 'medium' ? [] : hiddenColumnsOf(b.columns, this.rightOfView());
  });
  /** One hint per swimlane whose cards all lie right of view, by band key. */
  readonly laneHints = computed<ReadonlyMap<string | null, LaneHint>>(() => {
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

  /** The stage word of the lifted card, for the "not next from …" hint. */
  readonly fromLabel = computed(() => {
    const card = this.drag.dragging();
    return card === null ? '' : this.transloco.translate(`stages.${card.stage}`, {}, this.lang());
  });

  /** The band whose "Move" menu is open, or was last opened. */
  readonly menuBand = signal<string | null>(null);
  /** The polite live region's line after a band move: "F8 at position 2 of 10 in Free". */
  readonly bandNews = signal('');
  /** The move group of the lifted band, while one is lifted: other groups' bands are locked (T35). */
  readonly bandDragGroup = signal<string | null>(null);
  /** The head the drop line sits on while a band is dragged over a gap of its own group; null for no line. */
  readonly bandLine = signal<string | null>(null);
  /** The band a move just landed, for the confirmation: a tint that fades, a static dot under reduced motion (ISC-200.1). */
  readonly bandMoved = signal<string | null>(null);

  /**
   * The feature order a band moves in: every milestone of `featureOrder` with only the features the board shows a band
   * of in that move group, so a step, a menu entry and a drop gap all count the bands the user sees.
   */
  readonly bandOrder = computed<readonly FeatureGroup[]>(() => {
    const b = this.board();
    const model = this.writer.model();
    if (b === null || model === null || b.query.group !== 'feature') return [];
    const shown = new Map(b.lanes.flatMap((lane) => (lane.key !== null && lane.moveGroup !== null ? [[lane.key, lane.moveGroup] as const] : [])));
    return featureOrder(model).map((group) => ({ ...group, ids: group.ids.filter((id) => shown.get(id) === group.key) }));
  });

  /** The move group of a feature band; null for a feature the board shows no band of. */
  moveGroupOf(feature: string): string | null {
    return this.board()?.lanes.find((lane) => lane.key === feature)?.moveGroup ?? null;
  }

  /** The milestone name of a move group, null for the "No milestone" group. */
  private groupName(groupKey: string | null): string | null {
    return groupKey === null ? null : (groupOf(this.bandOrder(), groupKey)?.name ?? null);
  }

  /** The grip's name, the menu's title: "Move F8 · in Free", or "· no milestone". */
  gripLabel(feature: string | null): string {
    const id = feature ?? '';
    const group = this.groupName(this.moveGroupOf(id));
    const lang = this.lang();
    return group === null
      ? this.transloco.translate('backlog.reorder.titleNone', { id }, lang)
      : this.transloco.translate('backlog.reorder.title', { id, group }, lang);
  }

  /** The open menu's band: its group's name, whether it can move up or down, and its place. */
  readonly menuState = computed(() => {
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

  /** True for a band the lifted band cannot land among: another move group's, or the one without a feature. */
  bandLocked(group: string | null): boolean {
    const lifted = this.bandDragGroup();
    return lifted !== null && group !== lifted;
  }

  /** The target of Alt+↑ / Alt+↓ or a menu entry for `feature` within its milestone; 'none' for a band that cannot move. */
  bandStepTarget(feature: string | null, step: ReorderStep): Target {
    const group = feature === null ? null : this.moveGroupOf(feature);
    if (feature === null || group === null) return 'none';
    const order = this.bandOrder();
    return step === 'up' || step === 'down' ? stepBefore(order, group, feature, step === 'up' ? -1 : 1) : edgeBefore(order, group, feature, step);
  }

  /**
   * Sends the move unless it changes nothing or a write is in flight, and announces the band's new place. Resolves true
   * once the grip should take focus again (every send), false when nothing was sent.
   */
  async moveBand(feature: string, before: Target): Promise<boolean> {
    if (before === 'none' || this.writer.busy()) return false;
    const outcome = await this.writer.move(this.ws(), feature, before);
    if (outcome === 'written') {
      this.bandMoved.set(feature);
      this.announceBand(feature);
    }
    return true;
  }

  private announceBand(feature: string): void {
    const group = this.moveGroupOf(feature);
    const at = group === null ? null : positionOf(this.bandOrder(), group, feature);
    if (at === null) return;
    const name = this.groupName(group);
    const params = { id: feature, position: at.index, count: at.count, group: name };
    this.bandNews.set(this.transloco.translate(`${name === null ? 'backlog.board.movedNone' : 'backlog.board.moved'}.${at.count === 1 ? 'one' : 'other'}`, params, this.lang()));
  }

  /** The one move of a drop, a menu entry or a key (`BoardDrag.move`) in this board's workspace. */
  move(card: BoardCard, to: WorkflowStage | null): Promise<MoveOutcome> {
    return this.drag.move(this.ws(), card, to);
  }

  /** The stage Shift+← / Shift+→ moves `card` to in this board's column order; null when there is none that way. */
  stepTo(card: BoardCard, dir: -1 | 1): WorkflowStage | null {
    return stepTarget(card, this.board()?.stages ?? [], dir);
  }

  /** A card's page: the idea page for a story, the spec page otherwise (the same target as the card title). */
  cardLink(card: BoardCard): string[] {
    return cardLinkOf(this.ws(), card);
  }

  /** Opens a folded column or folds an open one (`?open=` for a column without shown cards, `?fold=` for one with). */
  toggleFold(column: BoardColumn): void {
    const q = this.query();
    const key = column.cards.length === 0 ? 'open' : 'fold';
    const stages = q[key].includes(column.stage) ? q[key].filter((s) => s !== column.stage) : [...q[key], column.stage];
    this.setQuery({ ...q, [key]: stages });
  }

  setQuery(query: BoardQueryState): void {
    if (boardQueryString(query) === boardQueryString(this.query())) return;
    this.navigate(query);
  }

  clearFilters(): void {
    this.setQuery(withoutFilters(this.query()));
  }

  /** The compact switch, the bar's ◂ and ▸ and the tray (T125) pick the visible column through `?col`. */
  selectColumn(key: string | null | undefined): void {
    const b = this.board();
    if (b === null || key === null || key === undefined || !isWorkflowStage(key) || key === b.current) return;
    this.setQuery({ ...this.query(), col: key });
  }

  /** Writes `query` to the URL, replacing the entry: a filter, lane or column change adds no history step. */
  private navigate(query: BoardQueryState): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: boardNavigationParams(query), queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** The story the allocation dialog names (T128): the card `BoardDrag.allocating` holds, or null. */
  readonly allocating = this.drag.allocating;
  /** True while the allocation of the open story is in flight. */
  readonly allocSaving = computed(() => {
    const card = this.allocating();
    return card !== null && this.drag.saving() === card.key;
  });

  /** What the allocation touches, from `WRITE_PATHS.allocate` with the number left open. */
  readonly allocPaths = computed(() => allocPathsOf(this.allocating()));

  /** The story as the server reads it now; its `hash` is what the allocation sends. */
  private readonly story = resource({
    params: () => {
      const card = this.allocating();
      return card === null ? undefined : { ws: this.ws(), slug: card.slug };
    },
    loader: ({ params }) => this.api.idea(params.ws, params.slug),
  });

  readonly allocHash = computed(() => {
    const read = this.story.value();
    const card = this.allocating();
    return read?.kind === 'ok' && read.body.idea.slug === card?.slug ? read.body.hash : null;
  });

  readonly allocUnreadable = computed(() => {
    const read = this.story.value();
    return read !== undefined && read.kind !== 'ok';
  });

  /** Not yet, ✕, Esc or a backdrop click: the dialog closes and nothing is sent. The key of the card whose grip takes focus. */
  cancelAllocation(): string | null {
    const card = this.allocating();
    if (card === null) return null;
    this.drag.allocating.set(null);
    return card.key;
  }

  /**
   * Allocate: sends `BoardDrag.allocate` once and, on 200, opens the new spec (`/w/:ws/s/:id`). Resolves the key of the
   * card whose grip takes focus when the dialog closed without a new spec, null otherwise.
   */
  async confirmAllocation(): Promise<string | null> {
    const card = this.allocating();
    const hash = this.allocHash();
    if (card === null || hash === null || this.drag.saving() !== null) return null;
    const written = await this.drag.allocate(this.ws(), card, hash);
    this.drag.allocating.set(null);
    if (written === null) return card.key;
    await this.router.navigate(['/w', this.ws(), 's', written.id]);
    return null;
  }

  /** The workspace whose remembered query was already considered on this page; the bare route restores once. */
  private restoredFor: string | null = null;

  constructor() {
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
}
