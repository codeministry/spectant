import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { Tier } from '../../layout/shell/tier';
import { UiIcon } from '../../shared/icons/icon';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { type BoardRefusal, type DropHint, dropHint, runHoldOf } from './board-drag';
import type { BoardCard, BoardModel } from '../../core/model/board-types';
import { RefusalNotice } from '../../shared/ui/refusal-notice/refusal-notice';

/** `stepTarget` and `MovedCard` live in `board-view.ts` since spec 061; the menu's spec reads them from here. */
export { type MovedCard, stepTarget } from './board-view';

interface MoveEntry {
  readonly stage: WorkflowStage;
  readonly hint: DropHint;
  readonly enabled: boolean;
}

/** A chosen entry: the card and the stage it moves to. */
export interface MoveChoice {
  readonly card: BoardCard;
  readonly to: WorkflowStage;
}

/**
 * "Move to…" (spec 008, T127, ISC-130; design 008 § Drag, Drop und die Alternativen, WCAG 2.5.7): the single-pointer
 * and keyboard path to the move a drag makes. A click on a card's grip (`openFor`) lists every board stage in column
 * order: the card's own stage marked current, the stages core's table admits (`card.targets`) enabled, every other one
 * disabled (`aria-disabled`, still focusable so its reason is read) with the drag's own hint words, "not next from …"
 * or "gate" (`dropHint`).
 *
 * An entry emits `choose`, and the page sends `BoardDrag.move`, the one move of a drop, so the held move, toast, count
 * morph, tint and reload, and the refusal notice, are the drop's. On a 200 the page closes the menu and follows the
 * card; a story's entry opens the allocation dialog (T128) and closes the menu; a refusal keeps the menu open with the
 * notice under its entry. The drag state comes in through `draggable` and `refusalOf` (spec 061, ISC-437).
 *
 * Spec 040 (T58, ISC-225.1): for a card a running run holds, every entry is disabled (`BoardDrag.draggable`) and the
 * run's refusal, the notice the drag and the keys show (`itemState.refusal`), stands above them without its ✕
 * (`data-move-run`), for as long as the card's state is `running`.
 *
 * At compact the menu is a `ui-sheet` bottom sheet (a modal `<dialog>`, 56 px rows); at medium and wide a `ui-popover`
 * anchored to the grip (CSS anchor positioning, else the trigger's `getBoundingClientRect()`). Esc closes either one
 * and focus returns to the grip. One instance serves the whole board.
 */
@Component({
  selector: 'app-move-to-menu',
  imports: [NgTemplateOutlet, RefusalNotice, TranslocoPipe, UiIcon, UiPopover, UiSheet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './move-to-menu.css',
  templateUrl: './move-to-menu.html',
})
export class MoveToMenu {
  readonly board = input.required<BoardModel>();
  readonly ws = input.required<string>();
  readonly tier = input.required<Tier>();
  /** Whether a card may move at all (`BoardDrag.draggable`): false while a running run holds it (T58). */
  readonly draggable = input.required<(card: BoardCard) => boolean>();
  /** The refusal that stands for a card now (`BoardDrag.refusalOf`), shown under the entry it was refused for. */
  readonly refusalOf = input.required<(card: BoardCard) => BoardRefusal | null>();
  /** An enabled entry was chosen: the page sends the move. */
  readonly choose = output<MoveChoice>();
  /** The ✕ of the refusal notice under an entry: the card's key. */
  readonly dismiss = output<string>();

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly popover = viewChild(UiPopover);

  protected readonly open = signal(false);
  private readonly key = signal<string | null>(null);
  /** The grip the popover is anchored to; its `anchor-name` is taken back when another grip opens the menu. */
  private anchor: HTMLElement | null = null;

  /** The card as the board shows it now, so a choice after a reload sends the current hash. */
  protected readonly card = computed<BoardCard | null>(() => {
    const key = this.key();
    return key === null ? null : (this.board().cards.find((c) => c.key === key) ?? null);
  });

  protected readonly entries = computed<readonly MoveEntry[]>(() => {
    const card = this.card();
    if (card === null) return [];
    const movable = this.draggable()(card);
    return this.board().stages.map((stage) => {
      const hint = dropHint(card, stage);
      return { stage, hint, enabled: movable && hint === 'allowed' };
    });
  });

  /** The first enabled entry takes focus on open; the current one when none is enabled. */
  protected readonly focusStage = computed(() => this.entries().find((e) => e.enabled)?.stage ?? this.card()?.stage ?? null);

  protected readonly refusal = computed(() => {
    const card = this.card();
    return card === null ? null : this.refusalOf()(card);
  });

  /** The run's refusal above the entries while a run holds the card (T58); null otherwise. */
  protected readonly runRefusal = computed<BoardRefusal | null>(() => {
    const card = this.card();
    const hold = card === null ? null : runHoldOf(card);
    if (card === null || hold === null) return null;
    return { key: card.key, id: card.id ?? card.slug, stage: card.stage, to: card.stage, kind: 'run-locked', ...hold };
  });

  protected readonly heading = computed(() => {
    const card = this.card();
    if (card === null) return '';
    return this.transloco.translate('board.workspace.move.title', { id: card.id ?? card.slug, title: card.title }, this.lang());
  });

  protected readonly fromLabel = computed(() => {
    const card = this.card();
    return card === null ? '' : this.transloco.translate(`stages.${card.stage}`, {}, this.lang());
  });

  /** Opens the menu for `card`, anchored to its grip at medium and wide. The caller has focused the grip. */
  openFor(card: BoardCard, grip: HTMLElement): void {
    this.key.set(card.key);
    this.open.set(true);
    if (this.tier() === 'compact') return;
    if (this.anchor !== null && this.anchor !== grip) this.anchor.style.removeProperty('anchor-name');
    this.anchor = grip;
    this.popover()?.show(grip);
  }

  close(): void {
    const popover = this.popover();
    if (popover) popover.close();
    else this.open.set(false);
  }

  protected onOpenChange(open: boolean): void {
    this.open.set(open);
  }

  protected chose(entry: MoveEntry): void {
    const card = this.card();
    if (card === null || !entry.enabled) return;
    this.choose.emit({ card, to: entry.stage });
  }
}
