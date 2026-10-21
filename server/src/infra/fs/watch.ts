/**
 * The directory watch behind the live update stream (spec 030, `live/`): `fs.watch` over one directory with the
 * options the caller passes. Read-only: it opens the directory for reading and writes nothing. A failure to arm
 * throws, and a watched directory that goes away reports on the watcher's `error` event; the caller decides both.
 */
import { type FSWatcher, watch } from "node:fs";

export type { FSWatcher } from "node:fs";

/** Watches `dir`, recursively or not, and calls `listener` with each event and the file name the platform reported. */
export function watchDir(
  dir: string,
  options: { recursive: boolean; persistent: boolean },
  listener: (event: string, filename: string | null) => void,
): FSWatcher {
  return watch(dir, options, listener);
}
