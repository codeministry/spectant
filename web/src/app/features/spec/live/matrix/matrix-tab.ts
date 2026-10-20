import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, resource, signal, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame, MatrixCell, MatrixColumn } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { type RailBadge, RailContent } from '../../../../layout/shell/rail-content';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import type { CardState } from '../../../../../../../core/src/files';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { UiSheet } from '../../../../shared/ui/overlay/sheet';
import { UiScrubber } from '../../../../shared/ui/scrubber/scrubber';
import { type SegmentedOption, UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { frameEvents, LANE_COLORS, needsYouOf, recutMarkers, scrubberStops } from '../board/board-model';
import { CardDetail } from '../card/card-detail';
import { cardHistory } from '../card/card-history';
import { LiveSource } from '../live-source';
import { FrameBar } from '../this-frame/frame-bar';
import { NeedsYou } from '../this-frame/needs-you';
import { ThisFrame } from '../this-frame/this-frame';
import { stateKey } from '../../../../shared/ui/glyph/states';
import { boardQuery, glyphOf, laneGroups, matrixOf } from './matrix-model';

/**
 * The Matrix tab (T87, ISC-92): tasks × frames from core's `buildMatrix` over the board's frames (`…/frames` and
 * `…/live`), no route of its own. One labelled horizontal scroll region (`role="region"`, focusable, an edge shadow
 * while more columns hide to the right) holds a table whose first column sticks: task ids at compact and medium, id
 * and claim at wide under a lane group header. Every frame cell is a link to the Board at that frame (`?frame=<i>`, the
 * live column to `/board` without it), named by task, frame and state word; a re-cut column sits hatched between the
 * rounds it separates.
 *
 * Tiers (design.md § Live, Matrix): compact 64 px ids and 44 × 44 cells; medium 64 px ids and 32 × 32 cells; wide a
 * 224 px id and claim column, 32 px rows, dispatch 16 px (dimmed), result 28 px, live 40 px, re-cut 8 px.
 */
@Component({
  selector: 'app-matrix-tab',
  imports: [CardDetail, FrameBar, NeedsYou, NgTemplateOutlet, RouterLink, ThisFrame, TranslocoPipe, UiGlyph, UiScrubber, UiSegmented, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'matrix', '[attr.data-tier]': 'state.tier()', '(document:keydown)': 'onKey($event)' },
  templateUrl: './matrix-tab.html',
  styleUrl: './matrix-tab.css',
})
export class MatrixTab {
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });
  readonly framesResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.frames(params.ws, params.id) });
  /** The live frame, shared with the board and its cards' detail: one read per refresh tick (ISC-371). */
  readonly liveResult = inject(LiveSource).attach();
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** Every frame on the scrubber: the history, then the live frame. */
  private readonly frames = computed<ReadonlyArray<Frame | LiveFrame>>(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return [...(history?.kind === 'ok' ? history.body : []), ...(live?.kind === 'ok' ? [live.body] : [])];
  });
  protected readonly loading = computed(() => this.framesResult.isLoading() || this.liveResult.status() === 'loading');
  protected readonly failed = computed(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return history !== undefined && live !== undefined && history.kind !== 'ok' && live.kind !== 'ok';
  });

  private readonly lanes = computed<readonly string[]>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body.lanes.map((lane) => lane.name) : [];
  });
  protected readonly matrix = computed(() => matrixOf(this.frames(), this.lanes()));
  protected readonly groups = computed(() => laneGroups(this.matrix()));
  protected readonly boardLink = computed(() => ['/w', this.state.ws() ?? '', 's', this.state.specId() ?? '', 'board']);
  /** The accessible name of each column, by column index. */
  protected readonly columnNames = computed(() => {
    this.lang();
    return this.matrix().columns.map((column) => this.columnName(column));
  });

  /** The scrubber over the matrix (prototype `board-matrix.html`): it marks the current frame's column. */
  protected readonly stops = computed(() => scrubberStops(this.frames(), this.state.tier() === 'compact'));
  protected readonly markers = computed(() => {
    this.lang();
    return recutMarkers(this.frames(), this.transloco.translate('board.frame.recut'), (counts) => this.transloco.translate('board.frame.recutTitle', counts));
  });
  private readonly picked = signal<number | null>(null);
  protected readonly current = computed(() => this.picked() ?? Math.max(0, this.frames().length - 1));
  protected readonly playing = signal(false);
  /** The legend row under the grid: glyph and word per state, in the prototype's order. */
  protected readonly legendStates: readonly CardState[] = ['waiting', 'dispatched', 'question', 'concerns', 'fail', 'done', 'closed'];
  protected readonly stateKey = stateKey;

  /**
   * The prototype renders the matrix inside the round board (`board-matrix.html`), so it keeps the board's rail and
   * bottom bar: This frame and Needs you of the scrubbed frame in the shell rail at wide, the 48 px bar with Kbd `o`
   * and its sheet below wide and in zen (the same components the board registers).
   */
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  protected readonly frame = computed<Frame | LiveFrame | null>(() => this.frames()[this.current()] ?? null);
  protected readonly isLive = computed(() => this.frame()?.kind === 'live');
  protected readonly lastIndex = computed(() => Math.max(0, this.frames().length - 1));
  protected readonly events = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : frameEvents(this.frames()[this.current() - 1] ?? null, frame);
  });
  protected readonly needsYou = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : needsYouOf(frame);
  });
  protected readonly barOpen = signal(false);
  protected readonly barTab = signal<'frame' | 'needs'>('frame');
  protected readonly barTabs = computed<readonly SegmentedOption[]>(() => {
    this.lang();
    return [
      { key: 'frame', label: this.transloco.translate('board.rail.thisFrameCount', { count: this.events().length }) },
      { key: 'needs', label: this.transloco.translate('board.rail.needsYouCount', { count: this.needsYou().length }) },
    ];
  });
  protected readonly selected = signal<FrameCard | null>(null);
  protected readonly selectedHistory = computed(() => {
    const card = this.selected();
    return card === null ? null : cardHistory(this.frames(), card);
  });
  private readonly railBlocks = viewChild<TemplateRef<unknown>>('railBlocks');
  private readonly frameBar = viewChild<TemplateRef<unknown>>('frameBar');
  private readonly railBadges = computed<readonly RailBadge[]>(() => {
    this.lang();
    const thisFrame = this.events().length;
    const needsYou = this.needsYou().length;
    return [
      { key: 'thisFrame', count: thisFrame, label: this.transloco.translate('board.rail.badgeThisFrame', { count: thisFrame }) },
      { key: 'needsYou', count: needsYou, label: this.transloco.translate('board.rail.badgeNeedsYou', { count: needsYou }) },
    ];
  });

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.wide() ? (this.railBlocks() ?? null) : null)),
        bar: computed(() => this.frameBar() ?? null),
        badges: this.railBadges,
      },
      inject(DestroyRef),
    );
  }

  /** `o` opens This frame / Needs you below wide (prototype `.sheet-bar kbd`), as on the board. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'o' || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (this.wide() && !this.state.zen()) return;
    const target = event.target as HTMLElement | null;
    if (target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
    event.preventDefault();
    this.barOpen.set(true);
  }

  protected openCard(card: FrameCard): void {
    this.barOpen.set(false);
    this.selected.set(card);
  }

  protected closeDetail(open: boolean): void {
    if (!open) this.selected.set(null);
  }

  protected setBarTab(tab: string | undefined): void {
    this.barTab.set(tab === 'needs' ? 'needs' : 'frame');
  }

  /** The lane dot of a lane group: the board's lane colours in constitution order. */
  protected laneDot(i: number): string {
    return LANE_COLORS[i % LANE_COLORS.length] ?? 'var(--color-primary)';
  }

  protected setFrame(index: number): void {
    this.picked.set(Math.min(this.lastIndex(), Math.max(0, index)));
  }

  protected readonly glyphOf = glyphOf;
  protected readonly queryOf = boardQuery;

  /** "T27, R2: Waiting": task, frame and state word; "no card yet" before the first card, "absent" after the last. */
  protected cellLabel(cell: MatrixCell): string {
    const glyph = glyphOf(cell);
    const word = glyph === null ? this.transloco.translate('matrix.cell.none') : this.transloco.translate(stateKey(glyph, 'card'));
    return this.transloco.translate('matrix.cell.label', { task: cell.task, frame: this.columnNames()[cell.column] ?? '', state: word });
  }

  /** The re-cut mark of a cell as words, or '' when the re-cut left the id alone. */
  protected recutLabel(cell: MatrixCell): string {
    return cell.recut === undefined ? '' : this.transloco.translate(`matrix.recut.${cell.recut}`, { task: cell.task });
  }

  private columnName(column: MatrixColumn): string {
    const round = column.frame === null ? null : (this.frames()[column.frame]?.round ?? null);
    switch (column.kind) {
      case 'dispatch':
        return this.transloco.translate('matrix.column.dispatch', { round });
      case 'result':
        return this.transloco.translate('matrix.column.result', { round });
      case 'live':
        return this.transloco.translate('matrix.column.live');
      case 'recut':
        return this.transloco.translate('matrix.column.recut', { label: column.label });
    }
  }
}
