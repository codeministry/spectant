import type { FrameCard } from '../../../../../../../core/src/files';
import type { BoardSection, LaneView } from '../board/board-model';

/**
 * The Flow view's pure helpers (T82, ISC-87). Flow reads the board's own `LaneView` sections (`board-model.ts`), so a
 * card sits in the same section in both views; these helpers only turn a lane into a band of four columns, count the
 * columns and plan the FLIP move of the cards that changed place.
 */

/** The four columns, in the design's order: Waiting · In flight · Needs you · Landed. */
export const FLOW_COLUMNS: readonly BoardSection[] = ['waiting', 'inFlight', 'needsYou', 'landed'];

export type ColumnCounts = Readonly<Record<BoardSection, number>>;

export interface FlowBand<C extends FrameCard = FrameCard> {
  readonly name: string;
  readonly total: number;
  readonly landedCount: number;
  readonly columns: Readonly<Record<BoardSection, readonly C[]>>;
}

/** A lane as a band: its sections as columns; Waiting flattens the reason groups in their order. */
export function flowBands<C extends FrameCard>(lanes: ReadonlyArray<LaneView<C>>): Array<FlowBand<C>> {
  return lanes.map((lane) => ({
    name: lane.name,
    total: lane.total,
    landedCount: lane.landedCount,
    columns: {
      waiting: lane.waiting.flatMap((group) => group.cards),
      inFlight: lane.inFlight,
      needsYou: lane.needsYou,
      landed: lane.landed,
    },
  }));
}

/** How many cards each column holds over every band. */
export function flowCounts(bands: readonly FlowBand[]): ColumnCounts {
  const count = (column: BoardSection) => bands.reduce((sum, band) => sum + band.columns[column].length, 0);
  return { waiting: count('waiting'), inFlight: count('inFlight'), needsYou: count('needsYou'), landed: count('landed') };
}

/** `?flow=<column>` at compact: a valid column as it is, else the first column holding cards, else Waiting. */
export function resolveColumn(param: string | null, counts: ColumnCounts): BoardSection {
  const valid = FLOW_COLUMNS.find((column) => column === param);
  if (valid !== undefined) return valid;
  return FLOW_COLUMNS.find((column) => counts[column] > 0) ?? 'waiting';
}

/** Where a card was drawn: its offset from the view's own box (scroll-invariant) and its column. */
export interface CardPlace {
  readonly x: number;
  readonly y: number;
  readonly column: string;
}

/** One FLIP step: the offset that puts the card back where it was, and whether it changed column. */
export interface FlipMove {
  readonly task: string;
  readonly dx: number;
  readonly dy: number;
  readonly moved: boolean;
}

/** The cards drawn before and after that changed place; a card new to the view does not move. */
export function flipMoves(before: ReadonlyMap<string, CardPlace>, after: ReadonlyMap<string, CardPlace>): FlipMove[] {
  const moves: FlipMove[] = [];
  for (const [task, next] of after) {
    const last = before.get(task);
    if (last === undefined) continue;
    const dx = last.x - next.x;
    const dy = last.y - next.y;
    const moved = last.column !== next.column;
    if (dx !== 0 || dy !== 0 || moved) moves.push({ task, dx, dy, moved });
  }
  return moves;
}
