import { CdkDrag, type CdkDragDrop, type CdkDragMove, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { isWorkflowStage } from '../../../../../core/src/stage';
import type { Target } from '../../core/model/backlog-order';
import type { BoardCard as BoardCardModel } from '../../core/model/board-types';
import { ReorderMenu, type ReorderStep } from '../../layout/backlog-menu/reorder-menu';
import { DetailSelection } from '../../layout/detail-sidebar/selection';
import { NotFound } from '../../layout/not-found/not-found';
import { UiIcon } from '../../shared/icons/icon';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiCard } from '../../shared/ui/card/card';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import { UiGlyph } from '../../shared/ui/glyph/glyph';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiSegmented } from '../../shared/ui/segmented/segmented';
import { CARD_EDGE } from '../../shared/ui/stage-edge';
import { AllocateDialog } from './allocate-dialog';
import { BandDividerRow } from './band-divider-row';
import { BandHeader } from './band-header';
import { BarRow } from './bar-row';
import { BoardCards } from './board-cards';
import { BoardLoading } from './board-loading';
import { BoardOverflow } from './board-overflow';
import { ColumnHead } from './column-head';
import { BoardDrag, type BoardDropEvent, provideBoardDrag } from './board-drag';
import { BoardFilters } from './board-filters';
import { BoardTitle } from './board-title';
import { StageDrop } from './stage-drop';
import { BoardStore } from './board.store';
import { bandTargetAt, dividerShown, measureColumns, type MovedCard, reducedMotion, STAGE_GLYPHS, stepColumnOf } from './board-view';
import { type MoveChoice, MoveToMenu } from './move-to-menu';
import { NeedsList } from './needs-list';

/**
 * `/w/:ws/board` (spec 008, T121, ISC-129; design 008 § board layout, Tablet 820 and Desktop 1440): the workspace
 * board from `buildBoard` over the planning tree, the dashboard rows, the actor names and the URL's board query. Its
 * state lives in `BoardStore` (spec 061, ISC-436), provided here once per page; the page keeps the DOM: measuring,
 * observers, focus and scrolling.
 *
 * - The board card fills the viewport at medium and wide and its scroller scrolls both axes, so the column heads stick
 *   to its top edge in every view: without swimlanes each column scrolls its own cards under its head, with swimlanes
 *   the column sections (head-only grid items in row 1) stick themselves. The scroller is `cdkScrollable`, so a drag
 *   near its edge scrolls it towards a column out of view. There is no separate stage strip any more.
 * - Inside the card one horizontal scroller owns the overflow (the page never scrolls sideways): 232 px columns,
 *   12 px apart, scroll-snap at column starts and edge fades. A column with no shown card is a stub (48 px at medium,
 *   56 px at wide) carrying `data-stub`: its track is fixed by that attribute, so the drag task never widens it.
 * - A column head (`app-column-head`): stage glyph, label, the gate `<dfn>` on a fixed gate (`review`, `done`), the
 *   hourglass on a waiting stage, and the full count (`stageCounts`).
 * - With `?group=feature|milestone` the bands share the column grid: one 40 px full-width band head per band, the
 *   label sticking to the scroller's start, then one cell per column.
 *
 * The query (T123, ISC-129.1) is the URL's: `app-board-filters` emits the next query and the store navigates to it
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
  // The CDK drag and drop, the board's own parts, then the frame and the shared UI it renders.
  imports: [CdkDrag, CdkDropList, CdkDropListGroup, CdkScrollable, NgTemplateOutlet, RouterLink, TranslocoPipe,
    AllocateDialog, BandDividerRow, BandHeader, BarRow, BoardCards, BoardFilters, BoardLoading, BoardOverflow, BoardTitle, ColumnHead,
    MoveToMenu, NeedsList, NotFound, ReorderMenu, StageDrop, UiCard, UiCommandChip, UiEmptyState, UiGlyph, UiIcon, UiIconButton,
    UiSegmented, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [CdkDropListGroup],
  providers: [provideBoardDrag(), BoardStore],
  host: {
    'data-page': 'board',
    '[attr.data-tier]': 'store.tier()',
    '[attr.data-dragging]': 'drag.dragging() ? "" : null',
    '[attr.data-has-selection]': 'hasSelection() ? "" : null',
  },
  templateUrl: './board-page.html',
  styleUrls: [
    './board-page.css',
    './board-bands.css',
    './board-page.compact.css',
    './board-page.drag.css',
    './board-page.fill.css',
    './board-page.hidden.css',
    './board-page.parity.css',
  ],
})
export class BoardPage {
  protected readonly store = inject(BoardStore);
  /** The drag state and the transition write (T125, T126); the store composes it. */
  readonly drag: BoardDrag = this.store.drag;
  /**
   * The detail sidebar (spec 026, T26, ISC-171): a card click selects it. The board never docks the sidebar; it floats
   * at the right edge, and while it is open the scroller leaves room to scroll a card out from under it.
   */
  private readonly selection = inject(DetailSelection);
  protected readonly hasSelection = computed(() => this.selection.selected() !== null);

  protected readonly glyphs = STAGE_GLYPHS;
  protected readonly edges = CARD_EDGE;
  protected readonly dividerShown = dividerShown;
  /** The drag state the "Move to…" menu reads, bound to this board's `BoardDrag`. */
  protected readonly draggable = (card: BoardCardModel): boolean => this.drag.draggable(card);
  protected readonly refusalOf = (card: BoardCardModel) => this.drag.refusalOf(card);

  /** The column switch has scrolled away under the header: the sticky bar shows in its place. */
  protected readonly switchAway = signal(false);
  private readonly switchRef = viewChild<ElementRef<HTMLElement>>('colswitch');
  private readonly bandMenu = viewChild<ReorderMenu>('bandMenu');
  private readonly menu = viewChild(MoveToMenu);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The card whose grip takes focus after the next render that shows it (T127, T128). */
  private readonly pendingFocus = signal<string | null>(null);
  /** The band whose grip takes focus after the next render that shows it. */
  private readonly pendingBandFocus = signal<string | null>(null);
  /** True from a drag's start until the task after its end: the release's click is no menu click. */
  private dragClick = false;

  private readonly scrollerRef = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly scrollerEl = computed(() => this.scrollerRef()?.nativeElement);
  protected readonly fadeStart = signal(false);
  protected readonly fadeEnd = signal(false);

  constructor() {
    // Focus after a move from the menu or the keys, or a closed allocation dialog: the grip, once it is rendered.
    afterRenderEffect(() => {
      const key = this.pendingFocus();
      this.store.board();
      this.store.query();
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
      this.store.board();
      if (feature === null) return;
      const grip = [...this.host.querySelectorAll<HTMLElement>('[data-band-grip]')].find((el) => el.dataset['bandGrip'] === feature);
      if (!grip) return;
      grip.focus({ preventScroll: true });
      untracked(() => this.pendingBandFocus.set(null));
    });
    afterRenderEffect(() => {
      this.store.board();
      this.store.tier();
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
  }

  /** True while the "Move" menu is open for `feature`: its grip's `aria-expanded`. */
  protected menuOpenFor(feature: string | null): boolean {
    return feature !== null && this.store.menuBand() === feature && (this.bandMenu()?.expanded() ?? false);
  }

  /** The band list admits band drags only (their data is the feature id), never a card. */
  protected readonly bandsOnly = (drag: CdkDrag<unknown>): boolean => typeof drag.data === 'string';

  /** A plain click on a band's grip (no drag): its "Move" menu, anchored to the grip. */
  protected openBandMenu(feature: string | null, grip: HTMLElement): void {
    if (this.dragClick || feature === null) return;
    this.store.menuBand.set(feature);
    this.bandMenu()?.show(grip);
  }

  /** Alt+↑ / Alt+↓ on a band's grip, and the menu's four entries: the move within the band's milestone. */
  protected bandStep(feature: string | null, step: ReorderStep, event?: Event): void {
    event?.preventDefault();
    const before = this.store.bandStepTarget(feature, step);
    if (feature !== null) void this.moveBand(feature, before);
  }

  /** The menu's chosen entry, for the band it was opened on. */
  protected bandMenuStep(step: ReorderStep): void {
    this.bandStep(this.store.menuBand(), step);
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
    const group = this.store.moveGroupOf(feature);
    const heads = [...this.host.querySelectorAll<HTMLElement>('.band-list > .band-head')];
    return group === null ? null : bandTargetAt(heads, this.store.bandOrder(), group, feature, y);
  }

  protected bandDragStarted(group: string | null): void {
    this.dragClick = true;
    this.store.bandMoved.set(null);
    this.store.bandDragGroup.set(group);
  }

  protected bandDragMoved(event: CdkDragMove<string | null>): void {
    const feature = event.source.data;
    this.store.bandLine.set(feature === null ? null : (this.bandTarget(feature, event.pointerPosition.y)?.line ?? null));
  }

  protected bandDragEnded(): void {
    this.store.bandDragGroup.set(null);
    this.store.bandLine.set(null);
    setTimeout(() => {
      this.dragClick = false;
    });
  }

  /** Sends the move (the store skips a no-op or a write in flight); then the grip keeps focus. */
  private async moveBand(feature: string, before: Target): Promise<void> {
    if (await this.store.moveBand(feature, before)) this.pendingBandFocus.set(feature);
  }

  /** The bar's middle button: back to the whole column switch, its checked segment focused. */
  protected backToSwitch(): void {
    const el = this.switchRef()?.nativeElement;
    if (!el) return;
    if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    el.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus({ preventScroll: true });
  }

  /** A card is lifted: its hints show, and at compact the tray opens under the sticky bar. */
  dragStarted(card: BoardCardModel): void {
    this.drag.start(card);
    this.store.trayOpen.set(this.store.compact());
    this.dragClick = true;
  }

  protected dragEnded(): void {
    this.drag.end();
    this.store.trayOpen.set(false);
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
    void this.store.move(event.item.data, this.drag.dropTarget(event));
  }

  /**
   * The grip was clicked without a drag (T127): "Move to…" opens on it, the grip focused so Esc returns there. A card a
   * running run holds (spec 040, T57) shows the run's refusal under it instead at medium and wide; at compact the menu
   * opens with every entry disabled and the same notice above them (T58).
   */
  protected openMenu(card: BoardCardModel, grip: HTMLElement): void {
    if (this.dragClick) return;
    grip.focus({ preventScroll: true });
    if (!this.store.compact() && this.drag.holdRun(card, card.stage)) return;
    this.menu()?.openFor(card, grip);
  }

  /** A "Move to…" entry: the drop's move; a 200 or a story's dialog closes the menu, and a 200 follows the card. */
  protected async moveFromMenu({ card, to }: MoveChoice): Promise<void> {
    const outcome = await this.store.move(card, to);
    if (outcome === 'moved' || outcome === 'asked') this.menu()?.close();
    if (outcome === 'moved') this.followMove({ key: card.key, to });
  }

  /**
   * Shift+← / Shift+→ on a card (T127): the same move to the previous or next allowed stage, no menu. A card a running
   * run holds shows the run's refusal instead, whichever way a target lies (spec 040, T57).
   */
  protected async step(card: BoardCardModel, dir: -1 | 1): Promise<void> {
    if (this.drag.holdRun(card, card.stage)) return;
    const to = this.store.stepTo(card, dir);
    if (to === null) return;
    const outcome = await this.store.move(card, to);
    if (outcome === 'moved') this.followMove({ key: card.key, to });
    else if (outcome === 'refused') this.focusGrip(card.key);
  }

  /** After a move from the menu or the keys the grip of the moved card takes focus; at compact its column shows. */
  protected followMove(moved: MovedCard): void {
    if (this.store.compact()) this.store.selectColumn(moved.to);
    this.focusGrip(moved.key);
  }

  /** Focuses the grip of `key` once it is rendered (a moved card is a new element in its new column). */
  protected focusGrip(key: string | null): void {
    if (key !== null) this.pendingFocus.set(key);
  }

  /** The allocation dialog's Not yet, ✕, Esc or backdrop: closed without a write, the story's grip takes focus. */
  protected cancelAllocation(): void {
    this.focusGrip(this.store.cancelAllocation());
  }

  /** The allocation dialog's Allocate: the store writes; a refusal closes the dialog and the story's grip takes focus. */
  protected async confirmAllocation(): Promise<void> {
    this.focusGrip(await this.store.confirmAllocation());
  }

  /** The scroller scrolled: the fades and the columns right of view follow. */
  protected scrolled(): void {
    this.updateFades();
    this.measureHidden();
  }

  /** Measures which columns lie right of the scroller box (ISC-141.1); nothing outside medium. */
  private measureHidden(): void {
    const el = this.scrollerEl();
    const measured = el && untracked(this.store.tier) === 'medium' ? measureColumns(el) : { hidden: new Set<WorkflowStage>(), first: undefined };
    this.store.rightOfView.set(measured.hidden);
    this.store.firstInView.set(measured.first);
  }

  /** Scrolls the column of `stage` to the scroller's start (the overflow line's entries, a lane's hint). */
  protected showColumn(stage: WorkflowStage): void {
    const section = this.scrollerEl()?.querySelector<HTMLElement>(`:scope > .grid > section[data-col="${stage}"]`);
    if (!section || typeof section.scrollIntoView !== 'function') return;
    section.scrollIntoView({ inline: 'start', block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  /**
   * The position fades' arrows (spec 024): scroll one column back or on from the first column in view, measured
   * against the scroller's start edge, so it works on every tier where the scroller overflows.
   */
  protected stepColumn(dir: 1 | -1): void {
    const el = this.scrollerEl();
    const stage = el ? stepColumnOf(el, dir) : null;
    if (stage !== null) this.showColumn(stage);
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
