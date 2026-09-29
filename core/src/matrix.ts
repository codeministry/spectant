// Matrix cells (T19, ISC-92): tasks × frames with state glyph keys, absent and re-cut columns.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { Frame, Matrix, RecutMarker } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function buildMatrix(_frames: readonly Frame[], _recuts: readonly RecutMarker[]): Matrix {
  throw new Error('not implemented: buildMatrix');
}
