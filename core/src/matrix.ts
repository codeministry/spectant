// Matrix cells (T19, ISC-92): tasks × frames with state glyph keys, absent and re-cut columns.
//
//   rows     every task id that ever had a card, grouped by lane (the constitution's lanes in table order, then lanes
//            only the cards name in first-seen order, `operator` last), first seen within a lane. A row carries its
//            latest card's claim, lane and text: a renumbered id sits where its current task sits.
//   columns  one per frame in scrubber order (dispatch, result, and the live frame when the caller passes it), plus
//            one re-cut column before each frame that follows a tasks.md re-cut: a frame's `recut` (T17) or a
//            `RecutMarker` (T18) whose `beforeFrame` names it. Its label is `R<from> → R<to>`.
//   cells    a frame cell holds the task's card state in that frame; without a card its state is null and `gap` says
//            why: `none` before the task's first card, `absent` after it (a dashed cell). A re-cut cell has no state;
//            `recut` marks the ids the re-cut struck, added or changed.
//
// Pure over the frames the caller built: no `node:*`, no clock, no Bun API, so the web imports it into its bundle.
import type { Frame, FrameCard, Matrix, MatrixCell, MatrixColumn, MatrixRow, RecutMarker } from './files.ts';

const OPERATOR_LANE = 'operator';

/** One re-cut: the ids it touched, by the mark the re-cut cell shows. */
type RecutMarks = ReadonlyMap<string, NonNullable<MatrixCell['recut']>>;

export function buildMatrix(frames: readonly Frame[], recuts: readonly RecutMarker[] = [], lanes: readonly string[] = []): Matrix {
  const columns: MatrixColumn[] = [];
  const columnMarks: Array<RecutMarks | null> = [];
  frames.forEach((frame, i) => {
    const marks = recutBefore(frame, recuts);
    if (marks !== null && i > 0) {
      const from = recuts.find((m) => m.beforeFrame === frame.index)?.fromRound ?? frames[i - 1]?.round;
      const to = recuts.find((m) => m.beforeFrame === frame.index)?.toRound ?? frame.round;
      columns.push({ kind: 'recut', frame: null, label: `R${String(from)} → R${String(to)}` });
      columnMarks.push(marks);
    }
    columns.push({ kind: frame.kind, frame: frame.index, label: frame.label });
    columnMarks.push(null);
  });

  const latest = new Map<string, FrameCard>();
  for (const frame of frames) for (const card of frame.cards) latest.set(card.task, card);
  const details = orderRows([...latest.values()], lanes).map(
    (card): MatrixRow => ({ task: card.task, claim: card.claim, lane: card.lane, text: card.text }),
  );

  const byFrame = new Map(frames.map((frame) => [frame.index, new Map(frame.cards.map((card) => [card.task, card]))]));
  const cells = details.map(({ task }) => {
    let seen = false;
    return columns.map((column, c): MatrixCell => {
      if (column.frame === null) {
        const mark = columnMarks[c]?.get(task);
        return { task, column: c, frame: null, state: null, ...(mark === undefined ? {} : { recut: mark }) };
      }
      const card = byFrame.get(column.frame)?.get(task);
      if (card !== undefined) seen = true;
      return card === undefined
        ? { task, column: c, frame: column.frame, state: null, gap: seen ? 'absent' : 'none' }
        : { task, column: c, frame: column.frame, state: card.state };
    });
  });

  return { rows: details.map((d) => d.task), details, columns, cells };
}

/** The ids a re-cut before `frame` touched, from its marker when one names the frame, else from its `recut`; null for none. */
function recutBefore(frame: Frame, recuts: readonly RecutMarker[]): RecutMarks | null {
  const source = recuts.find((m) => m.beforeFrame === frame.index) ?? frame.recut;
  if (source === undefined) return null;
  const marks = new Map<string, NonNullable<MatrixCell['recut']>>();
  for (const id of source.struck) marks.set(id, 'struck');
  for (const id of source.added) marks.set(id, 'added');
  for (const id of source.changed) marks.set(id, 'changed');
  return marks;
}

/** Cards (one per task, first-seen order) grouped by lane: `lanes` first, then lanes the cards name, operator last. */
function orderRows(cards: readonly FrameCard[], lanes: readonly string[]): FrameCard[] {
  const order = lanes.filter((lane) => lane !== OPERATOR_LANE);
  for (const card of cards) if (card.lane !== OPERATOR_LANE && !order.includes(card.lane)) order.push(card.lane);
  order.push(OPERATOR_LANE);
  return order.flatMap((lane) => cards.filter((card) => card.lane === lane));
}
