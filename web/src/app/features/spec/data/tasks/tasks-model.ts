import type { SpecRouteResponses } from '../../../../../../../server/src/contracts/spec-routes.contract';
import type { ItemState, TaskRun } from '../../../../../../../core/src/files';

/** core's `TasksTab` as the tasks route serves it (`null` there means the spec has no tasks.md). */
export type TasksBody = NonNullable<SpecRouteResponses['tasks']>;
export type TaskRowView = TasksBody['tasks'][number];

/** What a row's check sub-line says, as visible text (never a tooltip): a lock, a 409, a failed write, no hash. */
export type CheckLine =
  | { readonly kind: 'locked'; readonly session: string }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'failed'; readonly status: number }
  | { readonly kind: 'no-hash' };

/** Spec 040 (T52): the status chip's tint per item state, the existing tones reused; aborted is the warning tint. */
export const ITEM_TONE: Readonly<Record<ItemState, string>> = { open: 'open', waiting: 'held', running: 'dispatched', aborted: 'aborted', done: 'done' };

/** The row's own words that stay a chip beside the state word (design § task row). */
export const OWN_WORDS: ReadonlySet<string> = new Set(['question', 'concerns', 'fail']);

/** The statuses whose round card carries a reason worth a sub-line (a hold, a fail, a question, concerns). */
export const REASONED = new Set(['held', 'fail', 'concerns', 'question']);

/** `T1, T2, …, T26, T30` →`T1–T26, T30`: consecutive numbers fold into a range, file order kept. */
export function taskRanges(ids: readonly string[]): string {
  const parts: string[] = [];
  let start: string | null = null;
  let prev: number | null = null;
  let last: string | null = null;
  const flush = () => {
    if (start !== null && last !== null) parts.push(start === last ? start : `${start}–${last}`);
  };
  for (const id of ids) {
    const n = Number(id.slice(1));
    if (prev !== null && n === prev + 1 && /^T\d+$/.test(id)) {
      last = id;
    } else {
      flush();
      start = id;
      last = id;
    }
    prev = Number.isFinite(n) ? n : null;
  }
  flush();
  return parts.join(', ');
}

/** The last path segment, a trailing slash kept (`web/src/app/tag-table/` → `tag-table/`). */
export function pathTail(path: string): string {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path;
  const tail = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return path.endsWith('/') ? `${tail}/` : tail;
}

/**
 * The builder's short form under the run chip (spec 027): the last segment of the run event's worktree
 * (`.claude/worktrees/agent-a1b2` → `agent-a1b2`), else of its session, as for a `dispatch` or `build` that names no
 * worktree (spec 035, ISC-189); read from the event, never from git.
 */
export function runShort(run: Pick<TaskRun, 'session' | 'worktree'>): string {
  const last = (text: string, sep: RegExp): string => text.split(sep).filter((part) => part !== '').pop() ?? '';
  return last(run.worktree ?? '', /\//) || last(run.session, /[:/]/) || run.session;
}

/** A probe cell as written, one enclosing pair of backticks dropped for the mono cell. */
export const probeText = (probe: string): string => (/^`[^`]*`$/.test(probe) ? probe.slice(1, -1) : probe);
