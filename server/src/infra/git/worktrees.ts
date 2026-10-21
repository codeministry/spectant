// The worktree reads: `worktree list --porcelain` (`worktreeList`) and `rev-list --count` (`aheadOfMain`), which
// never touch the index, take a lock or write an object; `ls-files` (`trackedSpecPaths`, `trackedPlanningPaths`),
// which reads the index and never writes it; `status --porcelain` (`dirty`, `changedPaths`), which reads the index and
// would write a refreshed one back under an optional lock: `GIT_OPTIONAL_LOCKS=0` turns that write off, as it covers
// any optional lock a future git might take; and `log` over named paths (`lastCommits`). `status` also runs with every
// filter driver's `clean` and `process` emptied and `required` off and with submodules ignored, so a page read starts
// no command the repository configures (spec 041, ISC-216.2).
import { hasGit } from "../fs/read.ts";
import type { UserEmailOptions } from "./refs.ts";
import {
  DEFAULT_TIMEOUT_MS,
  NO_FSMONITOR,
  defaultGitRunner,
  filterDrivers,
  gitEnv,
  hasOwnGit,
  isPlainBranchName,
  normalizeFolder,
  readWithin,
} from "./runner.ts";

// ── the worktrees (spec 027, T16, ISC-174, ISC-175) ──────────────────────────────────────────────────────────────

/**
 * The raw text of `git worktree list --porcelain` in `root`'s repository: the main checkout's record first, then every
 * linked worktree's in git's order, unparsed and untrimmed. `core/`'s `assignWorktrees` reads it and decides which
 * worktree belongs to which spec (FORMAT.md § Worktrees); the server only reads. One call, `worktree list`, which takes
 * no lock and writes nothing (a stale worktree is marked `prunable`, never pruned); no fetch, no network.
 * Never throws: no repository root, no git, a failure or the deadline answer the empty string, which
 * `assignWorktrees` reads as no worktrees.
 */
export async function worktreeList(root: string, options: UserEmailOptions = {}): Promise<string> {
  const runner = options.runner ?? defaultGitRunner;
  if (!hasGit(root)) return "";
  return readWithin(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "", async (signal) => {
    const run = await runner(["-C", root, "worktree", "list", "--porcelain"], gitEnv(root), signal);
    // No git (null), a non-zero exit and an aborted run all read as no listing; a partial text is never handed on.
    return run?.code === 0 && !signal.aborted ? run.stdout : "";
  });
}

/**
 * The paths git tracks under the spec folder `specs/<folder>` in the main checkout at `root`, read with
 * `ls-files -z -- specs/<folder>` and split on NUL: relative to the root, `/`-separated, unquoted. It is the answer
 * `core/`'s `specSourceOf` decides a spec's read source on (spec 027, T21, ISC-181; FORMAT.md § Worktrees). `ls-files`
 * reads the index and never writes it or takes a lock (`GIT_OPTIONAL_LOCKS=0` besides); the pathspec is literal. A
 * symbolic link on the way, `specs` or the folder, lists as the link itself or fails ("beyond a symbolic link"), never
 * as a path under the folder, so a linked `specs/` reads as untracked (ISC-181.1).
 * Never throws: a folder that is no single plain name, no repository root, no git, a non-zero exit and the deadline
 * answer the empty list, which `specSourceOf` reads as untracked.
 */
export async function trackedSpecPaths(root: string, folder: string, options: UserEmailOptions = {}): Promise<string[]> {
  if (folder.includes("/") || normalizeFolder(folder) === null) return [];
  const runner = options.runner ?? defaultGitRunner;
  if (!hasGit(root)) return [];
  return readWithin<string[]>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, [], async (signal) => {
    // `ls-files` asks a configured fsmonitor hook for changes as it reads the index (ISC-216.2): off for this read.
    const run = await runner(["-C", root, ...NO_FSMONITOR, "ls-files", "-z", "--", `specs/${folder}`], gitEnv(root), signal);
    // A partial listing is never handed on: a failed or killed run reads as untracked.
    if (run?.code !== 0 || signal.aborted) return [];
    return run.stdout.split("\0").filter((path) => path !== "");
  });
}

/**
 * The paths git tracks in the worktree at `worktreePath` (absolute) under the repository's planning files, `specs/` and
 * `ISA.md`, read inside that worktree with `ls-files -z -- specs/ ISA.md` and split on NUL: relative to the worktree,
 * `/`-separated, unquoted. Its own branch's index answers, so a spec folder committed only on that branch is listed
 * (spec 039, ISC-208.1, `core/`'s `worktreeOnlySpecs`), and so is each repository file that branch tracks (ISC-209). The
 * same read as `trackedSpecPaths`: the index read, never written, no lock, fsmonitor off; a linked `specs/` lists as
 * the link itself, never as a path under it (ISC-181.1).
 * Never throws: a path without its `.git` (the worktree is gone), no git, a non-zero exit and the deadline answer the
 * empty list.
 */
export async function trackedPlanningPaths(worktreePath: string, options: UserEmailOptions = {}): Promise<string[]> {
  if (!hasOwnGit(worktreePath)) return [];
  const runner = options.runner ?? defaultGitRunner;
  return readWithin<string[]>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, [], async (signal) => {
    const run = await runner(["-C", worktreePath, ...NO_FSMONITOR, "ls-files", "-z", "--", "specs/", "ISA.md"], gitEnv(worktreePath), signal);
    if (run?.code !== 0 || signal.aborted) return [];
    return run.stdout.split("\0").filter((path) => path !== "");
  });
}

/**
 * How many commits `branch` holds that `main` does not, read in the worktree at `worktreePath` (absolute) with
 * `rev-list --count main..<branch> --`: the worktree chip's distance to `main` (spec 027, T17, ISC-175). The base is
 * the local `main` by name, as ISC-175 names it; a repository without one answers null, so its chip shows no count.
 * `rev-list` reads refs and objects only: no index, no lock, no fetch, no network; the trailing `--` keeps a file of
 * the branch's name from turning the range into a pathspec.
 * Never throws: a detached worktree (`branch` null), a name that is no plain branch name (revision syntax, an option,
 * whitespace), a relative path and a path without its `.git` (the worktree is gone) answer null without spawning git;
 * no git, a non-zero exit (an unknown branch, a pruned gitdir), an output that is no count and the deadline answer null.
 */
export async function aheadOfMain(worktreePath: string, branch: string | null, options: UserEmailOptions = {}): Promise<number | null> {
  if (branch === null || !isPlainBranchName(branch) || !hasOwnGit(worktreePath)) return null;
  const runner = options.runner ?? defaultGitRunner;
  return readWithin<number | null>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
    const run = await runner(["-C", worktreePath, "rev-list", "--count", `main..${branch}`, "--"], gitEnv(worktreePath), signal);
    if (run?.code !== 0 || signal.aborted) return null;
    const count = run.stdout.trim();
    return /^\d+$/.test(count) ? Number(count) : null;
  });
}

/**
 * Whether the worktree at `worktreePath` (absolute) has uncommitted changes, read with `status --porcelain`: true when
 * git lists any change, a modified tracked file or an untracked one, false when it lists none (spec 027, T17,
 * ISC-175). Untracked files are read in git's `normal` mode, set explicitly so a `status.showUntrackedFiles` of `all`
 * in the user's config cannot make the read walk every untracked directory and one of `no` cannot hide a new file;
 * never `--untracked-files=all`. `GIT_OPTIONAL_LOCKS=0` keeps status from writing the refreshed index back, and
 * `core.fsmonitor=false` from asking a fsmonitor hook or starting a monitor daemon. A file whose stat data changed is
 * hashed again, which would run its clean filter: every driver the configuration names (`filterDrivers`, read first in
 * the worktree) runs with `clean` and `process` emptied and `required` off, so the bytes are compared as they are, and
 * an LFS-tracked file whose stat data changed may therefore read as dirty. `--ignore-submodules=all`: status would
 * otherwise run in each submodule under the submodule's own configuration, which no override here reaches; a changed
 * submodule alone reads as clean (spec 041, ISC-216.2). No cache: the index's mtime does not move when a file in the
 * tree is edited, so a cache keyed on it would keep answering false for a worktree an agent is writing in.
 * Never throws: a relative path or a path without its `.git` (the worktree is gone) answer null without spawning git;
 * no git, a non-zero exit (a pruned gitdir), a failed driver read or a driver name a `-c` cannot carry, and the
 * deadline answer null.
 */
export async function dirty(worktreePath: string, options: UserEmailOptions = {}): Promise<boolean | null> {
  const changed = await changedPaths(worktreePath, options);
  return changed === null ? null : changed.length > 0;
}

/**
 * The paths `git status --porcelain -z` lists in the worktree at `worktreePath` (absolute), the read `dirty` answers
 * from, under the same guards (no lock, fsmonitor off, filter drivers emptied, submodules ignored, untracked files in
 * `normal` mode): relative to the worktree, `/`-separated, unquoted; a rename's or copy's original path is left out, its
 * new path kept. With `pathspecs` only the paths below them (spec 039, ISC-209: which repository files carry an
 * uncommitted change, dated by their mtime). Never throws: as `dirty`, null where it answers null.
 */
export async function changedPaths(worktreePath: string, options: UserEmailOptions & { readonly pathspecs?: readonly string[] } = {}): Promise<string[] | null> {
  if (!hasOwnGit(worktreePath)) return null;
  const runner = options.runner ?? defaultGitRunner;
  return readWithin<string[] | null>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
    const env = gitEnv(worktreePath);
    // Read through a call each time: the flag turns true while a run is awaited, which a narrowed property would hide.
    const aborted = (): boolean => signal.aborted;
    const drivers = await filterDrivers(worktreePath, runner, env, signal);
    if (drivers === null || aborted()) return null;
    const args = [
      "-C",
      worktreePath,
      ...NO_FSMONITOR,
      ...drivers.flatMap((name) => ["-c", `filter.${name}.clean=`, "-c", `filter.${name}.process=`, "-c", `filter.${name}.required=false`]),
      "status",
      "--porcelain",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=all",
      ...(options.pathspecs === undefined ? [] : ["--", ...options.pathspecs]),
    ];
    const run = await runner(args, env, signal);
    // A failed or killed status may have printed part of a listing; only a complete one answers.
    if (run?.code !== 0 || aborted()) return null;
    return statusPaths(run.stdout);
  });
}

/**
 * The paths of `status --porcelain -z` output: entries `XY <path>` separated by NUL, where a rename or copy (`R` or
 * `C` in either column) is followed by one more entry, its original path, which is skipped.
 */
function statusPaths(stdout: string): string[] {
  const entries = stdout.split("\0");
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] ?? "";
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (/[RC]/u.test(entry.slice(0, 2))) i += 1;
  }
  return paths;
}

/**
 * When each path below `pathspecs` last changed in a commit on the branch checked out at `worktreePath` (absolute):
 * one `log --no-renames --format=%x01%cI --name-only -z -- <pathspecs>`, newest first, each path dated by the committer
 * date of the first commit that names it (spec 039, ISC-209). A merge names no path, so a merged file keeps the date of
 * the commit that changed it. `log` reads objects only: no index, no lock, no fetch, no network.
 * Never throws: a path without its `.git`, no git, a non-zero exit (a branch without commits included) and the deadline
 * answer an empty record.
 */
export async function lastCommits(worktreePath: string, pathspecs: readonly string[], options: UserEmailOptions = {}): Promise<Record<string, string>> {
  if (!hasOwnGit(worktreePath) || pathspecs.length === 0) return {};
  const runner = options.runner ?? defaultGitRunner;
  return readWithin<Record<string, string>>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, {}, async (signal) => {
    const args = ["-C", worktreePath, "--no-pager", "log", "--no-renames", "--format=%x01%cI", "--name-only", "-z", "--no-color", "--", ...pathspecs];
    const run = await runner(args, gitEnv(worktreePath), signal);
    if (run?.code !== 0 || signal.aborted) return {};
    const dates: Record<string, string> = {};
    let date: string | null = null;
    for (const raw of run.stdout.split("\0")) {
      const token = raw.startsWith("\n") ? raw.slice(1) : raw;
      if (token.startsWith("\u0001")) date = token.slice(1);
      else if (token !== "" && date !== null && dates[token] === undefined) dates[token] = date;
    }
    return dates;
  });
}
