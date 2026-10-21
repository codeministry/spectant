// The merge state: `for-each-ref`, `rev-list --first-parent` and `merge-base --is-ancestor` (`mergedSpecBranches`)
// and `log --ancestry-path` (`mergeCommitOf`), whether and where a merge brought a spec branch into `main`; all read
// refs and objects only, never touch the index, never take a lock and never write an object.
import { SPEC_FOLDER } from "../../../../core/src/spec-ref.ts";
import { hasGit } from "../fs/read.ts";
import { StateMemo, repoStateOf } from "./repo-state.ts";
import type { UserEmailOptions } from "./refs.ts";
import { DEFAULT_TIMEOUT_MS, type GitRunner, SHA, defaultGitRunner, firstLine, gitEnv, isPlainBranchName, readWithin } from "./runner.ts";

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
  if (!hasGit(root)) return nothing("not a git repository root");
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
 * for that line and `log --ancestry-path --topo-order --reverse --format=%H %cI %P refs/heads/<branch>..refs/heads/main --`
 * for the commits that descend from the tip, oldest first in topological order (spec 041, ISC-214); the first of those
 * on the line with a second parent is the merge commit, whatever the committer dates say (a skewed clock can date a
 * later merge before an earlier one, and a walk in date order then lists it last). A
 * tip on the line itself (fresh, or fast-forwarded into `main`) was brought in by no merge and answers null, as
 * `mergedSpecBranches` reads it unmerged. All three read refs and objects only: no index, no lock (`GIT_OPTIONAL_LOCKS=0` besides), no fetch, no network; the refs are full names, so
 * neither a tag nor a file of the branch's name is read instead.
 * Never throws: a name that is no plain branch name, no repository root, no git, a non-zero exit, no merge commit and
 * the deadline answer null.
 */
export async function mergeCommitOf(root: string, branch: string, options: UserEmailOptions = {}): Promise<MergeCommit | null> {
  if (!isPlainBranchName(branch)) return null;
  if (!hasGit(root)) return null;
  // An injected runner reads afresh: its caller counts or scripts the runs.
  if (options.runner !== undefined) return mergeCommitNow(root, branch, options.runner, options.timeoutMs);
  return MERGE_COMMITS.get(`${root}\0${branch}`, repoStateOf(root), () => mergeCommitNow(root, branch, defaultGitRunner, options.timeoutMs));
}

/** The process's merge commits per root and branch, kept while `repoStateOf(root)` stands: refs unchanged (ISC-215). */
const MERGE_COMMITS = new StateMemo<MergeCommit | null>();

function mergeCommitNow(root: string, branch: string, runner: GitRunner, timeoutMs: number | undefined): Promise<MergeCommit | null> {
  return readWithin<MergeCommit | null>(timeoutMs ?? DEFAULT_TIMEOUT_MS, null, async (signal) => {
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
    // Oldest first in topology, never by date: a committer clock that runs behind must not move the merge (ISC-214).
    const path = await runner(["-C", root, "log", "--ancestry-path", "--topo-order", "--reverse", "--format=%H %cI %P", range, "--"], env, signal);
    if (path?.code !== 0 || aborted()) return null;
    for (const entry of path.stdout.split("\n")) {
      const [commit = "", at = "", ...parents] = entry.trim().split(" ");
      if (firstParent.has(commit) && at !== "" && parents.length >= 2) return { commit, at };
    }
    return null;
  });
}
