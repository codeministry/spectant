/**
 * The read primitives the workspace reads go through: a file's text or raw bytes, null when it does not exist; a
 * regular file's bytes, never through a symbolic link; whether a folder holds its own `.git`. Read-only (ISC-15): no
 * write, no temp file, no lock.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The file's text, or null when it does not exist. Any other failure (permission, a directory) propagates. */
export function readIfExists(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A file's raw bytes, or null when it does not exist; any other failure throws. For hashes over exact bytes. */
export function readBytesIfExists(path: string): Buffer | null {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** A regular file's bytes, never through a symbolic link; null when absent or anything else. */
export function regularBytes(path: string): Buffer | null {
  try {
    return lstatSync(path).isFile() ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

/** Whether `path` holds its own `.git` (a linked worktree's is a file): a worktree git lists but that is gone is not read. */
export function hasGit(path: string): boolean {
  try {
    lstatSync(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}
