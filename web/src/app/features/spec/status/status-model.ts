/**
 * Pure display helpers for the Status tab (T54, ISC-79; spec 008 T132, T133). Nothing here counts or derives a stage:
 * the stage, its source, the next command, its reasons and the assignee are read from `SpecPageModel` as the parser
 * built them (ISC-72), the workflow row from the planning tree. The gate button's helpers moved with the button to
 * `layout/spec-head/spec-head-model.ts` (T78).
 */
import type { ActorRef, ClaimView, SpecHead, SpecNextStep, StageSource, Workflow, WorkflowStage } from '../../../../../../core/src/files';
import { workflowStagesOf } from '../../../../../../core/src/stage';
import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import type { StageDetour } from '../../../shared/ui/stage-track/stage-track';

/** The claims still open, in the model's order: everything neither closed nor dropped. */
export function openClaims(claims: readonly ClaimView[]): readonly ClaimView[] {
  return claims.filter((claim) => claim.state !== 'closed' && claim.state !== 'dropped');
}

/** What `ui-stage-track` draws in row mode: the type's row, the segment the spec stands on, and a detour marker. */
export interface StatusTrack {
  readonly stages: readonly WorkflowStage[];
  readonly stage: string;
  readonly detour: StageDetour | null;
}

/**
 * The track of a spec (ISC-122.3): its type's workflow row (the default row while the planning tree has not
 * answered), and the head's stage. A detour is no segment: `blocked` is marked on `build`, which it leaves from and
 * returns to; `close-pending` on the stage it waits to enter, the row's successor of `build` (`code-review`), else on
 * `build` itself.
 */
export function statusTrack(head: SpecHead, workflow: Workflow | null): StatusTrack {
  const stages = workflowStagesOf(head.type, workflow ?? undefined);
  if (head.stage === 'blocked') return { stages, stage: 'build', detour: 'blocked' };
  if (head.stage === 'close-pending') {
    const after = stages.at(stages.indexOf('build') + 1);
    return { stages, stage: stages.includes('build') && after !== undefined ? after : 'build', detour: 'close-pending' };
  }
  return { stages, stage: head.stage, detour: null };
}

/** The status block's reason line: the one phrase and the command chip beside it. */
export interface StatusReason {
  readonly phrase: string;
  readonly command: string | null;
}

/**
 * The one phrase of the stage table (`next.reasons[0]`, which core guarantees equals `head.nextReason` and the
 * dashboard row's `nextReason`) with the next command, none on `close-pending`; null on a done spec, where the
 * hourglass has nothing to wait for and the done line stands instead.
 */
export function statusReason(head: SpecHead, next: SpecNextStep): StatusReason | null {
  const phrase = next.reasons.at(0);
  if (head.stage === 'done' || phrase === undefined) return null;
  return { phrase, command: head.stage === 'close-pending' ? null : next.command };
}

/** Whether the stage is the frontmatter's `stage:` or derived; null when core did not say. */
export function stageSourceOf(head: Pick<SpecHead, 'stageSource'>): StageSource | null {
  return head.stageSource ?? null;
}

/** The assignee chip's input: the actor and, for a person, the display name the actors table maps. */
export interface StatusAssignee {
  readonly actor: ActorRef;
  readonly name: string | null;
}

/** The head's assignee (ISC-131) with its display name; null when unassigned. Only a person has a mapped name. */
export function statusAssignee(head: Pick<SpecHead, 'assignee'>, actors: readonly ActorMapping[]): StatusAssignee | null {
  const actor = head.assignee ?? null;
  if (actor === null) return null;
  const name = actor.kind === 'person' ? (actors.find((a) => a.id === actor.id)?.displayName ?? null) : null;
  return { actor, name };
}
