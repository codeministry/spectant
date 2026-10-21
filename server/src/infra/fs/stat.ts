/**
 * The asynchronous file probes the library's reader, search and asset route go through (spec 017, `library/`): a
 * path's real form, its stats through its links or without them, and a file's text. Read-only: no write, no temp file,
 * no lock. Every failure propagates, so the caller decides what it means.
 */
import type { Stats } from "node:fs";
import { lstat, readFile, realpath, stat } from "node:fs/promises";

export type { Stats };

/** The path with every link resolved; rejects when it cannot be resolved. */
export function realPathOf(path: string): Promise<string> {
  return realpath(path);
}

/** The stats of what the path names, through its links; rejects when it cannot be read. */
export function statOf(path: string): Promise<Stats> {
  return stat(path);
}

/** The stats of the path itself, never through a link; rejects when it cannot be read. */
export function lstatOf(path: string): Promise<Stats> {
  return lstat(path);
}

/** The file's text as UTF-8; rejects when it cannot be read. */
export function readTextOf(path: string): Promise<string> {
  return readFile(path, "utf8");
}
