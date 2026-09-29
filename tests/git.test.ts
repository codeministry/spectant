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
import { dirname, join } from "node:path";
import { CommitCache, commitsFor, defaultGitRunner, type GitRunner } from "../server/src/git.ts";

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
  const hasGit = ((): boolean => {
    try {
      lstatSync(join(self, ".git"));
      return true;
    } catch {
      return false;
    }
  })();

  test.skipIf(!hasGit)("spec 001's folder has its round commits", async () => {
    const result = await commitsFor(self, "specs/001-app-skeleton");
    expect(result.source).toBe("git");
    expect(result.head).toMatch(/^[0-9a-f]{40,64}$/);
    expect(result.commits.length).toBeGreaterThan(5);
    for (const c of result.commits) {
      expect(c.sha).toMatch(/^[0-9a-f]{40,64}$/);
      expect(Number.isNaN(Date.parse(c.ts))).toBe(false);
      expect(c.subject.length).toBeGreaterThan(0);
      expect(c.subject).not.toContain("\n");
    }
    expect(result.commits.some((c) => /round \d+/.test(c.subject))).toBe(true);
  });
});
