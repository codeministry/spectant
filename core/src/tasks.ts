// The task line grammar in full (T23, ISC-82): flags, lane, state, edges, paths, plus the probe mapping table.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { TaskParseInput, TasksModel } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function parseTaskLines(_input: TaskParseInput): TasksModel {
  throw new Error('not implemented: parseTaskLines');
}
