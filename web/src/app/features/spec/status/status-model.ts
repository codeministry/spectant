/**
 * Pure display helpers for the Status tab (T54, ISC-79, ISC-85). Nothing here counts or derives a stage: the stage,
 * the next command and its reasons are read from `SpecPageModel` as the parser built them (ISC-72). These helpers only
 * pick which of the gate button's four states the model's facts put it in and how a path wraps.
 */
import type { ClaimLock, ClaimView, GateView } from '../../../../../../core/src/files';

/** The gate button's four states (design.md § Status, ISC-85). */
export type GateAction = 'ready' | 'stale' | 'done' | 'paused';

/**
 * The reviewed gate's button: any lock on this spec pauses writes (a 423 would answer anyway, ISC-86), a stale mark
 * asks for a new review, a fresh one is done, and anything else (no mark yet) is ready.
 */
export function gateAction(reviewed: GateView, lock: ClaimLock | null): GateAction {
  if (lock !== null) return 'paused';
  if (reviewed.state === 'stale') return 'stale';
  if (reviewed.state === 'fresh') return 'done';
  return 'ready';
}

/** The claims still open, in the model's order: everything neither closed nor dropped. */
export function openClaims(claims: readonly ClaimView[]): readonly ClaimView[] {
  return claims.filter((claim) => claim.state !== 'closed' && claim.state !== 'dropped');
}

/** A path cut after each `/`, so the template can offer a line break there (`<wbr>`) and nowhere else. */
export function pathSegments(path: string): readonly string[] {
  return path.split(/(?<=\/)/u).filter((segment) => segment.length > 0);
}

/** The first twelve hex digits of a hash for display; null for a file that does not exist. */
export function shortHash(hash: string | null): string | null {
  return hash === null ? null : hash.slice(0, 12);
}
