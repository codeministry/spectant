import type { Tone } from './tone';

/** The phases a spec's frontmatter `phase:` names that carry a tone of their own; every other phase is `neutral`. */
export type TonedPhase = 'scoping' | 'building' | 'climbing' | 'complete';

/**
 * The phase tones of the spec picker, the command palette and the dashboard's stage-group meter, defined once (review
 * 024). The spec table keeps its own `PHASE_TONES` (`spec-table-model.ts`), which tones `complete` as `success`.
 */
export const PHASE_TONE: Readonly<Record<TonedPhase, Tone>> = {
  scoping: 'secondary',
  building: 'primary',
  climbing: 'warning',
  complete: 'accent',
};

const isTonedPhase = (phase: string): phase is TonedPhase => Object.hasOwn(PHASE_TONE, phase);

/** The tone of a phase as written, `neutral` for one without a tone of its own. */
export const toneOfPhase = (phase: string): Tone => (isTonedPhase(phase) ? PHASE_TONE[phase] : 'neutral');
