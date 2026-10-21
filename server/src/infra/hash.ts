/**
 * The one raw sha256 of the server: lowercase hex over the exact bytes (a string is hashed as its UTF-8 bytes). It is
 * the hash the writes compare (tasks.md, spec.md, a story, the backlog, `.spectant/activity.jsonl`), the digest of a
 * repository file's read source, and, cut to 16 characters at its call site, an image's version.
 */
import { createHash } from "node:crypto";

/** sha256 hex of raw bytes: tasks.md's hash (`X-Spectant-Tasks-Hash`). */
export function rawSha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
