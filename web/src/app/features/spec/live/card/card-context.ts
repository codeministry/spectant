import { Injectable, signal } from '@angular/core';
import type { TaskSteps } from '../../../../../../../core/src/files';

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
  /** Every task's agent steps from the live answer (spec 015, ISC-232), the live state whatever frame is on screen. */
  readonly steps = signal<TaskSteps>({});
  /** Whether the frame on screen is the live one: a past frame's cards name no latest step (the steps are live). */
  readonly live = signal(true);
}
