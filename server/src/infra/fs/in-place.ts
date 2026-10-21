/**
 * The in-place primitives every write path writes through (`writes.ts`, `feature-gate.ts`, `tokens-cli.ts`): the
 * target is written in place, open, write, fsync, close. No temp file, no rename, no git object. A created or removed
 * directory entry is made durable with `fsyncDir`.
 */
import { closeSync, fsyncSync, lstatSync, openSync, writeSync } from "node:fs";

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

/** Whether anything (a file, a folder, a link) already has this name; never follows a link. */
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
