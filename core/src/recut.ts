// Re-cut detection between rounds (T18, ISC-91): task ids and texts compared, struck tasks absent, no state
// attributed to a renumbered id.
//
// The one rule. A task is its id together with its text:
//
//   same id, same text        the same task: its card, tries and note carry forward (frames.ts)
//   same id, other text       `changed`: renumbered or reworded; the id starts fresh, nothing of the old task carries
//   id gone                   `struck`: no card from here on (the live frame shows it `absent` while tasks.md lists it
//                             struck and the last board held it, live.ts)
//   new id, known text        renumbered: the old id is `struck` (or `changed`, when another task took it) and the new
//                             id `added`; the text's tries, state and history stay with the old id
//   new id, new text          `added`
//
// `recutBetween` applies the rule to two consecutive boards; `buildFrames` calls it once per rounds.jsonl line and sets
// the result as the dispatch frame's `recut`. `detectRecut` turns the frames into the scrubber's markers by the same
// call, so there is no second reading of a re-cut. Pure: no file system, no clock.
import type { Frame, FrameRecut, RecutMarker } from './files.ts';

/** The identity fields of a task on a board: a rounds.jsonl task object, or a frame card's `task` and `text`. */
export interface TaskIdentity {
  readonly id: string;
  readonly text: string;
}

/** Whether two task entries are the same task: same id and same text (ISC-91). */
export function sameTask(a: TaskIdentity, b: TaskIdentity): boolean {
  return a.id === b.id && a.text === b.text;
}

/**
 * Struck, added and changed ids from the previous board to the next one; null when both hold the same tasks. `struck`
 * in the previous board's order, `added` and `changed` in the next board's order.
 */
export function recutBetween(previous: readonly TaskIdentity[], next: readonly TaskIdentity[]): FrameRecut | null {
  const before = new Map(previous.map((task) => [task.id, task.text]));
  const current = new Set(next.map((task) => task.id));
  const struck = previous.filter((task) => !current.has(task.id)).map((task) => task.id);
  const added = next.filter((task) => !before.has(task.id)).map((task) => task.id);
  const changed = next.filter((task) => before.has(task.id) && before.get(task.id) !== task.text).map((task) => task.id);
  return struck.length + added.length + changed.length === 0 ? null : { struck, added, changed };
}

/** A frame's cards as task identities. */
function board(frame: Frame): TaskIdentity[] {
  return frame.cards.map((card) => ({ id: card.task, text: card.text }));
}

/**
 * The scrubber's re-cut markers: one before each dispatch frame whose board differs from the result frame before it,
 * from that round to this one. The live frame is not compared: tasks.md against the last board is live.ts's layer.
 */
export function detectRecut(frames: readonly Frame[]): RecutMarker[] {
  return frames.flatMap((frame, i): RecutMarker[] => {
    const previous = i > 0 ? frames[i - 1] : undefined;
    if (frame.kind !== 'dispatch' || previous === undefined || previous.kind === 'live') return [];
    const recut = recutBetween(board(previous), board(frame));
    if (recut === null || previous.round === null || frame.round === null) return [];
    return [{ beforeFrame: frame.index, fromRound: previous.round, toRound: frame.round, ...recut }];
  });
}
