// The run release (spec 040, T34, ISC-226), `bun test tests/ -t "run release"`: `POST /api/workspaces/:ws/runs/:run/release`
// with the hash of `.spectant/activity.jsonl` the client rendered (`X-Spectant-Activity-Hash`, sent on the dashboard)
// appends exactly one `run-end` line with `outcome: released` and the viewer's `u:` id; the run is then ended, the
// run lock of ISC-225 lifted (the next stage move is accepted), and nothing else in the repository changes. The order
// is the other write routes': 400 (no hash header) → 404 (an unknown or already ended run) → 409 `hash-mismatch` (a
// stale hash, with the hash now) → 422 `release-refused` (no `u:` viewer, or the run already `aborted`) → 200. Every
// refusal leaves the copy byte-identical.
//
// The routes run on the real clock, so the run lines are written relative to now. harbor's copy is no repository of
// its own, so it has no viewer; a test that wants one makes it a repository with a synthetic address.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorIdOf } from "../core/src/actor-id.ts";
import { activityReading } from "../core/src/locks.ts";
import { dashboardApi } from "../server/src/api.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { ACTIVITY_HASH_HEADER, specRoutes, workspaceRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";
import { ACTIVITY_PATH, WRITE_PATHS, writeAnswerOf } from "../server/src/writes.contract.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };
const SLUG = "harbor";
const MINUTE = 60_000;
const SESSION = "a:claude:sess-9";
/** A synthetic address (reserved `.test` domain): the viewer of the repository a test turns into one. */
const VIEWER_EMAIL = "viewer@example.test";

let root: string;
const registries: Registry[] = [];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-run-release-")));
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  readonly run: string;
  readonly command: string;
  readonly target: { spec: string } | { idea: string };
  /** Minutes before now the run started. */
  readonly ago: number;
  readonly ended?: boolean;
}

interface Setup {
  readonly repo: string;
  readonly call: (path: string, method?: string, options?: { body?: unknown; hash?: string | null }) => Promise<Response>;
}

/** Runs git in `repo` (the test's own setup, never the server's), with the inherited repository variables dropped. */
function gitIn(repo: string, ...args: string[]): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"].includes(key)));
  const run = Bun.spawnSync(["git", "-C", repo, ...args], { env, stdout: "ignore", stderr: "pipe" });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr.toString()}`);
}

/** A fresh harbor copy with `runs` appended to its activity log, served by the spec and the workspace routes. */
function setup(runs: readonly Run[], options: { viewer?: boolean; abortAfterMs?: number } = {}): Setup {
  const repo = join(mkdtempSync(join(root, "repo-")), SLUG);
  cpSync(HARBOR, repo, { recursive: true });
  if (options.viewer === true) {
    gitIn(repo, "init", "-q");
    gitIn(repo, "config", "user.email", VIEWER_EMAIL);
  }
  const now = Date.now();
  const lines = runs.flatMap((r) => {
    const start = { ts: new Date(now - r.ago * MINUTE).toISOString(), event: "run-start", run: r.run, command: r.command, session: SESSION, ...r.target };
    return r.ended === true ? [start, { ...start, ts: new Date(now - MINUTE).toISOString(), event: "run-end", outcome: "ok" }] : [start];
  });
  appendFileSync(join(repo, ACTIVITY_PATH), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(repo);
  const abortAfterMs = options.abortAfterMs === undefined ? {} : { abortAfterMs: () => options.abortAfterMs as number };
  const specs = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT, ...abortAfterMs });
  const workspace = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT, ...abortAfterMs });
  const call: Setup["call"] = async (path, method = "GET", { body, hash } = {}) => {
    const url = new URL(`http://127.0.0.1:7717${path}`);
    const headers: Record<string, string> = { ...HOST, "Content-Type": "application/json", ...(hash == null ? {} : { [ACTIVITY_HASH_HEADER]: hash }) };
    const init = body === undefined ? {} : { body: JSON.stringify(body) };
    const req = (): Request => new Request(url.href, { method, headers, ...init });
    const res = (await specs(req(), url)) ?? (await workspace(req(), url));
    if (res === null) throw new Error(`no route answered ${path}`);
    return res;
  };
  return { repo, call };
}

const sha256 = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

/** Every file below `dir`, relative, with the sha256 of its bytes. */
function tree(dir: string, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = prefix === "" ? name : `${prefix}/${name}`;
    const absolute = join(dir, name);
    if (statSync(absolute).isDirectory()) {
      out.set(path, "dir");
      tree(absolute, path, out);
    } else out.set(path, sha256(readFileSync(absolute)));
  }
  return out;
}

const changed = (a: Map<string, string>, b: Map<string, string>): string[] =>
  [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k)).sort();

/** The hash the board rendered: `X-Spectant-Activity-Hash` on the dashboard. */
async function renderedHash(s: Setup): Promise<string> {
  return (await s.call(`/api/workspaces/${SLUG}/dashboard`)).headers.get(ACTIVITY_HASH_HEADER) ?? "";
}

const release = (s: Setup, run: string, hash: string | null): Promise<Response> => s.call(workspaceRoutes.runRelease(SLUG, run), "POST", { hash });
const specHash = (s: Setup, folder: string): string => sha256(readFileSync(join(s.repo, "specs", folder, "spec.md")));
const folder003 = (): string => readdirSync(join(HARBOR, "specs")).find((f) => f.startsWith("003-")) ?? "003";

describe("run release: one run-end line with outcome released and the viewer's u: id; the lock lifted; nothing else changes", () => {
  test("run release: releasing the running run on 003 appends exactly one run-end line and lifts the run lock on its stage move", async () => {
    const s = setup([{ run: "r-1", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 }], { viewer: true });
    const log = join(s.repo, ACTIVITY_PATH);
    const prior = readFileSync(log, "utf8");
    const hash = await renderedHash(s);
    expect(hash).toBe(sha256(prior));
    // Locked before: the stage move of 003 is refused with 423 run-locked.
    expect((await s.call(specRoutes.transition(SLUG, "003"), "POST", { body: { to: "review", hash: specHash(s, folder003()) } })).status).toBe(423);
    const before = tree(s.repo);

    const res = await release(s, "r-1", hash);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; event: Record<string, unknown> };
    expect(writeAnswerOf("runRelease", 200, body)).not.toBeNull();

    const after = readFileSync(log, "utf8");
    expect(after.startsWith(prior)).toBe(true);
    const appended = after.slice(prior.length);
    expect(appended.endsWith("\n")).toBe(true);
    expect(appended.trimEnd().split("\n")).toHaveLength(1);
    const line = JSON.parse(appended) as Record<string, unknown>;
    expect(Object.keys(line)).toEqual(["ts", "event", "run", "command", "session", "spec", "outcome"]);
    expect(line).toEqual({ ts: line.ts, event: "run-end", run: "r-1", command: "/spec-tasks 003", session: actorIdOf(VIEWER_EMAIL), spec: "003", outcome: "released" });
    expect(line.session).toMatch(/^u:[0-9a-f]{8}$/);
    expect(body).toEqual({ hash: sha256(after), event: line });
    // core reads the run as ended, without a diagnostic for the line.
    const reading = activityReading(after);
    expect((reading.openRuns ?? []).map((r) => r.run)).toEqual([]);
    expect((reading.diagnostics ?? []).filter((d) => d.code.includes("run"))).toEqual([]);
    // Exactly the one file of WRITE_PATHS.runRelease differs.
    expect(changed(before, tree(s.repo))).toEqual([...WRITE_PATHS.runRelease.writes]);
    // The lock is lifted: the stage move that was refused is accepted now.
    expect((await s.call(specRoutes.transition(SLUG, "003"), "POST", { body: { to: "review", hash: specHash(s, folder003()) } })).status).toBe(200);
    // The dashboard sends the new hash; a second release of the same run is 404.
    expect(await renderedHash(s)).toBe(body.hash);
    expect((await release(s, "r-1", body.hash)).status).toBe(404);
  });

  test("run release: a run on a story is released the same way, naming the idea", async () => {
    const s = setup([{ run: "r-idea", command: "/spec-idea console-audit-log", target: { idea: "console-audit-log" }, ago: 3 }], { viewer: true });
    const res = await release(s, "r-idea", await renderedHash(s));
    expect(res.status).toBe(200);
    const { event } = (await res.json()) as { event: Record<string, unknown> };
    expect(Object.keys(event)).toEqual(["ts", "event", "run", "command", "session", "idea", "outcome"]);
    expect(event).toMatchObject({ event: "run-end", run: "r-idea", idea: "console-audit-log", outcome: "released" });
  });

  test("run release: 400, 404, 409 and 422 in the write order, each leaving the copy byte-identical", async () => {
    const runs: Run[] = [
      { run: "r-run", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 },
      { run: "r-done", command: "/spec-plan 004", target: { spec: "004" }, ago: 30, ended: true },
      { run: "r-old", command: "/spec-review 004", target: { spec: "004" }, ago: 600 },
    ];
    const s = setup(runs, { viewer: true });
    const hash = await renderedHash(s);
    const stale = "0".repeat(64);
    const before = tree(s.repo);
    const cases: Array<[string, string | null, number, unknown]> = [
      ["r-run", null, 400, { error: "invalid-body" }],
      ["r-run", "not-a-hash", 400, { error: "invalid-body" }],
      ["r-none", hash, 404, { error: "not-found" }],
      // An already ended run is 404 before the hash is compared.
      ["r-done", stale, 404, { error: "not-found" }],
      ["r-run", stale, 409, { error: "hash-mismatch", files: [ACTIVITY_PATH], expected: { activity: hash } }],
      // Open, but older than the abort age (120 minutes by default): aborted, so there is nothing to release.
      ["r-old", hash, 422, { error: "release-refused", reason: "run-aborted" }],
    ];
    for (const [run, sent, status, expected] of cases) {
      const res = await release(s, run, sent);
      const body = await res.json();
      expect({ run, sent, status: res.status, body }).toEqual({ run, sent, status, body: expected });
      if (status !== 400 && status !== 404) expect(writeAnswerOf("runRelease", status, body)).not.toBeNull();
    }
    expect(changed(before, tree(s.repo))).toEqual([]);
  });

  test("run release: without a u: viewer the release is 422 no-viewer and changes no byte", async () => {
    const s = setup([{ run: "r-1", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 }]);
    const before = tree(s.repo);
    const res = await release(s, "r-1", await renderedHash(s));
    expect([res.status, await res.json()]).toEqual([422, { error: "release-refused", reason: "no-viewer" }]);
    expect(changed(before, tree(s.repo))).toEqual([]);
  });

  test("run release: the route answers POST only and refuses a foreign host", async () => {
    const s = setup([{ run: "r-1", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 }], { viewer: true });
    const get = await s.call(workspaceRoutes.runRelease(SLUG, "r-1"));
    expect([get.status, get.headers.get("Allow")]).toEqual([405, "POST"]);
    const url = new URL(`http://127.0.0.1:7717${workspaceRoutes.runRelease(SLUG, "r-1")}`);
    const registry = openRegistry(mkdtempSync(join(root, "data-host-")));
    registries.push(registry);
    registry.add(s.repo);
    const api = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT });
    const foreign = await api(new Request(url.href, { method: "POST", headers: { Host: "evil.example", [ACTIVITY_HASH_HEADER]: "0".repeat(64) } }), url);
    expect(foreign?.status).toBe(403);
    expect((await s.call(workspaceRoutes.runRelease("nope", "r-1"), "POST", { hash: "0".repeat(64) })).status).toBe(404);
  });
});
