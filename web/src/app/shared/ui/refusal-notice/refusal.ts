import type { Priority, WorkflowStage } from '../../../../../../core/src/files';
import type { AllocateRefused } from '../../../../../../server/src/contracts/spec-routes.contract';

/**
 * Why a drop did not move its card (spec 008, T126), shown by `app-refusal-notice` under the card. `stage` is the
 * card's stage when it was refused: once the card stands anywhere else, the notice is gone. `BoardDrag` keeps it; the
 * type lives here, beside the notice, so shared/ui never imports a feature.
 */
export type BoardRefusal = {
  readonly key: string;
  readonly id: string;
  readonly stage: WorkflowStage;
  readonly to: WorkflowStage;
} & (
  | { readonly kind: 'refused'; readonly reason: string; readonly command: string | null }
  | { readonly kind: 'stale' }
  | { readonly kind: 'locked'; readonly session: string; readonly claim: string }
  | { readonly kind: 'failed'; readonly status: number }
  /** T128: the allocation's 422 (`AllocateRefused`); `id` is the story's slug. */
  | { readonly kind: 'unallocated'; readonly reason: AllocateRefused['reason']; readonly folder: string | null }
  /**
   * Spec 040 (T59, ISC-225.1): a run on the item is `running`, so nothing was sent (the card's state said so) or the
   * write answered 423 `run-locked` (a run started after the board rendered). The run's command, its actor's id and
   * how long it has run; null where the source names none.
   */
  | { readonly kind: 'run-locked'; readonly command: string | null; readonly actor: string | null; readonly elapsedMs: number | null }
);

/**
 * Why a backlog write of the tree lens or the board's feature swimlanes was not accepted (spec 037, T20, ISC-198),
 * kept per feature by `BacklogWriter` and shown by `app-refusal-notice` under the feature's row or band head.
 *
 * - `op`: the write that was refused, a move or a priority; `priority` is the level a priority write tried, else null.
 * - `refused`: the 422 (`BacklogRefused`) with core's reason phrase exactly as the route sent it (fail tone).
 * - `stale`: the 409 (`StaleBacklog`); the writer has re-read the planning tree (warning tone).
 * - `failed`: any other status, no answer (0), or no answer within the writer's timeout (0) (fail tone).
 */
export type BacklogRefusal = {
  readonly op: 'move' | 'priority';
  readonly feature: string;
  readonly priority: Priority | null;
} & ({ readonly kind: 'refused'; readonly reason: string } | { readonly kind: 'stale' } | { readonly kind: 'failed'; readonly status: number });

/** Everything `app-refusal-notice` shows: a board drop's refusal or a backlog write's. */
export type Refusal = BoardRefusal | BacklogRefusal;

/** True for a backlog write's refusal (it carries `op`), false for a board drop's. */
export const isBacklogRefusal = (refusal: Refusal): refusal is BacklogRefusal => 'op' in refusal;
