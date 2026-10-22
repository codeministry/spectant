import { STAGE_ORDER } from '../../../shared/ui/stage-tone';

/**
 * The spec list's stage filter `?stage=<stage>[,<stage>…]` (spec 064, T62, ISC-503): the words it takes and the map of
 * an old `?phase=` value onto them, which the router's redirect uses. `spec-table-model.ts` re-exports the keys.
 */

/** The filter chip key for "every stage", for "has open fog" and for "only the ideas" (spec 064, ISC-480). */
export const ALL = 'all';
export const FOG = 'fog';
export const IDEA = 'idea';

/** Every word `?stage=` takes, in the order the list writes them: the stages in workflow order, then fog and idea. */
export const STAGE_FILTERS: readonly string[] = [...STAGE_ORDER, FOG, IDEA];

/**
 * The stages an old `?phase=` value stands for (spec 064, T62, ISC-503), the router's redirect to `?stage=`: scoping →
 * plan, tasks, review; building and climbing → build; complete → close, done; idea and fog stay; any other word → none.
 */
const PHASE_STAGES: Readonly<Record<string, readonly string[]>> = {
  scoping: ['plan', 'tasks', 'review'],
  building: ['build'],
  climbing: ['build'],
  complete: ['close', 'done'],
  idea: [IDEA],
  fog: [FOG],
};
export const stagesOfPhase = (phase: string): readonly string[] => (Object.hasOwn(PHASE_STAGES, phase) ? (PHASE_STAGES[phase] ?? []) : []);

/** The words of a `?stage=` value `STAGE_FILTERS` knows, once each and in its order; null when none is left (all). */
export function stagesOf(value: string | null): readonly string[] | null {
  const words = new Set((value ?? '').split(',').map((word) => word.trim()));
  const stages = STAGE_FILTERS.filter((stage) => words.has(stage));
  return stages.length > 0 ? stages : null;
}
