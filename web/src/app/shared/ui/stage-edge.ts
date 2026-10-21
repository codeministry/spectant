import type { WorkflowStage } from '../../../../../core/src/files';

/**
 * The inline-start edge per stage, in the prototype's role colours (spec 024, design § Workspace board): teal for an
 * idea, the track grey for plan and tasks, violet for a wait on you (review, code-review, close), cyan in motion
 * (build), red for blocked, the held grey for close-pending, lime done. The edge never carries the meaning alone: the
 * reason line says it in words.
 */
export const CARD_EDGE: Readonly<Record<WorkflowStage, string>> = {
  idea: 'var(--teal)',
  plan: 'var(--track)',
  tasks: 'var(--track)',
  review: 'var(--color-secondary)',
  'code-review': 'var(--color-secondary)',
  close: 'var(--color-secondary)',
  build: 'var(--color-primary)',
  blocked: 'var(--color-error)',
  'close-pending': 'var(--held)',
  done: 'var(--color-accent)',
};
