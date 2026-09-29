import type { Frame, FrameCard, FrameRecut } from '../../../../../../core/src/files';
import type { ScrubberMarker } from '../../../shared/ui/scrubber/scrubber';

/**
 * The web side of a re-cut (T86, ISC-91). Core decides what a re-cut is (`core/src/recut.ts`: id and text compared,
 * one rule) and sets it as the `recut` of the dispatch frame that follows it; the live frame carries a struck task still
 * on the last board as `absent` with its strike note. This file only maps those fields to what the board shows: the
 * hatched scrubber marker with its counts, and the absent card's note. Nothing is re-derived here.
 */

/** How many ids a re-cut struck, changed (renumbered or reworded) and added. */
export interface RecutCounts {
  readonly struck: number;
  readonly changed: number;
  readonly added: number;
}

export function recutCounts(recut: FrameRecut): RecutCounts {
  return { struck: recut.struck.length, changed: recut.changed.length, added: recut.added.length };
}

/**
 * A hatched, labelled re-cut marker before each frame that carries a re-cut (ISC-91). With `describe`, the marker's
 * `title` (its tooltip and accessible name) names the frame and the counts, e.g. "Re-cut before R3 dispatch: 1 struck,
 * 6 changed, 1 added".
 */
export function recutMarkers(
  frames: readonly Frame[],
  label: string,
  describe?: (counts: RecutCounts & { readonly frame: string }) => string,
): ScrubberMarker[] {
  return frames.flatMap((f): ScrubberMarker[] => {
    if (f.recut === undefined) return [];
    return [{ before: f.index, label, ...(describe === undefined ? {} : { title: describe({ ...recutCounts(f.recut), frame: f.label }) }) }];
  });
}

/**
 * The note an absent card shows on its face: its strike note ("struck 2026-03-08: …"), the empty string for a struck
 * task without one (the card shows the plain word), null for any card that is not absent.
 */
export function absentNote(card: Pick<FrameCard, 'state' | 'note'>): string | null {
  return card.state === 'absent' ? (card.note ?? '') : null;
}
