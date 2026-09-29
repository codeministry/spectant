// The timeline's commit source (T46, ISC-80): the commits touching a spec folder, read with `git log` and nothing else
// that could write (ISC-15). `core/` runs no subprocess; the server reads here and passes the records in.
//
// Read-only by construction: only `rev-parse` and `log` run, both of which never touch the index, never take a lock
// and never write an object; `GIT_OPTIONAL_LOCKS=0` covers any optional lock a future git might take. The inherited
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped so the environment cannot redirect the read, pathspecs
// are literal, and discovery stops at the root: a directory without its own `.git` is not read, even inside a repository.
//
// Bounded: at most `limit` commits, one deadline for the whole call (the child is killed, the call answers `none`),
// and a cache keyed by root and folder that skips `git log` while `HEAD` is unchanged.
import { lstatSync } from "node:fs";
import { dirname, join } from "node:path";
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
