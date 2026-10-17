// The feature-level code-review mark through the CLI (spec 008, T93/T94, ISC-122.2): `spectant gate code-reviewed F6`
// on a temp copy of harbor turned into a repository of its own. Harbor's spike pair 008/009 is main feature F6 under
// `code_review: feature`; 008 is closed, 009 holds ISC-131 open. With ISC-131 closed (master and spec.md) the command
// marks both folders (`scope: F6`, one `code-review → close` event each) and both then derive `close`; with it open it
// refuses and writes nothing; without `--yes` it only prints. `bun test tests/gates.test.ts -t feature` runs them all.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorIdOf } from "../core/src/actor-id.ts";
import { validateEventLine } from "../core/src/events.ts";
import type { SpecPageModel } from "../core/src/files.ts";
import { readGateMark } from "../core/src/gates.ts";
import { buildPlanning } from "../core/src/planning.ts";
import type { EmbeddedManifest } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { loadDashboard, readWorkspaceInput, worktreeTreeId } from "../server/src/workspace-loader.ts";
import { WRITE_PATHS } from "../server/src/writes.contract.ts";
import { type PlantedWorktreeRepo, SPEC_FOLDER, SPEC_ID, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const F6 = ["008-referrers-support", "009-chunked-upload-limits"];
/** A synthetic address (reserved `.test` domain): the viewer of the copy. */
const VIEWER_EMAIL = "viewer@example.test";
/** `run` takes the embedded manifest; the gate subcommand never serves, so an empty one does. */
const MANIFEST: EmbeddedManifest = { generatedAt: "2026-10-12T00:00:00.000Z", index: "", assets: [] };

const root = mkdtempSync(join(tmpdir(), "spectant-feature-gate-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function gitIn(repo: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)));
  const result = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** Ticks ISC-131 in the master and in 009's spec.md: 009's last open claim closed. */
function close131(repo: string): void {
  for (const file of [join(repo, "ISA.md"), join(repo, "specs", F6[1] ?? "", "spec.md")]) {
    const text = readFileSync(file, "utf8");
    const ticked = text.replace("- [ ] ISC-131:", "- [x] ISC-131:"); // single-core: allow — test setup ticks one known line
    expect(ticked).not.toBe(text);
    writeFileSync(file, ticked);
  }
}

/**
 * A fresh copy of harbor. `git: true` makes it a repository of its own with one commit, a local viewer address and
 * `.gates/` excluded (a reviewer's local marks, as for every per-spec mark), so the worktree tree id is computable.
 */
function harbor(options: { closed: boolean; git: boolean }): string {
  const repo = join(mkdtempSync(join(root, "repo-")), "harbor");
  cpSync(HARBOR, repo, { recursive: true });
  if (options.closed) close131(repo);
  if (options.git) {
    gitIn(repo, "init", "--quiet", "--initial-branch=main");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
    writeFileSync(join(repo, ".git", "info", "exclude"), "specs/*/.gates/\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "-c", "user.name=t", "commit", "--quiet", "-m", "harbor");
  }
  return repo;
}

/** Every file under `dir`, `.git/` included, to its sha256 (links to their target). */
function snapshot(dir: string, out = new Map<string, string>(), prefix = ""): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) snapshot(path, out, `${key}/`);
    else if (entry.isSymbolicLink()) out.set(key, `link:${readlinkSync(path)}`);
    else out.set(key, createHash("sha256").update(readFileSync(path)).digest("hex"));
  }
  return out;
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((k) => before.get(k) !== after.get(k)).sort();
}

const out: string[] = [];
const err: string[] = [];
const restore: Array<() => void> = [];
beforeEach(() => {
  out.length = 0;
  err.length = 0;
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
  const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
  restore.push(
    () => log.mockRestore(),
    () => error.mockRestore(),
  );
});
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

async function stagesOf(repo: string): Promise<Record<string, string>> {
  const load = await loadDashboard(repo, null);
  if (!load.readable) throw new Error(`unreadable: ${load.error}`);
  return Object.fromEntries(load.model.specs.filter((r) => F6.includes(r.slug)).map((r) => [r.slug, `${r.stage}/${r.gates.codeReviewed.state}`]));
}

describe("ISC-122.2 the feature-level code-review mark: spectant gate code-reviewed F<n>", () => {
  test("feature F6 closed: --yes marks both folders with scope F6, one code-review → close event each, both derive close", async () => {
    const repo = harbor({ closed: true, git: true });
    expect(await stagesOf(repo)).toEqual({ [F6[0] ?? ""]: "code-review/missing", [F6[1] ?? ""]: "code-review/missing" });
    const before = snapshot(repo);
    const events = new Map(F6.map((f) => [f, readFileSync(join(repo, "specs", f, "events.jsonl"), "utf8")]));

    expect(await run(["gate", "code-reviewed", "F6", "--root", repo, "--yes"], MANIFEST)).toBe(0);
    expect(err).toEqual([]);

    // Exactly the fifth write path's files, per target folder, and nothing else (`.git/` included).
    const allowed = F6.flatMap((f) => WRITE_PATHS.codeReviewFeature.writes.map((p) => p.replace("specs/NNN-slug/", `specs/${f}/`))).sort();
    expect(changed(before, snapshot(repo))).toEqual(allowed);

    const head = gitIn(repo, "rev-parse", "HEAD");
    const marks = F6.map((f) => readFileSync(join(repo, "specs", f, ".gates", "code-reviewed.json"), "utf8"));
    expect(marks[1]).toBe(marks[0] ?? ""); // the same mark in every target folder
    const reading = readGateMark("code-reviewed", marks[0] ?? "");
    expect(reading.diagnostics).toEqual([]);
    expect(reading.mark).toMatchObject({ gate: "code-reviewed", scope: "F6", head, branch: "main", findings: { code: 0, security: 0 } });
    expect((JSON.parse(marks[0] ?? "{}") as { actor?: unknown }).actor).toBe(actorIdOf(VIEWER_EMAIL));

    for (const f of F6) {
      const text = readFileSync(join(repo, "specs", f, "events.jsonl"), "utf8");
      const old = events.get(f) ?? "";
      expect(text.startsWith(old)).toBe(true);
      const added = text.slice(old.length).split("\n").filter((l) => l !== "");
      expect(added).toHaveLength(1);
      const check = validateEventLine(added[0] ?? "");
      if (!check.ok) throw new Error(check.diagnostic.message);
      expect(check.event).toMatchObject({ from: "code-review", to: "close", command: "spectant gate code-reviewed F6", actor: actorIdOf(VIEWER_EMAIL) });
    }

    // The dashboard, built by core over the copy as it now is: the mark is fresh and both specs stand in close.
    expect(await stagesOf(repo)).toEqual({ [F6[0] ?? ""]: "close/fresh", [F6[1] ?? ""]: "close/fresh" });
    expect(out.join("\n")).toContain("wrote the mark (scope F6");
  });

  // Spec 033 (ISC-186.1): a spec of F6 that holds no claim yet, an allocated story, stands under F6 in the planning tree
  // but is no target of the mark: the command marks 008 and 009 as before and leaves the story's folder byte-identical.
  test("feature F6 with a claimless spec of F6: --yes marks 008 and 009 only, the claimless folder stays byte-identical", async () => {
    const repo = harbor({ closed: true, git: true });
    const story = join(repo, "specs", "010-referrers-story");
    mkdirSync(story);
    const spec = ["---", 'task: "Story allocated under F6"', "slug: 010-referrers-story", "spec_type: spike", "isa_feature: F6", "stage: review", "---", "", "# 010 — referrers story", ""];
    writeFileSync(join(story, "spec.md"), spec.join("\n"));
    writeFileSync(join(story, "events.jsonl"), `${JSON.stringify({ ts: "2026-03-10T09:00:00Z", from: null, to: "review", command: "/spec new referrers-story", actor: "u:3f9c0a7d" })}\n`);
    gitIn(repo, "add", "-A");
    gitIn(repo, "-c", "user.name=t", "commit", "--quiet", "-m", "story");
    const reading = await readWorkspaceInput(repo, null);
    if (!reading.readable) throw new Error(`unreadable: ${reading.error}`);
    const f6 = buildPlanning({ ...reading.input, ideas: reading.ideas, workflow: reading.workflow }).features.find((f) => f.id === "F6");
    expect(f6?.holders.find((h) => h.slug === "010-referrers-story")).toMatchObject({ main: true, held: 0 });
    const before = snapshot(repo);

    expect(await run(["gate", "code-reviewed", "F6", "--root", repo, "--yes"], MANIFEST)).toBe(0);
    expect(err).toEqual([]);
    const allowed = F6.flatMap((f) => WRITE_PATHS.codeReviewFeature.writes.map((p) => p.replace("specs/NNN-slug/", `specs/${f}/`))).sort();
    const touched = changed(before, snapshot(repo));
    expect(touched).toEqual(allowed);
    expect(touched.filter((path) => path.startsWith("specs/010-referrers-story/"))).toEqual([]);
  });

  test("feature F6 with 009 open: refuses with exit 1, names 009 and ISC-131, and writes nothing", async () => {
    const repo = harbor({ closed: false, git: true });
    const before = snapshot(repo);
    expect(await run(["gate", "code-reviewed", "F6", "--root", repo, "--yes"], MANIFEST)).toBe(1);
    expect(changed(before, snapshot(repo))).toEqual([]);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("F6 still has open claims: 009-chunked-upload-limits (open claim ISC-131)");
  });

  test("feature F6 without --yes: prints what it would write, exits 0, and writes nothing", async () => {
    const repo = harbor({ closed: true, git: true });
    const before = snapshot(repo);
    expect(await run(["gate", "code-reviewed", "F6", "--root", repo], MANIFEST)).toBe(0);
    expect(changed(before, snapshot(repo))).toEqual([]);
    expect(err).toEqual([]);
    const printed = out.join("\n");
    expect(printed).toContain("would write the mark (scope F6");
    for (const f of F6) expect(printed).toContain(`specs/${f}/.gates/code-reviewed.json · code-review → close in specs/${f}/events.jsonl`);
    expect(printed).toContain("run it again with --yes");
  });

  test("feature gate refuses without a computable tree id, for an unknown feature, and parses usage errors", async () => {
    const plain = harbor({ closed: true, git: false });
    const before = snapshot(plain);
    expect(await run(["gate", "code-reviewed", "F6", "--root", plain, "--yes"], MANIFEST)).toBe(1);
    expect(err.join("\n")).toContain("tree id cannot be computed");
    expect(await run(["gate", "code-reviewed", "F99", "--root", plain, "--yes"], MANIFEST)).toBe(1);
    expect(err.join("\n")).toContain("F99 is not a feature block of the master");
    expect(changed(before, snapshot(plain))).toEqual([]);
    expect(await run(["gate", "code-reviewed", "6", "--root", plain], MANIFEST)).toBe(2);
    expect(await run(["gate", "reviewed", "F6"], MANIFEST)).toBe(2);
    expect(await run(["list", "--root", plain], MANIFEST)).toBe(2);
  });
});

// The code-review mark of a spec with a worktree of its own (spec 027, T20, ISC-176), on the fixture repository of
// `tests/fixtures/worktree-repo.ts`: spec 002 has the worktree `.worktrees/002-web-console`, two commits ahead of `main`
// with one uncommitted file; spec 004 has none. Each spec gets a mark whose tree is what `/spec-code-review` records
// where it ran, `git add -A && git write-tree` (here through a throwaway index outside the repository): 002's in its
// worktree, 004's in the main checkout. 002 reads fresh while its worktree stands, stale after a change there, and fresh
// again after that change is undone, whatever the main checkout does; 004 computes against the main checkout as before.
// `specs/` is untracked and linked into the worktree (the fixture's default), so both marks live in the main
// checkout's folders and the read source stays `main`. `bun test tests/gates.test.ts -t worktree` runs the group.
describe("ISC-176 worktree: the code-review mark of a spec with a worktree compares with the worktree's tree", () => {
  const WITHOUT = "004-retention-policies";
  let planted: PlantedWorktreeRepo;
  let registry: Registry;

  beforeAll(async () => {
    planted = await plantWorktreeRepo({ parent: root });
    registry = openRegistry(mkdtempSync(join(root, "data-")));
    registry.add(planted.root);
  });
  afterAll(() => registry.close());

  /** What `git add -A && git write-tree` prints in `dir`, through a throwaway index outside the repository. */
  function reviewedTree(dir: string): string {
    const index = join(planted.base, `review-index-${Math.random().toString(36).slice(2)}`);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE"].includes(key)));
    const git = (...args: string[]): string => {
      const result = Bun.spawnSync(["git", "-C", dir, ...args], { env: { ...env, GIT_INDEX_FILE: index }, stdout: "pipe", stderr: "pipe" });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
      return result.stdout.toString().trim();
    };
    git("read-tree", "HEAD");
    git("add", "-A");
    return git("write-tree");
  }

  /** A code-reviewed mark over `tree` in the main checkout's folder of the spec (the worktree links `specs/` to it). */
  function mark(folder: string, tree: string): void {
    const dir = join(planted.root, "specs", folder, ".gates");
    mkdirSync(dir, { recursive: true });
    const text = `${JSON.stringify({ gate: "code-reviewed", at: "2026-03-05T10:00:00Z", tree, code: 0, security: 0 }, null, 2)}\n`;
    expect(readGateMark("code-reviewed", text).diagnostics).toEqual([]);
    writeFileSync(join(dir, "code-reviewed.json"), text);
  }

  /** The code-reviewed state of 002 and 004 on the dashboard rows and on each spec page: the two never disagree. */
  async function states(): Promise<Record<string, string>> {
    const load = await loadDashboard(planted.root, null);
    if (!load.readable) throw new Error(`unreadable: ${load.error}`);
    const rows = Object.fromEntries(load.model.specs.map((row) => [row.slug, row.gates.codeReviewed.state]));
    const handler = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
    const answer: Record<string, string> = {};
    for (const [id, folder] of [[SPEC_ID, SPEC_FOLDER], ["004", WITHOUT]] as const) {
      const url = new URL(`http://127.0.0.1:7717${specRoutes.spec("harbor", id)}`);
      const res = await handler(new Request(url.href, { headers: { Host: "127.0.0.1:7717" } }), url);
      if (res === null) throw new Error(`the spec routes declined ${id}`);
      const page = (await res.json()) as SpecPageModel;
      expect(rows[folder]).toBe(page.gates.codeReviewed.state);
      answer[folder] = page.gates.codeReviewed.state;
    }
    return answer;
  }

  test("worktree: marked in the worktree → fresh; a change in the worktree → stale; a change only in the main checkout → fresh", async () => {
    const worktreeFile = join(planted.worktrees.spec, "src", "console.ts");
    const mainFile = join(planted.root, "src", "console.ts");
    const worktreeText = readFileSync(worktreeFile, "utf8");
    const mainText = readFileSync(mainFile, "utf8");
    mark(SPEC_FOLDER, reviewedTree(planted.worktrees.spec));
    mark(WITHOUT, reviewedTree(planted.root));
    // The worktree is two commits ahead with an uncommitted file: its tree is not the main checkout's.
    expect(reviewedTree(planted.worktrees.spec)).not.toBe(reviewedTree(planted.root));

    expect(await states()).toEqual({ [SPEC_FOLDER]: "fresh", [WITHOUT]: "fresh" });

    writeFileSync(worktreeFile, `${worktreeText}// reviewed? not this line.\n`);
    expect(await states()).toEqual({ [SPEC_FOLDER]: "stale", [WITHOUT]: "fresh" });

    writeFileSync(worktreeFile, worktreeText);
    writeFileSync(mainFile, `${mainText}// a change on main only.\n`);
    // 002 holds: its worktree is as reviewed. 004 has no worktree and computes against the main checkout, as before.
    expect(await states()).toEqual({ [SPEC_FOLDER]: "fresh", [WITHOUT]: "stale" });

    writeFileSync(mainFile, mainText);
    expect(await states()).toEqual({ [SPEC_FOLDER]: "fresh", [WITHOUT]: "fresh" });
  });
});

// The feature-level code-review mark of a spec with a worktree of its own (spec 041, T38, ISC-211), on the fixture of
// `tests/fixtures/worktree-repo.ts`: spec 002 (main feature F2, its open claims ticked in the master and the spec so the
// CLI does not refuse) has the worktree `.worktrees/002-web-console`. `spectant gate code-reviewed F2 --yes` must hash
// that worktree, not the main checkout, and write the mark into the spec's read source: (A) with `specs/` tracked, the
// worktree's copy `specs/002-web-console/`, the main checkout untouched; (B) with `specs/` untracked and linked into
// the worktree (this repository's own layout), the main checkout's folder, the same file through the link. The app then
// reads the mark fresh, stale after a change only in the worktree, and still stale after a further change only in the
// main checkout. `bun test tests/gates.test.ts -t "cli mark worktree"` runs the group.
describe("ISC-211 cli mark worktree: spectant gate code-reviewed F<n> marks a spec with a worktree against that worktree", () => {
  const F2_OPEN = /^- \[ \] (ISC-7[4-8]):/gm;

  /** Ticks F2's open claims ISC-74…78 in `file`; returns whether anything changed. */
  function closeF2(file: string): boolean {
    const text = readFileSync(file, "utf8");
    const ticked = text.replace(F2_OPEN, "- [x] $1:"); // single-core: allow — test setup ticks known claim lines
    if (ticked === text) return false;
    writeFileSync(file, ticked);
    return true;
  }

  /** Every file of the main checkout, its worktrees, `.claude/` and `.git/` left out. */
  function mainSnapshot(repo: string): Map<string, string> {
    const all = snapshot(repo);
    for (const key of [...all.keys()]) if (/^(\.worktrees|\.claude|\.git)\//.test(key)) all.delete(key);
    return all;
  }

  async function stateOf002(repo: string): Promise<string> {
    const load = await loadDashboard(repo, null);
    if (!load.readable) throw new Error(`unreadable: ${load.error}`);
    const row = load.model.specs.find((r) => r.slug === SPEC_FOLDER);
    if (row === undefined) throw new Error(`no row for ${SPEC_FOLDER}`);
    return row.gates.codeReviewed.state;
  }

  function treeOf(markFile: string): string | undefined {
    const reading = readGateMark("code-reviewed", readFileSync(markFile, "utf8"));
    expect(reading.diagnostics).toEqual([]);
    return reading.mark !== null && "tree" in reading.mark ? reading.mark.tree : undefined;
  }

  async function changeOnlyInWorktreeThenMain(planted: PlantedWorktreeRepo): Promise<void> {
    const worktreeFile = join(planted.worktrees.spec, "src", "console.ts");
    writeFileSync(worktreeFile, `${readFileSync(worktreeFile, "utf8")}// reviewed? not this line.\n`);
    expect(await stateOf002(planted.root)).toBe("stale");
    const mainFile = join(planted.root, "src", "console.ts");
    writeFileSync(mainFile, `${readFileSync(mainFile, "utf8")}// a change on main only.\n`);
    expect(await stateOf002(planted.root)).toBe("stale");
  }

  test("cli mark worktree (A, tracked specs/): the mark lands in the worktree's copy with the worktree's tree; current → stale → stays stale", async () => {
    const planted = await plantWorktreeRepo({ parent: root, trackedSpecs: true });
    const copy = join(planted.worktrees.spec, "specs", SPEC_FOLDER);
    for (const file of [join(planted.root, "ISA.md"), join(planted.root, "specs", SPEC_FOLDER, "spec.md"), join(planted.worktrees.spec, "ISA.md"), join(copy, "spec.md")]) {
      expect(closeF2(file)).toBe(true);
    }
    const mainBefore = mainSnapshot(planted.root);

    expect(await run(["gate", "code-reviewed", "F2", "--root", planted.root, "--yes"], MANIFEST)).toBe(0);
    expect(err).toEqual([]);

    const copyMark = join(copy, ".gates", "code-reviewed.json");
    expect(existsSync(copyMark)).toBe(true);
    expect(treeOf(copyMark)).toBe((await worktreeTreeId(planted.worktrees.spec)) ?? "no worktree tree");
    expect(existsSync(join(planted.root, "specs", SPEC_FOLDER, ".gates", "code-reviewed.json"))).toBe(false);
    expect(changed(mainBefore, mainSnapshot(planted.root))).toEqual([]);

    expect(await stateOf002(planted.root)).toBe("fresh");
    await changeOnlyInWorktreeThenMain(planted);
  });

  test("cli mark worktree (B, linked specs/): the mark lands in the main checkout's folder with the worktree's tree; current → stale → stays stale", async () => {
    const planted = await plantWorktreeRepo({ parent: root });
    for (const file of [join(planted.root, "ISA.md"), join(planted.root, "specs", SPEC_FOLDER, "spec.md")]) expect(closeF2(file)).toBe(true);

    expect(await run(["gate", "code-reviewed", "F2", "--root", planted.root, "--yes"], MANIFEST)).toBe(0);
    expect(err).toEqual([]);

    const mainMark = join(planted.root, "specs", SPEC_FOLDER, ".gates", "code-reviewed.json");
    expect(existsSync(mainMark)).toBe(true);
    // The worktree links `specs/` to the main checkout's: the same file through the link.
    expect(readFileSync(join(planted.worktrees.spec, "specs", SPEC_FOLDER, ".gates", "code-reviewed.json"), "utf8")).toBe(readFileSync(mainMark, "utf8"));
    const worktreeTree = await worktreeTreeId(planted.worktrees.spec);
    expect(worktreeTree).not.toBe(await worktreeTreeId(planted.root));
    expect(treeOf(mainMark)).toBe(worktreeTree ?? "no worktree tree");

    expect(await stateOf002(planted.root)).toBe("fresh");
    await changeOnlyInWorktreeThenMain(planted);
  });
});
