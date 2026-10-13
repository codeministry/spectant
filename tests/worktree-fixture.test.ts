// The worktree fixture repository (spec 027, T18, ISC-175): `tests/fixtures/worktree-repo.ts` plants a harbor repository
// with a spec worktree two commits ahead of `main` and one uncommitted file, plus a builder worktree; these probes prove
// that the server's own readers (`worktreeList`, `aheadOfMain`, `dirty`) and core's `assignWorktrees` and
// `specSourceOf` find in it exactly what the builder promises, for every option, and that it is the same on every run.
//
// The readers run under an empty global config and no system config (set on `process.env` for this file and restored
// after it), as in `tests/git.test.ts`; the builder needs none of it, it runs git under its own environment.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worktree } from "../core/src/files.ts";
import { assignWorktrees, specSourceOf } from "../core/src/worktrees.ts";
import { aheadOfMain, dirty, worktreeList } from "../server/src/git.ts";
import {
  BUILDER_WORKTREE,
  DATES,
  IDENTITY,
  plantWorktreeRepo,
  SPEC_BRANCH,
  SPEC_FOLDER,
  SPEC_ID,
  SPEC_WORKTREE,
  UNCOMMITTED,
  type PlantedWorktreeRepo,
  type WorktreeRepoOptions,
} from "./fixtures/worktree-repo.ts";

let parent: string;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  parent = mkdtempSync(join(tmpdir(), "spectant-worktree-fixture-"));
  const emptyConfig = join(parent, "gitconfig");
  writeFileSync(emptyConfig, "");
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    savedEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  rmSync(parent, { recursive: true, force: true });
});

const plant = (options: WorktreeRepoOptions = {}): Promise<PlantedWorktreeRepo> => plantWorktreeRepo({ ...options, parent });

/** One plant per option set, shared by the probes that only read it; the determinism probes plant afresh. */
const planted = new Map<string, Promise<PlantedWorktreeRepo>>();
function shared(options: WorktreeRepoOptions = {}): Promise<PlantedWorktreeRepo> {
  const key = JSON.stringify([options.trackedSpecs ?? false, options.merged ?? false, options.removeWorktree ?? false]);
  const known = planted.get(key);
  if (known !== undefined) return known;
  const fresh = plant(options);
  planted.set(key, fresh);
  return fresh;
}

/** The spec worktree of an assignment (git lists the linked worktrees sorted by path, the builder first). */
const specWorktree = (worktrees: readonly Worktree[]): Worktree | null => worktrees.find((w) => w.kind === "spec") ?? null;

/** The spec folder names of the main checkout, `NNN-slug`, as a loader hands them to `assignWorktrees`. */
const specFolders = (root: string): string[] => readdirSync(join(root, "specs")).filter((name) => /^\d{3}-/.test(name));

/** Runs git through the fixture and answers its trimmed stdout; a non-zero exit fails the test with git's stderr. */
async function out(repo: PlantedWorktreeRepo, cwd: string, ...args: string[]): Promise<string> {
  const run = await repo.git(cwd, ...args);
  expect({ args, code: run.code, stderr: run.stderr }).toEqual({ args, code: 0, stderr: "" });
  return run.stdout.trim();
}

describe("the spec worktree reads two commits ahead of main and dirty (ISC-175)", () => {
  for (const trackedSpecs of [false, true]) {
    test(`aheadOfMain 2 and dirty true, one uncommitted file and nothing else (trackedSpecs: ${String(trackedSpecs)})`, async () => {
      const repo = await shared({ trackedSpecs });
      expect(repo.expected).toEqual({ ahead: 2, dirty: true, builders: 1, trackedSpecs });
      expect(await aheadOfMain(repo.worktrees.spec, SPEC_BRANCH)).toBe(repo.expected.ahead ?? -1);
      expect(await dirty(repo.worktrees.spec)).toBe(repo.expected.dirty ?? false);
      expect(await out(repo, repo.worktrees.spec, "status", "--porcelain", "--untracked-files=normal")).toBe(`?? ${UNCOMMITTED}`);
      // The main checkout and the builder carry no change of their own.
      expect(await dirty(repo.root)).toBe(false);
      expect(await dirty(repo.worktrees.builder)).toBe(false);
      expect(await out(repo, repo.worktrees.builder, "rev-parse", "HEAD")).toBe(repo.commits.second);
    });
  }
});

describe("worktreeList and core's assignWorktrees find the spec worktree and one builder (ISC-174, ISC-175)", () => {
  for (const trackedSpecs of [false, true]) {
    test(`002 assigned by path and branch alike, no diagnostic, the builder counted (trackedSpecs: ${String(trackedSpecs)})`, async () => {
      const repo = await shared({ trackedSpecs });
      const { worktrees, builders, diagnostics } = assignWorktrees(await worktreeList(repo.root), specFolders(repo.root));
      expect(builders).toBe(repo.expected.builders);
      expect(diagnostics).toEqual([]);
      expect(worktrees).toEqual([
        { path: BUILDER_WORKTREE, branch: null, spec: null, ahead: null, dirty: null, kind: "builder" },
        { path: SPEC_WORKTREE, branch: SPEC_BRANCH, spec: SPEC_ID, ahead: null, dirty: null, kind: "spec" },
      ]);
    });
  }
});

describe("the two shapes of specs/ (ISC-181, ISC-181.1)", () => {
  test("trackedSpecs: true → ls-files lists the spec folder in main, the worktree's own copy differs, the source is the worktree", async () => {
    const repo = await shared({ trackedSpecs: true });
    const listed = (await out(repo, repo.root, "ls-files", "-z", "--", `specs/${SPEC_FOLDER}`)).split("\0").filter((p) => p !== "");
    expect(listed).toContain(`specs/${SPEC_FOLDER}/tasks.md`);
    expect(listed).toContain(`specs/${SPEC_FOLDER}/spec.md`);
    expect(listed.some((p) => p.includes("/.gates/"))).toBe(false);

    const main = join(repo.root, "specs", SPEC_FOLDER);
    const copy = join(repo.worktrees.spec, "specs", SPEC_FOLDER);
    expect(lstatSync(join(repo.worktrees.spec, "specs")).isDirectory()).toBe(true);
    const mainTasks = readFileSync(join(main, "tasks.md"), "utf8");
    const copyTasks = readFileSync(join(copy, "tasks.md"), "utf8");
    expect(copyTasks).not.toBe(mainTasks);
    expect(mainTasks).toContain("- [ ] T27 ·");
    expect(copyTasks).toContain("- [x] T27 ·");
    expect(copyTasks.match(/^- \[x\]/gm)?.length).toBe((mainTasks.match(/^- \[x\]/gm)?.length ?? 0) + 1);
    expect(readFileSync(join(main, "spec.md"), "utf8")).toMatch(/^stage: build$/m);
    expect(readFileSync(join(copy, "spec.md"), "utf8")).toMatch(/^stage: code-review$/m);
    // The gate marks stay outside the tree in both, and the copy carries the main checkout's reviewed mark.
    expect(readFileSync(join(copy, ".gates", "reviewed.json"), "utf8")).toBe(readFileSync(join(main, ".gates", "reviewed.json"), "utf8"));

    const { worktrees } = assignWorktrees(await worktreeList(repo.root), specFolders(repo.root));
    expect(specSourceOf({ folder: SPEC_FOLDER, worktree: specWorktree(worktrees), lsFiles: listed })).toBe("worktree");
  });

  test("trackedSpecs: false → ls-files answers nothing, the worktree's specs and ISA.md are relative links to main's, the source stays main", async () => {
    const repo = await shared({ trackedSpecs: false });
    expect(await out(repo, repo.root, "ls-files", "-z", "--", `specs/${SPEC_FOLDER}`)).toBe("");
    expect(await out(repo, repo.root, "ls-files", "--", "specs", "ISA.md")).toBe("");
    for (const name of ["specs", "ISA.md"]) {
      expect(lstatSync(join(repo.worktrees.spec, name)).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(repo.worktrees.spec, name))).toBe(`../../${name}`);
    }
    const viaLink = readFileSync(join(repo.worktrees.spec, "specs", SPEC_FOLDER, "tasks.md"), "utf8");
    expect(viaLink).toBe(readFileSync(join(repo.root, "specs", SPEC_FOLDER, "tasks.md"), "utf8"));

    const { worktrees } = assignWorktrees(await worktreeList(repo.root), specFolders(repo.root));
    expect(specSourceOf({ folder: SPEC_FOLDER, worktree: specWorktree(worktrees), lsFiles: [] })).toBe("main");
  });
});

describe("merged and removed (ISC-175.1)", () => {
  test("unmerged → the spec branch is no ancestor of main", async () => {
    const repo = await shared();
    expect((await repo.git(repo.root, "merge-base", "--is-ancestor", SPEC_BRANCH, "main")).code).toBe(1);
    expect(repo.commits.merge).toBeNull();
  });

  for (const trackedSpecs of [false, true]) {
    test(`merged: true → the branch is an ancestor of main, ahead 0, the merge commit dated (trackedSpecs: ${String(trackedSpecs)})`, async () => {
      const repo = await shared({ merged: true, trackedSpecs });
      expect((await repo.git(repo.root, "merge-base", "--is-ancestor", SPEC_BRANCH, "main")).code).toBe(0);
      expect(repo.expected).toEqual({ ahead: 0, dirty: true, builders: 1, trackedSpecs });
      expect(await aheadOfMain(repo.worktrees.spec, SPEC_BRANCH)).toBe(0);
      expect(await out(repo, repo.root, "rev-parse", "main")).toBe(repo.commits.merge ?? "");
      expect(await out(repo, repo.root, "show", "-s", "--format=%P", "main")).toBe(`${repo.commits.initial} ${repo.commits.second}`);
      const date = await out(repo, repo.root, "show", "-s", "--format=%cI", "main");
      expect(new Date(date).toISOString()).toBe(new Date(DATES.merge).toISOString());
      expect(await dirty(repo.root)).toBe(false);
    });
  }

  for (const trackedSpecs of [false, true]) {
    test(`removeWorktree: true → the path is gone, git no longer lists it, the branch and main's specs stay (trackedSpecs: ${String(trackedSpecs)})`, async () => {
      const repo = await shared({ removeWorktree: true, trackedSpecs });
      expect(existsSync(repo.worktrees.spec)).toBe(false);
      const listing = await worktreeList(repo.root);
      expect(listing).not.toContain(`/${SPEC_WORKTREE}\n`);
      expect(listing).toContain(`/${BUILDER_WORKTREE}\n`);
      expect(repo.expected).toEqual({ ahead: null, dirty: null, builders: 1, trackedSpecs });
      expect(await aheadOfMain(repo.worktrees.spec, SPEC_BRANCH)).toBeNull();
      expect(await dirty(repo.worktrees.spec)).toBeNull();
      expect(await out(repo, repo.root, "rev-parse", "--verify", SPEC_BRANCH)).toBe(repo.commits.second);
      // Removing the worktree removed its links, never what they pointed at.
      expect(existsSync(join(repo.root, "specs", SPEC_FOLDER, "spec.md"))).toBe(true);
      expect(existsSync(join(repo.root, "ISA.md"))).toBe(true);
      const { worktrees, builders } = assignWorktrees(listing, specFolders(repo.root));
      expect(worktrees.map((w) => w.path)).toEqual([BUILDER_WORKTREE]);
      expect(builders).toBe(1);
    });
  }

  test("merged and removed together: merge first, then the worktree goes", async () => {
    const repo = await shared({ merged: true, removeWorktree: true });
    expect((await repo.git(repo.root, "merge-base", "--is-ancestor", SPEC_BRANCH, "main")).code).toBe(0);
    expect(existsSync(repo.worktrees.spec)).toBe(false);
    expect(repo.expected.ahead).toBeNull();
  });
});

describe("deterministic and leak-free", () => {
  for (const options of [{ trackedSpecs: false }, { trackedSpecs: true }, { trackedSpecs: true, merged: true }]) {
    test(`two plants give the same commit and tree ids (${JSON.stringify(options)})`, async () => {
      const a = await shared(options);
      const b = await plant(options);
      expect(a.base).not.toBe(b.base);
      expect(b.commits).toEqual(a.commits);
      for (const ref of ["main^{tree}", `${SPEC_BRANCH}^{tree}`]) {
        expect(await out(b, b.root, "rev-parse", ref)).toBe(await out(a, a.root, "rev-parse", ref));
      }
    });
  }

  test("every commit carries the fixed identity and one of the fixed dates, never the clock", async () => {
    const repo = await shared({ trackedSpecs: true, merged: true });
    const lines = (await out(repo, repo.root, "log", "--all", "--format=%an|%ae|%aI|%cn|%ce|%cI")).split("\n");
    expect(lines).toHaveLength(4);
    const fixed = new Set<string>(Object.values(DATES).map((d) => new Date(d).toISOString()));
    for (const line of lines) {
      const [an, ae, ad, cn, ce, cd] = line.split("|");
      expect([an, ae, cn, ce]).toEqual([IDENTITY.name, IDENTITY.email, IDENTITY.name, IDENTITY.email]);
      expect(ad).toBe(cd);
      expect(fixed.has(new Date(ad ?? "").toISOString())).toBe(true);
    }
  });

  test("no committed byte names the temp directory or a home directory; the main checkout's tree holds no link", async () => {
    for (const trackedSpecs of [false, true]) {
      const repo = await shared({ trackedSpecs });
      for (const ref of ["main", SPEC_BRANCH]) {
        // `git grep` exits 1 when nothing matches.
        expect((await repo.git(repo.root, "grep", "-I", "-F", "-e", repo.base, ref)).code).toBe(1);
        expect((await repo.git(repo.root, "grep", "-I", "-E", "-e", "/(Users|home)/[A-Za-z0-9._-]+/", ref)).code).toBe(1);
        expect((await out(repo, repo.root, "ls-tree", "-r", ref)).split("\n").some((line) => line.startsWith("120000 "))).toBe(false);
      }
    }
  });
});
