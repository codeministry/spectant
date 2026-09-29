// The read-only invariant (T52, ISC-15): adding a workspace and opening every page leaves the registered repository
// byte-identical, `.git/` included. Since spec 002 it also guards the two writes (last describe): every read route and
// every refused write (400, 404, 409, 423) leaves it byte-identical, an accepted reviewed mark changes exactly
// `.gates/reviewed.json` and `events.jsonl`, an accepted tick exactly `tasks.md`, and `.git/` never changes.
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
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { openRegistry } from "../server/src/registry.ts";
import { REVIEWED_HASHES_HEADER, type ReviewedHashes, TASKS_HASH_HEADER, parseReviewedHashes, specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
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
      expect((await fetch(`${url}/api/settings`)).status).toBe(200);
      for (const page of ["/", `/w/${SLUG}`]) {
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
        for (const path of [specRoutes.spec, specRoutes.timeline, specRoutes.claims, specRoutes.tasks, specRoutes.evidence, specRoutes.frames, specRoutes.live]) {
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
