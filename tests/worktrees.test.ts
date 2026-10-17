// The end of a spec's worktree on its timeline (spec 027, T25, ISC-175.1): `GET /api/workspaces/:ws/specs/:id/timeline`
// through the real spec routes, over the git fixture of `tests/fixtures/worktree-repo.ts`.
//
// The contract under test (server/src/workspace-loader.ts `timelineWorktreeOf`, core/src/timeline.ts): a spec branch
// merged into `main` is one derived `worktree` entry `merged`, dated by the merge commit; a spec branch, unmerged, that
// no live worktree carries is one undated entry `removed`, naming the worktree's path while git still lists it; an open
// branch with its worktree, or one checked out in the main checkout, gives none. Merged or removed, the worktree leaves
// the dashboard reading, so no chip shows. Nothing is written: `events.jsonl` stays byte-identical.
import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { TimelineEntry } from "../core/src/files.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { SPEC_HASH_HEADER, TASKS_HASH_HEADER, specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { loadCatalogDoc, loadCatalogDocs, readWorkspaceInput } from "../server/src/workspace-loader.ts";
import { rawSha256 } from "../server/src/writes.ts";
import {
  DATES,
  type PlantedWorktreeRepo,
  SPEC_BRANCH,
  SPEC_FOLDER,
  SPEC_ID,
  SPEC_WORKTREE,
  UNCOMMITTED,
  type WorktreeRepoOptions,
  plantWorktreeRepo,
} from "./fixtures/worktree-repo.ts";

const HOST = { Host: "127.0.0.1:7717" };
const bases: string[] = [];
const registries: Registry[] = [];

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  for (const base of bases.splice(0)) rmSync(base, { recursive: true, force: true });
});

async function plant(options: WorktreeRepoOptions = {}): Promise<PlantedWorktreeRepo> {
  const repo = await plantWorktreeRepo(options);
  bases.push(repo.base);
  return repo;
}

/** The spec routes for the fixture's main checkout, registered alone; the workspace slug is the folder's name. */
function handlerFor(repo: PlantedWorktreeRepo): ApiHandler {
  const registry = openRegistry(mkdtempSync(join(repo.base, "data-")));
  registries.push(registry);
  registry.add(repo.root);
  return specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
}

/** The spec's timeline entries of kind `worktree`, and the bytes of its events.jsonl before and after the read. */
async function worktreeEntries(repo: PlantedWorktreeRepo): Promise<{ entries: TimelineEntry[]; eventsBefore: Buffer; eventsAfter: Buffer }> {
  const events = join(repo.root, "specs", SPEC_FOLDER, "events.jsonl");
  const eventsBefore = readFileSync(events);
  const path = specRoutes.timeline("harbor", SPEC_ID);
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const res = await handlerFor(repo)(new Request(url.href, { headers: HOST }), url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  expect(res.status).toBe(200);
  const entries = ((await res.json()) as TimelineEntry[]).filter((e) => e.kind === "worktree");
  return { entries, eventsBefore, eventsAfter: readFileSync(events) };
}

/** The spec worktrees the dashboard reading hands to `core/` for spec 002: what its chip is made of. */
async function chipWorktrees(repo: PlantedWorktreeRepo): Promise<Array<string | null>> {
  const reading = await readWorkspaceInput(repo.root);
  if (!reading.readable) throw new Error("the fixture workspace is unreadable");
  return (reading.input.worktrees?.worktrees ?? []).filter((w) => w.kind === "spec" && w.spec === SPEC_ID).map((w) => w.path);
}

describe("ISC-175.1 merged: the timeline derives the end of a spec's worktree from git, the chip goes, nothing is written", () => {
  test("merged: branch merged into main → one derived entry at the merge commit's date, chip gone, events.jsonl byte-identical", async () => {
    const repo = await plant({ merged: true });
    // A clean worktree: an uncommitted change would keep the merged worktree live (ISC-212.2, `merged edge cases`).
    rmSync(join(repo.worktrees.spec, UNCOMMITTED));
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.derived).toBe(true);
    expect(entry?.ref).toBe("merged");
    expect(Date.parse(entry?.ts ?? "")).toBe(Date.parse(DATES.merge));
    expect(entry?.worktree).toEqual({ state: "merged", branch: SPEC_BRANCH, path: SPEC_WORKTREE, commit: repo.commits.merge?.slice(0, 7) ?? null });
    expect(await chipWorktrees(repo)).toEqual([]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: merged and the worktree removed → still the merged entry, the merge wins", async () => {
    const repo = await plant({ merged: true, removeWorktree: true });
    const { entries } = await worktreeEntries(repo);
    expect(entries.map((e) => e.worktree?.state)).toEqual(["merged"]);
    expect(entries[0]?.worktree?.path).toBeNull();
    expect(await chipWorktrees(repo)).toEqual([]);
  });

  test("merged: worktree removed, branch open → one undated derived entry `removed`, chip gone, events.jsonl byte-identical", async () => {
    const repo = await plant({ removeWorktree: true });
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry?.derived).toBe(true);
    expect(entry?.undated).toBe(true);
    expect(entry?.ref).toBe("removed");
    expect(entry?.worktree).toEqual({ state: "removed", branch: SPEC_BRANCH, path: null, commit: null });
    expect(await chipWorktrees(repo)).toEqual([]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: worktree folder deleted while git still lists it (prunable) → `removed` naming its path, chip gone", async () => {
    const repo = await plant();
    rmSync(repo.worktrees.spec, { recursive: true, force: true });
    const { entries } = await worktreeEntries(repo);
    expect(entries.map((e) => e.worktree)).toEqual([{ state: "removed", branch: SPEC_BRANCH, path: SPEC_WORKTREE, commit: null }]);
    expect(await chipWorktrees(repo)).toEqual([]);
  });

  test("merged: branch open with its worktree → no entry, the chip stays, events.jsonl byte-identical", async () => {
    const repo = await plant();
    const { entries, eventsBefore, eventsAfter } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
    expect(await chipWorktrees(repo)).toEqual([SPEC_WORKTREE]);
    expect(eventsAfter.equals(eventsBefore)).toBe(true);
  });

  test("merged: worktree removed, the branch checked out in the main checkout → no entry, it is worked on there", async () => {
    const repo = await plant({ removeWorktree: true });
    expect((await repo.git(repo.root, "switch", "-q", SPEC_BRANCH)).code).toBe(0);
    const { entries } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
  });

  test("merged: a spec without a branch → no entry", async () => {
    const repo = await plant({ removeWorktree: true });
    expect((await repo.git(repo.root, "branch", "-D", SPEC_BRANCH)).code).toBe(0);
    const { entries } = await worktreeEntries(repo);
    expect(entries).toEqual([]);
  });
});

// ── ended everywhere (spec 041, T5, ISC-212.1) ──────────────────────────────────────────────────────────────────────
//
// One rule decides which worktree a spec is read from, and "ended" (merged, removed, `prunable`) applies in every place
// that reads a spec: the dashboard reading, the spec tabs and their three writes, the library and the timeline. The
// fixture: `specs/` tracked, the spec branch merged into `main`, the spec worktree still present and clean (its one
// uncommitted file removed, so it is not kept alive as a merged worktree with changes). `main` then moves on in one
// commit of its own, so the two copies of the spec differ: main's `spec.md` back at `build`, T28 ticked in `tasks.md`,
// one event line more and another plan heading. The worktree's copy keeps `code-review`; whoever reads it is wrong.

/** The planted event line on main's `events.jsonl`: an entry with this time on the timeline proves main was read. */
const MAIN_EVENT_TS = "2026-03-05T11:00:00Z";
/** main's plan heading after its own commit; the worktree copy keeps harbor's. */
const MAIN_PLAN_TITLE = "Plan 002 — Main checkout";
/** A branch naming another harbor spec than the worktree's path does (ISC-174.1: the path wins). */
const OTHER_FOLDER = "004-retention-policies";
const OTHER_ID = "004";
const OTHER_BRANCH = `feature/${OTHER_FOLDER}`;

/** The merged, still present, clean spec worktree with a main checkout that moved on, as described above. */
async function plantEnded(): Promise<PlantedWorktreeRepo> {
  const repo = await plant({ trackedSpecs: true, merged: true });
  rmSync(join(repo.worktrees.spec, UNCOMMITTED));
  const main = join(repo.root, "specs", SPEC_FOLDER);
  const edit = (file: string, from: RegExp, to: string): void => {
    const path = join(main, file);
    const text = readFileSync(path, "utf8");
    if (!from.test(text)) throw new Error(`ended everywhere: ${from.source} not found in ${file}`);
    writeFileSync(path, text.replace(from, to));
  };
  edit("spec.md", /^stage: code-review$/m, "stage: build");
  edit("tasks.md", /^- \[ \] T28 ·/m, "- [x] T28 ·"); // single-core: allow — the fixture ticks one box of main's tasks.md; nothing is parsed
  edit("plan.md", /^# Plan 002 — Web console$/m, `# ${MAIN_PLAN_TITLE}`);
  appendFileSync(join(main, "events.jsonl"), `{"ts":"${MAIN_EVENT_TS}","from":"code-review","to":"build","command":"/spec-implement 002","actor":"u:3f9c0a7d"}\n`);
  expect((await repo.git(repo.root, "commit", "-q", "-a", "-m", "harbor: main moves on")).code).toBe(0);
  // The worktree is clean and its branch merged: ended by every reading of the rule.
  expect((await repo.git(repo.worktrees.spec, "status", "--porcelain")).stdout).toBe("");
  return repo;
}

/** One request to the spec routes of `handler`; `body` makes it a POST. */
async function call(handler: ApiHandler, path: string, body?: unknown): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const init: RequestInit = body === undefined ? { headers: HOST } : { method: "POST", headers: HOST, body: JSON.stringify(body) };
  const res = await handler(new Request(url.href, init), url);
  if (res === null) throw new Error(`the spec routes declined ${path}`);
  return res;
}

/** The timeline of spec `id` through `handler`. */
async function timelineOf(handler: ApiHandler, id: string): Promise<TimelineEntry[]> {
  const res = await call(handler, specRoutes.timeline("harbor", id));
  expect(res.status).toBe(200);
  return (await res.json()) as TimelineEntry[];
}

describe("ISC-212.1 ended everywhere: a merged, still present worktree is read nowhere, and the timeline follows the path", () => {
  test("ended everywhere: dashboard reading → main's files, no worktree source, no copy, no chip", async () => {
    const repo = await plantEnded();
    const reading = await readWorkspaceInput(repo.root);
    if (!reading.readable) throw new Error("the fixture workspace is unreadable");
    const files = reading.input.specs.find((f) => f.folder === SPEC_FOLDER);
    expect(files?.texts.spec).toBe(readFileSync(join(repo.root, "specs", SPEC_FOLDER, "spec.md"), "utf8"));
    expect(reading.input.perSpec?.[SPEC_FOLDER]?.source).toBeUndefined();
    expect(reading.copies[SPEC_FOLDER]).toBeUndefined();
    expect(await chipWorktrees(repo)).toEqual([]);
  });

  test("ended everywhere: spec page and tasks tab → the hashes of main's spec.md and tasks.md", async () => {
    const repo = await plantEnded();
    const handler = handlerFor(repo);
    const main = join(repo.root, "specs", SPEC_FOLDER);
    const head = await call(handler, specRoutes.spec("harbor", SPEC_ID));
    expect(head.status).toBe(200);
    expect(head.headers.get(SPEC_HASH_HEADER)).toBe(rawSha256(readFileSync(join(main, "spec.md"))));
    const tasks = await call(handler, specRoutes.tasks("harbor", SPEC_ID));
    expect(tasks.status).toBe(200);
    expect(tasks.headers.get(TASKS_HASH_HEADER)).toBe(rawSha256(readFileSync(join(main, "tasks.md"))));
  });

  test("ended everywhere: library document → main's plan.md, no worktree copy", async () => {
    const repo = await plantEnded();
    const load = await loadCatalogDoc(repo.root, `${SPEC_FOLDER}/plan.md`);
    if (!load.readable) throw new Error("the fixture workspace is unreadable");
    expect(load.copies[SPEC_FOLDER]).toBeUndefined();
    expect(load.doc?.title).toBe(MAIN_PLAN_TITLE);
  });

  test("ended everywhere: timeline → main's events.jsonl, and the merged entry", async () => {
    const repo = await plantEnded();
    const entries = await timelineOf(handlerFor(repo), SPEC_ID);
    expect(entries.some((e) => e.ts === MAIN_EVENT_TS)).toBe(true);
    expect(entries.filter((e) => e.kind === "worktree").map((e) => e.worktree?.state)).toEqual(["merged"]);
  });

  test("ended everywhere: stage move with the page's hash → 200, stage written into main's spec.md, the worktree copy byte-identical", async () => {
    const repo = await plantEnded();
    // Main's plan heading goes back, so its reviewed mark reads fresh again and the move meets the review gate.
    const plan = join(repo.root, "specs", SPEC_FOLDER, "plan.md");
    writeFileSync(plan, readFileSync(plan, "utf8").replace(`# ${MAIN_PLAN_TITLE}`, "# Plan 002 — Web console"));
    // The harbor activity log holds ISC-74 of 002; released here, so the move meets no lock (the test's own change).
    appendFileSync(join(repo.root, ".spectant", "activity.jsonl"), '{"ts":"2026-03-08T16:00:00Z","event":"release","claim":"ISC-74","session":"a:claude:sess-2"}\n');
    const handler = handlerFor(repo);
    const mainSpec = join(repo.root, "specs", SPEC_FOLDER, "spec.md");
    const copySpec = join(repo.worktrees.spec, "specs", SPEC_FOLDER, "spec.md");
    const copyBefore = readFileSync(copySpec);
    const hash = (await call(handler, specRoutes.spec("harbor", SPEC_ID))).headers.get(SPEC_HASH_HEADER);
    const res = await call(handler, specRoutes.transition("harbor", SPEC_ID), { to: "blocked", hash });
    expect({ status: res.status, body: res.status === 200 ? null : await res.json() }).toEqual({ status: 200, body: null });
    expect(readFileSync(mainSpec, "utf8")).toMatch(/^stage: blocked$/m);
    expect(readFileSync(copySpec).equals(copyBefore)).toBe(true);
  });

  test("ended everywhere: path and branch name two specs → the timeline follows the path, not the branch", async () => {
    const repo = await plant();
    // The worktree `.worktrees/002-web-console` switches to a branch named for 004; 002's own branch goes, and the
    // 004 branch is merged into main with the worktree left clean and present.
    rmSync(join(repo.worktrees.spec, UNCOMMITTED));
    expect((await repo.git(repo.worktrees.spec, "switch", "-q", "-c", OTHER_BRANCH)).code).toBe(0);
    expect((await repo.git(repo.root, "branch", "-D", SPEC_BRANCH)).code).toBe(0);
    expect((await repo.git(repo.root, "merge", "-q", "--no-ff", "-m", `Merge branch '${OTHER_BRANCH}'`, OTHER_BRANCH)).code).toBe(0);
    const handler = handlerFor(repo);
    const own = (await timelineOf(handler, SPEC_ID)).filter((e) => e.kind === "worktree");
    expect(own.map((e) => ({ state: e.worktree?.state, branch: e.worktree?.branch, path: e.worktree?.path }))).toEqual([
      { state: "merged", branch: OTHER_BRANCH, path: SPEC_WORKTREE },
    ]);
    const other = (await timelineOf(handler, OTHER_ID)).filter((e) => e.kind === "worktree");
    expect(other.filter((e) => e.worktree?.path === SPEC_WORKTREE)).toEqual([]);
  });
});

// ── merged edge cases (spec 041, T9, ISC-212.2) ─────────────────────────────────────────────────────────────────────
//
// Three shapes the plain rule "merged ends the worktree" got wrong: a merged worktree that still holds an uncommitted
// change is live (its chip stays, dirty, and the timeline says nothing of a merge); a spec branch merged while a live
// worktree of the same spec runs on another, open branch yields no `merged` entry; and when a spec has several
// branches, the worktree entry's branch and path are those of one and the same worktree.

/** A second branch of spec 002 that never had a worktree; it sorts before `SPEC_BRANCH`, as git lists branches. */
const DRAFT_BRANCH = `feature/${SPEC_ID}-console-draft`;

/** Commits one new file on `branch`, made from `main` in the main checkout, which ends back on `main`. */
async function commitOnBranch(repo: PlantedWorktreeRepo, branch: string, file: string): Promise<void> {
  expect((await repo.git(repo.root, "switch", "-q", "-c", branch)).code).toBe(0);
  writeFileSync(join(repo.root, "src", file), `// ${branch}\nexport const draft = true;\n`);
  expect((await repo.git(repo.root, "add", "--", `src/${file}`)).code).toBe(0);
  expect((await repo.git(repo.root, "commit", "-q", "-m", `console: ${file}`)).code).toBe(0);
  expect((await repo.git(repo.root, "switch", "-q", "main")).code).toBe(0);
}

describe("ISC-212.2 merged edge cases: an uncommitted change, a second open branch, branch and path of one worktree", () => {
  test("merged edge cases: merged worktree with an uncommitted change → the chip stays (dirty), no merged entry", async () => {
    const repo = await plant({ merged: true });
    expect((await repo.git(repo.worktrees.spec, "status", "--porcelain")).stdout).toContain(UNCOMMITTED);
    const reading = await readWorkspaceInput(repo.root);
    if (!reading.readable) throw new Error("the fixture workspace is unreadable");
    const chip = (reading.input.worktrees?.worktrees ?? []).filter((w) => w.kind === "spec" && w.spec === SPEC_ID);
    expect(chip.map((w) => ({ path: w.path, branch: w.branch, dirty: w.dirty }))).toEqual([
      { path: SPEC_WORKTREE, branch: SPEC_BRANCH, dirty: true },
    ]);
    const entries = (await timelineOf(handlerFor(repo), SPEC_ID)).filter((e) => e.kind === "worktree");
    expect(entries.filter((e) => e.worktree?.state === "merged")).toEqual([]);
  });

  test("merged edge cases: one spec branch merged beside a live worktree on another, open branch → no merged entry", async () => {
    const repo = await plant();
    const merged = `feature/${SPEC_ID}-console-fix`;
    await commitOnBranch(repo, merged, "fix.ts");
    expect((await repo.git(repo.root, "merge", "-q", "--no-ff", "-m", `Merge branch '${merged}'`, merged)).code).toBe(0);
    expect(await chipWorktrees(repo)).toEqual([SPEC_WORKTREE]);
    const entries = (await timelineOf(handlerFor(repo), SPEC_ID)).filter((e) => e.kind === "worktree");
    expect(entries.filter((e) => e.worktree?.state === "merged")).toEqual([]);
  });

  test("merged edge cases: a spec with two branches, one with a worktree → branch and path of the same worktree", async () => {
    const repo = await plant();
    await commitOnBranch(repo, DRAFT_BRANCH, "draft-branch.ts");
    // The spec worktree's folder goes while git still lists it: no live worktree, the spec's work has stopped.
    rmSync(repo.worktrees.spec, { recursive: true, force: true });
    const entries = (await timelineOf(handlerFor(repo), SPEC_ID)).filter((e) => e.kind === "worktree");
    expect(entries.map((e) => e.worktree?.state)).toEqual(["removed"]);
    const pair = { branch: entries[0]?.worktree?.branch, path: entries[0]?.worktree?.path };
    // The listed worktree's own pair, or the worktree-less branch with no path; never one branch with another's path.
    const consistent: Array<{ branch: string | null | undefined; path: string | null | undefined }> = [
      { branch: SPEC_BRANCH, path: SPEC_WORKTREE },
      { branch: DRAFT_BRANCH, path: null },
    ];
    expect(consistent).toContainEqual(pair);
  });
});

// ── ISC-215 git spawn budget ─────────────────────────────────────────────────────────────────────────────────────
//
// Every git process the server starts is counted at the one place they all pass: `Bun.spawn`, spied for the duration
// of one read (git.ts' runner and the loader's own `ls-files` for the tree id both spawn through it). The fixture's
// own git calls run outside those windows. Five spec worktrees: the fixture's 002 plus 003, 004 (the one spec with a
// code-reviewed mark), 006 and 007, each one commit ahead of `main`.

/** One git process: its arguments after the binary and the directory it reads (`-C` or the spawn's `cwd`). */
interface GitSpawn {
  readonly args: readonly string[];
  readonly at: string | null;
  /** The subcommand: the first argument after the global options. */
  readonly command: string;
}

/** The git processes `read` starts, counted over `Bun.spawn`; every other spawn passes through uncounted. */
async function gitSpawnsOf<T>(read: () => Promise<T>): Promise<{ value: T; spawns: GitSpawn[] }> {
  const spawns: GitSpawn[] = [];
  const original = Bun.spawn;
  const spy = spyOn(Bun, "spawn").mockImplementation(((first: unknown, options?: { cwd?: string }) => {
    const cmd = Array.isArray(first) ? (first as string[]) : (first as { cmd: string[] }).cmd;
    if (cmd.length > 0 && basename(cmd[0] ?? "") === "git") {
      const args = cmd.slice(1);
      let i = 0;
      let at = options?.cwd ?? (Array.isArray(first) ? null : ((first as { cwd?: string }).cwd ?? null));
      while (i < args.length && (args[i] ?? "").startsWith("-")) {
        if (args[i] === "-C") at = args[i + 1] ?? at;
        i += args[i] === "-C" || args[i] === "-c" ? 2 : 1;
      }
      spawns.push({ args, at, command: args[i] ?? "" });
    }
    return (original as (...a: unknown[]) => unknown)(first, options);
  }) as unknown as typeof Bun.spawn);
  try {
    return { value: await read(), spawns };
  } finally {
    spy.mockRestore();
  }
}

const countOf = (spawns: readonly GitSpawn[], command: string): number => spawns.filter((s) => s.command === command).length;
const summary = (spawns: readonly GitSpawn[]): string => spawns.map((s) => s.command).join(",");

/** The spec worktrees the budget repository adds beside the fixture's 002; 004 is harbor's spec with a code-reviewed mark. */
const BUDGET_SPECS = ["003-config-loader", "004-retention-policies", "006-partial-push", "007-rotate-mirror-token"] as const;
const MARKED_SPEC = "004-retention-policies";

/** The worktree fixture plus four spec worktrees, each on `feature/<folder>` one commit ahead of `main`. */
async function plantBudget(): Promise<PlantedWorktreeRepo> {
  const repo = await plant();
  for (const folder of BUDGET_SPECS) {
    const path = `.worktrees/${folder}`;
    expect((await repo.git(repo.root, "worktree", "add", "-q", "-b", `feature/${folder}`, path)).code).toBe(0);
    const at = join(repo.root, path);
    symlinkSync("../../specs", join(at, "specs"));
    symlinkSync("../../ISA.md", join(at, "ISA.md"));
    mkdirSync(join(at, "src"), { recursive: true });
    writeFileSync(join(at, "src", `${folder}.ts`), `// ${folder}: the first step.\nexport const step = 1;\n`);
    expect((await repo.git(at, "add", "--", `src/${folder}.ts`)).code).toBe(0);
    expect((await repo.git(at, "commit", "-q", "-m", `${folder}: first step`)).code).toBe(0);
  }
  return repo;
}

/** One poll: the dashboard reading of the workspace. */
async function poll(repo: PlantedWorktreeRepo): Promise<void> {
  const reading = await readWorkspaceInput(repo.root);
  if (!reading.readable) throw new Error("the budget workspace is unreadable");
}

/** The live spec worktrees of the reading with their `ahead`, by path. */
async function aheadByPath(repo: PlantedWorktreeRepo): Promise<Record<string, number | null>> {
  const reading = await readWorkspaceInput(repo.root);
  if (!reading.readable) throw new Error("the budget workspace is unreadable");
  const out: Record<string, number | null> = {};
  for (const w of reading.input.worktrees?.worktrees ?? []) if (w.kind === "spec" && w.path !== null) out[w.path] = w.ahead;
  return out;
}

describe("ISC-215 git spawn budget: one worktree list per poll, nothing re-read while HEAD and refs stand", () => {
  let shared: PlantedWorktreeRepo | null = null;
  const budgetRepo = async (): Promise<PlantedWorktreeRepo> => (shared ??= await plantBudget());

  test("git spawn budget: the fixture has five live spec worktrees", async () => {
    const repo = await budgetRepo();
    const ahead = await aheadByPath(repo);
    expect(Object.keys(ahead).sort()).toEqual([SPEC_WORKTREE, ...BUDGET_SPECS.map((f) => `.worktrees/${f}`)].sort());
  });

  test("git spawn budget: a poll calls `git worktree list` exactly once", async () => {
    const repo = await budgetRepo();
    const { spawns } = await gitSpawnsOf(() => poll(repo));
    expect({ worktreeList: countOf(spawns, "worktree"), all: summary(spawns) }).toMatchObject({ worktreeList: 1 });
  });

  test("git spawn budget: a second poll without a change starts no `status` and no `rev-list`, at most one `worktree list`", async () => {
    const repo = await budgetRepo();
    await poll(repo);
    const { spawns } = await gitSpawnsOf(() => poll(repo));
    expect({ status: countOf(spawns, "status"), revList: countOf(spawns, "rev-list"), all: summary(spawns) }).toMatchObject({ status: 0, revList: 0 });
    expect(countOf(spawns, "worktree")).toBeLessThanOrEqual(1);
  });

  test("git spawn budget: no worktree without a code-reviewed mark is hashed (`ls-files --others` only in 004's)", async () => {
    const repo = await budgetRepo();
    const { spawns } = await gitSpawnsOf(() => poll(repo));
    const hashed = spawns.filter((s) => s.command === "ls-files" && s.args.includes("--others")).map((s) => (s.at === null ? null : s.at.slice(repo.root.length + 1)));
    for (const path of hashed) expect(path === `.worktrees/${MARKED_SPEC}` || path === "").toBe(true);
    expect(hashed).not.toContain(SPEC_WORKTREE);
  });

  test("git spawn budget: after a warm poll the single-spec route starts no git process", async () => {
    const repo = await budgetRepo();
    const handler = handlerFor(repo);
    await poll(repo);
    // A first request warms the handler's own commit cache; the counted one is the repeat.
    expect((await call(handler, specRoutes.spec("harbor", SPEC_ID))).status).toBe(200);
    const { value: res, spawns } = await gitSpawnsOf(() => call(handler, specRoutes.spec("harbor", SPEC_ID)));
    expect(res.status).toBe(200);
    expect({ count: spawns.length, all: summary(spawns) }).toMatchObject({ count: 0 });
  });

  test("git spawn budget: after a warm poll a library document starts no git process", async () => {
    const repo = await budgetRepo();
    await poll(repo);
    const { value: load, spawns } = await gitSpawnsOf(() => loadCatalogDoc(repo.root, `${SPEC_FOLDER}/plan.md`));
    expect(load.readable).toBe(true);
    expect({ count: spawns.length, all: summary(spawns) }).toMatchObject({ count: 0 });
  });

  test("git spawn budget: after a warm poll a search keystroke starts no git process", async () => {
    const repo = await budgetRepo();
    await poll(repo);
    const { value: load, spawns } = await gitSpawnsOf(() => loadCatalogDocs(repo.root));
    expect(load.readable).toBe(true);
    expect({ count: spawns.length, all: summary(spawns) }).toMatchObject({ count: 0 });
  });

  test("git spawn budget: after a warm poll the timeline route gets by with at most three git calls", async () => {
    const repo = await budgetRepo();
    await poll(repo);
    const { value: res, spawns } = await gitSpawnsOf(() => call(handlerFor(repo), specRoutes.timeline("harbor", SPEC_ID)));
    expect(res.status).toBe(200);
    expect(spawns.length, summary(spawns)).toBeLessThanOrEqual(3);
  });

  test("git spawn budget: a merged spec's timeline re-reads no first-parent history while the refs stand, within three calls", async () => {
    const repo = await plant({ merged: true, removeWorktree: true });
    const handler = handlerFor(repo);
    await poll(repo);
    expect((await timelineOf(handler, SPEC_ID)).filter((e) => e.kind === "worktree").map((e) => e.worktree?.state)).toEqual(["merged"]);
    const { value: res, spawns } = await gitSpawnsOf(() => call(handler, specRoutes.timeline("harbor", SPEC_ID)));
    expect(res.status).toBe(200);
    const firstParent = spawns.filter((s) => s.command === "rev-list" && s.args.includes("--first-parent")).length;
    expect({ firstParent, all: summary(spawns) }).toMatchObject({ firstParent: 0 });
    expect(spawns.length, summary(spawns)).toBeLessThanOrEqual(3);
  });

  test("git spawn budget: a commit in one worktree between polls re-reads its distance, never a stale `ahead`", async () => {
    const repo = await plantBudget();
    const path = `.worktrees/${BUDGET_SPECS[0]}`;
    expect((await aheadByPath(repo))[path]).toBe(1);
    const at = join(repo.root, path);
    writeFileSync(join(at, "src", "second.ts"), "export const second = 2;\n");
    expect((await repo.git(at, "add", "--", "src/second.ts")).code).toBe(0);
    expect((await repo.git(at, "commit", "-q", "-m", "second step")).code).toBe(0);
    const { value: ahead, spawns } = await gitSpawnsOf(() => aheadByPath(repo));
    expect(ahead[path]).toBe(2);
    expect(spawns.some((s) => s.command === "rev-list" && s.at === at)).toBe(true);
  });
});
