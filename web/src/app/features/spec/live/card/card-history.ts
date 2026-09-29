import type { CardState, FrameCard, FrameKind } from '../../../../../../../core/src/files';

/** One step of a card's state history: the frame it was seen in and the state it had there. */
export interface CardHistoryEntry {
  readonly frame: number;
  readonly kind: FrameKind;
  readonly label: string;
  readonly state: CardState;
}

/** The frame fields the history reads; `Frame` and `LiveFrame` both fit. */
export interface HistoryFrame {
  readonly index: number;
  readonly kind: FrameKind;
  readonly label: string;
  readonly cards: ReadonlyArray<Pick<FrameCard, 'task' | 'text' | 'state'>>;
}

/**
 * The state history of one task across the scrubber's frames (ISC-88, card detail): every frame that holds a card with
 * the same id and the same text, in frame order. Identity is the id together with its text, as in `core/src/frames.ts`:
 * a re-cut that renumbered or reworded an id makes the earlier cards another task's, so none of their states is
 * attributed to this one (ISC-91). A struck task keeps the text it had on the last board, so its `absent` step joins
 * the history of the task it was.
 */
export function cardHistory(frames: readonly HistoryFrame[], card: Pick<FrameCard, 'task' | 'text'>): CardHistoryEntry[] {
  return [...frames]
    .sort((a, b) => a.index - b.index)
    .flatMap((frame) => {
      const hit = frame.cards.find((c) => c.task === card.task && c.text === card.text);
      return hit === undefined ? [] : [{ frame: frame.index, kind: frame.kind, label: frame.label, state: hit.state }];
    });
}
