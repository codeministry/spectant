/**
 * The read primitives the workspace reads go through: a file's text or raw bytes, null when it does not exist; a
 * regular file's bytes, never through a symbolic link; whether a folder holds its own `.git`; the `*.md` files of a
 * folder; a file's modification time. Read-only (ISC-15): no write, no temp file, no lock.
 */
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { existsNoFollow } from "./exists.ts";

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
  return existsNoFollow(join(path, ".git"));
}

/**
 * Every regular `*.md` file directly in `dir`, file name to text, in name order. A missing folder is an empty record;
 * any other read failure propagates.
 */
export function readMarkdownFiles(dir: string): Record<string, string> {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const files: Record<string, string> = {};
  for (const name of names.filter((n) => n.endsWith(".md")).sort()) {
    const path = join(dir, name);
    if (statSync(path).isFile()) files[name] = readFileSync(path, "utf8");
  }
  return files;
}

/** A file's modification time as an ISO string, or null when it cannot be read. */
export function mtimeIsoOf(path: string): string | null {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return null;
  }
}
