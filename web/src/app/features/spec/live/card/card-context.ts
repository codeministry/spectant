import { Injectable, signal } from '@angular/core';

/**
 * What a board card and its detail know about the board around them (spec 024, prototype board.js): the frame on
 * screen (the detail head's "lane · frame"), the cards whose state changed when the frame last changed (the prototype's
 * `.changed` tint) and the card selected last (`.sel`). Provided by the Board and the Matrix tab; a card outside them
 * gets none and draws without these marks.
 */
@Injectable()
export class CardContext {
  /** The label of the frame on screen, `R2` or `Live`. */
  readonly frameLabel = signal<string | null>(null);
  /** Task ids whose state changed with the last frame change; empty on the first render. */
  readonly changed = signal<ReadonlySet<string>>(new Set());
  /** The task whose detail was opened last. */
  readonly selected = signal<string | null>(null);
}
