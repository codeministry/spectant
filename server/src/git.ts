// The timeline's commit source (T46, ISC-80): the commits touching a spec folder, read with `git log` and nothing else
// that could write (ISC-15). `core/` runs no subprocess; the server reads here and passes the records in.
//
// Read-only by construction: only `rev-parse`, `log`, `config --get` (the identity, `userEmail`) and `for-each-ref`
// (the branch names, `takenSpecNumbers`) and `worktree list --porcelain` (the worktrees, `worktreeList`) run, all of which
// never touch the index, never take a lock and never write an object; `GIT_OPTIONAL_LOCKS=0` covers any optional lock
// a future git might take. The inherited
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped so the environment cannot redirect the read, pathspecs
// are literal, and discovery stops at the root: a directory without its own `.git` is not read, even inside a repository.
//
// Bounded: at most `limit` commits, one deadline for the whole call (the child is killed, the call answers `none`),
// and a cache keyed by root and folder that skips `git log` while `HEAD` is unchanged.
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
import { specNumbersOf } from "../../core/src/allocate.ts";
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
