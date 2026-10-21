// The timeline's commit source (T46, ISC-80): the commits touching a spec folder, read with `git log` and nothing else
// that could write (ISC-15). Read-only by construction: only `rev-parse` and `log` run, neither of which touches the
// index, takes a lock or writes an object.
//
// Bounded: at most `limit` commits, one deadline for the whole call (the child is killed, the call answers `none`),
// and a cache keyed by root and folder that skips `git log` while `HEAD` is unchanged.
import type { CommitRecord } from "../../../../core/src/files.ts";
import { hasGit } from "../fs/read.ts";
import { storeBounded } from "./bounded.ts";
import { repoStateOf } from "./repo-state.ts";
import { DEFAULT_TIMEOUT_MS, type GitRunner, SHA, defaultGitRunner, firstLine, gitEnv, messageOf, normalizeFolder, readWithin } from "./runner.ts";

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

// ── the cache ────────────────────────────────────────────────────────────────────────────────────────────────────

interface CacheEntry {
  /** `repoStateOf(root)` when read; a hit under the same state starts no git process (spec 041, ISC-215). */
  readonly state: string | null;
  readonly head: string;
  readonly limit: number;
  readonly files: boolean;
  readonly commits: readonly GitCommit[];
}

/**
 * The last read per `<root>\0<folder>`, valid while `HEAD` is unchanged; bounded, the oldest key leaves first. While
 * `repoStateOf(root)` stands as well, a hit is answered without even the `rev-parse` (spec 041, ISC-215).
 */
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
    storeBounded(this.#entries, key, entry, this.max);
  }
}

const cacheKey = (root: string, folder: string): string => `${root}\0${folder}`;

// ── the read ─────────────────────────────────────────────────────────────────────────────────────────────────────

const RECORD = "\x1e";
const FIELD = "\x1f";

function none(diagnostic: string, head: string | null = null): CommitsResult {
  return { commits: [], head, source: "none", diagnostic };
}

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
  if (!hasGit(root)) return none("not a git repository root");

  return readWithin(
    timeoutMs,
    none(`git timed out after ${timeoutMs} ms`),
    (signal) => read(root, rel, { limit, withFiles, runner, cache: options.cache }, signal),
    (error) => none(`git read failed: ${messageOf(error)}`),
  );
}

interface ReadPlan {
  readonly limit: number;
  readonly withFiles: boolean;
  readonly runner: GitRunner;
  readonly cache: CommitCache | undefined;
}

async function read(root: string, rel: string, plan: ReadPlan, signal: AbortSignal): Promise<CommitsResult> {
  const env = gitEnv(root);
  const state = repoStateOf(root);
  const key = cacheKey(root, rel);
  const known = plan.cache?.lookup(key);
  if (state !== null && known?.state === state && known.limit === plan.limit && known.files === plan.withFiles) {
    return { commits: known.commits, head: known.head, source: "git" };
  }
  const headRun = await plan.runner(["-C", root, "rev-parse", "--verify", "--quiet", "HEAD"], env, signal);
  if (headRun === null) return none("git not found on PATH");
  if (signal.aborted) return none("aborted");
  if (headRun.code === 1) return { commits: [], head: null, source: "git" }; // a repository without a commit
  if (headRun.code !== 0) return none(`git rev-parse exited ${headRun.code}: ${firstLine(headRun.stderr)}`);
  const head = headRun.stdout.trim();

  if (known?.head === head && known.limit === plan.limit && known.files === plan.withFiles) {
    plan.cache?.store(key, { ...known, state });
    return { commits: known.commits, head, source: "git" };
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
  plan.cache?.store(key, { state, head, limit: plan.limit, files: plan.withFiles, commits });
  return { commits, head, source: "git" };
}
