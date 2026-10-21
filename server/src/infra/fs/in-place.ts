/**
 * The in-place primitives every write path writes through (`writes/`, `feature-gate.ts`, `tokens-cli.ts`): the
 * target is written in place, open, write, fsync, close. No temp file, no rename, no git object. A created or removed
 * directory entry is made durable with `fsyncDir`.
 */
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, unlinkSync, writeSync } from "node:fs";

function writeAll(fd: number, data: string | Uint8Array): void {
  const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  fsyncSync(fd);
}

/** Replaces the file's bytes in place (same inode, same mode) and fsyncs it; creates it when missing. */
export function writeInPlace(path: string, data: string | Uint8Array): void {
  const fd = openSync(path, "w");
  try {
    writeAll(fd, data);
  } finally {
    closeSync(fd);
  }
}

/** Appends to the file in place and fsyncs it; creates it when missing. */
export function appendInPlace(path: string, data: string): void {
  const fd = openSync(path, "a");
  try {
    writeAll(fd, data);
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether anything (a file, a folder, a link) already has this name; never follows a link. Unlike `existsNoFollow`
 * (`exists.ts`) any failure but ENOENT throws, so a write never takes an unreadable name for a free one.
 */
export function pathTaken(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** fsyncs a directory, so a created or removed entry in it is durable as well. */
export function fsyncDir(dir: string): void {
  const fd = openSync(dir, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Creates one directory, never a parent; throws when anything already has the name. */
export function createDir(path: string): void {
  mkdirSync(path);
}

/** Creates one directory when missing, never a parent; an existing entry of that name is left as it is. */
export function ensureDir(path: string): void {
  try {
    mkdirSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/** Removes one file (unlink); throws when it is missing. */
export function removeFile(path: string): void {
  unlinkSync(path);
}
