/**
 * The file primitives of the app's own data folder, never a registered repository (the workspace images,
 * `workspace-admin/`): a path's stats without following a link, a file's bytes, a folder tree created, a new file
 * written exclusively, and a file or tree removed without following a link. Every failure propagates, so the caller
 * decides what it means.
 */
import { type Stats, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

export type { Stats } from "node:fs";

/** The stats of the path itself, never through a link; throws when it cannot be read. */
export function lstatPath(path: string): Stats {
  return lstatSync(path);
}

/** The file's bytes; throws when it cannot be read. */
export function readBytes(path: string): Buffer {
  return readFileSync(path);
}

/** Creates the folder with every missing parent under `mode`; an existing folder is left as it is. */
export function makeDirs(path: string, mode: number): void {
  mkdirSync(path, { recursive: true, mode });
}

/** Writes `bytes` as a new file under `mode`; throws when anything already has the name, so it never follows a link. */
export function writeNewFile(path: string, bytes: Uint8Array, mode: number): void {
  writeFileSync(path, bytes, { flag: "wx", mode });
}

/** Removes one entry (a link itself, never its target); nothing when it is missing. */
export function removeIfPresent(path: string): void {
  rmSync(path, { force: true });
}

/** Removes a folder with everything in it, never following a link inside it; nothing when it is missing. */
export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true });
}
