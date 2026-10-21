/**
 * The worktree tree id for the code-reviewed mark, computed in memory by `core/`'s `treeIdOf` over a file list from
 * `git ls-files`, which reads the index and never writes it or an object (`GIT_OPTIONAL_LOCKS=0` keeps even an
 * optional index refresh off). A folder that is no repository root, or a git that is missing or fails, is `null`,
 * which `core/` reads as "tree id unavailable".
 *
 * The `ls-files` child is spawned here with its own environment and without a deadline, unlike the calls through
 * `runner.ts`'s `defaultGitRunner`; it is kept as it was (spec 059, a recorded finding for later work).
 *
 * Read-only: `node:fs` reads, no write, no temp file, no lock.
 */
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import { type TreeEntry, type TreeEntryMode, treeIdOf } from "../../../../core/src/gates.ts";
import { StateMemo, repoStateOf } from "./repo-state.ts";

/**
 * The paths `git add -A` would stage: tracked and untracked, `.gitignore`, `info/exclude` and the global excludes applied.
 * `ls-files` runs the repository's fsmonitor hook, so it is switched off (spec 041, ISC-216.2).
 */
async function listedPaths(root: string): Promise<string[] | null> {
  const git = Bun.which("git", { PATH: process.env.PATH ?? "" });
  if (!git) return null;
  const child = Bun.spawn([git, "-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code !== 0) return null;
  // Unmerged paths list once per stage; an untracked nested repository lists as `dir/` and is no file.
  return [...new Set(stdout.split("\0"))].filter((path) => path !== "" && !path.endsWith("/"));
}

/** One listed path as git would store it, or null when it is gone from the worktree or is no file (a submodule). */
function entryFor(root: string, path: string): TreeEntry | null {
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; // deleted: `git add -A` drops it
    throw error;
  }
  let mode: TreeEntryMode;
  let bytes: Uint8Array;
  if (stat.isSymbolicLink()) {
    mode = "120000";
    bytes = readlinkSync(absolute, { encoding: "buffer" });
  } else if (stat.isFile()) {
    mode = (stat.mode & 0o100) !== 0 ? "100755" : "100644";
    bytes = readFileSync(absolute);
  } else {
    return null;
  }
  return { path, mode, bytes };
}

/**
 * The listed paths per checkout, kept while `repoStateOf` stands (ISC-215): the files are read and hashed afresh on every
 * call, only the list is kept, so an edit to a listed file always shows; a new untracked file shows once the state moves.
 */
const LISTED_PATHS = new StateMemo<string[] | null>();

/**
 * The git tree id of the worktree at `root`, as `git add -A && git write-tree` would print it, computed in memory.
 * Null when `root` is not a repository root, git is missing or fails, or a file cannot be read. Clean filters
 * (`core.autocrlf`, LFS) and submodules are not applied, so such a repository reads as changed, never as reviewed.
 */
export async function worktreeTreeId(root: string): Promise<string | null> {
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return null;
  }
  try {
    const paths = await LISTED_PATHS.get(root, repoStateOf(root), () => listedPaths(root));
    if (paths === null) return null;
    return treeIdOf(paths.flatMap((path) => entryFor(root, path) ?? []));
  } catch {
    return null;
  }
}
