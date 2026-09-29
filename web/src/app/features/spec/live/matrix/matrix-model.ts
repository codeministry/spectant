import type { CardState, Frame, Matrix, MatrixCell, MatrixColumn, MatrixRow } from '../../../../../../../core/src/files';
import { buildMatrix } from '../../../../../../../core/src/matrix';

/**
 * The Matrix tab's helpers (T87, ISC-92). The matrix itself is core's `buildMatrix` over the frames the board already
 * reads (`…/frames` plus `…/live`), in the constitution's lane order; nothing here re-derives a state. These helpers only
 * group the rows by lane, pick the glyph a cell draws and the query a cell click sets on the Board.
 */

/** One row of the table: the task's id, claim and lane, and one cell per column. */
export interface MatrixTableRow {
  readonly detail: MatrixRow;
  readonly cells: readonly MatrixCell[];
}

/** The rows of one lane, under its 32 px group header. */
export interface MatrixLaneGroup {
  readonly lane: string;
  readonly rows: readonly MatrixTableRow[];
}

/** The matrix of every frame on the scrubber: the history, then the live frame. */
export function matrixOf(frames: readonly Frame[], lanes: readonly string[]): Matrix {
  return buildMatrix(frames, [], lanes);
}

/** Consecutive rows of the same lane, in core's row order (core already groups them by lane). */
export function laneGroups(matrix: Matrix): MatrixLaneGroup[] {
  const groups: Array<{ lane: string; rows: MatrixTableRow[] }> = [];
  matrix.details.forEach((detail, r) => {
    const row = { detail, cells: matrix.cells[r] ?? [] };
    const last = groups.at(-1);
    if (last?.lane === detail.lane) last.rows.push(row);
    else groups.push({ lane: detail.lane, rows: [row] });
  });
  return groups;
}

/** The glyph a cell draws: the card's state, the dashed `absent` once the task had a card, nothing before it. */
export function glyphOf(cell: MatrixCell): CardState | null {
  return cell.state ?? (cell.gap === 'absent' ? 'absent' : null);
}

/**
 * The Board query a cell click sets: `?frame=<index>` for a history frame, none for the live frame (the board opens at
 * live without `frame`), null for a re-cut cell, which is no link.
 */
export function boardQuery(column: MatrixColumn): Record<string, string> | null {
  if (column.frame === null) return null;
  return column.kind === 'live' ? {} : { frame: String(column.frame) };
}
