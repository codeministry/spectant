// Re-cut detection between rounds (T18, ISC-91): task ids and texts compared, struck tasks absent, no state
// attributed to a renumbered id.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { Frame, RecutMarker } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function detectRecut(_frames: readonly Frame[]): RecutMarker[] {
  throw new Error('not implemented: detectRecut');
}
