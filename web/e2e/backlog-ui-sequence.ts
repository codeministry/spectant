/**
 * Spec 037 · T44 (ISC-199): the backlog calls the tree lens and the workspace board send on harbor, as one typed list.
 *
 * The seam between the e2e and the readonly test: `tree-reorder.spec.ts` and `board-lanes.spec.ts` take their expected
 * request bodies from this list, so the e2e proves the UI sends exactly these calls; `tests/readonly.test.ts`
 * (`-t backlog-ui`) replays the list in order through the real `POST …/backlog` route on one copy of harbor, each call
 * with the hash the previous answer named (the first with the empty text's sha256: harbor has no `specs/backlog.md`),
 * and compares every byte, `.git/` included.
 *
 * Each e2e test sends its call on the golden tree; the order here is the replay's, chosen so that every call still
 * changes the ranks after the ones before it (a move to where a feature already stands is a 422). Harbor has no
 * `Milestone:` line, so the route ranks F0 to F7 in one group; the tree shows Harbor 1.0 as F1, F2, F4 and "No
 * milestone" as F0, F5, F6, F7, the feature board the bands that have cards: F2, F4 and F0, F5, F6, …
 * (web/CLAUDE.md § Driving the backlog writes from an e2e spec).
 */
import type { BacklogRequest } from '../../server/src/spec-routes.contract.ts';

/** A backlog request as the page builds it, before it adds the `backlogHash` it read. */
export type BacklogUiBody = BacklogRequest extends infer R ? (R extends unknown ? Omit<R, 'hash'> : never) : never;

export interface BacklogUiCall {
  /** The call's name, unique in the list. */
  readonly id: string;
  readonly view: 'tree' | 'board';
  readonly how: 'alt' | 'menu' | 'drag' | 'chip';
  readonly body: BacklogUiBody;
}

/** The sha256 of the empty text: the backlog hash of a tree without `specs/backlog.md`, harbor's before any write. */
export const EMPTY_BACKLOG_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const BACKLOG_UI_SEQUENCE = [
  // board-lanes.spec.ts, keys: Alt+↓ on the grip of Harbor 1.0's first band (F2, F4) puts it behind the last.
  { id: 'board-alt', view: 'board', how: 'alt', body: { op: 'move', feature: 'F2', before: null } },
  // tree-reorder.spec.ts: Alt+↓ at F1 in Harbor 1.0 (F1, F2, F4), then Alt+↓ again with the hash the first wrote.
  { id: 'tree-alt-down', view: 'tree', how: 'alt', body: { op: 'move', feature: 'F1', before: 'F4' } },
  { id: 'tree-alt-last', view: 'tree', how: 'alt', body: { op: 'move', feature: 'F1', before: null } },
  // board-lanes.spec.ts, menu: "Move down" in the same band's grip menu sends the same move.
  { id: 'board-menu', view: 'board', how: 'menu', body: { op: 'move', feature: 'F2', before: null } },
  // tree-reorder.spec.ts: the grip's "Move" menu, "Move to the top" at F4.
  { id: 'tree-menu-top', view: 'tree', how: 'menu', body: { op: 'move', feature: 'F4', before: 'F1' } },
  // tree-reorder.spec.ts: dragging F7's grip above F0 in the "No milestone" group.
  { id: 'tree-drag', view: 'tree', how: 'drag', body: { op: 'move', feature: 'F7', before: 'F0' } },
  // tree-reorder.spec.ts: P1 picked at F2's priority chip.
  { id: 'tree-chip', view: 'tree', how: 'chip', body: { op: 'priority', feature: 'F2', priority: 'P1' } },
  // board-lanes.spec.ts, drag: the first band of the first group of three (F0, F5, F6) dragged below its neighbour.
  { id: 'board-drag', view: 'board', how: 'drag', body: { op: 'move', feature: 'F0', before: 'F6' } },
] as const satisfies readonly BacklogUiCall[];

export type BacklogUiCallId = (typeof BACKLOG_UI_SEQUENCE)[number]['id'];

/** The request body of the named call, without the hash. */
export function backlogUiBody(id: BacklogUiCallId): BacklogUiBody {
  const call = BACKLOG_UI_SEQUENCE.find((c) => c.id === id);
  if (call === undefined) throw new Error(`no backlog UI call ${id}`);
  return call.body;
}
