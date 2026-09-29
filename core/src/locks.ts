// Lock sources (T20, ISC-37): LifeOS frontier lock files under a given state directory,
// `.spectant/activity.jsonl` claim/release lines, `none` when neither exists. Reads only, never writes.
// T20 may make the function `async`.
// Stub from the T1 seam: the fill-in task replaces the body and keeps the exported name and types.
import type { LockReadInput, LockReading } from './files.ts';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub parameters; the fill-in uses them and drops this line
export function readLockSources(_input: LockReadInput): Promise<LockReading> {
  throw new Error('not implemented: readLockSources');
}
