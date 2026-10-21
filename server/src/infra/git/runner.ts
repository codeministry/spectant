// The git runner of the server's git reads: the one spawn, the one environment, the one deadline and the guards every
// read in `infra/git/` shares. `core/` runs no subprocess; the server reads here and passes the records in.
//
// Every read runs only read-only git commands (each file names its own), none of which fetches or reaches the network.
// The inherited `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped so the environment cannot redirect the
// read, pathspecs are literal, and discovery stops at the root: a directory without its own `.git` is not read, even
// inside a repository. `ls-files` and `status` run with `core.fsmonitor=false` (`NO_FSMONITOR`), so neither asks a
// repository's fsmonitor hook nor starts a monitor daemon that would leave its socket in `.git/`; `config -z
// --get-regexp ^filter\.` (the filter driver names, `filterDrivers`) reads the configuration and never writes it
// (spec 041, ISC-216.2).
import { lstatSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface GitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs git with `args` under `env`, killing it when `signal` aborts; resolves null when git is not installed. */
export type GitRunner = (args: readonly string[], env: Record<string, string>, signal: AbortSignal) => Promise<GitRun | null>;

export const DEFAULT_TIMEOUT_MS = 3000;

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
export function gitEnv(root: string): Record<string, string> {
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

export const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The folder as a clean relative path without a trailing slash, or null when it is empty, absolute, escapes or starts with `-`/`:`. */
export function normalizeFolder(folder: string): string | null {
  const trimmed = folder.replace(/\/+$/, "");
  if (trimmed === "" || trimmed.startsWith("/") || trimmed.startsWith("-") || trimmed.startsWith(":")) return null;
  if (trimmed.includes("\0") || trimmed.includes("\\")) return null;
  const segments = trimmed.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;
  return trimmed;
}

export const firstLine = (text: string): string => text.trim().split("\n", 1)[0] ?? "";

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Turns the repository's fsmonitor hook or daemon off for one call: the read never starts a command it configures. */
export const NO_FSMONITOR = ["-c", "core.fsmonitor=false"] as const;

/**
 * The name of every filter driver the configuration at `path` defines (spec 041, ISC-216.2), read with
 * `config -z --get-regexp ^filter\.`: the repository's own config, its worktree config, the global one and their
 * includes (the system config is off as for every read here), each name once. `config` reads and never writes; a key
 * `filter.<name>.<var>` names the driver `<name>`, dots included. Exit 1 is git's "no key matched", no driver. Null
 * when git is missing, fails or is killed, or when a name holds `=` or a line break, which a `-c` override could not
 * carry: the caller then runs no status rather than one with a driver still on.
 */
export async function filterDrivers(path: string, runner: GitRunner, env: Record<string, string>, signal: AbortSignal): Promise<string[] | null> {
  const run = await runner(["-C", path, "config", "-z", "--get-regexp", "^filter\\."], env, signal);
  if (run === null || signal.aborted) return null;
  if (run.code === 1 && run.stdout === "") return [];
  if (run.code !== 0) return null;
  const names = new Set<string>();
  for (const record of run.stdout.split("\0")) {
    if (record === "") continue;
    // `-z` prints `<key>\n<value>`, or the key alone for a key without a value.
    const key = record.split("\n", 1)[0] ?? "";
    const name = key.slice("filter.".length, key.lastIndexOf("."));
    if (!key.startsWith("filter.") || key.lastIndexOf(".") <= "filter".length || name === "") continue;
    if (/[=\n\r\0]/.test(name)) return null;
    names.add(name);
  }
  return [...names];
}

/** An absolute path with its own `.git` (a linked worktree's is a file): the root rule of the worktree reads. */
export function hasOwnGit(path: string): boolean {
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
export const isPlainBranchName = (name: string): boolean => name !== "" && !name.startsWith("-") && !NOT_IN_BRANCH.test(name);

/**
 * `read` under one deadline: `fallback` when the deadline passes first (the signal aborts, which kills the child), and
 * `failed(error)`, by default `fallback`, when `read` throws. The one deadline helper of this module (spec 041, ISC-218):
 * every read that spawns git runs under it.
 */
export async function readWithin<T>(
  timeoutMs: number,
  fallback: T,
  read: (signal: AbortSignal) => Promise<T>,
  failed: (error: unknown) => T = () => fallback,
): Promise<T> {
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
  } catch (error) {
    return failed(error);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

// ── bounded concurrency ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * `fn` over `items` with at most `limit` calls in flight, the results in the items' order: the library search's file
 * reads (ISC-156.5) and the worktree view's git reads (spec 041, ISC-215).
 */
export async function mapBounded<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++;
      results[at] = await fn(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
