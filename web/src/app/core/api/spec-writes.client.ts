import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ClaimLock, WorkflowStage } from '../../../../../core/src/files';
import {
  type Conflict,
  type GateReviewedRequest,
  type GateReviewedResponse,
  type Locked,
  type ReviewedHashes,
  specRoutes,
  type TaskCheckRequest,
  type TaskCheckResponse,
  type TransitionRequest,
} from '../../../../../server/src/contracts/spec-routes.contract';
import { type HttpCore, isContractError, type WriteResult } from './http-core';

/** What the gate write answers (T54, ISC-85): never a thrown exception, the gate dialog branches on `kind`. */
export type GateWriteResult =
  | { readonly kind: 'ok'; readonly body: GateReviewedResponse }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'locked'; readonly lock: ClaimLock }
  | { readonly kind: 'error'; readonly status: number };

/**
 * The 200 of the checkbox write: `TaskCheckWritten` of `server/src/contracts/writes.contract.ts` (T67), the base answer
 * plus the task's line as it now stands (1-based, no newline). Re-declared over the contract's base type on purpose:
 * that module type-imports `core/src/gates.ts`, which `tsconfig.app.json` rejects (see `DashboardBody`).
 */
export interface TaskCheckWritten extends TaskCheckResponse {
  readonly line: { readonly number: number; readonly text: string };
}

/**
 * What the checkbox write answers, never a thrown exception (ISC-25, ISC-26, ISC-86):
 *
 * - `ok`: 200, the line as written and tasks.md's new raw hash (the next tick sends it).
 * - `conflict`: 409 `hash-mismatch`, tasks.md changed since it was rendered; nothing was written.
 * - `locked`: 423, a lock holds the task's claim; the body names the session. Nothing was written.
 * - `error`: anything else (400, 404, an unreadable workspace's 409), status 0 when no answer came.
 */
export type TaskCheckResult =
  | { readonly kind: 'ok'; readonly body: TaskCheckWritten }
  | { readonly kind: 'conflict'; readonly body: Conflict<{ readonly tasks: string }> }
  | { readonly kind: 'locked'; readonly body: Locked }
  | { readonly kind: 'error'; readonly status: number };

const isConflict = (body: unknown): body is Conflict<{ readonly tasks: string }> => isContractError(body, 'hash-mismatch');

const isLocked = (body: unknown): body is Locked => {
  if (!isContractError(body, 'locked')) return false;
  const lock: unknown = (body as { lock?: unknown }).lock;
  return typeof lock === 'object' && lock !== null && typeof (lock as { session?: unknown }).session === 'string';
};

/** The writes on one spec: the stage move, the reviewed mark, a task checkbox. Never cached, never retried. */
export class SpecWritesClient {
  constructor(private readonly core: HttpCore) {}

  /**
   * T111 · ISC-130: `POST …/:id/transition` with the stage wanted and the raw spec.md hash the page rendered. The
   * answer is the contract's, validated: 200 `TransitionWritten`, 409 `hash-mismatch`, 422 `transition-refused`
   * (the stage row's reason and command), 423 `locked`. Never cached, never retried.
   */
  transition(ws: string, id: string, to: WorkflowStage, hash: string): Promise<WriteResult<'transition'>> {
    const body: TransitionRequest = { to, hash };
    return this.core.write('transition', specRoutes.transition(ws, id), body);
  }

  /**
   * T54 · ISC-85: `POST …/gate/reviewed` with the hashes the page was rendered from. 409 `hash-mismatch` answers
   * `conflict` (a file changed since), 423 answers `locked` with the lock that holds the spec (ISC-86).
   */
  async gateReviewed(ws: string, id: string, hashes: ReviewedHashes): Promise<GateWriteResult> {
    try {
      const request: GateReviewedRequest = { hashes };
      const body = await firstValueFrom(this.core.http.post<GateReviewedResponse>(specRoutes.gateReviewed(ws, id), request));
      return { kind: 'ok', body };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const error: unknown = failure.error;
      if (failure.status === 409 && isContractError(error, 'hash-mismatch')) return { kind: 'conflict' };
      if (failure.status === 423 && isContractError(error, 'locked')) return { kind: 'locked', lock: (error as Locked).lock };
      return { kind: 'error', status: failure.status };
    }
  }

  /**
   * The checkbox write (T80, ISC-25): `POST …/tasks/:tid/check` with the state wanted and the raw tasks.md hash the tab
   * rendered (`X-Spectant-Tasks-Hash`). Never cached, never retried: a 409 or a 423 is the user's to act on.
   */
  async taskCheck(ws: string, id: string, tid: string, hash: string, checked: boolean): Promise<TaskCheckResult> {
    const body: TaskCheckRequest = { checked, hash };
    try {
      const written = await firstValueFrom(this.core.http.post<TaskCheckWritten>(specRoutes.taskCheck(ws, id, tid), body));
      return { kind: 'ok', body: written };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const error: unknown = failure.error;
      if (failure.status === 409 && isConflict(error)) return { kind: 'conflict', body: error };
      if (failure.status === 423 && isLocked(error)) return { kind: 'locked', body: error };
      return { kind: 'error', status: failure.status };
    }
  }
}
