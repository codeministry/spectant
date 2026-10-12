// A stage move planned in memory (spec 008, ISC-29 and the transition route): the workflow decides whether the move is
// allowed, and on yes `spec.md` with its `stage:` set plus the `events.jsonl` line to append. Seam T37 holds the
// signature; T71 and T72 fill it. Reads and writes nothing: `server/src/writes.ts` checks the hash, the locks, and
// writes. Browser-safe.
import type { MarkState, SpecFiles, TransitionPlan, Workflow, WorkflowStage } from './files.ts';
import type { ClaimCounts } from './stage.ts';

export interface TransitionInput {
  readonly files: SpecFiles;
  readonly workflow: Workflow;
  readonly to: WorkflowStage;
  /** The actor id recorded in the event line (actor grammar, `actor.ts`). */
  readonly actor: string;
  /** The event's `ts`. */
  readonly now: Date;
  readonly reviewed: MarkState;
  readonly partition: ClaimCounts;
  /** Open sibling specs of the spec's main feature, for `code_review: feature` (`close-pending`). */
  readonly featureSiblingsOpen: readonly string[];
}

export function planTransition(input: TransitionInput): TransitionPlan {
  // stub (spec 008, T71): every move is refused until the transition rules land; `from` is not derived yet.
  return { ok: false, from: input.to, to: input.to, reason: 'not implemented: planTransition', command: null };
}
