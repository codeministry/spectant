// The timeline's commit source (T46, ISC-80): the commits touching a spec folder, read with `git log` and nothing else
// that could write (ISC-15). `core/` runs no subprocess; the server reads here and passes the records in.
//
// Read-only by construction: only `rev-parse`, `log`, `config --get` (the identity, `userEmail`) and `for-each-ref`
// (the branch names, `takenSpecNumbers`) and `worktree list --porcelain` (the worktrees, `worktreeList`) and
// `rev-list --count` (a branch's distance to `main`, `aheadOfMain`) and `rev-list --first-parent` plus
// `merge-base --is-ancestor` (whether a merge brought a spec branch into `main`, `mergedSpecBranches`) run, all of which never touch the index, never take
// a lock and never write an object, plus `ls-files` (the tracked paths of a spec folder, `trackedSpecPaths`), which
// reads the index and never writes it, plus `status --porcelain` (a worktree's uncommitted changes, `dirty`), which reads
// the index and would write a refreshed one back under an optional lock: `GIT_OPTIONAL_LOCKS=0` turns that write off,
// as it covers any optional lock a future git might take, and `core.fsmonitor=false` keeps status from starting a
// monitor daemon that would leave its socket in `.git/`. No command fetches or reaches the network. The inherited
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped so the environment cannot redirect the read, pathspecs
// are literal, and discovery stops at the root: a directory without its own `.git` is not read, even inside a repository.
//
// Bounded: at most `limit` commits, one deadline for the whole call (the child is killed, the call answers `none`),
// and a cache keyed by root and folder that skips `git log` while `HEAD` is unchanged.
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { specNumbersOf } from "../../core/src/allocate.ts";
import { SPEC_FOLDER } from "../../core/src/spec-ref.ts";
import type { CommitRecord } from "../../core/src/files.ts";

/** A commit record, plus the touched paths inside the folder when `files` was asked for. */
export interface GitCommit extends CommitRecord {
  readonly files?: readonly string[];
}

export interface CommitsResult {
  readonly commits: readonly GitCommit[];
  /** `HEAD` of the repository, the cache key's freshness and the ETag's input; null without a repository or commit. */
  readonly head: string | null;
  /** `git` when git answered (even with no commit), `none` when there was nothing to read or the read failed. */
  readonly source: "git" | "none";
  /** Why the source is `none`, for the server log; never shown as data. */
  readonly diagnostic?: string;
}

export interface GitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git with `args` under `env`, killing it when `signal` aborts; resolves null when git is not installed. */
export type GitRunner = (args: readonly string[], env: Record<string, string>, signal: AbortSignal) => Promise<GitRun | null>;

export interface CommitsOptions {
  /** Newest commits kept (default 200). */
  readonly limit?: number;
  /** Deadline for the whole call in milliseconds (default 3000). */
  readonly timeoutMs?: number;
  /** Adds the touched paths inside the folder (`--name-only`); off by default, the timeline needs none. */
  readonly files?: boolean;
  readonly cache?: CommitCache;
  /** Injected for tests; the default spawns the `git` on PATH. */
  readonly runner?: GitRunner;
}

export const DEFAULT_LIMIT = 200;
export const DEFAULT_TIMEOUT_MS = 3000;

// ── the cache ────────────────────────────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  readonly head: string;
  readonly limit: number;
  readonly files: boolean;
  readonly commits: readonly GitCommit[];
}

/** The last read per `<root>\0<folder>`, valid while `HEAD` is unchanged; bounded, the oldest key leaves first. */
export class CommitCache {
  readonly #entries = new Map<string, CacheEntry>();

  constructor(readonly max = 256) {}

  get size(): number {
    return this.#entries.size;
  }

  has(root: string, folder: string): boolean {
    return this.#entries.has(cacheKey(root, normalizeFolder(folder) ?? folder));
  }

  /** @internal */
  lookup(key: string): CacheEntry | undefined {
    return this.#entries.get(key);
  }

  /** @internal */
  store(key: string, entry: CacheEntry): void {
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }
}

const cacheKey = (root: string, folder: string): string => `${root}\0${folder}`;

// ── the runner ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Spawns the `git` on PATH; stdin closed, no pager, killed on abort. */
export const defaultGitRunner: GitRunner = async (args, env, signal) => {
  const git = Bun.which("git", { PATH: env.PATH ?? "" });
  if (git === null) return null;
  const child = Bun.spawn([git, ...args], { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const kill = (): void => {
    child.kill("SIGKILL");
  };
  if (signal.aborted) kill();
  else signal.addEventListener("abort", kill, { once: true });
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { code, stdout, stderr };
  } finally {
    signal.removeEventListener("abort", kill);
  }
};

/** The environment every git call runs under: the caller's, minus redirections, plus the read-only switches. */
function gitEnv(root: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    Reflect.deleteProperty(env, key);
  }
  return {
    ...env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    LC_ALL: "C",
    GIT_LITERAL_PATHSPECS: "1",
    GIT_CEILING_DIRECTORIES: dirname(root),
  };
}

// ── the read ─────────────────────────────────────────────────────────────────────────────────────────────────────

const RECORD = "\x1e";
const FIELD = "\x1f";
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The folder as a clean relative path without a trailing slash, or null when it is empty, absolute, escapes or starts with `-`/`:`. */
function normalizeFolder(folder: string): string | null {
  const trimmed = folder.replace(/\/+$/, "");
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.startsWith("-") || trimmed.startsWith(":")) return null;
  if (trimmed.includes("\0") || trimmed.includes("\\")) return null;
  const segments = trimmed.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return trimmed;
}

function none(diagnostic: string, head: string | null = null): CommitsResult {
  return { commits: [], head, source: "none", diagnostic };
}

const firstLine = (text: string): string => text.trim().split("\n", 1)[0] ?? "";

/** Parses `\x1e<sha>\x1f<author date>\x1f<subject>` records, each followed by its paths when `--name-only` ran. */
export function parseLog(stdout: string, withFiles: boolean): GitCommit[] {
  const commits: GitCommit[] = [];
  for (const record of stdout.split(RECORD)) {
    if (record === "") continue;
    const [header = "", ...rest] = record.split("\n");
    const [sha = "", ts = "", ...subject] = header.split(FIELD);
    if (!SHA.test(sha) || Number.isNaN(Date.parse(ts))) continue;
    const base = { sha, ts, subject: subject.join(FIELD) };
    commits.push(withFiles ? { ...base, files: rest.filter((line) => line !== "") } : base);
  }
  return commits;
}

/**
 * The commits touching `folder` (relative to `root`) in `root`'s repository, newest first, at most `limit`, read-only.
 * Never throws: no repository, no git, a failure or the deadline answer `source: 'none'` with a diagnostic.
 */
export async function commitsFor(root: string, folder: string, options: CommitsOptions = {}): Promise<CommitsResult> {
  const limit = Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const withFiles = options.files === true;
  const runner = options.runner ?? defaultGitRunner;

  const rel = normalizeFolder(folder);
  if (rel === null) return none("folder is not a relative path inside the repository");
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return none("not a git repository root");
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<CommitsResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(none(`git timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([read(root, rel, { limit, withFiles, runner, cache: options.cache }, controller.signal), deadline]);
  } catch (error) {
    return none(`git read failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ── the identity (T77, ISC-119) ──────────────────────────────────────────────────────────────────────────────────

export interface UserEmailOptions {
  /** Deadline in milliseconds (default 3000). */
  readonly timeoutMs?: number;
  /** Injected for tests; the default spawns the `git` on PATH. */
  readonly runner?: GitRunner;
}

/**
 * The `user.email` git would commit with in `root`'s repository (its own config, then the global one; the system
 * config is off as for every read here), trimmed, for `core/`'s `actorIdOf`. Runs only `config --get`, which reads
 * and never writes. Never throws: no repository root, no git, no address, a failure or the deadline answer null.
 */
export async function userEmail(root: string, options: UserEmailOptions = {}): Promise<string | null> {
  const runner = options.runner ?? defaultGitRunner;
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return null;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  });
  const read = async (): Promise<string | null> => {
    const run = await runner(["-C", root, "config", "--get", "user.email"], gitEnv(root), controller.signal);
    // No git (null), exit 1 ("not set") and any other failure all read as no address.
    if (run?.code !== 0 || controller.signal.aborted) return null;
    const address = run.stdout.trim();
    return address === "" ? null : address;
  };
  try {
    return await Promise.race([read(), deadline]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ── the numbers given out (T86, ISC-130.2) ───────────────────────────────────────────────────────────────────────

export interface TakenNumbers {
  /** Every spec number a ref name or the history names, ascending, each once; empty when `source` is `none`. */
  readonly numbers: readonly number[];
  /** `git` when both reads answered (even with nothing found), `none` when there was nothing to read or a read failed. */
  readonly source: "git" | "none";
  /** Why the source is `none`, for the server log; never shown as data. */
  readonly diagnostic?: string;
}

/**
 * The numbers branch names and history have given out in `root`'s repository, for `core/`'s `nextSpecNumber` beside
 * the folders on disk (FORMAT.md § idea, Allocation). Two reads, both read-only:
 *
 * - `for-each-ref --format=%(refname) refs/heads/ refs/remotes/`: every local and remote-tracking ref; a path segment
 *   of the `NNN-slug` folder shape (`feature/012-tide-tables`) takes its number. The plumbing form of `branch --list`.
 * - `log --all --no-renames --diff-filter=A --name-only --format= -- specs`: every path ever added below `specs/` on
 *   any ref; the folder segment of `specs/NNN-slug/…` and `specs/archive/NNN-slug/…` takes its number, so a spec
 *   deleted or moved since still holds it. `--no-renames` makes an archive move an addition too.
 *
 * Folder segments are read by core's `specNumbersOf`, the one definition of the shape. Never throws: no repository
 * root, no git, a failure or the deadline answer `source: 'none'` with no number; the folders on disk still count.
 */
export async function takenSpecNumbers(root: string, options: UserEmailOptions = {}): Promise<TakenNumbers> {
  const runner = options.runner ?? defaultGitRunner;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nothing = (diagnostic: string): TakenNumbers => ({ numbers: [], source: "none", diagnostic });
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return nothing("not a git repository root");
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<TakenNumbers>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(nothing(`git timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const read = async (): Promise<TakenNumbers> => {
    const env = gitEnv(root);
    const refs = await runner(["-C", root, "for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/"], env, controller.signal);
    if (refs === null) return nothing("git not found on PATH");
    if (refs.code !== 0) return nothing(`git for-each-ref exited ${refs.code}: ${firstLine(refs.stderr)}`);
    const log = await runner(
      ["-C", root, "--no-pager", "log", "--all", "--no-renames", "--diff-filter=A", "--name-only", "--format=", "--no-color", "--no-ext-diff", "--no-textconv", "--", "specs"],
      env,
      controller.signal,
    );
    if (log === null) return nothing("git not found on PATH");
    if (log.code !== 0) return nothing(`git log exited ${log.code}: ${firstLine(log.stderr)}`);
    const fromRefs = refs.stdout.split("\n").flatMap((name) => specNumbersOf(name.trim().split("/")));
    const fromPaths = log.stdout.split("\n").flatMap((line) => {
      const [top, first, second] = line.trim().split("/");
      if (top !== "specs" || first === undefined) return [];
      return specNumbersOf([first === "archive" ? (second ?? "") : first]);
    });
    return { numbers: [...new Set([...fromRefs, ...fromPaths])].sort((a, b) => a - b), source: "git" };
  };
  try {
    return await Promise.race([read(), deadline]);
  } catch (error) {
    return nothing(`git read failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

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
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return "";
  }
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
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return [];
  }
  return readWithin<string[]>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, [], async (signal) => {
    const run = await runner(["-C", root, "ls-files", "-z", "--", `specs/${folder}`], gitEnv(root), signal);
    // A partial listing is never handed on: a failed or killed run reads as untracked.
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
 * `core.fsmonitor=false` from starting a monitor daemon. No cache: the index's mtime does not move when a file in the
 * tree is edited, so a cache keyed on it would keep answering false for a worktree an agent is writing in.
 * Never throws: a relative path or a path without its `.git` (the worktree is gone) answer null without spawning git;
 * no git, a non-zero exit (a pruned gitdir) and the deadline answer null.
 */
export async function dirty(worktreePath: string, options: UserEmailOptions = {}): Promise<boolean | null> {
  if (!hasOwnGit(worktreePath)) return null;
  const runner = options.runner ?? defaultGitRunner;
  return readWithin<boolean | null>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
    const args = ["-C", worktreePath, "-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=normal"];
    const run = await runner(args, gitEnv(worktreePath), signal);
    // A failed or killed status may have printed part of a listing; only a complete one answers.
    if (run?.code !== 0 || signal.aborted) return null;
    return run.stdout.trim() !== "";
  });
}

/** An absolute path with its own `.git` (a linked worktree's is a file): the root rule of the worktree reads. */
function hasOwnGit(path: string): boolean {
  if (!isAbsolute(path)) return false;
  try {
    lstatSync(join(path, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Revision syntax, whitespace and control characters: what a plain branch name never holds (git-check-ref-format). */
const NOT_IN_BRANCH = /\.\.|@\{|[\s~^:?*[\\]|\p{Cc}/u;

/** A name git could take as one branch and nothing else: not empty, no option, no revision syntax. */
const isPlainBranchName = (name: string): boolean => name !== "" && !name.startsWith("-") && !NOT_IN_BRANCH.test(name);

/**
 * `read` under one deadline: `fallback` when the deadline passes first (the signal aborts, which kills the child) or
 * when `read` throws. The bound the worktree reads share.
 */
async function readWithin<T>(timeoutMs: number, fallback: T, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(fallback);
    }, timeoutMs);
  });
  try {
    return await Promise.race([read(controller.signal), deadline]);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

interface ReadPlan {
  readonly limit: number;
  readonly withFiles: boolean;
  readonly runner: GitRunner;
  readonly cache: CommitCache | undefined;
}

async function read(root: string, rel: string, plan: ReadPlan, signal: AbortSignal): Promise<CommitsResult> {
  const env = gitEnv(root);
  const headRun = await plan.runner(["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"], env, signal);
  if (headRun === null) return none("git not found on PATH");
  if (signal.aborted) return none("aborted");
  if (headRun.code === 1) return { commits: [], head: null, source: "git" }; // a repository without a commit
  if (headRun.code !== 0) return none(`git rev-parse exited ${headRun.code}: ${firstLine(headRun.stderr)}`);
  const head = headRun.stdout.trim();

  const key = cacheKey(root, rel);
  const cached = plan.cache?.lookup(key);
  if (cached?.head === head && cached.limit === plan.limit && cached.files === plan.withFiles) {
    return { commits: cached.commits, head, source: "git" };
  }

  const args = [
    "-C",
    root,
    "--no-pager",
    "log",
    "--no-decorate",
    "--no-color",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--date=iso-strict",
    `--format=${RECORD}%H${FIELD}%aI${FIELD}%s`,
    `-n${plan.limit}`,
    ...(plan.withFiles ? ["--name-only"] : []),
    "--",
    rel,
  ];
  const logRun = await plan.runner(args, env, signal);
  if (logRun === null) return none("git not found on PATH", head);
  // After a deadline the race has already answered; a killed `log` exits non-zero and is never cached.
  if (logRun.code !== 0) return none(`git log exited ${logRun.code}: ${firstLine(logRun.stderr)}`, head);

  const commits = parseLog(logRun.stdout, plan.withFiles);
  plan.cache?.store(key, { head, limit: plan.limit, files: plan.withFiles, commits });
  return { commits, head, source: "git" };
}

// ── the merge state (spec 025, T9, ISC-162.1) ────────────────────────────────────────────────────────────────────

/** The branch kinds a spec's branch carries before its `NNN-slug` folder name (ISC-162.1). */
export const SPEC_BRANCH_PREFIXES: readonly string[] = ["feature", "fix", "spike", "infra"];

/** One local spec branch and whether `main` holds it. */
export interface SpecBranch {
  /** The spec number, `NNN`, from the branch's folder segment. */
  readonly spec: string;
  /** The branch name without `refs/heads/`, e.g. `feature/012-tide-tables`. */
  readonly branch: string;
  /** The branch's tip is an ancestor of `main`'s (or is `main`'s tip); false when the repository has no `main`. */
  readonly merged: boolean;
}

export interface SpecBranches {
  /** Every local spec branch, by branch name; empty when `source` is `none`. */
  readonly branches: readonly SpecBranch[];
  /** `git` when the reads answered (even with no spec branch), `none` when there was nothing to read or a read failed. */
  readonly source: "git" | "none";
  /** Why the source is `none`, or that the repository has no `main`; for the server log, never shown as data. */
  readonly diagnostic?: string;
}

/**
 * The last answer per repository root, valid while `main`'s tip and every spec branch's name and tip are unchanged:
 * the key is that ref state, so the dashboard poll runs one `for-each-ref` and no `merge-base` while nothing moved.
 * Bounded, the oldest root leaves first.
 */
export class MergeCache {
  readonly #entries = new Map<string, { readonly key: string; readonly result: SpecBranches }>();

  constructor(readonly max = 64) {}

  get size(): number {
    return this.#entries.size;
  }

  /** @internal */
  lookup(root: string, key: string): SpecBranches | undefined {
    const entry = this.#entries.get(root);
    return entry?.key === key ? entry.result : undefined;
  }

  /** @internal */
  store(root: string, key: string, result: SpecBranches): void {
    this.#entries.delete(root);
    this.#entries.set(root, { key, result });
    while (this.#entries.size > this.max) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }
}

/** The process's cache, which the dashboard reads go through unless a caller passes its own. */
const MERGE_CACHE = new MergeCache();

export interface MergedBranchesOptions extends UserEmailOptions {
  readonly cache?: MergeCache;
}

const MAIN_REF = "refs/heads/main";

/** `refs/heads/<prefix>/NNN-slug` → the branch name and its number; null for any other ref. */
function specBranchOf(refname: string): { branch: string; spec: string } | null {
  const [refs, heads, prefix = "", folder = "", ...rest] = refname.split("/");
  if (refs !== "refs" || heads !== "heads" || rest.length > 0 || !SPEC_BRANCH_PREFIXES.includes(prefix)) return null;
  const spec = SPEC_FOLDER.exec(folder)?.[1];
  return spec === undefined ? null : { branch: `${prefix}/${folder}`, spec };
}

/**
 * The local spec branches of `root`'s repository and whether a merge brought each into `main` (ISC-162.1): every ref
 * `refs/heads/<feature|fix|spike|infra>/NNN-slug` (the folder segment in core's `SPEC_FOLDER` shape), read with
 * `for-each-ref --format=%(objectname) %(refname) refs/heads/`. A branch is merged when its tip is an ancestor of
 * `main` and does not lie on `main`'s first-parent line. `rev-list --first-parent <main> --` reads that line once; a
 * tip on it (a branch fresh from `main`, at an older `main` commit, or fast-forwarded into it) is not merged without a
 * further read, and for every other tip `merge-base --is-ancestor <tip> <main>` on the two object ids decides (exit 0
 * merged, 1 not). A fast-forwarded branch therefore reads as unmerged while it exists; once deleted, `core/` falls back
 * to `phase: complete`. Only local branches count: remote-tracking refs are as old as the last fetch, and no fetch
 * runs. The base is the local `main` by name, as `aheadOfMain` reads it; a repository without one answers every branch
 * unmerged. All three commands read refs and objects only: no index, no lock (`GIT_OPTIONAL_LOCKS=0` besides), no
 * object written, no network.
 *
 * Cached per root on `main`'s tip and the spec branches' names and tips: a branch commit, a merge into `main`, a new
 * or a deleted spec branch each change the key. Never throws: no repository root, no git, a failure or the deadline
 * answer `source: 'none'` with no branch (never cached), which the loader reads as "no branch", so `core/` falls back
 * to `phase: complete` and the archive.
 */
export async function mergedSpecBranches(root: string, options: MergedBranchesOptions = {}): Promise<SpecBranches> {
  const runner = options.runner ?? defaultGitRunner;
  const cache = options.cache ?? MERGE_CACHE;
  const nothing = (diagnostic: string): SpecBranches => ({ branches: [], source: "none", diagnostic });
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return nothing("not a git repository root");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return readWithin(timeoutMs, nothing(`git timed out after ${timeoutMs} ms`), async (signal) => {
    const env = gitEnv(root);
    const refs = await runner(["-C", root, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/"], env, signal);
    if (refs === null) return nothing("git not found on PATH");
    // Read through a call each time: the flag turns true while a run is awaited, which a narrowed property would hide.
    const aborted = (): boolean => signal.aborted;
    if (refs.code !== 0 || aborted()) return nothing(`git for-each-ref exited ${refs.code}: ${firstLine(refs.stderr)}`);
    let main: string | null = null;
    const tips: Array<{ branch: string; spec: string; sha: string }> = [];
    for (const line of refs.stdout.split("\n")) {
      const [sha = "", refname = ""] = line.trim().split(" ");
      if (!SHA.test(sha)) continue;
      if (refname === MAIN_REF) main = sha;
      const shape = specBranchOf(refname);
      if (shape !== null) tips.push({ ...shape, sha });
    }
    tips.sort((a, b) => (a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0));
    const key = [main ?? "-", ...tips.map((t) => `${t.sha} ${t.branch}`)].join("\n");
    const cached = cache.lookup(root, key);
    if (cached !== undefined) return cached;

    // `main`'s first-parent line, read once per key and only when there is a spec branch to judge.
    const firstParent = new Set<string>();
    if (main !== null && tips.length > 0) {
      const line = await runner(["-C", root, "rev-list", "--first-parent", main, "--"], env, signal);
      if (line === null) return nothing("git not found on PATH");
      if (line.code !== 0 || aborted()) return nothing(`git rev-list exited ${line.code}: ${firstLine(line.stderr)}`);
      for (const sha of line.stdout.split("\n")) if (SHA.test(sha)) firstParent.add(sha);
    }

    const branches: SpecBranch[] = [];
    for (const tip of tips) {
      // No main, or a tip on its first-parent line (main's own tip included): no merge brought the branch in.
      if (main === null || firstParent.has(tip.sha)) {
        branches.push({ spec: tip.spec, branch: tip.branch, merged: false });
        continue;
      }
      const run = await runner(["-C", root, "merge-base", "--is-ancestor", tip.sha, main], env, signal);
      if (run === null) return nothing("git not found on PATH");
      // Only 0 and 1 are answers; a killed run exits otherwise, and a partial answer is never cached.
      if (aborted() || (run.code !== 0 && run.code !== 1)) return nothing(`git merge-base exited ${run.code}: ${firstLine(run.stderr)}`);
      branches.push({ spec: tip.spec, branch: tip.branch, merged: run.code === 0 });
    }
    const result: SpecBranches = main === null ? { branches, source: "git", diagnostic: "no main branch" } : { branches, source: "git" };
    if (aborted()) return nothing("aborted"); // the deadline has answered; a late result is never cached
    cache.store(root, key, result);
    return result;
  });
}

/** The merge commit that brought a branch into `main`: its full sha and its committer date (ISO 8601). */
export interface MergeCommit {
  readonly commit: string;
  readonly at: string;
}

/**
 * The commit that merged `branch` into `main` in `root`'s repository (spec 027, T25, ISC-175.1): the oldest commit on `main`'s first-parent line that has the branch's tip as
 * an ancestor and two or more parents, with its committer date, the moment `main` received the merge. Three reads:
 * `for-each-ref --format=%(objectname) refs/heads/<branch>` for the tip, `rev-list --first-parent refs/heads/main --`
 * for that line and `log --ancestry-path --format=%H %cI %P refs/heads/<branch>..refs/heads/main --` for the commits
 * that descend from the tip, newest first; the last of those on the line with a second parent is the merge commit. A
 * tip on the line itself (fresh, or fast-forwarded into `main`) was brought in by no merge and answers null, as
 * `mergedSpecBranches` reads it unmerged. All three read refs and objects only: no index, no lock (`GIT_OPTIONAL_LOCKS=0` besides), no fetch, no network; the refs are full names, so
 * neither a tag nor a file of the branch's name is read instead.
 * Never throws: a name that is no plain branch name, no repository root, no git, a non-zero exit, no merge commit and
 * the deadline answer null.
 */
export async function mergeCommitOf(root: string, branch: string, options: UserEmailOptions = {}): Promise<MergeCommit | null> {
  if (!isPlainBranchName(branch)) return null;
  const runner = options.runner ?? defaultGitRunner;
  try {
    lstatSync(join(root, ".git"));
  } catch {
    return null;
  }
  return readWithin<MergeCommit | null>(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
    const env = gitEnv(root);
    // Read through a call each time: the flag turns true while a run is awaited, which a narrowed property would hide.
    const aborted = (): boolean => signal.aborted;
    const ref = await runner(["-C", root, "for-each-ref", "--format=%(objectname)", `refs/heads/${branch}`], env, signal);
    const tip = ref?.code === 0 && !aborted() ? ref.stdout.trim() : "";
    if (!SHA.test(tip)) return null;
    const line = await runner(["-C", root, "rev-list", "--first-parent", MAIN_REF, "--"], env, signal);
    if (line?.code !== 0 || aborted()) return null;
    const firstParent = new Set(line.stdout.split("\n").filter((sha) => SHA.test(sha)));
    if (firstParent.has(tip)) return null;
    const range = `refs/heads/${branch}..${MAIN_REF}`;
    const path = await runner(["-C", root, "log", "--ancestry-path", "--format=%H %cI %P", range, "--"], env, signal);
    if (path?.code !== 0 || aborted()) return null;
    let merge: MergeCommit | null = null;
    for (const entry of path.stdout.split("\n")) {
      const [commit = "", at = "", ...parents] = entry.trim().split(" ");
      if (firstParent.has(commit) && at !== "" && parents.length >= 2) merge = { commit, at };
    }
    return merge;
  });
}
