/**
 * Pure display helpers for the Status tab (T54, ISC-79). Nothing here counts or derives a stage: the stage, the next
 * command and its reasons are read from `SpecPageModel` as the parser built them (ISC-72). The gate button's helpers
 * moved with the button to `layout/spec-head/spec-head-model.ts` (T78).
 */
import type { ClaimView } from '../../../../../../core/src/files';

/** The claims still open, in the model's order: everything neither closed nor dropped. */
export function openClaims(claims: readonly ClaimView[]): readonly ClaimView[] {
  return claims.filter((claim) => claim.state !== 'closed' && claim.state !== 'dropped');
}
