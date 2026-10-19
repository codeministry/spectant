// The read-only invariant (T52, ISC-15): adding a workspace and opening every page leaves the registered repository
// byte-identical, `.git/` included. Since spec 002 it also guards the two writes (last describe): every read route and
// every refused write (400, 404, 409, 423) leaves it byte-identical, an accepted reviewed mark changes exactly
// `.gates/reviewed.json` and `events.jsonl`, an accepted tick exactly `tasks.md`, and `.git/` never changes. Since
// spec 017 the library's routes, the prototype route and the SPA shell of the old deep links are guarded too (`-t library`).
//
// The fixture `core/fixtures/harbor` has no `.git`, so the test builds a real repository from a copy of it and plants
// the state a careless implementation would disturb: a commit, a staged-but-uncommitted file (index differs from HEAD),
// a modified tracked file, a tracked file whose mtime moved without a content change (stale stat data, which a
// `git status` refreshes by rewriting `.git/index`), an untracked file and two ignored files.
//
// The git path of the loader must actually run, or the test would pass without exercising it: the loader computes the
// worktree tree id (`git ls-files` + `core/`'s in-memory `treeIdOf`) only for a repository root with an active spec that
// carries a code-reviewed mark. Spec 004 carries one. Its `tree` is set to what `git add -A && git write-tree` prints for
// this exact worktree, computed on a throwaway copy (never on the repository under test). The mark file itself is
// excluded through `.git/info/exclude`, so writing the id into it does not change the tree it names. The dashboard
// must then report the gate `fresh`: the id was computed, and computed right. The golden model, built without a
// repository, reports "worktree tree id unavailable" for the same spec.
//
// Every git command here runs under an empty global config and no system config (set on `process.env` for this file
// and restored after it), so the loader and the setup see the same excludes and no host hook, signing or filter applies.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import {
  appendFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import type { DashboardModel } from "../core/src/dashboard.ts";
import type { Guidance, TasksTab } from "../core/src/files.ts";
import { hashForGate } from "../core/src/gates.ts";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { dashboardApi } from "../server/src/api.ts";
import { run } from "../server/src/cli.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { openRegistry } from "../server/src/registry.ts";
import {
  ACTIVITY_HASH_HEADER,
  ACTORS_PATH,
  EVENTS_PATH,
  LIVE_EVENT,
  REVIEWED_HASHES_HEADER,
  type ReviewedHashes,
  SPEC_HASH_HEADER,
  TASKS_HASH_HEADER,
  type WorkspaceRouteResponses,
  parseReviewedHashes,
  prototypeFolderOf,
  prototypeRoute,
  specRoutes,
  workspaceRoutes,
} from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { tokensCommand } from "../server/src/tokens-cli.ts";
import { WRITE_PATHS, WRITE_TABLE, runReleaseEvent, writePathsOf } from "../server/src/writes.contract.ts";
import { readWorkspaceInput } from "../server/src/workspace-loader.ts";
import { BACKLOG_UI_SEQUENCE, EMPTY_BACKLOG_HASH } from "../web/e2e/backlog-ui-sequence.ts";
import { BUILDER_WORKTREE, type PlantedWorktreeRepo, SPEC_BRANCH, SPEC_FOLDER, SPEC_ID, SPEC_WORKTREE, UNCOMMITTED, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
/** The harbor transcripts: a main session with a sub-agent, beside the folders of an agent and a spec worktree. */
const TRANSCRIPTS = join(import.meta.dir, "..", "core", "tests", "fixtures", "transcripts", "harbor");
const SLUG = "harbor";
const MARKED_SPEC = "004-retention-policies";
const MARK = `specs/${MARKED_SPEC}/.gates/code-reviewed.json`;

/** One entry of the tree: its kind, permission bits, size and mtime, and the sha256 of its bytes (or link target). */
type Entry = { kind: "file" | "dir" | "link"; mode: number; size: number; mtimeMs: number; digest: string };

type Snapshot = {
  /** sha256 over every path, kind, mode and content in sorted path order; mtimes are not part of it. */
  checksum: string;
  entries: Map<string, Entry>;
};

const sha256 = (bytes: Uint8Array | string): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** Every entry below `dir` (the root itself excluded), `/`-separated and relative, with node:fs only, no git. */
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

/** The recursive hash of `root`, `.git/` included. */
function snapshot(root: string): Snapshot {
  const entries = walk(root);
  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of [...entries.keys()].sort()) {
    const e = entries.get(path);
    if (e === undefined) continue;
    hasher.update(`${path}\0${e.kind}\0${e.mode.toString(8)}\0${e.digest}\n`);
  }
  return { checksum: hasher.digest("hex"), entries };
}

/** The paths that were added, removed or whose kind, mode or bytes differ; `mtime` also counts a moved mtime. */
function changed(before: Snapshot, after: Snapshot, options: { mtime?: boolean } = {}): string[] {
  const paths = new Set([...before.entries.keys(), ...after.entries.keys()]);
  return [...paths].sort().filter((path) => {
    const a = before.entries.get(path);
    const b = after.entries.get(path);
    if (a === undefined || b === undefined) return true;
    if (a.kind !== b.kind || a.mode !== b.mode || a.digest !== b.digest) return true;
    return options.mtime === true && a.mtimeMs !== b.mtimeMs;
  });
}

const underGit = (s: Snapshot): string[] => [...s.entries.keys()].filter((p) => p === ".git" || p.startsWith(".git/")).sort();

/** Runs git in `cwd` with the file's hermetic config and fixed identity; throws with stderr on a non-zero exit. */
function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Spectant Test",
      GIT_AUTHOR_EMAIL: "readonly@example.com",
      GIT_COMMITTER_NAME: "Spectant Test",
      GIT_COMMITTER_EMAIL: "readonly@example.com",
      GIT_AUTHOR_DATE: "2026-03-08T12:00:00Z",
      GIT_COMMITTER_DATE: "2026-03-08T12:00:00Z",
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

let root: string;
let repo: string;
let expectedTree: string;
const savedEnv: Record<string, string | undefined> = {};

/** The repository under test: harbor, committed, then left with index, worktree and ignore state. */
function buildRepository(): void {
  repo = join(root, SLUG);
  cpSync(FIXTURE, repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), "*.log\nbuild/\n");
  appendFileSync(join(repo, ".git", "info", "exclude"), `${MARK}\n`);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "harbor fixture");

  writeFileSync(join(repo, "staged.md"), "# staged, not committed\n");
  git(repo, "add", "staged.md"); // the index now differs from HEAD
  appendFileSync(join(repo, "generate.ts"), "// modified after the commit\n"); // worktree differs from the index
  const future = new Date("2030-01-01T00:00:00Z");
  utimesSync(join(repo, "ISA.md"), future, future); // same bytes, stale stat data in the index
  mkdirSync(join(repo, "notes"));
  writeFileSync(join(repo, "notes", "untracked.md"), "# untracked\n");
  writeFileSync(join(repo, "debug.log"), "ignored by *.log\n");
  mkdirSync(join(repo, "build"));
  writeFileSync(join(repo, "build", "out.txt"), "ignored by build/\n");

  // The tree `git add -A && git write-tree` gives for this worktree, written on a throwaway copy.
  const scratch = join(root, "scratch-write-tree");
  cpSync(repo, scratch, { recursive: true });
  git(scratch, "add", "-A");
  expectedTree = git(scratch, "write-tree");
  rmSync(scratch, { recursive: true, force: true });

  const mark = JSON.parse(readFileSync(join(repo, MARK), "utf8")) as Record<string, unknown>;
  writeFileSync(join(repo, MARK), `${JSON.stringify({ ...mark, tree: expectedTree }, null, 2)}\n`);
}

function manifest(): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-readonly-"));
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    savedEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  buildRepository();
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

describe("the hash sees what a careless implementation would change", () => {
  test("one byte appended under .git/ changes the checksum, and restoring it restores the checksum", () => {
    const description = join(repo, ".git", "description");
    const original = readFileSync(description);
    const before = snapshot(repo);
    try {
      appendFileSync(description, "x");
      const touched = snapshot(repo);
      expect(touched.checksum).not.toBe(before.checksum);
      expect(changed(before, touched)).toEqual([".git/description"]);
    } finally {
      writeFileSync(description, original);
    }
    expect(snapshot(repo).checksum).toBe(before.checksum);
  });

  test("the planted state is armed: a plain `git status` on a copy rewrites its .git/index", () => {
    const copy = join(root, "scratch-status");
    cpSync(repo, copy, { recursive: true });
    try {
      const before = snapshot(copy);
      git(copy, "status", "--porcelain");
      expect(changed(before, snapshot(copy))).toContain(".git/index");
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});

describe("ISC-15: add + browse leaves the registered repository byte-identical, .git/ included", () => {
  test("readonly: checksum, .git/ file set, .git/index bytes and every mtime are unchanged, and the git path ran", async () => {
    const before = snapshot(repo);
    const indexBefore = readFileSync(join(repo, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(repo, ".git", "index")).mtimeMs;

    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    let model: DashboardModel;
    try {
      expect(await run(["add", repo], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }

      // Every page the app has: the overview, a workspace dashboard (polled: once, then revalidated), the settings,
      // the app shell and a deep link through the SPA fallback.
      const list = await fetch(`${url}/api/workspaces`);
      expect(list.status).toBe(200);
      expect(((await list.json()) as Array<{ slug: string; readable: boolean }>).map((w) => [w.slug, w.readable])).toEqual([
        [SLUG, true],
      ]);
      const first = await fetch(`${url}/api/workspaces/${SLUG}/dashboard`);
      expect(first.status).toBe(200);
      model = (await first.json()) as DashboardModel;
      const etag = first.headers.get("etag") ?? "";
      expect(etag).not.toBe("");
      const again = await fetch(`${url}/api/workspaces/${SLUG}/dashboard`, { headers: { "If-None-Match": etag } });
      expect(again.status).toBe(304);
      expect((await fetch(`${url}/api/workspaces/${SLUG}/dashboard`, { method: "HEAD" })).status).toBe(200);
      // The planning tree behind the Features and Milestones pages and the breadcrumb (spec 003, ISC-109): read once,
      // revalidated, and HEAD, like the dashboard.
      const planning = await fetch(`${url}/api/workspaces/${SLUG}/planning`);
      expect(planning.status).toBe(200);
      const planningEtag = planning.headers.get("etag") ?? "";
      expect(planningEtag).not.toBe("");
      expect((await planning.json()) as { features: unknown[] }).toHaveProperty("features");
      const planningAgain = await fetch(`${url}/api/workspaces/${SLUG}/planning`, { headers: { "If-None-Match": planningEtag } });
      expect(planningAgain.status).toBe(304);
      expect((await fetch(`${url}/api/workspaces/${SLUG}/planning`, { method: "HEAD" })).status).toBe(200);
      // A story page (spec 008 T88, ISC-124.2): read, revalidated and HEAD; an unknown story is a 404 that reads nothing.
      const story = await fetch(`${url}${workspaceRoutes.idea(SLUG, "console-audit-log")}`);
      expect(story.status).toBe(200);
      const storyEtag = story.headers.get("etag") ?? "";
      expect(((await story.json()) as { idea: { slug: string } }).idea.slug).toBe("console-audit-log");
      expect((await fetch(`${url}${workspaceRoutes.idea(SLUG, "console-audit-log")}`, { headers: { "If-None-Match": storyEtag } })).status).toBe(304);
      expect((await fetch(`${url}${workspaceRoutes.idea(SLUG, "console-audit-log")}`, { method: "HEAD" })).status).toBe(200);
      expect((await fetch(`${url}${workspaceRoutes.idea(SLUG, "tide-tables")}`)).status).toBe(404);
      expect((await fetch(`${url}/api/settings`)).status).toBe(200);
      for (const page of ["/", `/w/${SLUG}`, `/w/${SLUG}/features`, `/w/${SLUG}/milestones`]) {
        const res = await fetch(`${url}${page}`);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("<title>spectant</title>");
      }

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }

    // The git path ran and computed the right id: the mark names this worktree's tree, so the gate is fresh.
    const marked = model.specs.find((s) => s.slug === MARKED_SPEC);
    expect(marked?.gates.codeReviewed.state).toBe("fresh");
    expect(marked?.gates.codeReviewed.detail).not.toBe("worktree tree id unavailable");

    const after = snapshot(repo);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(repo, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
  });
});

// The two writes (spec 002, ISC-24 to ISC-27): the read-only rule's carve-out, proven on the same planted repository.
// A copy of it (`.git/` included) is registered, so this block never depends on the order of the one above. harbor's
// activity log holds ISC-74 of spec 002; spec 004 is free.
describe("ISC-15 with the writes: refused writes change nothing, an accepted one only its own files, .git/ never", () => {
  test("readonly: reads and every refused write leave the copy byte-identical; the mark and the tick touch only their targets", async () => {
    const copy = join(mkdtempSync(join(root, "writes-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-writes-")));
    registry.add(copy);
    const api = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
      const res = await api(new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init }), url);
      if (res === null) throw new Error(`the spec routes declined ${path}`);
      return res;
    };
    const retention = `specs/${MARKED_SPEC}`;
    const gitChanges = (a: Snapshot, b: Snapshot): string[] => changed(a, b, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"));
    const hashes = async (id: string): Promise<ReviewedHashes | null> =>
      parseReviewedHashes((await call(specRoutes.spec(SLUG, id))).headers.get(REVIEWED_HASHES_HEADER));
    const tasksHash = async (id: string): Promise<string> => (await call(specRoutes.tasks(SLUG, id))).headers.get(TASKS_HASH_HEADER) ?? "";

    try {
      const before = snapshot(copy);
      for (const id of ["002", "004"]) {
        for (const path of [specRoutes.spec, specRoutes.timeline, specRoutes.claims, specRoutes.tasks, specRoutes.frames, specRoutes.live]) {
          expect((await call(path(SLUG, id))).status).toBe(200);
        }
      }

      // Refused: 423 (ISC-74 held), 409 (stale hashes), 404 (no such task), 400 (no request).
      const refused: Array<[string, unknown, number]> = [
        [specRoutes.gateReviewed(SLUG, "002"), { hashes: await hashes("002") }, 423],
        [specRoutes.taskCheck(SLUG, "002", "T27"), { checked: true, hash: await tasksHash("002") }, 423],
        [specRoutes.gateReviewed(SLUG, "004"), { hashes: { spec: "0".repeat(64), plan: null, tasks: null } }, 409],
        [specRoutes.taskCheck(SLUG, "004", "T1"), { checked: false, hash: "0".repeat(64) }, 409],
        [specRoutes.taskCheck(SLUG, "004", "T999"), { checked: true, hash: await tasksHash("004") }, 404],
        [specRoutes.taskCheck(SLUG, "004", "T1"), "not json", 400],
      ];
      for (const [path, body, status] of refused) expect({ path, status: (await call(path, "POST", body)).status }).toEqual({ path, status });
      const afterRefused = snapshot(copy);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      // Accepted: the reviewed mark of 004 changes its mark and its events.jsonl, nothing else.
      expect((await call(specRoutes.gateReviewed(SLUG, "004"), "POST", { hashes: await hashes("004") })).status).toBe(200);
      const afterMark = snapshot(copy);
      expect(changed(before, afterMark)).toEqual([`${retention}/.gates/reviewed.json`, `${retention}/events.jsonl`]);
      expect(gitChanges(before, afterMark)).toEqual([]);

      // Accepted: unticking T1 of 004 changes tasks.md, nothing else.
      expect((await call(specRoutes.taskCheck(SLUG, "004", "T1"), "POST", { checked: false, hash: await tasksHash("004") })).status).toBe(200);
      const afterTick = snapshot(copy);
      expect(changed(afterMark, afterTick)).toEqual([`${retention}/tasks.md`]);
      expect(gitChanges(before, afterTick)).toEqual([]);
      expect(underGit(afterTick)).toEqual(underGit(before));
    } finally {
      registry.close();
    }
  });
});

// The stage move (spec 008, T95, ISC-130) under the same guard, on its own copy (`.git/` included): every refused
// move (400, 404, 409, 422, 423) leaves the copy byte-identical, an accepted one changes exactly that spec's `spec.md`
// and `events.jsonl`, and `.git/` never changes.
describe("ISC-130 with the transition: a refused move changes nothing, an accepted one only spec.md and events.jsonl", () => {
  test("readonly: refused transitions leave the copy byte-identical; the accepted one touches only its two files", async () => {
    const copy = join(mkdtempSync(join(root, "moves-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-moves-")));
    registry.add(copy);
    const api = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
      const res = await api(new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init }), url);
      if (res === null) throw new Error(`the spec routes declined ${path}`);
      return res;
    };
    const specHash = async (id: string): Promise<string> => (await call(specRoutes.spec(SLUG, id))).headers.get(SPEC_HASH_HEADER) ?? "";
    const loader = "specs/003-config-loader";
    const gitChanges = (a: Snapshot, b: Snapshot): string[] => changed(a, b, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"));

    try {
      const before = snapshot(copy);
      // Refused: 423 (ISC-74 of 002 held), 409 (stale hash), 422 (005 → build without a fresh mark), 404, 400.
      const refused: Array<[string, unknown, number]> = [
        [specRoutes.transition(SLUG, "002"), { to: "blocked", hash: await specHash("002") }, 423],
        [specRoutes.transition(SLUG, "003"), { to: "review", hash: "0".repeat(64) }, 409],
        [specRoutes.transition(SLUG, "005"), { to: "build", hash: await specHash("005") }, 422],
        [specRoutes.transition(SLUG, "999"), { to: "review", hash: "0".repeat(64) }, 404],
        [specRoutes.transition(SLUG, "003"), "not json", 400],
      ];
      for (const [path, body, status] of refused) expect({ path, status: (await call(path, "POST", body)).status }).toEqual({ path, status });
      const afterRefused = snapshot(copy);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      // Accepted: 003 tasks → review changes its spec.md and creates its events.jsonl, nothing else.
      const res = await call(specRoutes.transition(SLUG, "003"), "POST", { to: "review", hash: await specHash("003") });
      expect(res.status).toBe(200);
      const afterMove = snapshot(copy);
      expect(changed(before, afterMove)).toEqual([`${loader}/events.jsonl`, `${loader}/spec.md`]);
      expect(gitChanges(before, afterMove)).toEqual([]);
      expect(underGit(afterMove)).toEqual(underGit(before));
      expect(((await res.json()) as { hash: string }).hash).toBe(sha256(readFileSync(join(copy, loader, "spec.md"))));
    } finally {
      registry.close();
    }
  });
});

// The spec 008 reads (T97, ISC-132) under the same guard, through the served app (`spectant serve`, so the wiring is
// proven too) on its own copy, `.git/` included: the planning tree, a story page, the actor names and the board query
// (GET and PUT: both touch only the database, never the repository), the refused bodies of both, and one refused
// drop (a 422 transition: 005 → build without a fresh reviewed mark) leave the copy byte-identical, every mtime kept.
describe("ISC-132: the board's reads, the database routes and a refused drop leave the repository byte-identical", () => {
  test("readonly: planning, idea, actors and board-query (GET and PUT) and a 422 transition change no byte, .git/ included", async () => {
    const copy = join(mkdtempSync(join(root, "board-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const before = snapshot(copy);
    const indexBefore = readFileSync(join(copy, ".git", "index"));

    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-board-")) };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", copy], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      const put = (path: string, body: unknown): Promise<Response> =>
        fetch(`${url}${path}`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) });

      // The board's reads: the planning tree and a story page, read, revalidated and HEAD.
      for (const path of [workspaceRoutes.planning(SLUG), workspaceRoutes.idea(SLUG, "console-audit-log")]) {
        const first = await fetch(`${url}${path}`);
        expect({ path, status: first.status }).toEqual({ path, status: 200 });
        const etag = first.headers.get("etag") ?? "";
        expect((await fetch(`${url}${path}`, { headers: { "If-None-Match": etag } })).status).toBe(304);
        expect((await fetch(`${url}${path}`, { method: "HEAD" })).status).toBe(200);
      }

      // The actor names: GET, a PUT round trip, a refused PUT. Synthetic names and addresses only.
      const actor = { id: "u:3f9c0a7d", displayName: "Harbor Master", gitIdentities: ["harbor@example.org"] };
      expect(await (await fetch(`${url}${ACTORS_PATH}`)).json()).toEqual([]);
      expect(await (await put(ACTORS_PATH, [actor])).json()).toEqual([actor]);
      expect(await (await fetch(`${url}${ACTORS_PATH}`)).json()).toEqual([actor]);
      expect((await put(ACTORS_PATH, [{ ...actor, id: "a:claude:sess-1" }])).status).toBe(400);

      // The board query: GET, a PUT round trip, a refused PUT, an unknown workspace.
      const board = workspaceRoutes.boardQuery(SLUG);
      expect(await (await fetch(`${url}${board}`)).json()).toEqual({ query: "" });
      expect(await (await put(board, { query: "feature=F2&group=milestone" })).json()).toEqual({ query: "feature=F2&group=milestone" });
      expect(await (await fetch(`${url}${board}`)).json()).toEqual({ query: "feature=F2&group=milestone" });
      expect((await put(board, { query: "?feature=F2" })).status).toBe(400);
      expect((await put(workspaceRoutes.boardQuery("nowhere"), { query: "" })).status).toBe(404);

      // One refused drop: 005 → build without a fresh reviewed mark is a 422 that writes nothing.
      const specHash = (await fetch(`${url}${specRoutes.spec(SLUG, "005")}`)).headers.get(SPEC_HASH_HEADER) ?? "";
      expect(specHash).toMatch(/^[0-9a-f]{64}$/);
      const drop = await fetch(`${url}${specRoutes.transition(SLUG, "005")}`, { method: "POST", body: JSON.stringify({ to: "build", hash: specHash }) });
      expect(drop.status).toBe(422);

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }

    const after = snapshot(copy);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(copy, ".git", "index")).equals(indexBefore)).toBe(true);
  });
});

// The unified planning page (spec 026 T36, ISC-173) under the same guard, through the served app on its own copy,
// `.git/` included: the planning route with its relation index (`relations`, the milestones' `featureIds`,
// `unassignedFeatures`) read, revalidated and HEAD; every other read the three lenses, the redirects and the detail
// sidebar make (the workspace list, the dashboard, the settings, the actor names, the board query and a story the
// sidebar opens on the workspace board); and the SPA paths of the lenses with `?sel=`, the old Features and
// Milestones addresses and the workspace board with a selected card. The redirect itself is client-side (the `#`
// anchor never reaches the server), so on the server an old address is the SPA fallback and the redirect's reads are
// the planning route's; the browser side of the same pages is `bun run e2e -- offline`. The copy stays byte-identical,
// every mtime and `.git/index` kept.
describe("ISC-173: the planning lenses, the redirects and the sidebar leave the repository byte-identical", () => {
  // Spec 038 (ISC-206): the Gantt lens and the old matrix address it redirects from are among the pages read here.
  test("readonly: planning with its relation index, the sidebar's reads and every planning page, the gantt lens and its redirect included, change no byte, .git/ included", async () => {
    const copy = join(mkdtempSync(join(root, "planning-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const before = snapshot(copy);
    const indexBefore = readFileSync(join(copy, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(copy, ".git", "index")).mtimeMs;

    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-planning-")) };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", copy], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }

      // The planning route with its index: every lens, the redirect target and the sidebar read it.
      const planning = await fetch(`${url}${workspaceRoutes.planning(SLUG)}`);
      expect(planning.status).toBe(200);
      const etag = planning.headers.get("etag") ?? "";
      expect(etag).not.toBe("");
      const body = (await planning.json()) as {
        relations?: Record<string, unknown>;
        unassignedFeatures?: unknown[];
        milestones: Array<{ featureIds?: unknown[] }>;
      };
      expect(Object.keys(body.relations ?? {}).length).toBeGreaterThan(0);
      expect(body.relations).toHaveProperty(["feature:F2"]);
      expect(body.unassignedFeatures).toContain("F2");
      expect(body.milestones.length).toBeGreaterThan(0);
      expect(body.milestones.every((m) => Array.isArray(m.featureIds))).toBe(true);
      expect((await fetch(`${url}${workspaceRoutes.planning(SLUG)}`, { headers: { "If-None-Match": etag } })).status).toBe(304);
      expect((await fetch(`${url}${workspaceRoutes.planning(SLUG)}`, { method: "HEAD" })).status).toBe(200);

      // The shell's and the sidebar's other reads: the workspace list, the dashboard, the settings, the actor names,
      // the board query (the workspace board's filter) and a story an idea card opens.
      for (const path of [
        "/api/workspaces",
        `/api/workspaces/${SLUG}/dashboard`,
        "/api/settings",
        ACTORS_PATH,
        workspaceRoutes.boardQuery(SLUG),
        workspaceRoutes.idea(SLUG, "console-audit-log"),
      ]) {
        expect({ path, status: (await fetch(`${url}${path}`)).status }).toEqual({ path, status: 200 });
      }

      // The pages: the three lenses with an open sidebar (the Gantt lens since spec 038), the old addresses the client
      // redirects (the Matrix's `/planning/board` among them) and the workspace board with a selected card, each the
      // SPA's index through the fallback.
      for (const page of [
        `/w/${SLUG}/planning`,
        `/w/${SLUG}/planning/tree?sel=feature:F2`,
        `/w/${SLUG}/planning/gantt?sel=feature:F2`,
        `/w/${SLUG}/planning/board?sel=feature:F2&m=harbor-1-0`,
        `/w/${SLUG}/planning/graph?sel=milestone:harbor-0-9`,
        `/w/${SLUG}/features`,
        `/w/${SLUG}/milestones`,
        `/w/${SLUG}/board?sel=spec:002`,
      ]) {
        const res = await fetch(`${url}${page}`);
        expect({ page, status: res.status }).toEqual({ page, status: 200 });
        expect(await res.text()).toContain("<title>spectant</title>");
      }

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }

    const after = snapshot(copy);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(copy, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(copy, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
  });
});

// The next-step guidance (spec 020 T32, ISC-243) under the same guard, through the served app on its own copy, `.git/`
// included: the dashboard carries the workspace-wide `guidance` (`waits` and `next`), the spec page of a spec the
// guidance names carries that spec's slice of it, entry for entry and in the same order, and both routes are read,
// revalidated and HEAD. Copying an entry's command is the browser's clipboard and reaches no route, so these reads are
// every server read behind the guidance on the four surfaces; the browser side is `bun run e2e -- guidance -g anti`.
// The copy stays byte-identical, every mtime and `.git/index` kept.
describe("ISC-243 guidance: the dashboard's and a spec page's guidance leave the repository byte-identical", () => {
  test("readonly: the dashboard and a spec page carry the guidance, read, revalidated and HEAD, and change no byte, .git/ included", async () => {
    const copy = join(mkdtempSync(join(root, "guidance-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const before = snapshot(copy);
    const indexBefore = readFileSync(join(copy, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(copy, ".git", "index")).mtimeMs;

    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-guidance-")) };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", copy], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }

      /** GET (200 with an ETag), its revalidation (304) and HEAD (200) of one route; the GET's guidance. */
      const readGuidance = async (path: string): Promise<Guidance | undefined> => {
        const first = await fetch(`${url}${path}`);
        expect({ path, status: first.status }).toEqual({ path, status: 200 });
        const etag = first.headers.get("etag") ?? "";
        expect(etag).not.toBe("");
        expect((await fetch(`${url}${path}`, { headers: { "If-None-Match": etag } })).status).toBe(304);
        expect((await fetch(`${url}${path}`, { method: "HEAD" })).status).toBe(200);
        return ((await first.json()) as { guidance?: Guidance }).guidance;
      };

      // The dashboard: the Start's "Waits on you" and the workspace dashboard's Next read it.
      const dashboard = await readGuidance(`/api/workspaces/${SLUG}/dashboard`);
      expect(dashboard).toBeDefined();
      const entries = [...(dashboard?.waits ?? []), ...(dashboard?.next ?? [])];
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(entry.spec).toMatch(/^\d{3}$/);
        expect(entry.reason.key).not.toBe("");
        expect(entry.reason.phrase).not.toBe("");
      }

      // A spec page the guidance names: its slice is the dashboard's entries of that spec, in the same order.
      const id = entries[0]?.spec ?? "";
      expect(await readGuidance(specRoutes.spec(SLUG, id))).toEqual({
        waits: (dashboard?.waits ?? []).filter((e) => e.spec === id),
        next: (dashboard?.next ?? []).filter((e) => e.spec === id),
      });

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }

    const after = snapshot(copy);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(copy, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(copy, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
  });
});

// The library (spec 017 T24, ISC-160) under the same guard, through the served app, `.git/` included. Its workspace is
// a real repository built from `core/fixtures/library` (every catalog zone, a stale plan.md and tldr.md, documents a
// spec's type asks for and that are missing, prototypes with a preview screenshot, `.evidence/` and `artifacts/` files,
// an archived spec) with the planted git state of the harbor repository above: a commit, a staged file, a modified
// tracked file, a tracked file with stale stat data, an untracked and two ignored files. One spec more, a bug reviewed
// on its spec.md, carries a code-reviewed mark naming this worktree's tree (excluded through `.git/info/exclude`): the
// catalog's group head reads it `close` only when the library route ran the dashboard's git path (worktree tree id,
// lock sources) and computed the id right; core alone reads it `code-review`.
//
// The redirects of ISC-157.1 (`/w/:ws/tech`, `/w/:ws/tech/<tab>`) and ISC-158.1 (`/w/:ws/s/:id/<tab>` for plan, design,
// decisions, constitution and evidence) are the Angular router's, in the browser: the server answers each of them with
// the SPA shell and nothing else, and the page they land on reads the library routes probed here. Both are fetched too.
const LIBRARY_FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "library");
const SHELF = "shelf";
const PIER = "005-pier-lamp";

/**
 * `core/fixtures/library` as a repository with the planted state, and the pier spec's fresh code-reviewed mark;
 * `plant` adds files to the fixture copy before the first commit, so they are tracked like the rest.
 */
function buildLibraryRepository(dir: string, plant?: (dir: string) => void): void {
  cpSync(LIBRARY_FIXTURE, dir, { recursive: true });
  plant?.(dir);
  // Stale (ISC-155.1): 001's plan.md older than its last events.jsonl line (03-12), tldr.md older than the newest spec.
  for (const [path, at] of [
    ["specs/001-lighthouse-map/plan.md", "2026-03-05T00:00:00Z"],
    ["specs/tldr.md", "2026-03-08T00:00:00Z"],
  ] as const) {
    utimesSync(join(dir, path), new Date(at), new Date(at));
  }
  // A bug reviewed on its current spec.md: only the code review stands between it and close.
  const pier = join(dir, "specs", PIER);
  mkdirSync(join(pier, ".gates"), { recursive: true });
  const spec = ["---", "task: pier lamp", `slug: ${PIER}`, "spec_type: bug", "phase: build", "---", "", "# 005 — Pier lamp", "", "## Goal", "", "The pier lamp blinks.", "", "## Claims", "", "- [x] ISC-1: It blinks.", ""].join("\n");
  writeFileSync(join(pier, "spec.md"), spec);
  const reviewed = { gate: "reviewed", at: "2026-03-13T10:00:00Z", files: { "spec.md": hashForGate("spec.md", spec), "plan.md": null, "tasks.md": null } };
  writeFileSync(join(pier, ".gates", "reviewed.json"), `${JSON.stringify(reviewed, null, 2)}\n`);
  writeFileSync(join(dir, "README.md"), "# shelf\n");
  writeFileSync(join(dir, "CHANGES.md"), "# changes\n");

  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "*.log\nbuild/\n");
  appendFileSync(join(dir, ".git", "info", "exclude"), `specs/${PIER}/.gates/code-reviewed.json\n`);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "library fixture");

  writeFileSync(join(dir, "staged.md"), "# staged, not committed\n");
  git(dir, "add", "staged.md");
  appendFileSync(join(dir, "README.md"), "modified after the commit\n");
  const future = new Date("2030-01-01T00:00:00Z");
  utimesSync(join(dir, "CHANGES.md"), future, future);
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "untracked.md"), "# untracked\n");
  writeFileSync(join(dir, "debug.log"), "ignored by *.log\n");
  mkdirSync(join(dir, "build"));
  writeFileSync(join(dir, "build", "out.txt"), "ignored by build/\n");

  const scratch = `${dir}-write-tree`;
  cpSync(dir, scratch, { recursive: true });
  git(scratch, "add", "-A");
  const tree = git(scratch, "write-tree");
  rmSync(scratch, { recursive: true, force: true });
  const mark = { gate: "code-reviewed", at: "2026-03-13T11:00:00Z", tree, head: null, code: 0, security: 0 };
  writeFileSync(join(pier, ".gates", "code-reviewed.json"), `${JSON.stringify(mark, null, 2)}\n`);
}

describe("ISC-160: the library, its reader, search, assets, prototypes and the old deep links leave the repository byte-identical", () => {
  test("readonly: library catalog, every Markdown doc, searches, images, prototype pages and fonts, refusals and the SPA shell change no byte, .git/ included", async () => {
    const copy = join(mkdtempSync(join(root, "library-")), SHELF);
    buildLibraryRepository(copy);
    // The planted state is armed here too: a plain `git status` on a copy rewrites its index.
    const probe = `${copy}-status`;
    cpSync(copy, probe, { recursive: true });
    const probeBefore = snapshot(probe);
    git(probe, "status", "--porcelain");
    expect(changed(probeBefore, snapshot(probe))).toContain(".git/index");
    rmSync(probe, { recursive: true, force: true });

    const before = snapshot(copy);
    const indexBefore = readFileSync(join(copy, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(copy, ".git", "index")).mtimeMs;

    const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-library-")) };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    let catalog: WorkspaceRouteResponses["library"];
    const readTypes = new Set<string>();
    try {
      expect(await run(["add", copy], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      /** GET 200 (body drained), the same with its ETag 304, HEAD 200; `headers` go with all three. */
      const read = async (path: string, headers: Record<string, string> = {}): Promise<Response> => {
        const first = await fetch(`${url}${path}`, { headers });
        expect({ path, status: first.status }).toEqual({ path, status: 200 });
        const body = new Response(await first.arrayBuffer(), { headers: first.headers });
        const etag = first.headers.get("etag") ?? "";
        expect({ path, etag: etag !== "" }).toEqual({ path, etag: true });
        expect({ path, status: (await fetch(`${url}${path}`, { headers: { ...headers, "If-None-Match": etag } })).status }).toEqual({ path, status: 304 });
        expect({ path, status: (await fetch(`${url}${path}`, { method: "HEAD", headers })).status }).toEqual({ path, status: 200 });
        return body;
      };
      /** Each request answers the expected status, its body drained. */
      const refused = async (cases: ReadonlyArray<readonly [string, number, RequestInit?]>): Promise<void> => {
        for (const [path, status, init] of cases) {
          const res = await fetch(`${url}${path}`, init);
          await res.arrayBuffer();
          expect({ path, method: init?.method ?? "GET", status: res.status }).toEqual({ path, method: init?.method ?? "GET", status });
        }
      };

      // The catalog, first, so its git path is the first to run: read, revalidated and HEAD.
      catalog = (await (await read(workspaceRoutes.library(SHELF))).json()) as WorkspaceRouteResponses["library"];

      // The reader: every Markdown document the catalog lists as readable, each read, revalidated and HEAD.
      const readable = catalog.docs.filter((d) => d.media === "markdown" && d.state !== "missing");
      for (const doc of readable) {
        await read(workspaceRoutes.libraryDoc(SHELF, doc.path));
        readTypes.add(doc.type);
      }

      // The search: hits, no hits, case, a blank query, and the same query again from the text cache.
      for (const q of ["lighthouse", "tide", "LIGHTHOUSE", "no such words anywhere", "", "   ", "lighthouse"]) {
        await read(workspaceRoutes.librarySearch(SHELF, q));
      }
      const hits = (await (await fetch(`${url}${workspaceRoutes.librarySearch(SHELF, "lighthouse")}`)).json()) as WorkspaceRouteResponses["librarySearch"];
      expect(hits.hits.length).toBeGreaterThan(0);

      // The images: every prototype's preview, an `.evidence/`, an `artifacts/` and a `.design/` image, and `tech/`.
      const prototypes = catalog.docs.filter((d) => d.type === "prototype");
      const previews = prototypes.flatMap((d) => (d.preview == null ? [] : [d.preview]));
      expect(previews.length).toBeGreaterThan(0);
      for (const image of [
        ...previews,
        "001-lighthouse-map/.evidence/ISC-1/map.png",
        "001-lighthouse-map/artifacts/map-overview.png",
        "001-lighthouse-map/.design/views/mobile.png",
        "tech/arch.png",
      ]) {
        await read(workspaceRoutes.libraryAsset(SHELF, image));
      }

      // The prototypes: every page the catalog lists, and the files a page links, a font by `Origin: null` included.
      for (const doc of prototypes) {
        const folder = prototypeFolderOf(doc);
        expect({ path: doc.path, folder: folder !== null }).toEqual({ path: doc.path, folder: true });
        for (const page of doc.pages ?? []) await read(prototypeRoute(SHELF, doc.spec, folder ?? "", page));
      }
      const board = (file: string): string => prototypeRoute(SHELF, "002-tide-board", "prototype/board", file);
      for (const file of ["styles.css", "app.js", "main.js", "tide.mjs", "img/badge.png", "notes.md", "fonts/manrope-variable.woff2"]) await read(board(file));
      // The sandboxed page's own CORS fetches (T58): a font, a stylesheet, a module script and its `.mjs` import, by
      // `Origin: null` with `Sec-Fetch-Mode: cors` and their `Sec-Fetch-Dest`.
      const opaqueFetches: Array<[string, string]> = [["fonts/manrope-variable.woff2", "font"], ["styles.css", "style"], ["main.js", "script"], ["tide.mjs", "script"]];
      for (const [file, dest] of opaqueFetches) {
        const opaque = await read(board(file), { Origin: "null", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": dest });
        expect(opaque.headers.get("Access-Control-Allow-Origin")).toBe("*");
      }

      // Refused: unknown workspace, missing or unlisted document, traversal, other media, other methods, foreign origins.
      const missingDoc = catalog.docs.find((d) => d.state === "missing");
      expect(missingDoc).toBeDefined();
      await refused([
        [workspaceRoutes.library("nowhere"), 404],
        [workspaceRoutes.library(SHELF), 405, { method: "POST" }],
        [workspaceRoutes.library(SHELF), 403, { headers: { Origin: "https://example.com" } }],
        [workspaceRoutes.libraryDoc(SHELF, missingDoc?.path ?? ""), 404],
        [workspaceRoutes.libraryDoc(SHELF, "../README.md"), 404],
        // An archived spec's documents are read above with the catalog (spec 034, ISC-187.1); an unknown one is refused.
        [workspaceRoutes.libraryDoc(SHELF, "archive/999-none/spec.md"), 404],
        [workspaceRoutes.libraryDoc(SHELF, "tech/arch.png"), 404],
        [workspaceRoutes.libraryDoc(SHELF, "001-lighthouse-map/spec.md"), 405, { method: "PUT", body: "{}" }],
        [workspaceRoutes.libraryDoc("nowhere", "001-lighthouse-map/spec.md"), 404],
        [workspaceRoutes.librarySearch(SHELF, "lighthouse"), 405, { method: "POST", body: "{}" }],
        [workspaceRoutes.librarySearch("nowhere", "lighthouse"), 404],
        [workspaceRoutes.libraryAsset(SHELF, "tech/gone.png"), 404],
        [workspaceRoutes.libraryAsset(SHELF, "../README.md"), 403],
        [`${workspaceRoutes.library(SHELF)}/asset?path=%252e%252e%2FREADME.md`, 403],
        [workspaceRoutes.libraryAsset(SHELF, "001-lighthouse-map/artifacts/data.json"), 403],
        [workspaceRoutes.libraryAsset(SHELF, "001-lighthouse-map/plan.md"), 403],
        [workspaceRoutes.libraryAsset(SHELF, "tech/arch.png"), 405, { method: "DELETE" }],
        [board("missing.html"), 404],
        [board("..%2F..%2Fspec.md"), 403],
        [board("..%252F..%252Fspec.md"), 403],
        [board("%2Fetc%2Fpasswd"), 403],
        [board("index.html"), 405, { method: "POST", body: "x" }],
        [board("index.html"), 403, { headers: { Origin: "null" } }],
        [board("index.html"), 403, { headers: { Origin: "https://example.com" } }],
        [prototypeRoute(SHELF, "999-none", "prototype", "index.html"), 404],
        [prototypeRoute(SHELF, "009-nowhere", "prototype", "index.html"), 404],
        [prototypeRoute("nowhere", "002-tide-board", "prototype/board", "index.html"), 404],
        [`/proto/${SHELF}/002-tide-board/views/mobile.png`, 404],
      ]);

      // The SPA shell for the library page and the old deep links the router redirects (ISC-157.1, ISC-158.1).
      const tabs = ["overview", "architecture", "status", "specs", "open"].map((tab) => `/w/${SHELF}/tech/${tab}`);
      const deepLinks = ["plan", "design", "decisions", "constitution", "evidence", "docs", "docs/plan"].map((tab) => `/w/${SHELF}/s/001/${tab}`);
      for (const page of [`/w/${SHELF}/library`, `/w/${SHELF}/tech`, ...tabs, ...deepLinks]) {
        const res = await fetch(`${url}${page}`);
        expect({ page, status: res.status }).toEqual({ page, status: 200 });
        expect(await res.text()).toContain("<title>spectant</title>");
      }

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }

    // The catalog is the fixture's: stale and missing documents, and the git path ran and computed the right id.
    expect(catalog.stale).toBeGreaterThan(0);
    expect(catalog.missing).toBeGreaterThan(0);
    expect(catalog.docs.find((d) => d.path === "001-lighthouse-map/plan.md")?.state).toBe("stale");
    expect(catalog.groups.find((g) => g.spec === PIER)?.stage).toBe("close");
    // Every Markdown kind of the catalog went through the reader.
    const kinds = ["artifact", "constitution", "context", "design", "evidence", "idea", "plan", "spec", "tasks", "tech", "tldr"];
    expect(kinds.filter((kind) => !readTypes.has(kind))).toEqual([]);

    const after = snapshot(copy);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(copy, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(copy, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
  });
});

// Density and readability (spec 021, T58, ISC-255) under the same guard, `-t density`: every route the denser
// dashboard, the spec page, the Tasks tab and the sectioned library reader read, and the density setting's GET, HEAD
// and PUT, leave the registered repository byte-identical, `.git/` included, and call no host but loopback. The
// workspace is the library fixture (its `specs/tldr.md` names `lang: de`) with planted git state, plus one rounds.jsonl
// line that holds 001's open task T3 and one more open task T4, so the Tasks tab counts open, done and held rows.
//
// Opening and closing a fold and the per-view density override are client-side: they rewrite the address only
// (`?open=…`, `?density=…`) and call no write route. The address half is covered by requesting the API routes and the
// SPA pages with those query parameters: each answers as without them and changes no byte. The density setting lives in
// the app's SQLite (`spectant.db` in the data directory): its PUTs change the data directory, never the repository.
const DENSITY_ROUND = {
  v: 1,
  round: 1,
  ts: "2026-03-12T09:00:00Z",
  mode: "agent",
  width: 1,
  dispatched: [],
  tasks: [{ id: "T3", claim: "ISC-3", lane: "web", seam: false, parallel: false, text: "remember the last area", paths: [], state: "held", reason: "width 1 reached" }],
  claims: { closed: ["ISC-1", "ISC-2"], open: ["ISC-3"], closed_this_round: [] },
  progress: "2/3",
};

describe("ISC-255 density: KPIs, the brief's language, the Tasks tab, the sectioned reader, the density setting and the fold addresses change no byte", () => {
  test("readonly: every read and the density PUTs change no byte of the repository, .git/ included, only the data directory; every request is loopback", async () => {
    const copy = join(mkdtempSync(join(root, "density-")), SHELF);
    buildLibraryRepository(copy, (dir) => {
      writeFileSync(join(dir, "specs", "001-lighthouse-map", "rounds.jsonl"), `${JSON.stringify(DENSITY_ROUND)}\n`);
      appendFileSync(join(dir, "specs", "001-lighthouse-map", "tasks.md"), "- [ ] T4 · ISC-3 · web — keep the zoom level\n");
    });
    const before = snapshot(copy);
    const indexBefore = readFileSync(join(copy, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(copy, ".git", "index")).mtimeMs;

    const xdg = mkdtempSync(join(root, "xdg-density-"));
    const env = { XDG_DATA_HOME: xdg };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    // Every fetch of this process, the test's and any the server might make, names its host here (as ISC-182).
    const hosts = new Set<string>();
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
      hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname);
      return realFetch(input, init);
    }) as typeof fetch);
    const stop = new AbortController();
    let model: DashboardModel;
    let tasks: TasksTab | null;
    let dataChanged: string[] = [];
    try {
      expect(await run(["add", copy], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      /** GET 200 with an ETag, its revalidation 304 and HEAD 200; the GET's body as JSON. */
      const read = async <T>(path: string): Promise<T> => {
        const first = await fetch(`${url}${path}`);
        expect({ path, status: first.status }).toEqual({ path, status: 200 });
        const etag = first.headers.get("etag") ?? "";
        expect({ path, etag: etag !== "" }).toEqual({ path, etag: true });
        expect({ path, status: (await fetch(`${url}${path}`, { headers: { "If-None-Match": etag } })).status }).toEqual({ path, status: 304 });
        expect({ path, status: (await fetch(`${url}${path}`, { method: "HEAD" })).status }).toEqual({ path, status: 200 });
        return (await first.json()) as T;
      };
      const put = async (body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
        const res = await fetch(`${url}/api/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: res.status, json: (await res.json()) as Record<string, unknown> };
      };

      // The dashboard: the KPI tiles with their references and the brief with its language, plain and with fold and
      // density addresses (the API ignores them; the body is the same).
      const dashboardPath = `/api/workspaces/${SHELF}/dashboard`;
      model = await read<DashboardModel>(dashboardPath);
      for (const query of ["?open=specs,tldr", "?open=specs,tldr,overlaps&density=compact", "?density=comfortable"]) {
        expect(await read<DashboardModel>(`${dashboardPath}${query}`)).toEqual(model);
      }

      // A spec page and its Tasks tab, plain and with the addresses.
      await read(specRoutes.spec(SHELF, "001"));
      await read(`${specRoutes.spec(SHELF, "001")}?open=overlaps&density=compact`);
      tasks = await read<TasksTab | null>(specRoutes.tasks(SHELF, "001"));
      expect(await read<TasksTab | null>(`${specRoutes.tasks(SHELF, "001")}?density=compact`)).toEqual(tasks);

      // The library reader: the catalog, then its documents until a sectioned one (two or more headings) is read, and
      // the TL;DR document.
      const catalog = await read<WorkspaceRouteResponses["library"]>(workspaceRoutes.library(SHELF));
      const readable = catalog.docs.filter((d) => d.media === "markdown" && d.state !== "missing");
      let sectioned = 0;
      for (const doc of readable) {
        const page = await read<WorkspaceRouteResponses["libraryDoc"]>(workspaceRoutes.libraryDoc(SHELF, doc.path));
        if (page.toc.length >= 2) sectioned += 1;
      }
      expect(sectioned).toBeGreaterThan(0);
      expect(readable.some((d) => d.type === "tldr")).toBe(true);

      // The density setting: GET, its revalidation and HEAD; PUT compact, an invalid value (refused, nothing stored),
      // comfortable. The data directory changes, the repository does not.
      const dataBefore = snapshot(xdg);
      const initial = await read<{ density: string }>("/api/settings");
      expect(initial.density).toBe("comfortable");
      const compact = await put({ density: "compact" });
      expect([compact.status, compact.json.density]).toEqual([200, "compact"]);
      expect((await read<{ density: string }>("/api/settings")).density).toBe("compact");
      const invalid = await put({ density: "dense" });
      expect([invalid.status, invalid.json.error, invalid.json.key]).toEqual([400, "invalid-value", "density"]);
      expect((await read<{ density: string }>("/api/settings")).density).toBe("compact");
      const comfortable = await put({ density: "comfortable" });
      expect([comfortable.status, comfortable.json.density]).toEqual([200, "comfortable"]);
      dataChanged = changed(dataBefore, snapshot(xdg));

      // The SPA pages a fold or a density override addresses: the shell, and nothing else.
      for (const page of [
        `/w/${SHELF}?open=specs,tldr`,
        `/w/${SHELF}?density=compact`,
        `/w/${SHELF}/s/001?open=overlaps&density=compact`,
        `/w/${SHELF}/s/001/tasks?density=comfortable`,
        `/w/${SHELF}/library?open=s-goal`,
        `/w/${SHELF}/board?density=compact`,
      ]) {
        const res = await fetch(`${url}${page}`);
        expect({ page, status: res.status }).toEqual({ page, status: 200 });
        expect(await res.text()).toContain("<title>spectant</title>");
      }

      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      spy.mockRestore();
      log.mockRestore();
    }

    // The numbers are the model's own: each tile's reference holds its number, and the brief names the file's language.
    const k = model.kpis;
    expect(k.stageGroups.scoping + k.stageGroups.building + k.stageGroups.complete).toBe(k.specs);
    expect([k.stageGroups.building, k.stageGroups.scoping]).toEqual([k.building, k.scoping]);
    expect(k.takeable).toBeLessThanOrEqual(k.openClaims);
    expect(k.specsWithWarnings).toBeLessThanOrEqual(k.specs);
    expect(k.specsWithFog).toBeLessThanOrEqual(k.specs);
    expect(k.masterFog).toBeLessThanOrEqual(k.fog);
    expect(model.brief?.lang).toBe("de");
    // The Tasks tab counts rows: open, done and held each appear, and the statuses sum to the rows.
    const counts = tasks?.counts;
    const byStatus = Object.fromEntries((counts?.byStatus ?? []).map((c) => [c.name, c.count]));
    expect(byStatus).toEqual({ open: 1, held: 1, done: 2 });
    const statusSum = (counts?.byStatus ?? []).reduce((sum, c) => sum + c.count, 0);
    expect([counts?.rows, counts?.done, statusSum]).toEqual([4, 2, 4]);

    // The settings went to the data directory.
    expect(dataChanged.length).toBeGreaterThan(0);

    const after = snapshot(copy);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(copy, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(copy, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
    expect([...hosts]).toEqual(["127.0.0.1"]);
  });
});

// The allocation (spec 008, T96, ISC-130.2) under the same guard, on its own copy (`.git/` included, so the git reads
// of `takenSpecNumbers` and the viewer run): every refused allocation (400, 404, 409, 422) leaves the copy
// byte-identical, an accepted one creates exactly the new folder with its three files and removes the story file, and
// `.git/` never changes. The committed history names specs 001 to 009, so the story gets 010.
describe("ISC-130.2 with the allocation: a refused one changes nothing, an accepted one only the new folder and the story", () => {
  test("readonly: refused allocations leave the copy byte-identical; the accepted one creates three files and removes one", async () => {
    const copy = join(mkdtempSync(join(root, "allocate-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-allocate-")));
    registry.add(copy);
    const api = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
      const res = await api(new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init }), url);
      if (res === null) throw new Error(`the workspace routes declined ${path}`);
      return res;
    };
    const storyHash = async (slug: string): Promise<string> => ((await (await call(workspaceRoutes.idea(SLUG, slug))).json()) as { hash: string }).hash;
    const folder = "specs/010-console-audit-log";
    const gitChanges = (a: Snapshot, b: Snapshot): string[] => changed(a, b, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"));

    try {
      const before = snapshot(copy);
      // Refused: 409 (stale hash), 422 (registry-webhooks is not in the index), 404 (no such story), 400 (no request).
      const refused: Array<[string, unknown, number]> = [
        [workspaceRoutes.allocate(SLUG, "console-audit-log"), { hash: "0".repeat(64) }, 409],
        [workspaceRoutes.allocate(SLUG, "registry-webhooks"), { hash: await storyHash("registry-webhooks") }, 422],
        [workspaceRoutes.allocate(SLUG, "tide-tables"), { hash: "0".repeat(64) }, 404],
        [workspaceRoutes.allocate(SLUG, "console-audit-log"), "not json", 400],
      ];
      for (const [path, body, status] of refused) expect({ path, status: (await call(path, "POST", body)).status }).toEqual({ path, status });
      const afterRefused = snapshot(copy);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      // Accepted: console-audit-log becomes 010 with context.md, spec.md and events.jsonl; its story file is removed.
      const res = await call(workspaceRoutes.allocate(SLUG, "console-audit-log"), "POST", { hash: await storyHash("console-audit-log") });
      expect(res.status).toBe(200);
      const afterAllocate = snapshot(copy);
      expect(changed(before, afterAllocate)).toEqual([folder, `${folder}/context.md`, `${folder}/events.jsonl`, `${folder}/spec.md`, "specs/ideas/console-audit-log.md"]);
      expect(afterAllocate.entries.has("specs/ideas/console-audit-log.md")).toBe(false);
      expect(gitChanges(before, afterAllocate)).toEqual([]);
      expect(underGit(afterAllocate)).toEqual(underGit(before));
    } finally {
      registry.close();
    }
  });
});

// The run lock (spec 040, T32, ISC-225) under the same guard, on its own copy (`.git/` included): with a running run
// on 003, on 004 and on the story console-audit-log (run lines written before the first snapshot, relative to now, as
// the routes run on the real clock), the stage move, the reviewed mark, the checkbox and the allocation each answer
// 423 `run-locked`, and the copy stays byte-identical with every mtime kept.
describe("ISC-225 run-lock: every write a running run refuses leaves the repository byte-identical, .git/ included", () => {
  test("readonly run-lock: 423 run-locked on the move, the mark, the tick and the allocation changes no byte or mtime", async () => {
    const copy = join(mkdtempSync(join(root, "run-lock-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const runs = [
      { run: "r-003", command: "/spec-tasks 003", spec: "003" },
      { run: "r-004", command: "/spec-review 004", spec: MARKED_SPEC },
      { run: "r-idea", command: "/spec-idea console-audit-log", idea: "console-audit-log" },
    ].map((r) => `${JSON.stringify({ ts: since, event: "run-start", session: "a:claude:sess-9", ...r })}\n`);
    appendFileSync(join(copy, ".spectant", "activity.jsonl"), runs.join(""));
    const registry = openRegistry(mkdtempSync(join(root, "data-run-lock-")));
    registry.add(copy);
    const specs = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT });
    const workspace = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
      const req = (): Request => new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init });
      const res = (await specs(req(), url)) ?? (await workspace(req(), url));
      if (res === null) throw new Error(`no route answered ${path}`);
      return res;
    };
    const header = async (id: string, name: string): Promise<string> => (await call(specRoutes.spec(SLUG, id))).headers.get(name) ?? "";
    const tasksHash = async (id: string): Promise<string> => (await call(specRoutes.tasks(SLUG, id))).headers.get(TASKS_HASH_HEADER) ?? "";
    const storyHash = async (slug: string): Promise<string> => ((await (await call(workspaceRoutes.idea(SLUG, slug))).json()) as { hash: string }).hash;

    try {
      const before = snapshot(copy);
      const locked: Array<[string, unknown]> = [
        [specRoutes.transition(SLUG, "003"), { to: "review", hash: await header("003", SPEC_HASH_HEADER) }],
        [specRoutes.gateReviewed(SLUG, "004"), { hashes: parseReviewedHashes(await header("004", REVIEWED_HASHES_HEADER)) }],
        [specRoutes.taskCheck(SLUG, "004", "T1"), { checked: false, hash: await tasksHash("004") }],
        [workspaceRoutes.allocate(SLUG, "console-audit-log"), { hash: await storyHash("console-audit-log") }],
      ];
      for (const [path, body] of locked) {
        const res = await call(path, "POST", body);
        expect({ path, status: res.status, error: ((await res.json()) as { error: string }).error }).toEqual({ path, status: 423, error: "run-locked" });
      }
      const after = snapshot(copy);
      expect(changed(before, after, { mtime: true })).toEqual([]);
      expect(after.checksum).toBe(before.checksum);
      expect(underGit(after)).toEqual(underGit(before));
    } finally {
      registry.close();
    }
  });
});

// The eighth write path (spec 040, T38, ISC-226.1) under the same guard, on its own copy (`.git/` included): with a
// running run on 003 written before the first snapshot, and the copy given a synthetic viewer address (the file's empty
// global config holds none). Every refused release (400, 404, 409 with a wrong hash, 422 for an aborted run) leaves the
// copy byte-identical with every mtime kept; the accepted one changes exactly the file of `WRITE_PATHS.runRelease`,
// never `.git/`, and creates no directory.
describe("ISC-226.1 run-release: a refused release changes nothing, an accepted one only .spectant/activity.jsonl", () => {
  test("readonly run-release: a wrong hash changes no byte or mtime; the accepted release touches only WRITE_PATHS.runRelease", async () => {
    const copy = join(mkdtempSync(join(root, "run-release-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    git(copy, "config", "user.email", "viewer@example.test");
    const now = Date.now();
    const runs = [
      { ts: new Date(now - 5 * 60_000).toISOString(), run: "r-003", command: "/spec-tasks 003", spec: "003" },
      { ts: new Date(now - 600 * 60_000).toISOString(), run: "r-old", command: "/spec-review 004", spec: MARKED_SPEC },
    ].map((r) => `${JSON.stringify({ ...r, event: "run-start", session: "a:claude:sess-9" })}\n`);
    appendFileSync(join(copy, WRITE_PATHS.runRelease.writes[0]), runs.join(""));
    const registry = openRegistry(mkdtempSync(join(root, "data-run-release-")));
    registry.add(copy);
    const api = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const call = async (path: string, method = "GET", hash: string | null = null): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const headers = { Host: "127.0.0.1:7717", ...(hash === null ? {} : { [ACTIVITY_HASH_HEADER]: hash }) };
      const res = await api(new Request(url.href, { method, headers }), url);
      if (res === null) throw new Error(`the workspace routes declined ${path}`);
      return res;
    };

    try {
      const before = snapshot(copy);
      const hash = (await call(`/api/workspaces/${SLUG}/dashboard`)).headers.get(ACTIVITY_HASH_HEADER) ?? "";
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const refused: Array<[string, string | null, number]> = [
        ["r-003", null, 400],
        ["r-none", hash, 404],
        ["r-003", "0".repeat(64), 409],
        ["r-old", hash, 422],
      ];
      for (const [run, sent, status] of refused) {
        expect({ run, sent, status: (await call(workspaceRoutes.runRelease(SLUG, run), "POST", sent)).status }).toEqual({ run, sent, status });
      }
      const afterRefused = snapshot(copy);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      expect((await call(workspaceRoutes.runRelease(SLUG, "r-003"), "POST", hash)).status).toBe(200);
      const after = snapshot(copy);
      expect(changed(before, after)).toEqual([...WRITE_PATHS.runRelease.writes]);
      expect(WRITE_TABLE.runRelease.root).toBe("main");
      expect(WRITE_PATHS.runRelease.creates).toBeNull();
      expect(underGit(after)).toEqual(underGit(before));
      expect(changed(before, after, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"))).toEqual([]);
    } finally {
      registry.close();
    }
  });
});

// The sixth write path (spec 009, T21, ISC-137.1) under the same guard: `spectant tokens` runs on its own copy against
// the harbor transcripts. Without `--yes` it only prints the plan, and the copy stays byte-identical with every mtime
// kept; with `--yes` exactly the files of `WRITE_PATHS.tokens` differ, and `.git/` never changes. The transcript folder
// it reads (and its worktree siblings) is hashed too: the run reads it and writes nothing there.
describe("ISC-137.1 with the token measurement: a dry run changes nothing, `tokens --yes` only specs/tokens.jsonl", () => {
  test("readonly: tokens without --yes leaves the copy byte-identical; with --yes exactly WRITE_PATHS.tokens differs", async () => {
    const copy = join(mkdtempSync(join(root, "tokens-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    // harbor carries its own specs/tokens.jsonl (the FORMAT.md example), byte-equal to what the run writes; removed
    // here so that `--yes` has to create the file and the diff below can prove it.
    rmSync(join(copy, WRITE_PATHS.tokens.writes[0]), { force: true });
    const home = mkdtempSync(join(root, "home-tokens-"));
    const transcripts = join(TRANSCRIPTS, "..");
    const transcriptsBefore = snapshot(transcripts);
    const gitChanges = (a: Snapshot, b: Snapshot): string[] => changed(a, b, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"));
    const out: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
    const error = spyOn(console, "error").mockImplementation(() => undefined);

    try {
      const before = snapshot(copy);
      expect(before.entries.has(WRITE_PATHS.tokens.writes[0])).toBe(false);

      // Without --yes: the plan is printed, nothing is written, every mtime is kept.
      expect(await tokensCommand(copy, { transcripts: TRANSCRIPTS, yes: false, env: {}, home })).toBe(0);
      const afterDry = snapshot(copy);
      expect(changed(before, afterDry, { mtime: true })).toEqual([]);
      expect(afterDry.checksum).toBe(before.checksum);

      // With --yes: exactly the sixth path's file appears; `.git/` keeps every byte and mtime.
      expect(await tokensCommand(copy, { transcripts: TRANSCRIPTS, yes: true, env: {}, home })).toBe(0);
      const afterWrite = snapshot(copy);
      expect(changed(before, afterWrite)).toEqual([...WRITE_PATHS.tokens.writes]);
      expect(gitChanges(before, afterWrite)).toEqual([]);
      expect(underGit(afterWrite)).toEqual(underGit(before));
      expect(out.some((line) => line.startsWith(`tokens wrote ${WRITE_PATHS.tokens.writes[0]} `))).toBe(true);

      expect(changed(transcriptsBefore, snapshot(transcripts), { mtime: true })).toEqual([]);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

// ── spec 027: a repository with a spec worktree and a builder worktree (`tests/fixtures/worktree-repo.ts`) ───────────
//
// Both linked worktrees live inside the main checkout (`.worktrees/002-web-console`, `.claude/worktrees/agent-a1b2`)
// and their admin folders under its `.git/worktrees/`, so `snapshot` of the main checkout already hashes every byte of
// all three working trees and of the one `.git/`; `expectWorktreesHashed` proves the walk reaches them. Two groups,
// selected apart by name: `-t worktree-copy` runs the writes in the copy (T23, ISC-181) alone, `-t worktree` the reads
// (T29, ISC-182) together with them.

/** The snapshot reaches both linked worktrees, the spec worktree's uncommitted file and both admin folders. */
function expectWorktreesHashed(s: Snapshot): void {
  const reached = [`${SPEC_WORKTREE}/.git`, `${SPEC_WORKTREE}/${UNCOMMITTED}`, `${BUILDER_WORKTREE}/.git`, `.git/worktrees/${SPEC_FOLDER}/HEAD`, ".git/worktrees/agent-a1b2/HEAD"];
  expect(reached.filter((path) => !s.entries.has(path))).toEqual([]);
}

/** Paths of git's own: the main `.git/` and each linked worktree's `.git` file. */
const gitPaths = (paths: readonly string[]): string[] => paths.filter((p) => p === ".git" || p.startsWith(".git/") || p.endsWith("/.git"));

/** The served app (`spectant serve`) with `repo` registered: its loopback URL, and `stop`, which waits for the exit. */
async function serve(repo: string, tag: string): Promise<{ url: string; stop: () => Promise<void> }> {
  const env = { XDG_DATA_HOME: mkdtempSync(join(root, `xdg-${tag}-`)) };
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  try {
    expect(await run(["add", repo], manifest(), { env })).toBe(0);
    const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: abort.signal });
    const deadline = Date.now() + 5_000;
    let url = "";
    while (url === "") {
      url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
      if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
      if (url === "") await Bun.sleep(5);
    }
    return {
      url,
      stop: async () => {
        abort.abort();
        const code = await done;
        log.mockRestore();
        expect(code).toBe(0);
      },
    };
  } catch (error) {
    abort.abort();
    log.mockRestore();
    throw error;
  }
}

/**
 * Every read the dashboard, the board and the spec page of each id make, each revalidated with its ETag: the workspace
 * list, the dashboard, the planning tree behind the board, and per spec the head and every tab (timeline, claims,
 * tasks, frames, the live board); every read answers 200.
 */
async function readEverything(url: string, ids: readonly string[]): Promise<void> {
  const reads: Array<[string, readonly number[]]> = [
    ["/api/workspaces", [200]],
    [`/api/workspaces/${SLUG}/dashboard`, [200]],
    [workspaceRoutes.planning(SLUG), [200]],
  ];
  for (const id of ids) {
    // The docs tabs and the evidence list moved into the library (spec 017); a spec's own read routes are these.
    for (const route of [specRoutes.spec, specRoutes.timeline, specRoutes.claims, specRoutes.tasks, specRoutes.frames, specRoutes.live]) {
      reads.push([route(SLUG, id), [200]]);
    }
  }
  for (const [path, statuses] of reads) {
    const first = await fetch(`${url}${path}`);
    expect({ path, ok: statuses.includes(first.status) }).toEqual({ path, ok: true });
    // The revalidation is a second read, as the polling client makes it; a body that carries the clock (the live frame,
    // a lock's age) answers it with 200 instead of 304, so either counts here: this guard is about bytes, not ETags.
    const etag = first.headers.get("etag");
    const again = await fetch(`${url}${path}`, etag === null ? {} : { headers: { "If-None-Match": etag } });
    expect({ path, ok: [...statuses, 304].includes(again.status) }).toEqual({ path, ok: true });
  }
}

describe("ISC-181 worktree-copy writes: with specs/ tracked, the three writes on 002 touch only its worktree copy", () => {
  test("readonly: reads and refused writes change no byte; the accepted tick, mark and move only the copy's WRITE_PATHS, never main or .git/", async () => {
    const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs: true });
    const repo = planted.root;
    const mainFolder = join(repo, "specs", SPEC_FOLDER);
    const copyFolder = `${SPEC_WORKTREE}/specs/${SPEC_FOLDER}`;
    /** `WRITE_PATHS[op]` resolved against the spec's read source, here the worktree copy. */
    const inCopy = (op: "taskCheck" | "gateReviewed" | "transition"): string[] => {
      expect({ op, root: WRITE_TABLE[op].root }).toEqual({ op, root: "source" });
      return writePathsOf(op, SPEC_FOLDER).writes.map((path) => `${SPEC_WORKTREE}/${path}`).sort();
    };
    const before = snapshot(repo);
    expectWorktreesHashed(before);

    const { url, stop } = await serve(repo, "copy");
    try {
      await readEverything(url, [SPEC_ID, "004"]);
      const model = (await (await fetch(`${url}/api/workspaces/${SLUG}/dashboard`)).json()) as DashboardModel;
      expect(model.specs.find((row) => row.id === SPEC_ID)?.source).toBe("worktree");
      const tasksHash = async (): Promise<string> => (await fetch(`${url}${specRoutes.tasks(SLUG, SPEC_ID)}`)).headers.get(TASKS_HASH_HEADER) ?? "";
      const head = async (): Promise<Headers> => (await fetch(`${url}${specRoutes.spec(SLUG, SPEC_ID)}`)).headers;
      const post = (path: string, body: unknown): Promise<Response> => fetch(`${url}${path}`, { method: "POST", body: JSON.stringify(body) });

      // Refused: 423 while harbor's activity log holds ISC-74 of 002 (the copy's hashes), 409 for main's hashes.
      const refused: Array<[string, unknown, number]> = [
        [specRoutes.taskCheck(SLUG, SPEC_ID, "T27"), { checked: false, hash: await tasksHash() }, 423],
        [specRoutes.gateReviewed(SLUG, SPEC_ID), { hashes: parseReviewedHashes((await head()).get(REVIEWED_HASHES_HEADER)) }, 423],
        [specRoutes.transition(SLUG, SPEC_ID), { to: "blocked", hash: (await head()).get(SPEC_HASH_HEADER) }, 423],
        [specRoutes.taskCheck(SLUG, SPEC_ID, "T27"), { checked: false, hash: sha256(readFileSync(join(mainFolder, "tasks.md"))) }, 409],
        [specRoutes.transition(SLUG, SPEC_ID), { to: "blocked", hash: sha256(readFileSync(join(mainFolder, "spec.md"))) }, 409],
      ];
      for (const [path, body, status] of refused) expect({ path, status: (await post(path, body)).status }).toEqual({ path, status });
      const afterRefused = snapshot(repo);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      // The test's own two changes: ISC-74 released in the ignored activity log, and the round in the worktree set
      // back from code-review (whose one move needs every claim closed) to build, which may move to blocked.
      appendFileSync(join(repo, ".spectant", "activity.jsonl"), '{"ts":"2026-03-08T16:00:00Z","event":"release","claim":"ISC-74","session":"a:claude:sess-2"}\n');
      const copySpec = join(repo, copyFolder, "spec.md");
      writeFileSync(copySpec, readFileSync(copySpec, "utf8").replace(/^stage: code-review$/m, "stage: build"));
      const released = snapshot(repo);
      expect(changed(before, released)).toEqual([".spectant/activity.jsonl", `${copyFolder}/spec.md`]);

      // Accepted, one at a time: each changes exactly its WRITE_PATHS in the copy.
      expect((await post(specRoutes.taskCheck(SLUG, SPEC_ID, "T27"), { checked: false, hash: await tasksHash() })).status).toBe(200);
      const afterTick = snapshot(repo);
      expect(changed(released, afterTick)).toEqual(inCopy("taskCheck"));
      expect((await post(specRoutes.gateReviewed(SLUG, SPEC_ID), { hashes: parseReviewedHashes((await head()).get(REVIEWED_HASHES_HEADER)) })).status).toBe(200);
      const afterMark = snapshot(repo);
      expect(changed(afterTick, afterMark)).toEqual(inCopy("gateReviewed"));
      expect((await post(specRoutes.transition(SLUG, SPEC_ID), { to: "blocked", hash: (await head()).get(SPEC_HASH_HEADER) })).status).toBe(200);
      const afterMove = snapshot(repo);
      expect(changed(afterMark, afterMove)).toEqual(inCopy("transition"));

      // Together: only the copy's files; nothing in the main checkout, the builder worktree or any of git's files.
      const union = [...new Set([...inCopy("taskCheck"), ...inCopy("gateReviewed"), ...inCopy("transition")])].sort();
      expect(changed(released, afterMove)).toEqual(union);
      expect(gitPaths(changed(before, afterMove, { mtime: true }))).toEqual([]);
      expect(underGit(afterMove)).toEqual(underGit(before));
    } finally {
      await stop();
    }
  }, 60_000);
});

describe("ISC-182 worktree reads: the dashboard, the board and the spec page of a repository with worktrees change no byte", () => {
  for (const trackedSpecs of [false, true]) {
    test(`readonly: specs/ ${trackedSpecs ? "tracked" : "untracked"}: main, the spec and the builder worktree keep every byte and mtime, .git/ included; every request is loopback`, async () => {
      const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs });
      const repo = planted.root;
      const before = snapshot(repo);
      expectWorktreesHashed(before);
      const indexes = [".git/index", `.git/worktrees/${SPEC_FOLDER}/index`];
      const indexesBefore = indexes.map((path) => readFileSync(join(repo, path)));

      // Every fetch of this process, the test's and any the server might make, names its host here (ISC-2 in-process;
      // the network-level proof is `tests/offline-server.ts` and the web e2e `offline`).
      const hosts = new Set<string>();
      const realFetch = globalThis.fetch;
      const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
        hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname);
        return realFetch(input, init);
      }) as typeof fetch);

      const { url, stop } = await serve(repo, `reads-${String(trackedSpecs)}`);
      try {
        await readEverything(url, [SPEC_ID, "004"]);
        // The git reads ran: the row's chip carries git's two facts, and the copy is the source exactly when tracked.
        const model = (await (await fetch(`${url}/api/workspaces/${SLUG}/dashboard`)).json()) as DashboardModel;
        const row = model.specs.find((r) => r.id === SPEC_ID);
        expect([row?.worktree?.ahead, row?.worktree?.dirty, row?.source]).toEqual([planted.expected.ahead, planted.expected.dirty, trackedSpecs ? "worktree" : "main"]);
        // The merge-state read the dashboard runs (spec 025, ISC-162.1: `for-each-ref` and `merge-base --is-ancestor`)
        // ran here too: the spec branch is found and `main` does not hold it.
        const reading = await readWorkspaceInput(repo);
        expect(reading.readable ? reading.mergeState.find((r) => r.spec === SPEC_ID) : null).toMatchObject({ branch: SPEC_BRANCH, merged: false, archived: false });
      } finally {
        await stop();
        spy.mockRestore();
      }

      const after = snapshot(repo);
      expect(changed(before, after, { mtime: true })).toEqual([]);
      expect(after.checksum).toBe(before.checksum);
      expect(underGit(after)).toEqual(underGit(before));
      expect(indexes.filter((path, i) => !readFileSync(join(repo, path)).equals(indexesBefore[i] ?? Buffer.alloc(0)))).toEqual([]);
      expect([...hosts]).toEqual(["127.0.0.1"]);
    }, 60_000);
  }
});

// Every kind of worktree at once (spec 041, T40, ISC-220), under the same guard as ISC-182, `-t worktree`: the fixture's
// live spec worktree 002 with its builder worktree, plus three more spec worktrees, each one commit ahead of `main` on
// `feature/<folder>`: 003 merged into `main` and still present, clean; 006 `prunable` (its folder deleted while git
// still lists it, its admin folder left under `.git/worktrees/`); 007 outside the repository, a sibling folder of the
// main checkout. Every page reads them: the dashboard, the board, the spec page of each with every tab, the library
// catalog with every readable document and a search, the timeline and the live board. Afterwards every byte and mtime
// of the main checkout, of every worktree folder under it and of the outside one is the same, `.git/` included, and
// every request was loopback.

/** The extra spec worktrees and the kind each is left in. */
const WORKTREE_KINDS = { merged: "003-config-loader", prunable: "006-partial-push", outside: "007-rotate-mirror-token" } as const;

/** Adds the spec worktree of `folder` at `path` on `feature/<folder>`, one commit ahead of `main`, specs linked when untracked. */
async function addSpecWorktree(planted: PlantedWorktreeRepo, folder: string, path: string, trackedSpecs: boolean): Promise<void> {
  const ok = async (cwd: string, ...args: string[]): Promise<void> => {
    const result = await planted.git(cwd, ...args);
    if (result.code !== 0) throw new Error(`git ${args.join(" ")} exited ${result.code}: ${result.stderr}`);
  };
  await ok(planted.root, "worktree", "add", "-q", "-b", `feature/${folder}`, path);
  if (!trackedSpecs) {
    const toMain = relative(path, planted.root);
    symlinkSync(join(toMain, "specs"), join(path, "specs"));
    symlinkSync(join(toMain, "ISA.md"), join(path, "ISA.md"));
  }
  mkdirSync(join(path, "src"), { recursive: true });
  writeFileSync(join(path, "src", `${folder}.ts`), `// ${folder}: the first step.\nexport const step = 1;\n`);
  await ok(path, "add", "--", `src/${folder}.ts`);
  await ok(path, "commit", "-q", "-m", `${folder}: first step`);
}

describe("ISC-220 worktree reads with every kind of worktree: spec, builder, merged, prunable and outside change no byte", () => {
  for (const trackedSpecs of [false, true]) {
    test(`readonly: specs/ ${trackedSpecs ? "tracked" : "untracked"}: every page keeps every byte and mtime of main and each worktree, .git/ included; every request is loopback`, async () => {
      const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs });
      const repo = planted.root;
      const merged = join(repo, ".worktrees", WORKTREE_KINDS.merged);
      const prunable = join(repo, ".worktrees", WORKTREE_KINDS.prunable);
      const outside = join(planted.base, `outside-${WORKTREE_KINDS.outside}`);
      await addSpecWorktree(planted, WORKTREE_KINDS.merged, merged, trackedSpecs);
      await addSpecWorktree(planted, WORKTREE_KINDS.prunable, prunable, trackedSpecs);
      await addSpecWorktree(planted, WORKTREE_KINDS.outside, outside, trackedSpecs);
      const branch = `feature/${WORKTREE_KINDS.merged}`;
      expect((await planted.git(repo, "merge", "-q", "--no-ff", "-m", `Merge branch '${branch}'`, branch)).code).toBe(0);
      rmSync(prunable, { recursive: true, force: true });

      // The planted kinds, as git itself reports them: main and five linked worktrees, the deleted one `prunable`, the merged one
      // clean and held by `main`, the outside one beside the main checkout.
      const list = (await planted.git(repo, "worktree", "list", "--porcelain")).stdout;
      const records = list.trim().split("\n\n");
      expect(records.length).toBe(6);
      expect(records.find((r) => r.includes(`/.worktrees/${WORKTREE_KINDS.prunable}\n`))).toContain("\nprunable");
      expect(records.filter((r) => r.includes("\nprunable")).length).toBe(1);
      expect(records.some((r) => r.startsWith(`worktree ${outside}\n`))).toBe(true);
      expect((await planted.git(merged, "status", "--porcelain")).stdout).toBe("");
      expect((await planted.git(repo, "merge-base", "--is-ancestor", branch, "main")).code).toBe(0);

      const before = snapshot(repo);
      expectWorktreesHashed(before);
      const reached = [`.worktrees/${WORKTREE_KINDS.merged}/.git`, `.worktrees/${WORKTREE_KINDS.merged}/src/${WORKTREE_KINDS.merged}.ts`, `.git/worktrees/${WORKTREE_KINDS.prunable}/HEAD`, `.git/worktrees/outside-${WORKTREE_KINDS.outside}/HEAD`];
      expect(reached.filter((path) => !before.entries.has(path))).toEqual([]);
      expect(before.entries.has(`.worktrees/${WORKTREE_KINDS.prunable}`)).toBe(false);
      const outsideBefore = snapshot(outside);
      expect(outsideBefore.entries.has(".git")).toBe(true);

      const hosts = new Set<string>();
      const realFetch = globalThis.fetch;
      const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
        hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname);
        return realFetch(input, init);
      }) as typeof fetch);

      const { url, stop } = await serve(repo, `kinds-${String(trackedSpecs)}`);
      try {
        // Dashboard, board, and the spec page with every tab (timeline, claims, tasks, frames, the live board) of each
        // spec that has a worktree, and of 004, which has none.
        await readEverything(url, [SPEC_ID, "003", "004", "006", "007"]);
        for (const path of ["/api/settings", ACTORS_PATH, workspaceRoutes.boardQuery(SLUG)]) {
          expect({ path, status: (await fetch(`${url}${path}`)).status }).toEqual({ path, status: 200 });
        }

        // The library: the catalog, every readable document (each spec's plan among them) and a search, each revalidated.
        const library = await fetch(`${url}${workspaceRoutes.library(SLUG)}`);
        expect(library.status).toBe(200);
        const catalog = (await library.json()) as WorkspaceRouteResponses["library"];
        const docs = catalog.docs.filter((d) => d.media === "markdown" && d.state !== "missing").map((d) => d.path);
        expect(docs).toContain(`${SPEC_FOLDER}/plan.md`);
        const searches = ["console", "retention", "no such words anywhere"].map((q) => workspaceRoutes.librarySearch(SLUG, q));
        for (const path of [workspaceRoutes.library(SLUG), ...docs.map((doc) => workspaceRoutes.libraryDoc(SLUG, doc)), ...searches]) {
          const first = await fetch(`${url}${path}`);
          await first.arrayBuffer();
          expect({ path, status: first.status }).toEqual({ path, status: 200 });
          const etag = first.headers.get("etag");
          const again = await fetch(`${url}${path}`, etag === null ? {} : { headers: { "If-None-Match": etag } });
          await again.arrayBuffer();
          expect({ path, ok: [200, 304].includes(again.status) }).toEqual({ path, ok: true });
        }

        // The git reads ran: 002 keeps its live chip, the merged and the prunable worktree end theirs, the outside one
        // keeps its chip by branch without a path; no body names the outside folder.
        const model = (await (await fetch(`${url}/api/workspaces/${SLUG}/dashboard`)).json()) as DashboardModel;
        const chip = (id: string): DashboardModel["specs"][number]["worktree"] | undefined => model.specs.find((r) => r.id === id)?.worktree;
        expect(chip(SPEC_ID)?.ahead).toBe(planted.expected.ahead);
        expect([chip("003") ?? null, chip("006") ?? null]).toEqual([null, null]);
        expect([chip("007")?.branch, chip("007")?.path]).toEqual([`feature/${WORKTREE_KINDS.outside}`, null]);
        const bodies = [JSON.stringify(model), await (await fetch(`${url}${specRoutes.spec(SLUG, "007")}`)).text(), await (await fetch(`${url}${specRoutes.timeline(SLUG, "007")}`)).text()];
        expect(bodies.filter((body) => body.includes(basename(outside)))).toEqual([]);
      } finally {
        await stop();
        spy.mockRestore();
      }

      const after = snapshot(repo);
      expect(changed(before, after, { mtime: true })).toEqual([]);
      expect(after.checksum).toBe(before.checksum);
      expect(underGit(after)).toEqual(underGit(before));
      const outsideAfter = snapshot(outside);
      expect(changed(outsideBefore, outsideAfter, { mtime: true })).toEqual([]);
      expect(outsideAfter.checksum).toBe(outsideBefore.checksum);
      expect([...hosts]).toEqual(["127.0.0.1"]);
    }, 60_000);
  }
});

// The spec edges (spec 025 T18, ISC-165) under the same guard, through the served app, `.git/` included (`-t blockers`).
// The workspace is a real repository built from `core/fixtures/edges` with a branch for each path `mergedSpecBranches`
// takes: `feature/002-stop-search` one commit ahead and unmerged (its tip off `main`'s first-parent line, so
// `merge-base --is-ancestor` runs and answers 1), `infra/005-night-service` brought in by a merge commit (off the line,
// answers 0) and `fix/006-holiday-calendar` fresh at `main`'s tip (on the line, no further read). Then the planted
// state of the blocks above: a staged file, a modified tracked file, a tracked file with stale stat data, an untracked
// and two ignored files. The model must carry the edges (003 and 004 wait on the unmerged 002, 002 and 007 overlap), so
// the reads cannot pass without resolving them; afterwards every byte and mtime is the same and every request loopback.
const EDGES_FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "edges");

/** `core/fixtures/edges` as a repository with an unmerged, a merged and a fresh spec branch, and the planted state. */
function buildEdgesRepository(dir: string): void {
  cpSync(EDGES_FIXTURE, dir, { recursive: true });
  // A master with one feature block naming 004's held claim, so the planning route has a holder whose card waits.
  const master = ["---", 'task: "Ride the quay network"', "slug: 20260302-quay", "phase: climbing", "---", "", "# Quay", "", "## Features", "", "### F1 · Fares", "Why: a rider sees the fare before boarding.", "", "- [ ] ISC-9: Picking two found stops shows the fare between them.", ""];
  writeFileSync(join(dir, "ISA.md"), master.join("\n"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(join(dir, ".gitignore"), "*.log\nbuild/\n");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "routes.ts"), "export const routes = [];\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "edges fixture");

  git(dir, "switch", "-q", "-c", "infra/005-night-service");
  writeFileSync(join(dir, "src", "night.ts"), "export const night = true;\n");
  git(dir, "add", "src/night.ts");
  git(dir, "commit", "-q", "-m", "night service");
  git(dir, "switch", "-q", "main");
  git(dir, "merge", "-q", "--no-ff", "-m", "merge night service", "infra/005-night-service");

  git(dir, "switch", "-q", "-c", "feature/002-stop-search");
  writeFileSync(join(dir, "src", "search.ts"), "export const search = () => [];\n");
  git(dir, "add", "src/search.ts");
  git(dir, "commit", "-q", "-m", "stop search");
  git(dir, "switch", "-q", "main");
  git(dir, "branch", "fix/006-holiday-calendar");

  writeFileSync(join(dir, "staged.md"), "# staged, not committed\n");
  git(dir, "add", "staged.md");
  appendFileSync(join(dir, "src", "routes.ts"), "// modified after the commit\n");
  const future = new Date("2030-01-01T00:00:00Z");
  utimesSync(join(dir, "README.md"), future, future);
  mkdirSync(join(dir, "notes"));
  writeFileSync(join(dir, "notes", "untracked.md"), "# untracked\n");
  writeFileSync(join(dir, "debug.log"), "ignored by *.log\n");
  mkdirSync(join(dir, "build"));
  writeFileSync(join(dir, "build", "out.txt"), "ignored by build/\n");
}

describe("ISC-165 blockers: the spec edges, the merge reads and the overlap warning leave the repository byte-identical", () => {
  test("readonly: dashboard, planning, spec pages, claims and live of held and overlapping specs change no byte or mtime, .git/ included; every request is loopback", async () => {
    // Named for the slug the shared reads use; only the parent folder is this block's own.
    const repo = join(realpathSync(mkdtempSync(join(root, "blockers-"))), SLUG);
    buildEdgesRepository(repo);
    const before = snapshot(repo);
    const indexBefore = readFileSync(join(repo, ".git", "index"));
    const indexMtimeBefore = lstatSync(join(repo, ".git", "index")).mtimeMs;

    const hosts = new Set<string>();
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
      hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname);
      return realFetch(input, init);
    }) as typeof fetch);

    const { url, stop } = await serve(repo, "blockers");
    try {
      // 002 overlaps 007, 003 holds in part on 002, 004 in full: every route that resolves edges, each revalidated.
      await readEverything(url, ["002", "003", "004", "007"]);

      // The git reads ran, every path of them: 002 unmerged, 005 merged by its merge commit, 006 fresh at main's tip.
      const reading = await readWorkspaceInput(repo);
      const merge = reading.readable ? reading.mergeState : [];
      expect(["002", "005", "006"].map((spec) => merge.find((m) => m.spec === spec))).toEqual([
        { spec: "002", branch: "feature/002-stop-search", merged: false, complete: false, archived: false },
        { spec: "005", branch: "infra/005-night-service", merged: true, complete: false, archived: false },
        { spec: "006", branch: "fix/006-holiday-calendar", merged: false, complete: false, archived: false },
      ]);

      // The model carries the edges and the overlap, so none of the reads above could pass vacuously.
      const model = (await (await fetch(`${url}/api/workspaces/${SLUG}/dashboard`)).json()) as DashboardModel;
      const row = (id: string) => model.specs.find((s) => s.id === id);
      expect(row("004")?.waits).toMatchObject({ blockers: ["002"], full: true });
      expect(row("003")?.waits).toMatchObject({ blockers: ["002"], full: false });
      const overlap = model.specs.flatMap((s) => s.warnings).find((w) => w.kind === "spec-overlap");
      expect(overlap?.overlap?.specs).toEqual(["002", "007"]);
      const waitsOn002 = /"waits":\{[^}]*"blockers":\["002"\]/;
      expect(await (await fetch(`${url}${workspaceRoutes.planning(SLUG)}`)).text()).toMatch(waitsOn002);
      expect(await (await fetch(`${url}${specRoutes.spec(SLUG, "004")}`)).text()).toMatch(waitsOn002);
      expect(await (await fetch(`${url}${specRoutes.claims(SLUG, "004")}`)).text()).toContain('"waitsOn":["002"]');
      expect(await (await fetch(`${url}${specRoutes.live(SLUG, "003")}`)).text()).toContain("waits on 002");
      // The tasks route (ISC-162.2): 003's T2 by its own edge, T4 and 004's open tasks by their claim's, all held.
      const held = async (id: string) =>
        ((await (await fetch(`${url}${specRoutes.tasks(SLUG, id)}`)).json()) as TasksTab).tasks.filter((t) => t.status === "held").map((t) => `${t.id}: ${String(t.reason)}`);
      expect(await held("003")).toEqual(["T2: waits on 002", "T4: waits on 002"]);
      expect(await held("004")).toEqual(["T2: waits on 002", "T3: waits on 002"]);
    } finally {
      await stop();
      spy.mockRestore();
    }

    const after = snapshot(repo);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(join(repo, ".git", "index")).equals(indexBefore)).toBe(true);
    expect(lstatSync(join(repo, ".git", "index")).mtimeMs).toBe(indexMtimeBefore);
    expect([...hosts]).toEqual(["127.0.0.1"]);
  }, 60_000);
});

// The seventh write path (spec 036, ISC-191.2) under the same guard: the backlog route on its own copy of harbor, which
// has no specs/backlog.md yet. Every refused write (409, 422, 400) leaves the copy byte-identical with every mtime kept;
// the accepted move and priority change exactly the files of `WRITE_PATHS.backlog`, never `ISA.md` or `.git/`, and no
// request leaves the process (`fetch` is never called).
describe("ISC-191.2 with the backlog: a refused write changes nothing, an accepted one only specs/backlog.md and its log", () => {
  test("readonly: backlog refusals leave the copy byte-identical; the accepted move and priority touch only WRITE_PATHS.backlog", async () => {
    const copy = join(mkdtempSync(join(root, "backlog-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-backlog-")));
    registry.add(copy);
    const api = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const hosts: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request) => {
      hosts.push(new URL(input instanceof Request ? input.url : String(input)).hostname);
      return Promise.reject(new Error("no request may leave the process"));
    }) as typeof fetch);
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
      const res = await api(new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init }), url);
      if (res === null) throw new Error(`the workspace routes declined ${path}`);
      return res;
    };
    const backlogHash = async (): Promise<string> => ((await (await call(workspaceRoutes.planning(SLUG))).json()) as { backlogHash: string }).backlogHash;
    const gitChanges = (a: Snapshot, b: Snapshot): string[] => changed(a, b, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"));

    try {
      const before = snapshot(copy);
      const hash = await backlogHash();
      // Refused: 409 (stale hash), 422 (no such feature block, no such priority, a move that changes nothing), 400.
      const refused: Array<[unknown, number]> = [
        [{ op: "move", feature: "F7", before: "F0", hash: "0".repeat(64) }, 409],
        [{ op: "move", feature: "F99", before: null, hash }, 422],
        [{ op: "priority", feature: "F2", priority: "P9", hash }, 422],
        [{ op: "move", feature: "F1", before: "F2", hash }, 422],
        ["not json", 400],
      ];
      for (const [body, status] of refused) expect({ body, status: (await call(workspaceRoutes.backlog(SLUG), "POST", body)).status }).toEqual({ body, status });
      const afterRefused = snapshot(copy);
      expect(changed(before, afterRefused, { mtime: true })).toEqual([]);
      expect(afterRefused.checksum).toBe(before.checksum);

      // Accepted: F7 moves before F0, then F2 gets P1; only the two files of WRITE_PATHS.backlog differ.
      expect((await call(workspaceRoutes.backlog(SLUG), "POST", { op: "move", feature: "F7", before: "F0", hash })).status).toBe(200);
      expect((await call(workspaceRoutes.backlog(SLUG), "POST", { op: "priority", feature: "F2", priority: "P1", hash: await backlogHash() })).status).toBe(200);
      const after = snapshot(copy);
      expect(changed(before, after)).toEqual([...WRITE_PATHS.backlog.writes].sort());
      expect(WRITE_PATHS.backlog.creates).toBeNull();
      expect(after.entries.get("ISA.md")).toEqual(before.entries.get("ISA.md"));
      expect(gitChanges(before, after)).toEqual([]);
      expect(underGit(after)).toEqual(underGit(before));
      expect(hosts).toEqual([]);
    } finally {
      spy.mockRestore();
      registry.close();
    }
  });
});

// Spec 037 (ISC-199, T45): the calls the tree lens and the workspace board send (`web/e2e/backlog-ui-sequence.ts`, the
// list the e2e takes its expected bodies from) replayed in list order through the real backlog route on one copy of
// harbor, each with the hash the previous answer named. Every answer is 200, every file but the two of
// `WRITE_PATHS.backlog` keeps its bytes, `.git/` included (its mtimes too), the log gains one line per call, and no
// request leaves the process.
describe("backlog-ui: reordering and prioritising in the tree and on the board change only the backlog files", () => {
  test("readonly backlog-ui: the UI's backlog calls, replayed on a harbor copy, touch only specs/backlog.md and its log, .git/ included", async () => {
    const copy = join(mkdtempSync(join(root, "backlog-ui-")), SLUG);
    cpSync(repo, copy, { recursive: true });
    const registry = openRegistry(mkdtempSync(join(root, "data-backlog-ui-")));
    registry.add(copy);
    const api = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const hosts: string[] = [];
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request) => {
      hosts.push(new URL(input instanceof Request ? input.url : String(input)).hostname);
      return Promise.reject(new Error("no request may leave the process"));
    }) as typeof fetch);
    const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const init = body === undefined ? {} : { body: JSON.stringify(body) };
      const res = await api(new Request(url.href, { method, headers: { Host: "127.0.0.1:7717" }, ...init }), url);
      if (res === null) throw new Error(`the workspace routes declined ${path}`);
      return res;
    };

    try {
      const before = snapshot(copy);
      expect(before.entries.has("specs/backlog.md")).toBe(false);
      expect(((await (await call(workspaceRoutes.planning(SLUG))).json()) as { backlogHash: string }).backlogHash).toBe(EMPTY_BACKLOG_HASH);
      let hash: string = EMPTY_BACKLOG_HASH;
      for (const { id, body } of BACKLOG_UI_SEQUENCE) {
        const res = await call(workspaceRoutes.backlog(SLUG), "POST", { ...body, hash });
        const answer = (await res.json()) as { hash?: string };
        expect({ id, status: res.status }).toEqual({ id, status: 200 });
        hash = answer.hash ?? "";
      }

      const after = snapshot(copy);
      // Bytes everywhere, mtimes under .git/ as well (the specs/ folder's own mtime moves when the two files appear).
      expect(changed(before, after)).toEqual([...WRITE_PATHS.backlog.writes].sort());
      expect(changed(before, after, { mtime: true }).filter((p) => p === ".git" || p.startsWith(".git/"))).toEqual([]);
      expect(underGit(after)).toEqual(underGit(before));
      const log = readFileSync(join(copy, "specs", "backlog.events.jsonl"), "utf8").split("\n").filter((line) => line !== "");
      expect(log).toHaveLength(BACKLOG_UI_SEQUENCE.length);
      expect(sha256(readFileSync(join(copy, "specs", "backlog.md")))).toBe(hash);
      expect(hosts).toEqual([]);
    } finally {
      spy.mockRestore();
      registry.close();
    }
  }, 60_000);
});

// ISC-192.1: the seventh path is named with exactly its two files, creates no directory, and the root CLAUDE.md lists it.
// Spec 040 (ISC-226.1) adds the eighth after it, the run release with its one file; the count follows.
describe("write paths: the backlog is the seventh", () => {
  test("write paths: WRITE_PATHS.backlog names exactly specs/backlog.md and specs/backlog.events.jsonl, creates nothing; CLAUDE.md names the seventh path", () => {
    expect(WRITE_PATHS.backlog).toEqual({ writes: ["specs/backlog.md", "specs/backlog.events.jsonl"], removes: [], creates: null });
    expect(Object.keys(WRITE_PATHS)).toHaveLength(8);
    expect(Object.keys(WRITE_PATHS).slice(-2)).toEqual(["backlog", "runRelease"]);
    expect(WRITE_TABLE.backlog).toMatchObject({ root: "main", locked: null });
    const claude = readFileSync(join(import.meta.dir, "..", "CLAUDE.md"), "utf8");
    expect(claude).toMatch(/exactly\s+eight\s+write\s+paths/);
    expect(claude).toMatch(/7\. the feature backlog: `specs\/backlog\.md`[^]*?`specs\/backlog\.events\.jsonl`/);
  });
});

// ISC-226.1: the eighth path is the run release, named with exactly its one file at the main checkout, no directory,
// and the root CLAUDE.md, the README and FORMAT.md name it.
describe("write paths: the run release is the eighth", () => {
  test("write paths run-release: WRITE_PATHS.runRelease names exactly .spectant/activity.jsonl; CLAUDE.md, README.md and FORMAT.md name the release", () => {
    expect(WRITE_PATHS.runRelease).toEqual({ writes: [".spectant/activity.jsonl"], removes: [], creates: null });
    expect(WRITE_TABLE.runRelease).toMatchObject({ root: "main", locked: null, runLocked: null });
    const doc = (name: string): string => readFileSync(join(import.meta.dir, "..", name), "utf8");
    expect(doc("CLAUDE.md")).toMatch(/8\. the run release: [^]*?`run-end`[^]*?`outcome: released`[^]*?`\.spectant\/activity\.jsonl`/);
    expect(doc("README.md")).toMatch(/8\. the run release: [^]*?`run-end`[^]*?`\.spectant\/activity\.jsonl`/);
    expect(doc("FORMAT.md")).toMatch(/never written by the app \(spec 002, T20, `locks\.ts`\), with one exception: the run release/);
  });
});

// ── spec 039: every file kind from the worktree copy, and still no byte changed (T22, ISC-210) ───────────────────────
//
// `specs/` tracked, and in the spec worktree of 002 a newer version of each file kind the app reads: a file of the
// spec folder beside the ISC-181 kinds (`artifacts/T13-routes.md`, `.evidence/bun-test-r3.log`, uncommitted), the
// repository files `specs/tldr.md` and `specs/tech.md` (committed after main's) and a story (uncommitted); plus a spec
// folder only a second worktree's branch carries (`050-new-console`). Every read route answers the worktree's version,
// none main's, and the repository with all its worktrees keeps every byte and mtime, `.git/` included.

const COPY_MARK = "(worktree copy, spec 039)";

describe("ISC-210 worktree-copy reads: every file kind is served from the newer copy, and no byte changes", () => {
  test("readonly: worktree-copy: spec folder, worktree-only spec and repository files read from the worktree; repo and worktrees byte-identical", async () => {
    const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs: true });
    const repo = planted.root;
    const copy = join(planted.worktrees.spec, "specs");
    const mark = (file: string, from: RegExp): void => {
      const path = join(copy, file);
      const text = readFileSync(path, "utf8");
      if (!from.test(text)) throw new Error(`worktree-copy: ${from.source} not in ${file}`);
      writeFileSync(path, text.replace(from, (line) => `${line} ${COPY_MARK}`));
    };
    mark(`${SPEC_FOLDER}/artifacts/T13-routes.md`, /^# T13 — routes$/m);
    writeFileSync(join(copy, SPEC_FOLDER, ".evidence", "bun-test-r3.log"), `log ${COPY_MARK}\n`);
    mark("tldr.md", /^# TL;DR — harbor$/m);
    mark("tech.md", /^# Harbor — technical documentation$/m);
    expect((await planted.git(planted.worktrees.spec, "commit", "-q", "-m", "specs: tldr and tech", "--", "specs/tldr.md", "specs/tech.md")).code).toBe(0);
    appendFileSync(join(copy, "ideas", "registry-webhooks.md"), `\nWebhooks ${COPY_MARK}\n`);
    const only = join(repo, ".worktrees", "050-new-console");
    expect((await planted.git(repo, "worktree", "add", "-q", "-b", "draft/console", ".worktrees/050-new-console")).code).toBe(0);
    mkdirSync(join(only, "specs", "050-new-console"), { recursive: true });
    writeFileSync(join(only, "specs", "050-new-console", "spec.md"), `---\ntask: "New console ${COPY_MARK}"\nslug: 050-new-console\nstage: plan\nphase: scoping\nprogress: 0/1\n---\n\n# 050 — new-console\n\n## Claims\n\n- [ ] ISC-90: x\n`);
    expect((await planted.git(only, "add", "--", "specs/050-new-console/spec.md")).code).toBe(0);
    expect((await planted.git(only, "commit", "-q", "-m", "specs: new console")).code).toBe(0);

    const before = snapshot(repo);
    expectWorktreesHashed(before);
    const { url, stop } = await serve(repo, "039");
    try {
      await readEverything(url, [SPEC_ID, "050"]);
      const get = async (path: string): Promise<string> => {
        const res = await fetch(`${url}${path}`);
        expect({ path, status: res.status }).toEqual({ path, status: 200 });
        return res.text();
      };
      const model = JSON.parse(await get(`/api/workspaces/${SLUG}/dashboard`)) as DashboardModel;
      expect(model.specs.find((row) => row.id === SPEC_ID)?.source).toBe("worktree");
      expect(model.specs.find((row) => row.id === "050")?.source).toBe("worktree");
      expect(model.brief?.markdown).toContain(COPY_MARK);
      for (const path of [
        workspaceRoutes.libraryDoc(SLUG, `${SPEC_FOLDER}/artifacts/T13-routes.md`),
        specRoutes.evidenceFile(SLUG, SPEC_ID, ".evidence/bun-test-r3.log"),
        workspaceRoutes.libraryDoc(SLUG, "tech.md"),
        workspaceRoutes.libraryDoc(SLUG, "tldr.md"),
        workspaceRoutes.idea(SLUG, "registry-webhooks"),
        specRoutes.spec(SLUG, "050"),
      ]) {
        expect({ path, copy: (await get(path)).includes(COPY_MARK) }).toEqual({ path, copy: true });
      }
      const after = snapshot(repo);
      expect(changed(before, after, { mtime: true })).toEqual([]);
      expect(after.checksum).toBe(before.checksum);
      expect(underGit(after)).toEqual(underGit(before));
    } finally {
      await stop();
    }
  }, 60_000);
});

// The live update stream (spec 030, ISC-28) under the same guard: with the stream open on a repository whose spec
// worktree carries specs/ (so the watchers arm on the main checkout and on the copy), every read is made once and one
// task box is ticked from outside in the worktree copy. The update arrives, and the only path that differs afterwards is
// the ticked file: the watchers, the builds behind the frame and the heartbeat write nothing, `.git/` and each linked
// worktree's `.git` included.
describe("ISC-28 with the live stream: an open stream and its updates leave the repository byte-identical", () => {
  test("readonly: live — stream open, a change from outside, every byte but the changed file kept, .git/ and worktrees included", async () => {
    const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs: true });
    const repo = planted.root;
    const ticked = `${SPEC_WORKTREE}/specs/${SPEC_FOLDER}/tasks.md`;
    const before = snapshot(repo);
    expectWorktreesHashed(before);

    const { url, stop } = await serve(repo, "live");
    const abort = new AbortController();
    try {
      const res = await fetch(`${url}${EVENTS_PATH}`, { signal: abort.signal });
      expect(res.status).toBe(200);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      await readEverything(url, [SPEC_ID]);
      await Bun.sleep(250);
      expect(changed(before, snapshot(repo), { mtime: true })).toEqual([]);

      const file = join(repo, ticked);
      const text = readFileSync(file, "utf8");
      expect(text).toMatch(/^- \[ \]/m);
      writeFileSync(file, text.replace(/^- \[ \]/m, "- [x]"));

      // Read until an update names the ticked spec; the probe of the 2 s bound is `tests/live.test.ts`.
      const want = `"${specRoutes.spec(SLUG, SPEC_ID)}"`;
      const deadline = Date.now() + 5_000;
      let seen = "";
      while (!(seen.includes(`event: ${LIVE_EVENT}`) && seen.includes(want))) {
        const left = deadline - Date.now();
        if (left <= 0) throw new Error(`no update for ${want} within 5 s`);
        const chunk = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]);
        if (chunk === null || chunk.done) continue;
        seen += decoder.decode(chunk.value, { stream: true });
      }
      await readEverything(url, [SPEC_ID]);
      abort.abort();
    } finally {
      abort.abort();
      await stop();
    }

    const after = snapshot(repo);
    expect(changed(before, after)).toEqual([ticked]);
    expect(changed(before, after, { mtime: true })).toEqual([ticked]);
    expect(gitPaths([...after.entries.keys()])).toEqual(gitPaths([...before.entries.keys()]));
    expect(changed(before, after, { mtime: true }).filter((path) => gitPaths([path]).length > 0)).toEqual([]);
  }, 60_000);
});

// The step feed under the same guard (spec 015, T37, ISC-235, `-t steps`): the main checkout's `.spectant/activity.jsonl`
// carries probe (red, then green) and question step lines for task T2 of the live spec 002. With the stream open, every
// read of the dashboard, the board and the spec page (the tasks and live routes carry `steps` now) changes no byte or
// mtime of the repository, its worktrees or `.git/`; every request is loopback; and no route writes `.spectant/`: the
// log keeps its bytes and the folder gains no file. The step lines are the plugin's to write, never the app's; the
// second case proves that statically: no server source names a `probe` or `question` event, the one line builder that
// appends to the log writes `run-end`, and `WRITE_PATHS.runRelease` is the only write path under `.spectant/`.

type StepsBody = { steps: Record<string, Array<{ kind: string; result?: string; text?: string }>> };

describe("ISC-235 steps: the step lines, the routes that carry them and the stream leave the repository byte-identical", () => {
  test("readonly: steps — probe and question lines in the log, stream open, spec page and live board read: no byte or mtime moves, .git/ and worktrees included; every request is loopback; no route writes .spectant/", async () => {
    const planted = await plantWorktreeRepo({ parent: realpathSync(root), trackedSpecs: true });
    const repo = planted.root;
    const logPath = WRITE_PATHS.runRelease.writes[0];
    const log = join(repo, logPath);
    const at = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
    const step = { claim: "ISC-51", task: "T2", session: `a:claude:spec-${SPEC_ID}/T2` };
    const lines = [
      { ts: at(3), event: "probe", ...step, result: "red" },
      { ts: at(2), event: "question", ...step, text: "Which empty state does the list show?" },
      { ts: at(1), event: "probe", ...step, result: "green" },
    ];
    appendFileSync(log, lines.map((line) => `${JSON.stringify(line)}\n`).join(""));

    const spectantDir = join(repo, ".spectant");
    const listing = (): string[] => readdirSync(spectantDir).sort();
    const listingBefore = listing();
    const logBefore = readFileSync(log);
    const before = snapshot(repo);
    expectWorktreesHashed(before);
    expect(before.entries.has(logPath)).toBe(true);

    const hosts = new Set<string>();
    const realFetch = globalThis.fetch;
    const spy = spyOn(globalThis, "fetch").mockImplementation(((input: string | URL | Request, init?: RequestInit) => {
      hosts.add(new URL(input instanceof Request ? input.url : String(input)).hostname);
      return realFetch(input, init);
    }) as typeof fetch);

    const { url, stop } = await serve(repo, "steps");
    const abort = new AbortController();
    try {
      const stream = await fetch(`${url}${EVENTS_PATH}`, { signal: abort.signal });
      expect(stream.status).toBe(200);
      await readEverything(url, [SPEC_ID, "004"]);
      for (const path of ["/api/settings", ACTORS_PATH, workspaceRoutes.boardQuery(SLUG)]) {
        expect({ path, status: (await fetch(`${url}${path}`)).status }).toEqual({ path, status: 200 });
      }
      // The steps were read, not skipped: both routes carry T2's three steps from the log.
      for (const path of [specRoutes.tasks(SLUG, SPEC_ID), specRoutes.live(SLUG, SPEC_ID)]) {
        const body = (await (await fetch(`${url}${path}`)).json()) as StepsBody;
        expect({ path, kinds: (body.steps.T2 ?? []).map((s) => s.kind) }).toEqual({ path, kinds: ["probe", "question", "probe"] });
      }
      await Bun.sleep(250);
      abort.abort();
    } finally {
      abort.abort();
      await stop();
      spy.mockRestore();
    }

    const after = snapshot(repo);
    expect(changed(before, after, { mtime: true })).toEqual([]);
    expect(after.checksum).toBe(before.checksum);
    expect(underGit(after)).toEqual(underGit(before));
    expect(readFileSync(log).equals(logBefore)).toBe(true);
    expect(listing()).toEqual(listingBefore);
    expect([...hosts]).toEqual(["127.0.0.1"]);
  }, 60_000);

  test("readonly steps: no server source writes a probe or question line; the release appends only run-end; .spectant/ is WRITE_PATHS.runRelease alone", () => {
    // Static, over the source text: an event literal `event: 'probe'` or `event: "question"` anywhere in server/src.
    const literal = /\bevent['"]?\s*:\s*['"](probe|question)['"]/;
    const src = join(import.meta.dir, "..", "server", "src");
    const sources = [...new Bun.Glob("**/*.ts").scanSync(src)];
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((file) => literal.test(readFileSync(join(src, file), "utf8")))).toEqual([]);
    // The one line builder the app appends to the log with.
    expect(runReleaseEvent(new Date(0).toISOString(), { run: "r-1", command: "/spec-implement 002", spec: SPEC_ID }, "u:viewer").event).toBe("run-end");
    const underSpectant = Object.entries(WRITE_PATHS).flatMap(([op, p]) =>
      [...p.writes, ...p.removes, ...(p.creates === null ? [] : [p.creates])].filter((path) => path.startsWith(".spectant/")).map((path) => `${op}:${path}`),
    );
    expect(underSpectant).toEqual(["runRelease:.spectant/activity.jsonl"]);
  });
});
