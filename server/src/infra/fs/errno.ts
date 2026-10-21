/**
 * An unreadable workspace (gone, not a directory, no permission) as a stable `UnreadableCode`, never the OS message,
 * which would carry the absolute path (ISC-3). `Unreadable` carries a code up as a throw; `codeOf` maps it, or an
 * errno, to the code.
 */
import { readdirSync, statSync } from "node:fs";
import type { UnreadableCode } from "../../contracts/spec-routes.contract.ts";

/** A read failure, carried up to the workspace as its code. */
export class Unreadable extends Error {
  constructor(readonly code: UnreadableCode) {
    super(code);
  }
}

export function codeOf(error: unknown): UnreadableCode {
  if (error instanceof Unreadable) return error.code;
  switch ((error as NodeJS.ErrnoException | null)?.code) {
    case "ENOENT":
      return "missing";
    case "ENOTDIR":
      return "not-a-directory";
    case "EACCES":
    case "EPERM":
      return "permission-denied";
    default:
      return "unreadable";
  }
}

/** The code of a workspace that cannot be read at `root`, or null when it is a readable directory. */
export function workspaceUnreadable(root: string): UnreadableCode | null {
  try {
    if (!statSync(root).isDirectory()) return "not-a-directory";
    readdirSync(root);
    return null;
  } catch (error) {
    return codeOf(error);
  }
}

/** The stable code of a read failure (ENOENT, EACCES, …), never the OS message, which names the path (ISC-3). */
export function unreadableCode(error: unknown): UnreadableCode {
  return codeOf(error);
}
