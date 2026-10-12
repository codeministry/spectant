import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage, WAITING_STAGES } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiCard } from '../../shared/ui/card/card';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { type SegmentedOption, UiSegmented, watchColumns } from '../../shared/ui/segmented/segmented';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../shared/ui/term/term';
import { planningPageState } from '../planning/planning-page';
import { BoardCard, CARD_EDGE } from './board-card';
import { BoardDrag, type BoardDropEvent, provideBoardDrag, withMoves } from './board-drag';
import { BoardFilters, withoutFilters } from './board-filters';
import {
  type BoardCard as BoardCardModel,
  type BoardColumn,
  type BoardModel,
  type BoardQueryState,
  boardQueryParams,
  boardQueryString,
  boardRowsOf,
  buildBoard,
  parseBoardQuery,
} from './board-model';
import { AllocateDialog } from './allocate-dialog';
import { type MovedCard, MoveToMenu, stepTarget } from './move-to-menu';
import { RefusalNotice } from './refusal-notice';

/** Every key the board query owns: a navigation clears the ones the next query leaves out and keeps any other param. */
const QUERY_KEYS = ['feature', 'milestone', 'type', 'assignee', 'group', 'col'] as const;

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

const reducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What a band head shows, from a band across the board (medium, wide) or a band of the one column (compact). */
type BandHead = Pick<BandRow, 'key' | 'label' | 'target' | 'count'>;

/** A swimlane band across the whole board: its head and one cell per column, in column order. */
interface BandRow {
  readonly key: string | null;
  readonly label: string | null;
  readonly target: string | null;
  readonly count: number;
  readonly cells: ReadonlyArray<{ readonly stage: WorkflowStage; readonly stub: boolean; readonly cards: readonly BoardCardModel[] }>;
}

/**
 * `/w/:ws/board` (spec 008, T121, ISC-129; design 008 § board layout, Tablet 820 and Desktop 1440): the workspace
 * board from `buildBoard` over the planning tree, the dashboard rows, the actor names and the URL's board query.
 *
 * - The sticky stage strip (`ui-segmented mode="strip"`) sits above the board card, outside the scroller (a column head
 *   cannot stick inside an `overflow-x` container): one segment per column, `inView` fed by `watchColumns`, a click
 *   scrolls its column into view, so the strip is the minimap.
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
    CdkDropList,
    MoveToMenu,
    NgTemplateOutlet,
    RefusalNotice,
    TranslocoPipe,
    RouterLink,
    NotFound,
    BoardCard,
    BoardFilters,
    UiCard,
    UiEmptyState,
    UiIcon,
    UiIconButton,
    UiSegmented,
    UiSkeleton,
    UiTerm,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkDropListGroup],
  providers: [provideBoardDrag()],
  host: { 'data-page': 'board', '[attr.data-tier]': 'tier()', '[attr.data-dragging]': 'drag.dragging() ? "" : null' },
  templateUrl: './board-page.html',
  styleUrls: ['./board-page.css', './board-page.compact.css'],
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
  private readonly params = toSignal(this.route.queryParams, { initialValue: this.route.snapshot.queryParams });
  /** The board query as the URL holds it (ISC-129.1). */
  protected readonly query = computed(() => parseBoardQuery(this.params()));

  protected readonly tier = this.state.tier;
  /** The compact tier (T124) shows one column through the segmented control instead of the strip and the scroller. */
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly name = computed(() => this.data.workspaceName(this.ws()));

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
    const planning = this.data.planningModel();
    const dashboard = this.data.dashboard.value();
    if (planning === null || dashboard === undefined) return null;
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

  /** The drop tray under the sticky bar; T125 opens it while a card is dragged. Closed, it is laid out but hidden. */
  readonly trayOpen = signal(false);
  /** The column switch has scrolled away under the header: the sticky bar shows in its place. */
  protected readonly switchAway = signal(false);
  private readonly switchRef = viewChild<ElementRef<HTMLElement>>('colswitch');
  /** The workspace whose remembered query was already considered on this page; the bare route restores once. */
  private restoredFor: string | null = null;

  /** The track of each column: a stub's fixed width, or the 232 px column. */
  protected readonly tracks = computed(() =>
    (this.board()?.columns ?? []).map((c) => (c.stub.kind === 'empty' ? 'var(--board-stub)' : 'minmax(var(--board-col), 1fr)')).join(' '),
  );

  protected readonly stripOptions = computed<readonly SegmentedOption[]>(() => {
    const lang = this.lang();
    return (this.board()?.columns ?? []).map((c) => {
      const label = this.transloco.translate(`stages.${c.stage}`, {}, lang);
      return {
        key: c.stage,
        label,
        count: c.cards.length,
        ...(c.stub.kind === 'empty' ? { narrow: true } : {}),
        ...(c.waitingOnYou > 0 ? { tone: 'secondary' as const } : {}),
        ariaLabel: this.transloco.translate('board.workspace.column.name', { stage: label, count: c.cards.length, waiting: c.waitingOnYou }, lang),
      };
    });
  });

  /** The bands across the board in band order (master order, or target order for milestones), the one without last. */
  protected readonly bands = computed<readonly BandRow[]>(() => {
    const b = this.board();
    if (b === null || b.query.group === 'none') return [];
    const order: Array<string | null> = [...(b.query.group === 'feature' ? b.options.features.map((f) => f.id) : b.options.milestones), null];
    return order.flatMap((key): BandRow[] => {
      const found = b.columns.flatMap((c) => c.bands.filter((band) => band.key === key));
      const count = found.reduce((n, band) => n + band.count, 0);
      if (count === 0) return [];
      return [
        {
          key,
          label: found[0]?.label ?? null,
          target: found[0]?.target ?? null,
          count,
          cells: b.columns.map((c) => ({
            stage: c.stage,
            stub: c.stub.kind === 'empty',
            cards: c.bands.find((band) => band.key === key)?.cards ?? [],
          })),
        },
      ];
    });
  });

  private readonly menu = viewChild(MoveToMenu);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The card whose grip takes focus after the next render that shows it (T127, T128). */
  private readonly pendingFocus = signal<string | null>(null);
  /** True from a drag's start until the task after its end: the release's click is no menu click. */
  private dragClick = false;

  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly scrollerEl = computed(() => this.scrollerRef()?.nativeElement);
  protected readonly inView = signal<readonly string[]>([]);
  /** The scroller's horizontal offset, so the strip's column-aligned segments follow the columns under them. */
  protected readonly stripShift = signal(0);
  protected readonly fadeStart = signal(false);
  protected readonly fadeEnd = signal(false);

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
    // The minimap: watch the scroller's columns again whenever the board re-renders them.
    afterRenderEffect((onCleanup) => {
      this.board();
      const scroller = this.scrollerEl();
      if (!scroller || typeof IntersectionObserver !== 'function') return;
      onCleanup(watchColumns(scroller, (keys) => this.inView.set(keys)));
    });
    afterRenderEffect(() => {
      this.board();
      this.updateFades();
    });
    // The compact sticky bar: shown once the column switch has left the area under the 92 px compact header.
    afterRenderEffect((onCleanup) => {
      const el = this.switchRef()?.nativeElement;
      if (!el || typeof IntersectionObserver !== 'function') {
        this.switchAway.set(false);
        return;
      }
      const observer = new IntersectionObserver((entries) => this.switchAway.set(entries.some((entry) => !entry.isIntersecting)), {
        rootMargin: '-92px 0px 0px 0px',
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
    void this.drag.move(this.ws(), event.item.data, this.drag.stageOf(event));
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

  /** The edge fades show only where the scroller has more to show on that side. */
  protected updateFades(): void {
    const el = this.scrollerEl();
    if (!el) return;
    this.stripShift.set(el.scrollLeft);
    this.fadeStart.set(el.scrollLeft > 4);
    this.fadeEnd.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
}
