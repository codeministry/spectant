// Spec edges against git (spec 025, T11, ISC-162.1): a fixture repository with real git, one blocker spec per case, and
// one consumer spec whose claims each wait on one of them. The server reads the merge state (`git.ts`
// `mergedSpecBranches`, `workspace-loader.ts` `mergeStateOf`), `core/`'s `resolveEdges` decides open or met:
//
// | blocker | branch                          | frontmatter       | edge |
// |---------|---------------------------------|-------------------|------|
// | 002     | `feature/002-…`, not in `main`  | `phase: complete` | open (the branch decides) |
// | 003     | `infra/003-…`, merged into main | `phase: building` | met  |
// | 004     | deleted                         | `phase: complete` | met  |
// | 005     | deleted                         | `phase: building` | open |
// | 001     | none, under `specs/archive/`    | `phase: building` | met  |
//
// The reads never write: `.git/` is hashed, every file's bytes and mtime, before and after them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveEdges } from "../core/src/spec-edges.ts";
import { type GitRunner, MergeCache, defaultGitRunner, mergedSpecBranches } from "../server/src/git.ts";
import { readWorkspaceInput } from "../server/src/workspace-loader.ts";

const DATE = "2026-03-08T12:00:00Z";

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Spectant Test",
      GIT_AUTHOR_EMAIL: "edges@example.com",
      GIT_COMMITTER_NAME: "Spectant Test",
      GIT_COMMITTER_EMAIL: "edges@example.com",
      GIT_AUTHOR_DATE: DATE,
      GIT_COMMITTER_DATE: DATE,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

function specText(folder: string, phase: string, claims: readonly string[]): string {
  return [
    "---",
    `task: "Spec ${folder}"`,
    `slug: ${folder}`,
    "spec_type: feature",
    `phase: ${phase}`,
    "---",
    "",
    `# ${folder}`,
    "",
    "## Claims",
    "",
    ...claims,
    "",
  ].join("\n");
}

function writeSpec(dir: string, folder: string, phase: string, claims: readonly string[] = ["- [ ] ISC-1: The blocker's own work."]): void {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, "spec.md"), specText(folder, phase, claims));
}

/** A commit on top of `parent` with the same tree, written without touching the index or the worktree. */
const commitOn = (repo: string, parent: string, message: string, ...more: string[]): string =>
  git(repo, "commit-tree", `${parent}^{tree}`, "-p", parent, ...more.flatMap((p) => ["-p", p]), "-m", message);

/** Every path under `.git/` with its bytes' digest and its mtime. */
function gitSnapshot(repo: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string): void => {
    const abs = join(repo, rel);
    const stat = lstatSync(abs);
    if (stat.isDirectory()) {
      out.set(rel, `dir ${stat.mtimeMs}`);
      for (const name of readdirSync(abs)) walk(join(rel, name));
    } else {
      out.set(rel, `${createHash("sha256").update(readFileSync(abs)).digest("hex")} ${stat.mtimeMs}`);
    }
  };
  walk(".git");
  return out;
}

let root: string;
let repo: string;
let unmerged002: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-spec-edges-")));
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    savedEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  repo = join(root, "edges");
  const specs = join(repo, "specs");
  writeSpec(specs, "002-unmerged", "complete");
  writeSpec(specs, "003-merged", "building");
  writeSpec(specs, "004-deleted-complete", "complete");
  writeSpec(specs, "005-deleted-open", "building");
  writeSpec(join(specs, "archive"), "001-archived", "building");
  writeSpec(specs, "010-consumer", "building", [
    "- [ ] ISC-1: Waits on the unmerged branch. (after: 002)",
    "- [ ] ISC-2: Waits on the merged branch. (after: 003)",
    "- [ ] ISC-3: Waits on the deleted branch of a complete spec. (after: 004)",
    "- [ ] ISC-4: Waits on the deleted branch of an open spec. (after: 005)",
    "- [ ] ISC-5: Waits on the archived spec. (after: 001)",
  ]);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "edges fixture");
  const base = git(repo, "rev-parse", "HEAD");

  // 002: one commit main does not hold. Also under a prefix that is no spec branch, which must not count.
  unmerged002 = commitOn(repo, base, "work on 002");
  git(repo, "update-ref", "refs/heads/feature/002-unmerged", unmerged002);
  git(repo, "update-ref", "refs/heads/wip/003-merged", unmerged002);
  git(repo, "update-ref", "refs/heads/feature/not-a-spec", unmerged002);
  // 003: a commit merged into main with a merge commit; main (checked out) moves, the index and worktree stay as they are.
  const work003 = commitOn(repo, base, "work on 003");
  git(repo, "update-ref", "refs/heads/infra/003-merged", work003);
  git(repo, "update-ref", "refs/heads/main", commitOn(repo, base, "Merge branch 'infra/003-merged'", work003));
  // 004 and 005: a branch that existed and is gone.
  git(repo, "branch", "fix/004-deleted-complete", unmerged002);
  git(repo, "branch", "spike/005-deleted-open", unmerged002);
  git(repo, "branch", "-D", "fix/004-deleted-complete", "spike/005-deleted-open");
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

/** The consumer's edges as `claim → target state`, resolved from a fresh workspace read. */
async function consumerEdges(): Promise<string[]> {
  const reading = await readWorkspaceInput(repo);
  if (!reading.readable) throw new Error(`unreadable: ${reading.error}`);
  const { edges } = resolveEdges(reading.input, reading.mergeState);
  return edges.filter((e) => e.fromSpec === "010").map((e) => `${e.fromId} → ${e.toSpec} ${e.state}`);
}

/** A runner that records each git subcommand it spawns. */
function recording(): { runner: GitRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: GitRunner = (args, env, signal) => {
    calls.push(args[2] ?? "");
    return defaultGitRunner(args, env, signal);
  };
  return { runner, calls };
}

describe("ISC-162.1 merged: a spec edge is met by a merged branch, else by phase complete or the archive", () => {
  test("merged: git answers one row per local spec branch; other prefixes, non-spec names and deleted branches are not read", async () => {
    const result = await mergedSpecBranches(repo, { cache: new MergeCache() });
    expect(result.source).toBe("git");
    expect(result.branches).toEqual([
      { spec: "002", branch: "feature/002-unmerged", merged: false },
      { spec: "003", branch: "infra/003-merged", merged: true },
    ]);
  });

  test("merged: one MergeState per spec, active and archived, with branch, merged, complete and archived", async () => {
    const reading = await readWorkspaceInput(repo);
    if (!reading.readable) throw new Error(`unreadable: ${reading.error}`);
    expect([...reading.mergeState].sort((a, b) => a.spec.localeCompare(b.spec))).toEqual([
      { spec: "001", branch: null, merged: false, complete: false, archived: true },
      { spec: "002", branch: "feature/002-unmerged", merged: false, complete: true, archived: false },
      { spec: "003", branch: "infra/003-merged", merged: true, complete: false, archived: false },
      { spec: "004", branch: null, merged: false, complete: true, archived: false },
      { spec: "005", branch: null, merged: false, complete: false, archived: false },
      { spec: "010", branch: null, merged: false, complete: false, archived: false },
    ]);
  });

  test("merged: not merged open, merged met, deleted with complete met, deleted without open, archived met", async () => {
    expect(await consumerEdges()).toEqual(["ISC-1 → 002 open", "ISC-2 → 003 met", "ISC-3 → 004 met", "ISC-4 → 005 open", "ISC-5 → 001 met"]);
  });

  test("merged: the cache skips merge-base while main and the spec branches stand still, and a merge into main is seen", async () => {
    const cache = new MergeCache();
    const first = recording();
    await mergedSpecBranches(repo, { cache, runner: first.runner });
    expect(first.calls).toEqual(["for-each-ref", "merge-base", "merge-base"]); // 002 and 003, neither at main's tip
    const again = recording();
    const cached = await mergedSpecBranches(repo, { cache, runner: again.runner });
    expect(again.calls).toEqual(["for-each-ref"]);
    expect(cached.branches.find((b) => b.spec === "002")?.merged).toBe(false);

    // Merge 002 into main: the ref state changes, the read runs again and the edge on 002 turns met.
    const main = git(repo, "rev-parse", "refs/heads/main");
    git(repo, "update-ref", "refs/heads/main", commitOn(repo, main, "Merge branch 'feature/002-unmerged'", unmerged002));
    try {
      const moved = recording();
      const after = await mergedSpecBranches(repo, { cache, runner: moved.runner });
      expect(moved.calls.filter((c) => c === "merge-base").length).toBeGreaterThan(0);
      expect(after.branches.find((b) => b.spec === "002")?.merged).toBe(true);
      expect(await consumerEdges()).toEqual(["ISC-1 → 002 met", "ISC-2 → 003 met", "ISC-3 → 004 met", "ISC-4 → 005 open", "ISC-5 → 001 met"]);
    } finally {
      git(repo, "update-ref", "refs/heads/main", main);
    }
  });

  test("merged: without a repository the rows carry no branch and core decides by complete and archive", async () => {
    const plain = join(root, "plain");
    writeSpec(join(plain, "specs"), "002-unmerged", "complete");
    writeSpec(join(plain, "specs"), "010-consumer", "building", ["- [ ] ISC-1: Waits. (after: 002)"]);
    expect((await mergedSpecBranches(plain)).source).toBe("none");
    const reading = await readWorkspaceInput(plain);
    if (!reading.readable) throw new Error(`unreadable: ${reading.error}`);
    expect(reading.mergeState.find((r) => r.spec === "002")).toEqual({ spec: "002", branch: null, merged: false, complete: true, archived: false });
    expect(resolveEdges(reading.input, reading.mergeState).edges.map((e) => e.state)).toEqual(["met"]);
  });

  test("merged: the reads leave .git/ byte-identical, every mtime included; no fetch, no index refresh", async () => {
    const before = gitSnapshot(repo);
    await mergedSpecBranches(repo, { cache: new MergeCache() });
    await readWorkspaceInput(repo);
    await consumerEdges();
    const after = gitSnapshot(repo);
    expect([...after.keys()].filter((k) => after.get(k) !== before.get(k))).toEqual([]);
    expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
  });
});
