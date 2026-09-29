import type { SpecRouteResponses } from '../../../../../../../server/src/spec-routes.contract';
import type { TaskCheckResult } from '../../../../core/api.service';

/** One row of core's `TasksTab` (the same type `tasks-tab.ts` exports; declared here so the two do not import each other). */
type TaskRowView = NonNullable<SpecRouteResponses['tasks']>['tasks'][number];

/**
 * One task checkbox's write state (T80, ISC-25, ISC-26, ISC-86). The Tasks tab keeps one per row it wrote to and drops
 * them all when the list is read again, so a state never outlives the tasks.md it was about.
 *
 * - `idle`: the box shows the file.
 * - `saving`: the write is in flight; the box shows the state wanted, disabled, with an inline spinner.
 * - `written`: 200; the box and the row's state follow the line the server wrote.
 * - `locked`: 423; the session the answer names is shown as visible text. A new tick retries.
 * - `conflict`: 409; tasks.md changed on disk, nothing was applied. Reload reads the list again.
 * - `failed`: any other answer (status 0: none came). A new tick retries.
 */
export type CheckState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saving'; readonly checked: boolean }
  | { readonly kind: 'written'; readonly checked: boolean; readonly line: number }
  | { readonly kind: 'locked'; readonly session: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly status: number };

export type CheckEvent =
  | { readonly type: 'tick'; readonly checked: boolean }
  | { readonly type: 'answer'; readonly result: TaskCheckResult }
  | { readonly type: 'reload' };

export const IDLE: CheckState = { kind: 'idle' };

/** The checkbox of a tasks.md task line as written (`- [x] T1 · …`); null when the text is no task line. */
export function checkedFromLine(text: string): boolean | null {
  const match = /^\s*[-*]\s+\[([ xX])\]/.exec(text);
  return match ? match[1] !== ' ' : null;
}

/** The transition function; a state is returned unchanged (same reference) when the event does not apply to it. */
export function nextCheckState(state: CheckState, event: CheckEvent): CheckState {
  switch (event.type) {
    case 'tick':
      return state.kind === 'saving' ? state : { kind: 'saving', checked: event.checked };
    case 'reload':
      return IDLE;
    case 'answer': {
      // An answer that arrives after the list was read again belongs to a state that no longer exists.
      if (state.kind !== 'saving') return state;
      const result = event.result;
      switch (result.kind) {
        case 'ok':
          return { kind: 'written', checked: checkedFromLine(result.body.line.text) ?? result.body.checked, line: result.body.line.number };
        case 'conflict':
          return { kind: 'conflict' };
        case 'locked':
          return { kind: 'locked', session: result.body.lock.session };
        case 'error':
          return { kind: 'failed', status: result.status };
      }
    }
  }
}

/** What the box shows: the state wanted while saving, the written state after a 200, else the file. */
export function rowChecked(row: TaskRowView, state: CheckState): boolean {
  return state.kind === 'saving' || state.kind === 'written' ? state.checked : row.state === 'done';
}

/**
 * The row as it stands after a 200: a tick is `done`, an untick `open` (a checked box outranks an unfinished round);
 * a write that left the box as the file had it keeps the row as read.
 */
export function withCheck(row: TaskRowView, state: CheckState): TaskRowView {
  if (state.kind !== 'written' || (row.state === 'done') === state.checked) return row;
  return state.checked ? { ...row, state: 'done', status: 'done' } : { ...row, state: 'open', status: 'open' };
}

/** How a written state moves the "boxes ticked" count: +1, -1 or 0. */
export function landedDelta(row: TaskRowView, state: CheckState): number {
  if (state.kind !== 'written' || (row.state === 'done') === state.checked) return 0;
  return state.checked ? 1 : -1;
}

/** Why a box cannot be ticked right now, shown as visible text in the row, never as a tooltip. */
export type CheckBlock =
  | { readonly kind: 'saving' }
  | { readonly kind: 'locked'; readonly session: string }
  | { readonly kind: 'no-hash' };

/**
 * The box is disabled while its write is in flight, while the lock source names a session on the row's claim (the
 * server would answer 423), and while the list came without tasks.md's hash (a write could not be checked against the
 * file). Every lane, operator included, is tickable otherwise.
 */
export function checkBlock(
  row: TaskRowView,
  state: CheckState,
  lock: { readonly claim: string; readonly session: string } | null,
  hash: string | null,
): CheckBlock | null {
  if (state.kind === 'saving') return { kind: 'saving' };
  if (lock !== null && lock.claim === row.claim) return { kind: 'locked', session: lock.session };
  if (hash === null) return { kind: 'no-hash' };
  return null;
}
