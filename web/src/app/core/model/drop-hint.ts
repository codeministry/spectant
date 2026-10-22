import type { WorkflowStage } from '../../../../../core/src/files';
import { FIXED_GATES } from '../../../../../core/src/workflow';

/**
 * What a column (stub, strip segment, tray slot) says while a card is dragged over the board, and what an entry of the
 * stage-target list (`ui-stage-targets`: the board's "Move to…", the detail sidebar's stage change) says about its
 * stage. Here since spec 067 (T27), so the shared list and the sidebar read the board's one rule.
 */
export type DropHint = 'current' | 'allowed' | 'gate' | 'not-next';

/**
 * The hint of one column for the dragged card. `allowed` is a column core's transition table admits (`card.targets`,
 * `dropTargetsOf`); any other column is `gate` when it is one of core's `FIXED_GATES` (the card has not passed it) and
 * `not-next` otherwise. Only hints: core decides every drop, so a drop on a `gate` or `not-next` column is still sent
 * and comes back refused.
 */
export function dropHint(card: { readonly stage: WorkflowStage; readonly targets: readonly WorkflowStage[] }, stage: WorkflowStage): DropHint {
  if (stage === card.stage) return 'current';
  if (card.targets.includes(stage)) return 'allowed';
  return FIXED_GATES.includes(stage) ? 'gate' : 'not-next';
}
