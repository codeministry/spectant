/*
 * The task checkbox (T80, ISC-25, ISC-26, ISC-86) moved down to `core/model/task-check.ts` (spec 067, T32, ISC-535), so
 * the detail sidebar in `layout/` ticks a task with the same state machine and the same write (path 2) as the Tasks
 * tab; the Tasks tab and the live area import it from here as before.
 */
export {
  type CheckBlock,
  type CheckEvent,
  type CheckLine,
  type CheckLock,
  type CheckState,
  checkBlock,
  checkedFromLine,
  IDLE,
  landedDelta,
  nextCheckState,
  rowChecked,
  TaskChecks,
  type TaskChecksSource,
  type TaskCheckWrite,
  withCheck,
} from '../../../../core/model/task-check';
