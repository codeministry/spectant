/**
 * The git state of a checkout read from the file system alone, without a git process (spec 041, ISC-215): the key of
 * every process-level cache over git reads, so a poll, a spec route, a library document or a search keystroke starts
 * no git process while nothing moved.
 *
 * `repoStateOf(checkout)` resolves the checkout's git directory (`.git` itself, or the `gitdir:` a linked worktree's
 * `.git` file names) and its common directory (`commondir`), and joins into one string:
 *
 * - the checkout's `HEAD` text and the mtime and size of its index (a commit, a checkout, a stage);
 * - `packed-refs` and every entry under `refs/heads/` with its mtime and size (a branch moved, added or deleted; a ref
 *   update renames a new file into place, so its stat changes);
 * - `config`, `config.worktree` and `info/exclude` (filter drivers, the address, the excludes `ls-files` applies), and
 *   the global config files (`~/.gitconfig`, `$XDG_CONFIG_HOME/git/config`);
 * - per linked worktree under `worktrees/`: its `HEAD` text, its index, its `gitdir` text, whether that folder still
 *   holds its `.git` and whether it is `locked` (a worktree added, removed, moved or deleted by hand).
 *
 * What the key does not see: an edit to a tracked file that touches no index (the dirty mark and the listed paths of the
 * tree id keep the last read until `HEAD`, a ref or an index moves; file contents are hashed afresh on every read) and
 * a `.gitignore` edit below the root. Null when the checkout holds no `.git`.
 *
 * Read-only: `lstat`, `stat`, `readdir` and small reads, nothing written, no lock.
 */
import { lstatSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { existsNoFollow } from "../fs/exists.ts";

const statOf = (path: string): string => {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}:${s.ino}`;
  } catch {
    return "-";
  }
};

const textOf = (path: string): string => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "-";
  }
};

/** Every entry below `dir`, depth first in name order, each with its stat; `-` for a folder that is not there. */
function walk(dir: string, out: string[]): void {
  let names: string[];
  try {
    names = readdirSync(dir).sort();
  } catch {
    out.push(`${dir}:-`);
    return;
  }
  for (const name of names) {
    const path = join(dir, name);
    let isDir = false;
    try {
      isDir = lstatSync(path).isDirectory();
    } catch {
      continue;
    }
    out.push(`${name}:${statOf(path)}`);
    if (isDir) walk(path, out);
  }
}

/** The git directory of `checkout`: `.git` when it is a folder, else the `gitdir:` its `.git` file names; null without. */
function gitDirOf(checkout: string): string | null {
  const dotGit = join(checkout, ".git");
  try {
    if (lstatSync(dotGit).isDirectory()) return dotGit;
  } catch {
    return null;
  }
  const pointer = /^gitdir:\s*(.+)$/m.exec(textOf(dotGit))?.[1]?.trim();
  if (pointer === undefined) return null;
  return isAbsolute(pointer) ? pointer : join(checkout, pointer);
}

/** The common directory of a git directory: the one its `commondir` file names (a linked worktree's), else itself. */
function commonDirOf(gitDir: string): string {
  const common = textOf(join(gitDir, "commondir"));
  if (common === "-") return gitDir;
  return isAbsolute(common) ? common : join(gitDir, common);
}

/** The state key of the checkout at `checkout` (see the header); null when it holds no `.git`. */
export function repoStateOf(checkout: string): string | null {
  const gitDir = gitDirOf(checkout);
  if (gitDir === null) return null;
  const common = commonDirOf(gitDir);
  const parts = [
    gitDir,
    textOf(join(gitDir, "HEAD")),
    statOf(join(gitDir, "index")),
    statOf(join(gitDir, "config.worktree")),
    statOf(join(common, "packed-refs")),
    statOf(join(common, "config")),
    statOf(join(common, "info", "exclude")),
    statOf(join(homedir(), ".gitconfig")),
    statOf(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "git", "config")),
  ];
  walk(join(common, "refs", "heads"), parts);
  const worktrees = join(common, "worktrees");
  let names: string[] = [];
  try {
    names = readdirSync(worktrees).sort();
  } catch {
    // no linked worktree
  }
  for (const name of names) {
    const dir = join(worktrees, name);
    const target = textOf(join(dir, "gitdir"));
    const folder = target === "-" ? null : dirname(target);
    parts.push(
      name,
      textOf(join(dir, "HEAD")),
      statOf(join(dir, "index")),
      target,
      folder !== null && existsNoFollow(join(folder, ".git")) ? "present" : "gone",
      existsNoFollow(join(dir, "locked")) ? "locked" : "",
    );
  }
  return parts.join("\0");
}

/**
 * One value per key, valid while the state it was read under stands; bounded, the oldest key leaves first. The value
 * is a promise, so readers that start together share one read.
 */
export class StateMemo<T> {
  readonly #entries = new Map<string, { readonly state: string; readonly value: Promise<T> }>();

  constructor(readonly max = 64) {}

  /** The value read under `state` for `key`, or `read()` stored for it; `state` null reads afresh and keeps nothing. */
  get(key: string, state: string | null, read: () => Promise<T>): Promise<T> {
    if (state === null) return read();
    const entry = this.#entries.get(key);
    if (entry?.state === state) return entry.value;
    const value = read();
    this.#entries.delete(key);
    this.#entries.set(key, { state, value });
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
    // A failed read is not kept: the next caller reads again.
    value.catch(() => {
      if (this.#entries.get(key)?.value === value) this.#entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.#entries.clear();
  }
}
