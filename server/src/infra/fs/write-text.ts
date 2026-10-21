/**
 * The plain file write outside every registered repository (`spectant export-notes <file>`, `notes/`): the file's
 * text replaced, created when missing. No fsync, no temp file; every failure propagates, so the caller decides what it
 * means.
 */
import { writeFileSync } from "node:fs";

/** Writes the text to the file, creating or truncating it; throws when it cannot be written. */
export function writeText(path: string, data: string): void {
  writeFileSync(path, data);
}
