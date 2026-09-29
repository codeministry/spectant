// The takeable task set (T38, ISC-16), ported from the old SpecRun `plan()`: which tasks the next round may dispatch
// and why the others are held (operator lane, closed, blocked or locked claim, open edge or seam, same file, width,
// not [P]). Without tasks.md the open claims are the units. Tasks come from spec 002's task-line grammar (tasks.ts).
// Stub from the T33 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { Claim } from './claims.ts';
import type { ClaimLock, SpecType, TasksModel } from './files.ts';

export interface TakeableInput {
  readonly specType: SpecType | null;
  readonly claims: readonly Claim[];
  /** Parsed tasks.md; null when the spec has none. */
  readonly tasks: TasksModel | null;
  readonly locks?: readonly ClaimLock[];
  /** Tasks per round; defaults to 1 for bug, spike and infra, else 4. */
  readonly width?: number;
}

export interface TakeableEntry {
  /** A task id `T12`, or `C1`… for a claim unit when there is no tasks.md. */
  readonly task: string;
  readonly claim: string;
  /** Why it is dispatched or held, one phrase. */
  readonly reason: string;
}

export interface TakeableSet {
  readonly width: number;
  /** Claim IDs takeable now. */
  readonly claims: readonly string[];
  readonly dispatch: readonly TakeableEntry[];
  readonly held: readonly TakeableEntry[];
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Nothing left to dispatch: every unit is done, or every held unit waits on something a round cannot change. */
  readonly exhausted: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function takeableSet(_input: TakeableInput): TakeableSet {
  throw new Error('not implemented: takeableSet');
}
