// The identity and the numbers given out: `config --get` (`userEmail`) and `for-each-ref` plus `log` over `specs`
// (`takenSpecNumbers`), all of which read and never touch the index, take a lock or write an object.
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { specNumbersOf } from "../../../../core/src/allocate.ts";
import { DEFAULT_TIMEOUT_MS, type GitRunner, defaultGitRunner, firstLine, gitEnv, messageOf, readWithin } from "./runner.ts";

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
  return readWithin(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
    const run = await runner(["-C", root, "config", "--get", "user.email"], gitEnv(root), signal);
    // No git (null), exit 1 ("not set") and any other failure all read as no address.
    if (run?.code !== 0 || signal.aborted) return null;
    const address = run.stdout.trim();
    return address === "" ? null : address;
  });
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
 *   deleted or moved since still holds it. `--no-renames` makes an archive move an addition too. A spec folder
 *   committed only on a spec worktree's branch is such an addition, so its number is taken before the merge, whatever
 *   the branch is called (spec 039, ISC-208.1).
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
  const read = async (signal: AbortSignal): Promise<TakenNumbers> => {
    const env = gitEnv(root);
    const refs = await runner(["-C", root, "for-each-ref", "--format=%(refname)", "refs/heads/", "refs/remotes/"], env, signal);
    if (refs === null) return nothing("git not found on PATH");
    if (refs.code !== 0) return nothing(`git for-each-ref exited ${refs.code}: ${firstLine(refs.stderr)}`);
    const log = await runner(
      ["-C", root, "--no-pager", "log", "--all", "--no-renames", "--diff-filter=A", "--name-only", "--format=", "--no-color", "--no-ext-diff", "--no-textconv", "--", "specs"],
      env,
      signal,
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
  return readWithin(timeoutMs, nothing(`git timed out after ${timeoutMs} ms`), read, (error) => nothing(`git read failed: ${messageOf(error)}`));
}
