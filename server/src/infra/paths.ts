import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * The data directory (ISC-21): `$XDG_DATA_HOME/spectant` when that variable is set and non-empty,
 * otherwise `~/.spectant`. It holds only the registry and settings database (ISC-7).
 *
 * These helpers are the only place an absolute path is resolved; callers must never print it or
 * return it over the API (ISC-3).
 */
export function dataDir(env: Record<string, string | undefined> = process.env, home = homedir()): string {
  const xdg = env.XDG_DATA_HOME;
  return xdg ? join(xdg, "spectant") : join(home, ".spectant");
}

/** The SQLite database file inside the data directory. */
export function dbPath(dir = dataDir()): string {
  return join(dir, "spectant.db");
}

/** Creates the data directory with `mkdir -p` semantics, owner-only (0700), and returns its path. */
export function ensureDataDir(dir = dataDir()): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode is filtered by the umask and ignored for an existing directory; set it explicitly.
  chmodSync(dir, 0o700);
  return dir;
}
