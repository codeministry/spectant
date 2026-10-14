// The timeline's commit source (T46, ISC-80): `commitsFor` reads the commits touching a spec folder with a read-only
// `git log`, bounded in count and time, and cached by the repository's head.
//
// The repository under test is built in a temp directory with a fixed identity and fixed dates: three commits touching
// `specs/010-x/` alone, one commit elsewhere (the sibling folder `specs/010-xy/`, which a prefix match would wrongly
// include) and one touching both the folder and a root file. Every git command here runs under an empty global config
// and no system config (set on `process.env` for this file and restored after it), as in `tests/readonly.test.ts`,
// so the setup and `commitsFor` see no host hook, signing or pager.
//
// Read-only (ISC-15): the repository, `.git/` included, is hashed before and after with node:fs only; the hash covers
// bytes, modes and mtimes, so even an index refresh that rewrites identical bytes would show.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assignWorktrees } from "../core/src/worktrees.ts";
import {
  aheadOfMain,
  CommitCache,
  commitsFor,
  defaultGitRunner,
  dirty,
  mergeCommitOf,
  type GitRunner,
  takenSpecNumbers,
  userEmail,
  worktreeList,
} from "../server/src/git.ts";

const FOLDER = "specs/010-x";

// ── the byte-identical check (the helper pattern of tests/readonly.test.ts) ─────────────────────────────────────────

type Entry = { kind: "file" | "dir" | "link"; mode: number; size: number; mtimeMs: number; digest: string };

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Every entry below `dir`, `/`-separated and relative, with node:fs only, no git. */
function walk(dir: string, prefix = "", out = new Map<string, Entry>()): Map<string, Entry> {
  for (const name of readdirSync(dir)) {
    const absolute = join(dir, name);
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const stat = lstatSync(absolute);
    const base = { mode: stat.mode & 0o7777, size: stat.size, mtimeMs: stat.mtimeMs };
    if (stat.isSymbolicLink()) {
      out.set(path, { kind: "link", ...base, digest: sha256(readlinkSync(absolute, { encoding: "buffer" })) });
    } else if (stat.isDirectory()) {
      out.set(path, { kind: "dir", ...base, digest: "" });
      walk(absolute, path, out);
    } else {
      out.set(path, { kind: "file", ...base, digest: sha256(readFileSync(absolute)) });
    }
  }
  return out;
}

/** The recursive hash of `root`, `.git/` included, over path, kind, mode, bytes and (unless off) mtime. */
function checksum(root: string, withMtime = true): string {
  const entries = walk(root);
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of [...entries.keys()].sort()) {
    const e = entries.get(path);
    if (e === undefined) continue;
    hasher.update(`${path}\0${e.kind}\0${e.mode.toString(8)}\0${e.digest}\0${withMtime ? e.mtimeMs : ""}\n`);
  }
  return hasher.digest("hex");
}

// ── the repository under test ─────────────────────────────────────────────────────────────────────────────────────

/** Runs git in `cwd` with a fixed identity and the given author/committer date; throws with stderr on failure. */
function git(cwd: string, date: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Spectant Test",
      GIT_AUTHOR_EMAIL: "git@example.com",
      GIT_COMMITTER_NAME: "Spectant Test",
      GIT_COMMITTER_EMAIL: "git@example.com",
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** Writes `files` (path → content) below `repo`, stages them and commits with `message` at `date`. */
function commit(repo: string, date: string, message: string, files: Record<string, string>): string {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
    git(repo, date, "add", "--", path);
  }
  git(repo, date, "commit", "-q", "-m", message);
  return git(repo, date, "rev-parse", "HEAD");
}

/** A runner that forwards to git and records every argument list, so a test can count the `log` calls. */
function countingRunner(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (args, env, signal) => {
    calls.push([...args]);
    return defaultGitRunner(args, env, signal);
  };
  return { runner, calls };
}

const logCalls = (calls: string[][]): number => calls.filter((args) => args.includes("log")).length;

let root: string;
let repo: string;
const shas: Record<string, string> = {};
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-git-"));
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    savedEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
  shas.one = commit(repo, "2026-01-01T12:00:00Z", "spec: first draft", { [`${FOLDER}/spec.md`]: "# x\n" });
  shas.elsewhere = commit(repo, "2026-01-02T12:00:00Z", "sibling spec", { "specs/010-xy/spec.md": "# xy\n" });
  shas.two = commit(repo, "2026-01-03T10:00:00+02:00", "plan: stages\n\nA body line that must stay out.\n", {
    [`${FOLDER}/plan.md`]: "# plan\n",
  });
  shas.three = commit(repo, "2026-01-04T12:00:00Z", "tasks: first cut", { [`${FOLDER}/tasks.md`]: "# tasks\n" });
  shas.both = commit(repo, "2026-01-05T12:00:00Z", "both: folder and readme", {
    [`${FOLDER}/spec.md`]: "# x, revised\n",
    "README.md": "# readme\n",
  });

  // State a careless reader would disturb: staged-not-committed, stale stat data (a `git status` rewrites the index
  // for it), an untracked file.
  writeFileSync(join(repo, "staged.md"), "# staged\n");
  git(repo, "2026-01-06T00:00:00Z", "add", "staged.md");
  const future = new Date("2030-01-01T00:00:00Z");
  utimesSync(join(repo, "README.md"), future, future);
  writeFileSync(join(repo, FOLDER, "untracked.md"), "# untracked\n");
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("commitsFor reads the commits touching the folder", () => {
  test("exactly the touching commits, newest first, with ISO author dates and one-line subjects", async () => {
    const result = await commitsFor(repo, FOLDER);
    expect(result.source).toBe("git");
    expect(result.head).toBe(shas.both ?? "");
    expect(result.commits.map((c) => c.sha)).toEqual([shas.both, shas.three, shas.two, shas.one].map(String));
    expect(result.commits.map((c) => c.subject)).toEqual([
      "both: folder and readme",
      "tasks: first cut",
      "plan: stages",
      "spec: first draft",
    ]);
    for (const c of result.commits) {
      expect(c.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/);
      expect(c.files).toBeUndefined();
    }
    expect(result.commits[2]?.ts).toBe("2026-01-03T10:00:00+02:00");
    expect(Date.parse(result.commits[0]?.ts ?? "")).toBe(Date.parse("2026-01-05T12:00:00Z"));
  });

  test("files when enabled: the touched paths inside the folder, README of the mixed commit left out", async () => {
    const result = await commitsFor(repo, FOLDER, { files: true });
    expect(result.commits.map((c) => c.files)).toEqual([
      [`${FOLDER}/spec.md`],
      [`${FOLDER}/tasks.md`],
      [`${FOLDER}/plan.md`],
      [`${FOLDER}/spec.md`],
    ]);
  });

  test("the limit is respected and keeps the newest", async () => {
    const result = await commitsFor(repo, FOLDER, { limit: 2 });
    expect(result.commits.map((c) => c.sha)).toEqual([shas.both, shas.three].map(String));
  });

  test("a trailing slash names the same folder", async () => {
    const result = await commitsFor(repo, `${FOLDER}/`);
    expect(result.commits).toHaveLength(4);
  });

  test("a missing folder gives [] from git, not an error", async () => {
    const result = await commitsFor(repo, "specs/999-missing");
    expect(result).toEqual({ commits: [], head: shas.both ?? "", source: "git" });
  });
});

describe("where there is nothing to read", () => {
  test("a directory that is no repository → none, git never spawned", async () => {
    const plain = mkdtempSync(join(root, "plain-"));
    const { runner, calls } = countingRunner();
    const result = await commitsFor(plain, FOLDER, { runner });
    expect(result.source).toBe("none");
    expect(result.commits).toEqual([]);
    expect(result.head).toBeNull();
    expect(calls).toEqual([]);
  });

  test("a subdirectory of a repository is no repository root → none, the parent is not read", async () => {
    const { runner, calls } = countingRunner();
    const result = await commitsFor(join(repo, "specs"), "010-x", { runner });
    expect(result.source).toBe("none");
    expect(calls).toEqual([]);
  });

  test("a repository without commits → [] with a null head", async () => {
    const empty = join(root, "empty");
    mkdirSync(empty);
    git(empty, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
    const result = await commitsFor(empty, FOLDER);
    expect(result).toEqual({ commits: [], head: null, source: "git" });
  });

  test("git missing → none with a diagnostic", async () => {
    const result = await commitsFor(repo, FOLDER, { runner: () => Promise.resolve(null) });
    expect(result.source).toBe("none");
    expect(result.commits).toEqual([]);
    expect(result.diagnostic).toMatch(/git not found/);
  });

  test("a folder that escapes the repository or reads as an option is refused without spawning", async () => {
    for (const folder of ["../outside", "/etc", "-n", "specs/../../x", "", ":(top)specs"]) {
      const { runner, calls } = countingRunner();
      const result = await commitsFor(repo, folder, { runner });
      expect(result.source).toBe("none");
      expect(result.diagnostic).toMatch(/folder/);
      expect(calls).toEqual([]);
    }
  });
});

describe("the timeout", () => {
  test("a slow git is killed at the deadline → none with a diagnostic, no throw", async () => {
    let aborted = false;
    const slow: GitRunner = (_args, _env, signal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          resolve({ code: 137, stdout: "", stderr: "" });
        });
      });
    const started = performance.now();
    const result = await commitsFor(repo, FOLDER, { runner: slow, timeoutMs: 50 });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ commits: [], head: null, source: "none", diagnostic: "git timed out after 50 ms" });
    expect(aborted).toBe(true);
  });

  test("a runner that ignores the abort still cannot hold the call past the deadline", async () => {
    const deaf: GitRunner = () => new Promise(() => undefined);
    const result = await commitsFor(repo, FOLDER, { runner: deaf, timeoutMs: 30 });
    expect(result.source).toBe("none");
    expect(result.diagnostic).toBe("git timed out after 30 ms");
  });

  test("a failing git log → none with its stderr as the diagnostic", async () => {
    const failing: GitRunner = (args, env, signal) =>
      args.includes("log") ? Promise.resolve({ code: 128, stdout: "", stderr: "fatal: bad object\n" }) : defaultGitRunner(args, env, signal);
    const result = await commitsFor(repo, FOLDER, { runner: failing });
    expect(result.source).toBe("none");
    expect(result.diagnostic).toBe("git log exited 128: fatal: bad object");
  });
});

describe("the head cache", () => {
  test("an unchanged head returns the cached list without running git log; a new commit refreshes it", async () => {
    const cache = new CommitCache();
    const { runner, calls } = countingRunner();

    const first = await commitsFor(repo, FOLDER, { cache, runner });
    expect(logCalls(calls)).toBe(1);
    expect(cache.size).toBe(1);

    const second = await commitsFor(repo, FOLDER, { cache, runner });
    expect(logCalls(calls)).toBe(1);
    expect(second).toEqual(first);
    expect(calls.filter((args) => args.includes("rev-parse"))).toHaveLength(2);

    // Same key, different shape (limit or files) is a miss, not a wrong answer.
    const limited = await commitsFor(repo, FOLDER, { cache, runner, limit: 1 });
    expect(logCalls(calls)).toBe(2);
    expect(limited.commits).toHaveLength(1);

    const scratch = join(root, "scratch");
    rmSync(scratch, { recursive: true, force: true });
    // A new commit on a clone keeps the repository under test unchanged for the read-only check below.
    git(root, "2026-01-07T00:00:00Z", "clone", "-q", repo, scratch);
    const cacheOnClone = new CommitCache();
    await commitsFor(scratch, FOLDER, { cache: cacheOnClone, runner });
    const newSha = commit(scratch, "2026-01-07T12:00:00Z", "spec: second draft", { [`${FOLDER}/spec.md`]: "# x, again\n" });
    const logsBefore = logCalls(calls);
    const refreshed = await commitsFor(scratch, FOLDER, { cache: cacheOnClone, runner });
    expect(logCalls(calls)).toBe(logsBefore + 1);
    expect(refreshed.head).toBe(newSha);
    expect(refreshed.commits[0]?.sha).toBe(newSha);
    expect(refreshed.commits).toHaveLength(5);
  });

  test("a failed read is not cached", async () => {
    const cache = new CommitCache();
    await commitsFor(repo, FOLDER, { cache, runner: () => Promise.resolve(null) });
    expect(cache.size).toBe(0);
  });

  test("the cache is bounded: the oldest key goes first", async () => {
    const cache = new CommitCache(2);
    await commitsFor(repo, "specs/a", { cache });
    await commitsFor(repo, "specs/b", { cache });
    await commitsFor(repo, "specs/c", { cache });
    expect(cache.size).toBe(2);
    expect(cache.has(repo, "specs/a")).toBe(false);
    expect(cache.has(repo, "specs/c")).toBe(true);
  });
});

describe("userEmail reads the repository's git user.email (T77, ISC-119)", () => {
  /** A repository with `user.email` set in its own config to a synthetic address, nothing committed. */
  function identityRepo(): string {
    const dir = mkdtempSync(join(root, "identity-"));
    git(dir, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
    git(dir, "2026-01-01T00:00:00Z", "config", "user.email", "dev@example.com");
    return dir;
  }

  test("a configured address is returned as written", async () => {
    expect(await userEmail(identityRepo())).toBe("dev@example.com");
  });

  test("no configuration (empty global config, no system config, none in the repository) → null", async () => {
    expect(await userEmail(repo)).toBeNull();
  });

  test("a directory that is no repository root → null, git never spawned", async () => {
    const { runner, calls } = countingRunner();
    expect(await userEmail(mkdtempSync(join(root, "plain-")), { runner })).toBeNull();
    expect(await userEmail(join(repo, "specs"), { runner })).toBeNull();
    expect(calls).toEqual([]);
  });

  test("git missing, a failing git, a throwing runner or the deadline → null, never a throw", async () => {
    const dir = identityRepo();
    expect(await userEmail(dir, { runner: () => Promise.resolve(null) })).toBeNull();
    expect(await userEmail(dir, { runner: () => Promise.resolve({ code: 128, stdout: "", stderr: "fatal: broken\n" }) })).toBeNull();
    expect(await userEmail(dir, { runner: () => Promise.reject(new Error("spawn failed")) })).toBeNull();
    expect(await userEmail(dir, { runner: () => Promise.resolve({ code: 0, stdout: "  \n", stderr: "" }) })).toBeNull();
    const slow: GitRunner = () => new Promise(() => undefined);
    expect(await userEmail(dir, { runner: slow, timeoutMs: 20 })).toBeNull();
  });

  test("runs only `config --get user.email` under the read-only environment, rooted at the repository", async () => {
    const dir = identityRepo();
    const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: GitRunner = (args, env, signal) => {
      seen.push({ args: [...args], env });
      return defaultGitRunner(args, env, signal);
    };
    expect(await userEmail(dir, { runner })).toBe("dev@example.com");
    expect(seen.map((s) => s.args)).toEqual([["-C", dir, "config", "--get", "user.email"]]);
    expect(seen[0]?.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(dir) });
  });

  test("reading the config leaves the repository, .git/ included, byte- and mtime-identical (ISC-15)", async () => {
    const dir = identityRepo();
    const before = checksum(dir);
    await userEmail(dir);
    await userEmail(dir, { timeoutMs: 1 });
    expect(checksum(dir)).toBe(before);
    const beforeRepo = checksum(repo);
    await userEmail(repo);
    expect(checksum(repo)).toBe(beforeRepo);
  });
});

describe("takenSpecNumbers reads the spec numbers branch names and history have given out (T86, ISC-130.2)", () => {
  /**
   * A repository whose history added specs/003-a/ and specs/archive/002-b/, added and then deleted specs/005-gone/,
   * with local branches main, feature/012-tide-tables, release/1.0 and fix/44-short (no three-digit folder segment),
   * and a remote-tracking ref origin/feature/031-remote.
   */
  function numberedRepo(): string {
    const dir = mkdtempSync(join(root, "numbers-"));
    git(dir, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
    commit(dir, "2026-01-01T12:00:00Z", "spec 003", { "specs/003-a/spec.md": "# a\n", "specs/ideas/README.md": "# ideas\n" });
    commit(dir, "2026-01-02T12:00:00Z", "archived 002", { "specs/archive/002-b/spec.md": "# b\n" });
    commit(dir, "2026-01-03T12:00:00Z", "spec 005", { "specs/005-gone/spec.md": "# gone\n" });
    git(dir, "2026-01-04T12:00:00Z", "rm", "-q", "-r", "--", "specs/005-gone");
    git(dir, "2026-01-04T12:00:00Z", "commit", "-q", "-m", "drop 005");
    for (const branch of ["feature/012-tide-tables", "release/1.0", "fix/44-short"]) git(dir, "2026-01-05T00:00:00Z", "branch", branch);
    git(dir, "2026-01-05T00:00:00Z", "update-ref", "refs/remotes/origin/feature/031-remote", "HEAD");
    return dir;
  }

  test("folders added anywhere in history (deleted or archived ones too) and branch segments, sorted and unique", async () => {
    expect(await takenSpecNumbers(numberedRepo())).toEqual({ numbers: [2, 3, 5, 12, 31], source: "git" });
    // The timeline repository: specs/010-x/ and specs/010-xy/ both give 10, once.
    expect(await takenSpecNumbers(repo)).toEqual({ numbers: [10], source: "git" });
  });

  test("a repository without commits answers no number from git", async () => {
    const empty = mkdtempSync(join(root, "numbers-empty-"));
    git(empty, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
    expect(await takenSpecNumbers(empty)).toEqual({ numbers: [], source: "git" });
  });

  test("no repository root, git missing, a failing git, a throwing runner or the deadline → none, never a throw", async () => {
    const { runner, calls } = countingRunner();
    expect(await takenSpecNumbers(mkdtempSync(join(root, "numbers-plain-")), { runner })).toMatchObject({ numbers: [], source: "none" });
    expect(await takenSpecNumbers(join(repo, "specs"), { runner })).toMatchObject({ numbers: [], source: "none" });
    expect(calls).toEqual([]);
    expect(await takenSpecNumbers(repo, { runner: () => Promise.resolve(null) })).toMatchObject({ numbers: [], source: "none" });
    const failing: GitRunner = () => Promise.resolve({ code: 128, stdout: "", stderr: "fatal: broken\n" });
    const failed = await takenSpecNumbers(repo, { runner: failing });
    expect(failed).toMatchObject({ numbers: [], source: "none" });
    expect(failed.diagnostic).toContain("fatal: broken");
    expect(await takenSpecNumbers(repo, { runner: () => Promise.reject(new Error("spawn failed")) })).toMatchObject({ numbers: [], source: "none" });
    const slow: GitRunner = () => new Promise(() => undefined);
    expect(await takenSpecNumbers(repo, { runner: slow, timeoutMs: 20 })).toMatchObject({ numbers: [], source: "none" });
  });

  test("runs only for-each-ref over branches and remotes and an --all log of added specs/ paths, under the read-only environment", async () => {
    const dir = numberedRepo();
    const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: GitRunner = (args, env, signal) => {
      seen.push({ args: [...args], env });
      return defaultGitRunner(args, env, signal);
    };
    await takenSpecNumbers(dir, { runner });
    expect(seen.map((s) => s.args.slice(0, 4))).toEqual([
      ["-C", dir, "for-each-ref", "--format=%(refname)"],
      ["-C", dir, "--no-pager", "log"],
    ]);
    expect(seen[1]?.args).toContain("--all");
    expect(seen[1]?.args).toContain("--diff-filter=A");
    expect(seen[1]?.args.slice(-2)).toEqual(["--", "specs"]);
    for (const s of seen) {
      expect(s.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_LITERAL_PATHSPECS: "1", GIT_CEILING_DIRECTORIES: dirname(dir) });
    }
  });

  test("reading the numbers leaves the repository, .git/ included, byte- and mtime-identical (ISC-15)", async () => {
    const dir = numberedRepo();
    const before = checksum(dir);
    await takenSpecNumbers(dir);
    await takenSpecNumbers(dir, { timeoutMs: 1 });
    expect(checksum(dir)).toBe(before);
    const beforeRepo = checksum(repo);
    await takenSpecNumbers(repo);
    expect(checksum(repo)).toBe(beforeRepo);
  });
});

/**
 * A repository with one commit on main and two linked worktrees inside it: `.worktrees/027-x` on the new branch
 * `feature/027-x` and `.worktrees/detached` on a detached HEAD. Uncommitted state in the linked worktree too, so a
 * reader that refreshed an index or took a lock there would show in the hash. Shared by T16's and T17's groups.
 */
function worktreeRepo(): string {
  const dir = mkdtempSync(join(root, "worktrees-"));
  git(dir, "2026-01-01T00:00:00Z", "init", "-q", "-b", "main");
  commit(dir, "2026-01-01T12:00:00Z", "spec 027", { "specs/027-x/spec.md": "# x\n" });
  git(dir, "2026-01-02T00:00:00Z", "worktree", "add", "-q", "-b", "feature/027-x", ".worktrees/027-x");
  git(dir, "2026-01-02T00:00:00Z", "worktree", "add", "-q", "--detach", ".worktrees/detached");
  writeFileSync(join(dir, ".worktrees/027-x/specs/027-x/plan.md"), "# uncommitted\n");
  const future = new Date("2030-01-01T00:00:00Z");
  utimesSync(join(dir, ".worktrees/027-x/specs/027-x/spec.md"), future, future);
  return dir;
}

describe("worktreeList reads the raw `git worktree list --porcelain` text (spec 027, T16, ISC-174, ISC-175)", () => {
  const records = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("worktree "));

  test("the main checkout and both linked worktrees, three records in git's own order and bytes", async () => {
    const dir = worktreeRepo();
    const text = await worktreeList(dir);
    // Exactly what git prints for the same listing (the helper trims, so compare without the closing blank line).
    expect(text.trimEnd()).toBe(git(dir, "2026-01-03T00:00:00Z", "worktree", "list", "--porcelain"));
    const paths = records(text).map((line) => line.slice("worktree ".length));
    expect(paths).toHaveLength(3);
    expect(paths[0]?.endsWith(`/${basename(dir)}`)).toBe(true);
    expect(paths.slice(1).map((p) => p.slice(p.indexOf("/.worktrees/") + 1)).sort()).toEqual([".worktrees/027-x", ".worktrees/detached"]);
    expect(text).toContain("branch refs/heads/main\n");
    expect(text).toContain("branch refs/heads/feature/027-x\n");
    expect(text).toContain("\ndetached\n");
  });

  test("core's assignWorktrees takes the text as it is: the branch worktree is spec 027, the detached one no spec", async () => {
    const dir = worktreeRepo();
    const { worktrees, builders, diagnostics } = assignWorktrees(await worktreeList(dir), ["027-x"]);
    expect(builders).toBe(0);
    expect(diagnostics).toEqual([]);
    expect([...worktrees].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: ".worktrees/027-x", branch: "feature/027-x", spec: "027", ahead: null, dirty: null, kind: "spec" },
      { path: ".worktrees/detached", branch: null, spec: null, ahead: null, dirty: null, kind: "spec" },
    ]);
  });

  test("runs only `worktree list --porcelain`, rooted at the repository, under the read-only environment, no fetch", async () => {
    const dir = worktreeRepo();
    const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: GitRunner = (args, env, signal) => {
      seen.push({ args: [...args], env });
      return defaultGitRunner(args, env, signal);
    };
    expect(records(await worktreeList(dir, { runner }))).toHaveLength(3);
    expect(seen.map((s) => s.args)).toEqual([["-C", dir, "worktree", "list", "--porcelain"]]);
    expect(seen[0]?.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(dir) });
  });

  test("a directory that is no repository root → empty, git never spawned", async () => {
    const { runner, calls } = countingRunner();
    expect(await worktreeList(mkdtempSync(join(root, "worktrees-plain-")), { runner })).toBe("");
    expect(await worktreeList(join(repo, "specs"), { runner })).toBe("");
    expect(calls).toEqual([]);
  });

  test("no git on PATH, a failing git, a throwing runner or the deadline → empty, never a throw", async () => {
    const dir = worktreeRepo();
    const savedPath = process.env.PATH;
    process.env.PATH = mkdtempSync(join(root, "no-git-"));
    try {
      expect(await worktreeList(dir)).toBe("");
    } finally {
      if (savedPath === undefined) Reflect.deleteProperty(process.env, "PATH");
      else process.env.PATH = savedPath;
    }
    expect(await worktreeList(dir, { runner: () => Promise.resolve(null) })).toBe("");
    expect(await worktreeList(dir, { runner: () => Promise.resolve({ code: 128, stdout: "worktree /x\n", stderr: "fatal: broken\n" }) })).toBe("");
    expect(await worktreeList(dir, { runner: () => Promise.reject(new Error("spawn failed")) })).toBe("");
    const slow: GitRunner = () => new Promise(() => undefined);
    expect(await worktreeList(dir, { runner: slow, timeoutMs: 20 })).toBe("");
  });

  test("reading the listing leaves the repository and its worktrees, .git/ included, byte- and mtime-identical (ISC-182)", async () => {
    const dir = worktreeRepo();
    const before = checksum(dir);
    await worktreeList(dir);
    await worktreeList(dir, { timeoutMs: 1 });
    await worktreeList(join(dir, ".worktrees/027-x"));
    expect(checksum(dir)).toBe(before);
  });
});

describe("aheadOfMain and dirty read a worktree's distance to main and its uncommitted changes (spec 027, T17, ISC-175)", () => {
  /**
   * T16's repository plus two commits on `feature/027-x` in its worktree (`plan.md` stays untracked, the uncommitted
   * file) and a third worktree `.worktrees/028-clean` on `feature/028-clean` at main with nothing uncommitted. The
   * commits refresh the index, so a tracked file in each branch worktree gets a later mtime afterwards: `git status`
   * must compare its bytes, and a status that wrote the refreshed index back would show in the hash.
   */
  function chipRepo(): { dir: string; spec: string; clean: string; detached: string } {
    const dir = worktreeRepo();
    const spec = join(dir, ".worktrees/027-x");
    const clean = join(dir, ".worktrees/028-clean");
    commit(spec, "2026-01-03T12:00:00Z", "tasks 027", { "specs/027-x/tasks.md": "# tasks\n" });
    commit(spec, "2026-01-04T12:00:00Z", "core 027", { "core/x.ts": "export const x = 1;\n" });
    git(dir, "2026-01-05T00:00:00Z", "worktree", "add", "-q", "-b", "feature/028-clean", ".worktrees/028-clean");
    const later = new Date("2031-01-01T00:00:00Z");
    for (const tree of [spec, clean]) utimesSync(join(tree, "specs/027-x/spec.md"), later, later);
    return { dir, spec, clean, detached: join(dir, ".worktrees/detached") };
  }

  /** A runner that forwards to git and records every argument list with its environment. */
  function recordingRunner(): { runner: GitRunner; seen: Array<{ args: string[]; env: Record<string, string> }> } {
    const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: GitRunner = (args, env, signal) => {
      seen.push({ args: [...args], env });
      return defaultGitRunner(args, env, signal);
    };
    return { runner, seen };
  }

  test("two commits ahead and dirty for the spec worktree; 0 and clean for a branch at main; a detached one clean", async () => {
    const { spec, clean, detached } = chipRepo();
    expect(await aheadOfMain(spec, "feature/027-x")).toBe(2);
    expect(await dirty(spec)).toBe(true);
    expect(await aheadOfMain(clean, "feature/028-clean")).toBe(0);
    expect(await dirty(clean)).toBe(false);
    expect(await dirty(detached)).toBe(false);
  });

  test("a modified tracked file alone reads as dirty too", async () => {
    const { clean } = chipRepo();
    writeFileSync(join(clean, "specs/027-x/spec.md"), "# x, edited\n");
    expect(await dirty(clean)).toBe(true);
  });

  test("a detached worktree or a name git would not take → ahead null, git never spawned", async () => {
    const { spec, detached } = chipRepo();
    const { runner, calls } = countingRunner();
    expect(await aheadOfMain(detached, null, { runner })).toBeNull();
    for (const name of ["", "-x", "--all", "main..x", "x@{1}", "x^", "x~1", "x:y", "a b", "x\ny"]) {
      expect(await aheadOfMain(spec, name, { runner })).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  test("a removed worktree path or a relative path → null, git never spawned; a pruned gitdir → null from git", async () => {
    const { dir, spec, clean } = chipRepo();
    rmSync(spec, { recursive: true, force: true });
    const { runner, calls } = countingRunner();
    expect(await aheadOfMain(spec, "feature/027-x", { runner })).toBeNull();
    expect(await dirty(spec, { runner })).toBeNull();
    expect(await aheadOfMain(".worktrees/028-clean", "feature/028-clean", { runner })).toBeNull();
    expect(await dirty(".worktrees/028-clean", { runner })).toBeNull();
    expect(calls).toEqual([]);
    // The worktree's own `.git` file still points at its gitdir, which is gone: git refuses, the answer is null.
    rmSync(join(dir, ".git/worktrees/028-clean"), { recursive: true, force: true });
    expect(await aheadOfMain(clean, "feature/028-clean")).toBeNull();
    expect(await dirty(clean)).toBeNull();
  });

  test("no local `main` or an unknown branch → ahead null, never a throw", async () => {
    const trunk = mkdtempSync(join(root, "trunk-"));
    git(trunk, "2026-01-01T00:00:00Z", "init", "-q", "-b", "trunk");
    commit(trunk, "2026-01-01T12:00:00Z", "first", { "README.md": "# trunk\n" });
    git(trunk, "2026-01-02T00:00:00Z", "worktree", "add", "-q", "-b", "feature/027-x", ".worktrees/027-x");
    const tree = join(trunk, ".worktrees/027-x");
    expect(await aheadOfMain(tree, "feature/027-x")).toBeNull();
    expect(await dirty(tree)).toBe(false);
    const { spec } = chipRepo();
    expect(await aheadOfMain(spec, "feature/999-gone")).toBeNull();
  });

  test("no git on PATH, a failing git, a throwing runner, an output that is no count or a 1 ms deadline → null, never a throw", async () => {
    const { spec } = chipRepo();
    const savedPath = process.env.PATH;
    process.env.PATH = mkdtempSync(join(root, "no-git-"));
    try {
      expect(await aheadOfMain(spec, "feature/027-x")).toBeNull();
      expect(await dirty(spec)).toBeNull();
    } finally {
      if (savedPath === undefined) Reflect.deleteProperty(process.env, "PATH");
      else process.env.PATH = savedPath;
    }
    const missing: GitRunner = () => Promise.resolve(null);
    const failing: GitRunner = () => Promise.resolve({ code: 128, stdout: "?? partial\n", stderr: "fatal: broken\n" });
    const throwing: GitRunner = () => Promise.reject(new Error("spawn failed"));
    const deaf: GitRunner = () => new Promise(() => undefined);
    for (const options of [{ runner: missing }, { runner: failing }, { runner: throwing }, { runner: deaf, timeoutMs: 1 }]) {
      expect(await aheadOfMain(spec, "feature/027-x", options)).toBeNull();
      expect(await dirty(spec, options)).toBeNull();
    }
    for (const stdout of ["two\n", "", "-1\n", "2 3\n"]) {
      expect(await aheadOfMain(spec, "feature/027-x", { runner: () => Promise.resolve({ code: 0, stdout, stderr: "" }) })).toBeNull();
    }
  });

  test("runs only `rev-list --count main..<branch>` and `status --porcelain` in the worktree, under the read-only environment, no fetch", async () => {
    const { spec } = chipRepo();
    const { runner, seen } = recordingRunner();
    expect(await aheadOfMain(spec, "feature/027-x", { runner })).toBe(2);
    expect(await dirty(spec, { runner })).toBe(true);
    expect(seen.map((s) => s.args)).toEqual([
      ["-C", spec, "rev-list", "--count", "main..feature/027-x", "--"],
      ["-C", spec, "-c", "core.fsmonitor=false", "status", "--porcelain", "--untracked-files=normal"],
    ]);
    for (const s of seen) {
      expect(s.args).not.toContain("fetch");
      expect(s.args).not.toContain("--untracked-files=all");
      expect(s.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(spec) });
    }
  });

  test("reading distance and changes leaves the repository and its worktrees, .git/ and .worktrees/ included, byte- and mtime-identical (ISC-182)", async () => {
    const { dir, spec, clean, detached } = chipRepo();
    const before = checksum(dir);
    expect(await aheadOfMain(spec, "feature/027-x")).toBe(2);
    expect(await dirty(spec)).toBe(true);
    expect(await aheadOfMain(clean, "feature/028-clean")).toBe(0);
    expect(await dirty(clean)).toBe(false);
    expect(await dirty(detached)).toBe(false);
    await aheadOfMain(spec, "feature/027-x", { timeoutMs: 1 });
    await dirty(clean, { timeoutMs: 1 });
    expect(checksum(dir)).toBe(before);
  });
});

describe("read-only (ISC-15)", () => {
  test("the repository, .git/ included, is byte- and mtime-identical after every kind of read", async () => {
    const before = checksum(repo);
    const cache = new CommitCache();
    await commitsFor(repo, FOLDER);
    await commitsFor(repo, FOLDER, { files: true });
    await commitsFor(repo, FOLDER, { cache });
    await commitsFor(repo, FOLDER, { cache });
    await commitsFor(repo, "specs/999-missing");
    await commitsFor(repo, FOLDER, { timeoutMs: 1 });
    expect(checksum(repo)).toBe(before);
  });

  // Last in the file: restoring the bytes cannot restore a sub-millisecond mtime, so this check compares content only.
  test("the hash sees a one-byte change under .git/", () => {
    const description = join(repo, ".git", "description");
    const original = readFileSync(description);
    const before = checksum(repo, false);
    try {
      writeFileSync(description, Buffer.concat([original, Buffer.from("x")]));
      expect(checksum(repo, false)).not.toBe(before);
    } finally {
      writeFileSync(description, original);
    }
    expect(checksum(repo, false)).toBe(before);
  });
});

describe("this repository (integration)", () => {
  const self = join(import.meta.dir, "..");
  // The file's empty global config also drops any safe.directory the runner set, and a CI job container runs as
  // root over a checkout another uid owns, so git refuses it as "dubious ownership". Trust this one path, only here.
  let trustedConfig: string;
  beforeAll(() => {
    trustedConfig = join(root, "gitconfig-self");
    writeFileSync(trustedConfig, `[safe]\n\tdirectory = ${self}\n`);
    process.env.GIT_CONFIG_GLOBAL = trustedConfig;
  });
  afterAll(() => {
    process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
  });
  const hasGit = ((): boolean => {
    try {
      lstatSync(join(self, ".git"));
      return true;
    } catch {
      return false;
    }
  })();

  // `specs/` is untracked planning material (since 2026-10-11), so the repository's own commits are read for a
  // tracked path the implement rounds touched: core/src carries round commits of specs 001 to 003.
  test.skipIf(!hasGit)("this repository's core/src has its round commits", async () => {
    const result = await commitsFor(self, "core/src");
    // A failed read carries its reason; surface it, because on CI the checkout may be shallow, foreign-owned or without git.
    if (result.source !== "git") throw new Error(`commitsFor on this repository answered none: ${result.diagnostic ?? "(no diagnostic)"}`);
    expect(result.head).toMatch(/^[0-9a-f]{40,64}$/);
    // At least one: a shallow clone (actions/checkout defaults to depth 1) carries only the tip commit.
    expect(result.commits.length).toBeGreaterThanOrEqual(1);
    for (const c of result.commits) {
      expect(c.sha).toMatch(/^[0-9a-f]{40,64}$/);
      expect(Number.isNaN(Date.parse(c.ts))).toBe(false);
      expect(c.subject.length).toBeGreaterThan(0);
      expect(c.subject).not.toContain("\n");
    }
    // A depth-1 checkout shows only the tip commit, whatever its subject; the round-commit subjects are proven on the
    // temp repositories above, so here only a full clone may expect one.
    if (result.commits.length > 1) expect(result.commits.some((c) => /round \d+/.test(c.subject))).toBe(true);
  });
});

describe("mergeCommitOf names the commit that merged a spec branch into main (spec 027, T25, ISC-175.1)", () => {
  /**
   * main: a → b → m1 → M (merge of feature/001-x: x1 → x2) → m2. `feature/002-ff` sits at m1 on main's first-parent
   * line, `feature/003-open` one commit past m2, unmerged.
   */
  function mergeRepo(): { dir: string; merge: string } {
    const dir = mkdtempSync(join(root, "merge-commit-"));
    git(dir, "2026-02-01T00:00:00Z", "init", "-q", "-b", "main");
    commit(dir, "2026-02-01T00:00:00Z", "a", { "a.txt": "a\n" });
    commit(dir, "2026-02-02T00:00:00Z", "b", { "b.txt": "b\n" });
    git(dir, "2026-02-03T00:00:00Z", "switch", "-q", "-c", "feature/001-x");
    commit(dir, "2026-02-03T00:00:00Z", "x1", { "x1.txt": "x1\n" });
    commit(dir, "2026-02-04T00:00:00Z", "x2", { "x2.txt": "x2\n" });
    git(dir, "2026-02-05T00:00:00Z", "switch", "-q", "main");
    commit(dir, "2026-02-05T00:00:00Z", "m1", { "m1.txt": "m1\n" });
    git(dir, "2026-02-06T10:00:00Z", "merge", "-q", "--no-ff", "-m", "merge 001", "feature/001-x");
    const merge = git(dir, "2026-02-06T10:00:00Z", "rev-parse", "HEAD");
    commit(dir, "2026-02-07T00:00:00Z", "m2", { "m2.txt": "m2\n" });
    git(dir, "2026-02-08T00:00:00Z", "branch", "feature/002-ff", "main~2");
    git(dir, "2026-02-08T00:00:00Z", "switch", "-q", "-c", "feature/003-open");
    commit(dir, "2026-02-08T00:00:00Z", "o1", { "o1.txt": "o1\n" });
    git(dir, "2026-02-08T00:00:00Z", "switch", "-q", "main");
    return { dir, merge };
  }

  test("merged: the merge commit on main's first-parent line with its committer date", async () => {
    const { dir, merge } = mergeRepo();
    const found = await mergeCommitOf(dir, "feature/001-x");
    expect(found?.commit).toBe(merge);
    expect(Date.parse(found?.at ?? "")).toBe(Date.parse("2026-02-06T10:00:00Z"));
  });

  test("a tip on main's first-parent line, an open branch, an unknown or unplain name → null", async () => {
    const { dir } = mergeRepo();
    expect(await mergeCommitOf(dir, "feature/002-ff")).toBeNull();
    expect(await mergeCommitOf(dir, "feature/003-open")).toBeNull();
    expect(await mergeCommitOf(dir, "feature/004-none")).toBeNull();
    const { runner, calls } = countingRunner();
    expect(await mergeCommitOf(dir, "main..feature/001-x", { runner })).toBeNull();
    expect(await mergeCommitOf(dir, "-x", { runner })).toBeNull();
    expect(calls).toEqual([]);
  });

  test("runs only for-each-ref, rev-list --first-parent and log --ancestry-path, rooted, under the read-only environment", async () => {
    const { dir } = mergeRepo();
    const seen: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: GitRunner = (args, env, signal) => {
      seen.push({ args: [...args], env });
      return defaultGitRunner(args, env, signal);
    };
    expect(await mergeCommitOf(dir, "feature/001-x", { runner })).not.toBeNull();
    expect(seen.map((s) => s.args)).toEqual([
      ["-C", dir, "for-each-ref", "--format=%(objectname)", "refs/heads/feature/001-x"],
      ["-C", dir, "rev-list", "--first-parent", "refs/heads/main", "--"],
      ["-C", dir, "log", "--ancestry-path", "--format=%H %cI %P", "refs/heads/feature/001-x..refs/heads/main", "--"],
    ]);
    for (const s of seen) expect(s.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CEILING_DIRECTORIES: dirname(dir) });
  });

  test("no repository root, a failing or throwing runner and the deadline → null, never a throw", async () => {
    const { dir } = mergeRepo();
    const { runner, calls } = countingRunner();
    expect(await mergeCommitOf(mkdtempSync(join(root, "merge-plain-")), "feature/001-x", { runner })).toBeNull();
    expect(calls).toEqual([]);
    expect(await mergeCommitOf(dir, "feature/001-x", { runner: () => Promise.resolve(null) })).toBeNull();
    expect(await mergeCommitOf(dir, "feature/001-x", { runner: () => Promise.resolve({ code: 128, stdout: "", stderr: "fatal\n" }) })).toBeNull();
    expect(await mergeCommitOf(dir, "feature/001-x", { runner: () => Promise.reject(new Error("spawn failed")) })).toBeNull();
    expect(await mergeCommitOf(dir, "feature/001-x", { runner: () => new Promise(() => undefined), timeoutMs: 20 })).toBeNull();
  });

  test("reading the merge commit leaves the repository, .git/ included, byte- and mtime-identical (ISC-15)", async () => {
    const { dir } = mergeRepo();
    const before = checksum(dir);
    for (const branch of ["feature/001-x", "feature/002-ff", "feature/003-open"]) await mergeCommitOf(dir, branch);
    await mergeCommitOf(dir, "feature/001-x", { timeoutMs: 1 });
    expect(checksum(dir)).toBe(before);
  });
});
