// The events.jsonl line validator (T16, ISC-32) against {ts, from, to, command, actor}.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { EventValidation } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function validateEventLine(_line: string): EventValidation {
  throw new Error('not implemented: validateEventLine');
}
