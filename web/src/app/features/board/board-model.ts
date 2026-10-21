import type { WorkflowStage } from '../../../../../core/src/files';
import type { BoardBand } from '../../core/model/board-types';

/** The board page's overflow helpers (spec 019); the board's query, input, model and builder live in `core/model/`. */

// ─── Hidden columns at medium (spec 019, T29, ISC-141.1) ────────────────────────────────────────────────────────────

/**
 * What the overflow reads of a column: its stage, its shown cards (only their number) and its swimlane bands. A
 * `BoardColumn` is assignable to it.
 */
export interface OverflowColumn {
  readonly stage: WorkflowStage;
  readonly cards: ArrayLike<unknown>;
  readonly bands: ReadonlyArray<Pick<BoardBand, 'key' | 'count'>>;
}

/** A column out of view and the cards it holds: the whole column's shown cards, or one lane's. */
export interface HiddenColumn {
  readonly stage: WorkflowStage;
  readonly count: number;
}

/** A swimlane whose cards all lie out of view: its band key, its card count and the hidden columns holding them. */
export interface HiddenLane {
  /** The band key (`F<n>`, a milestone name), or null for the band without one. */
  readonly key: string | null;
  /** The lane's shown cards, all of them in `columns`. */
  readonly count: number;
  /** The hidden columns that hold a card of the lane, in column order, each with the lane's cards there. */
  readonly columns: readonly HiddenColumn[];
}

/**
 * The overflow line's entries ("Right out of view: Build 2 · Done 1"): every column in `hidden` that holds a shown card,
 * in column order, with its shown card count. A column without a shown card (an empty column or an empty stub) hides
 * nothing and is left out; a folded column with cards counts. `hidden` holds the stages the page measured right of
 * the scroller box (a column head's left edge at or past the box's right edge).
 */
export function hiddenColumnsOf(columns: readonly OverflowColumn[], hidden: ReadonlySet<WorkflowStage>): readonly HiddenColumn[] {
  return columns.filter((c) => hidden.has(c.stage) && c.cards.length > 0).map((c) => ({ stage: c.stage, count: c.cards.length }));
}

/**
 * The swimlane hints ("2 cards in Build, Close-pending, right out of view"), keyed by band key: every lane that holds a
 * shown card and has all of them in `hidden` columns. A lane with one card in view is absent, and so is every lane on a
 * board without swimlanes (its columns carry no bands).
 */
export function hiddenLanesOf(columns: readonly OverflowColumn[], hidden: ReadonlySet<WorkflowStage>): ReadonlyMap<string | null, HiddenLane> {
  const lanes = new Map<string | null, { inView: boolean; columns: HiddenColumn[] }>();
  for (const column of columns) {
    for (const band of column.bands) {
      if (band.count === 0) continue;
      const lane = lanes.get(band.key) ?? { inView: false, columns: [] };
      if (hidden.has(column.stage)) lane.columns.push({ stage: column.stage, count: band.count });
      else lane.inView = true;
      lanes.set(band.key, lane);
    }
  }
  const found = new Map<string | null, HiddenLane>();
  for (const [key, lane] of lanes) {
    if (lane.inView || lane.columns.length === 0) continue;
    found.set(key, { key, count: lane.columns.reduce((n, c) => n + c.count, 0), columns: lane.columns });
  }
  return found;
}
