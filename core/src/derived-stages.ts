// Stage transitions for the timeline (T15, ISC-36): derived from the files and marked `derived` while
// events.jsonl is absent; the recorded events replace them when present.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { EventLine, SpecFiles, TimelineEntry } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function deriveStages(_files: SpecFiles, _events?: readonly EventLine[]): TimelineEntry[] {
  throw new Error('not implemented: deriveStages');
}
