/**
 * The folder listings and plain reads outside a workspace (the token measurement's transcript folders, `tokens/`): a
 * folder's entries with their types, a file's text, a path's real form and whether a path is a folder. Read-only: no
 * write, no temp file, no lock. Every failure but `isDirectory`'s propagates, so the caller decides what it means.
 */
import { type Dirent, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";

export type { Dirent } from "node:fs";

/** The folder's entries with their types, in the order `readdir` returns them; throws when it cannot be listed. */
export function listEntries(dir: string): Dirent[] {
  return readdirSync(dir, { withFileTypes: true });
}

/** The file's text as UTF-8; throws when it cannot be read. */
export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** The path with every link resolved; throws when it does not exist. */
export function realPath(path: string): string {
  return realpathSync(path);
}

/** Whether the path names a folder (through a link); false when it is anything else or cannot be read. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
