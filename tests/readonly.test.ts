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
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardModel } from "../core/src/dashboard.ts";
import { hashForGate } from "../core/src/gates.ts";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { dashboardApi } from "../server/src/api.ts";
import { run } from "../server/src/cli.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { openRegistry } from "../server/src/registry.ts";
import {
  ACTORS_PATH,
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
import { WRITE_PATHS } from "../server/src/writes.contract.ts";

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
  test("readonly: planning with its relation index, the sidebar's reads and every planning page change no byte, .git/ included", async () => {
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

      // The pages: the three lenses with an open sidebar, the old addresses the client redirects and the workspace
      // board with a selected card, each the SPA's index through the fallback.
      for (const page of [
        `/w/${SLUG}/planning`,
        `/w/${SLUG}/planning/tree?sel=feature:F2`,
        `/w/${SLUG}/planning/board?sel=spec:003`,
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

/** `core/fixtures/library` as a repository with the planted state, and the pier spec's fresh code-reviewed mark. */
function buildLibraryRepository(dir: string): void {
  cpSync(LIBRARY_FIXTURE, dir, { recursive: true });
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
      for (const file of ["styles.css", "app.js", "img/badge.png", "notes.md", "fonts/manrope-variable.woff2"]) await read(board(file));
      const font = await read(board("fonts/manrope-variable.woff2"), { Origin: "null" });
      expect(font.headers.get("Access-Control-Allow-Origin")).toBe("*");

      // Refused: unknown workspace, missing or unlisted document, traversal, other media, other methods, foreign origins.
      const missingDoc = catalog.docs.find((d) => d.state === "missing");
      expect(missingDoc).toBeDefined();
      await refused([
        [workspaceRoutes.library("nowhere"), 404],
        [workspaceRoutes.library(SHELF), 405, { method: "POST" }],
        [workspaceRoutes.library(SHELF), 403, { headers: { Origin: "https://example.com" } }],
        [workspaceRoutes.libraryDoc(SHELF, missingDoc?.path ?? ""), 404],
        [workspaceRoutes.libraryDoc(SHELF, "../README.md"), 404],
        [workspaceRoutes.libraryDoc(SHELF, "archive/000-first-light/spec.md"), 404],
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
        [prototypeRoute(SHELF, "000-first-light", "prototype", "index.html"), 404],
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
