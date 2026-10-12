import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { WAITING_STAGES } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import { NotFound } from '../../layout/not-found/not-found';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiCard } from '../../shared/ui/card/card';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { type SegmentedOption, UiSegmented, watchColumns } from '../../shared/ui/segmented/segmented';
import { UiSkeleton } from '../../shared/ui/skeleton/skeleton';
import { UiTerm } from '../../shared/ui/term/term';
import { planningPageState } from '../planning/planning-page';
import { BoardCard, CARD_EDGE } from './board-card';
import { type BoardCard as BoardCardModel, type BoardModel, boardRowsOf, buildBoard, parseBoardQuery } from './board-model';

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
 * The compact tier (< 640, one column through `ui-segmented` radio) is T124: `compact()` is its hook; until then the
 * scroller renders at every tier.
 */
@Component({
  selector: 'app-board-page',
  imports: [TranslocoPipe, RouterLink, NotFound, BoardCard, UiCard, UiEmptyState, UiIcon, UiSegmented, UiSkeleton, UiTerm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'board', '[attr.data-tier]': 'tier()' },
  templateUrl: './board-page.html',
  styleUrl: './board-page.css',
})
export class BoardPage {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly route = inject(ActivatedRoute);
  private readonly params = toSignal(this.route.queryParams, { initialValue: this.route.snapshot.queryParams });

  protected readonly tier = this.state.tier;
  /** T124's hook: the compact tier shows one column through the segmented control instead of the scroller. */
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

  /** The board, once the planning tree and the dashboard rows have both answered; null while loading. */
  protected readonly board = computed<BoardModel | null>(() => {
    const planning = this.data.planningModel();
    const dashboard = this.data.dashboard.value();
    if (planning === null || dashboard === undefined) return null;
    return buildBoard({
      planning,
      rows: boardRowsOf(dashboard.kind === 'ok' ? dashboard.body : null),
      actors: this.data.actorList(),
      query: parseBoardQuery(this.params()),
    });
  });

  /** The track of each column: a stub's fixed width, or the 232 px column. */
  protected readonly tracks = computed(() =>
    (this.board()?.columns ?? []).map((c) => (c.stub.kind === 'empty' ? 'var(--board-stub)' : 'var(--board-col)')).join(' '),
  );

  protected readonly stripOptions = computed<readonly SegmentedOption[]>(() => {
    const lang = this.lang();
    return (this.board()?.columns ?? []).map((c) => {
      const label = this.transloco.translate(`stages.${c.stage}`, {}, lang);
      return {
        key: c.stage,
        label,
        count: c.cards.length,
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

  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly scrollerEl = computed(() => this.scrollerRef()?.nativeElement);
  protected readonly inView = signal<readonly string[]>([]);
  protected readonly fadeStart = signal(false);
  protected readonly fadeEnd = signal(false);

  constructor() {
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
  }

  /** The edge fades show only where the scroller has more to show on that side. */
  protected updateFades(): void {
    const el = this.scrollerEl();
    if (!el) return;
    this.fadeStart.set(el.scrollLeft > 4);
    this.fadeEnd.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }
}
