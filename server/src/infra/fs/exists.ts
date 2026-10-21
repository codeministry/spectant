/**
 * The path probes many readers share: whether anything has a name, never following a link, whether a path resolves
 * through its links, and a path's real path when it resolves. All swallow every error; a caller that must tell a
 * missing entry from a failing one (`pathTaken` in `in-place.ts`) keeps its own check.
 */
import { existsSync, lstatSync, realpathSync } from "node:fs";

/** Whether anything (a file, a folder, a link, even a dangling one) has this name; false on any failure. */
export function existsNoFollow(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Whether the path resolves, through every link (`existsSync`): a dangling link is false; false on any failure. */
export function existsFollowing(path: string): boolean {
  return existsSync(path);
}

/** The path with every link resolved, or null when it cannot be resolved (missing, a dangling link, no access). */
export function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}
