import { CdkDrag } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { BoardCard as BoardCardModel } from '../../core/model/board-types';
import { RefusalNotice } from '../../shared/ui/refusal-notice/refusal-notice';
import { BoardCard } from './board-card';
import type { BoardDrag } from './board-drag';

/** A card's grip clicked without a drag (T127): the card and the grip the "Move to…" menu anchors to. */
export interface CardMenuRequest {
  readonly card: BoardCardModel;
  readonly grip: HTMLElement;
}

/** Shift+← / Shift+→ on a card (T127): the card and the direction. */
export interface CardStep {
  readonly card: BoardCardModel;
  readonly dir: -1 | 1;
}

/**
 * One list of board cards (spec 061): a column's, a band cell's or the compact column's, each card a `cdkDrag` with
 * its refusal notice under it. The drop list is the page's element around this `<ul>`, which the drag finds through
 * the element injector. The placeholder, the anchor and the preview are clones of the card element and carry this
 * component's scope, so their rules live in this stylesheet; the page hides a placeholder that entered a list of its own.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the list's <ul>, so the column keeps its list element
  selector: 'ul[app-board-cards]',
  imports: [BoardCard, CdkDrag, RefusalNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-cards.html',
  styleUrl: './board-cards.css',
})
export class BoardCards {
  readonly cards = input.required<readonly BoardCardModel[]>();
  readonly ws = input.required<string>();
  /** The page's drag state: what may be lifted, the card just moved and a refused move's notice. */
  readonly drag = input.required<BoardDrag>();
  /** A card was lifted. */
  readonly lifted = output<BoardCardModel>();
  /** The lifted card was let go, dropped or not. */
  readonly settled = output();
  readonly moveMenu = output<CardMenuRequest>();
  readonly step = output<CardStep>();
}
