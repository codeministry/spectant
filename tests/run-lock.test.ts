// The run lock (spec 040, T29, ISC-225), `bun test tests/ -t "run lock"`: while a run on a spec is `running` (a
// `run-start` in `.spectant/activity.jsonl` without its `run-end`, younger than the abort age), the server refuses the
// spec's stage move, its reviewed mark and its task checkboxes with 423 `run-locked`, naming the run, its command, its
// actor and its start; a run on a story refuses the story's allocation the same way. An aborted run (older than the
// abort age, `runAbortMinutes` in the settings) locks nothing. The checks keep their order: 400, 404, 409, then 423
// (a claim lock's `locked` first, then the run's `run-locked`), then 422. Every refusal leaves the copy byte-identical.
//
// The routes run on the real clock, so the run lines are written relative to now. harbor's activity log leaves ISC-74
// of spec 002 claimed; specs 003 and 004 hold no claim lock.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseActor } from "../core/src/actor.ts";
import { dashboardApi } from "../server/src/api.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { REVIEWED_HASHES_HEADER, TASKS_HASH_HEADER, parseReviewedHashes, specRoutes, workspaceRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const HOST = { Host: "127.0.0.1:7717" };
const SLUG = "harbor";
const MINUTE = 60_000;
const SESSION = "a:claude:sess-9";

let root: string;
const registries: Registry[] = [];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-run-lock-")));
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

type Target = { spec: string } | { idea: string };
interface Run {
  readonly run: string;
  readonly command: string;
  readonly target: Target;
  /** Minutes before now the run started. */
  readonly ago: number;
  readonly ended?: boolean;
}

interface Setup {
  readonly repo: string;
  readonly call: (path: string, method?: string, body?: unknown) => Promise<Response>;
  /** The `since` written for each run, by run id. */
  readonly since: Readonly<Record<string, string>>;
}

/** A fresh harbor copy with `runs` appended to its activity log, served by the spec and the workspace routes. */
function setup(runs: readonly Run[], options: { abortAfterMs?: number } = {}): Setup {
  const repo = join(mkdtempSync(join(root, "repo-")), SLUG);
  cpSync(HARBOR, repo, { recursive: true });
  const since: Record<string, string> = {};
  const now = Date.now();
  const lines = runs.flatMap((r) => {
    const ts = new Date(now - r.ago * MINUTE).toISOString();
    since[r.run] = ts;
    const start = { ts, event: "run-start", run: r.run, command: r.command, session: SESSION, ...r.target };
    return r.ended === true ? [start, { ...start, ts: new Date(now - MINUTE).toISOString(), event: "run-end", outcome: "ok" }] : [start];
  });
  appendFileSync(join(repo, ".spectant", "activity.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(repo);
  const abortAfterMs = options.abortAfterMs === undefined ? {} : { abortAfterMs: () => options.abortAfterMs as number };
  const specs = specRoutesApi({ registry, lifeos: LIFEOS_ABSENT, ...abortAfterMs });
  const workspace = dashboardApi({ registry, services: () => Promise.resolve([]), lifeos: LIFEOS_ABSENT, ...abortAfterMs });
  const call = async (path: string, method = "GET", body?: unknown): Promise<Response> => {
    const url = new URL(`http://127.0.0.1:7717${path}`);
    const init = body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) };
    const req = (): Request => new Request(url.href, { method, headers: { ...HOST, "Content-Type": "application/json" }, ...init });
    const res = (await specs(req(), url)) ?? (await workspace(req(), url));
    if (res === null) throw new Error(`no route answered ${path}`);
    return res;
  };
  return { repo, call, since };
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

const folderOf = (id: string): string => `specs/${readdirSync(join(HARBOR, "specs")).find((f) => f.startsWith(`${id}-`)) ?? id}`;
const specHash = (s: Setup, id: string): string => sha256(readFileSync(join(s.repo, folderOf(id), "spec.md")));
const storyHash = (s: Setup, slug: string): string => sha256(readFileSync(join(s.repo, "specs", "ideas", `${slug}.md`)));

async function gateHashesOf(s: Setup, id: string): Promise<unknown> {
  const res = await s.call(specRoutes.spec(SLUG, id));
  return parseReviewedHashes(res.headers.get(REVIEWED_HASHES_HEADER));
}

async function tasksHashOf(s: Setup, id: string): Promise<string> {
  return (await s.call(specRoutes.tasks(SLUG, id))).headers.get(TASKS_HASH_HEADER) ?? "";
}

/** The four writes a run can lock, each with the hash the client rendered. */
const writes = {
  transition: async (s: Setup, id: string, to = "review") => s.call(specRoutes.transition(SLUG, id), "POST", { to, hash: specHash(s, id) }),
  gate: async (s: Setup, id: string) => s.call(specRoutes.gateReviewed(SLUG, id), "POST", { hashes: await gateHashesOf(s, id) }),
  tick: async (s: Setup, id: string, tid: string) => s.call(specRoutes.taskCheck(SLUG, id, tid), "POST", { checked: false, hash: await tasksHashOf(s, id) }),
  allocate: async (s: Setup, slug: string) => s.call(workspaceRoutes.allocate(SLUG, slug), "POST", { hash: storyHash(s, slug) }),
};

const runLocked = (s: Setup, run: string, command: string) => ({ error: "run-locked", run, command, actor: parseActor(SESSION), since: s.since[run] });

describe("run lock: an open run refuses the writes on its item with 423 run-locked; an aborted one locks nothing", () => {
  test("run lock: a running run on 003 refuses its stage move with 423 naming run, command, actor and since; the copy stays byte-identical", async () => {
    const s = setup([{ run: "r-1", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 }]);
    const before = tree(s.repo);
    const res = await writes.transition(s, "003");
    expect([res.status, await res.json()]).toEqual([423, runLocked(s, "r-1", "/spec tasks 003")]);
    expect(changed(before, tree(s.repo))).toEqual([]);
  });

  test("run lock: a running run on 004, named by its folder, refuses its reviewed mark and its checkbox; byte-identical", async () => {
    const s = setup([{ run: "r-2", command: "/spec-review 004", target: { spec: "004-retention-policies" }, ago: 10 }]);
    const before = tree(s.repo);
    const gate = await writes.gate(s, "004");
    expect([gate.status, await gate.json()]).toEqual([423, runLocked(s, "r-2", "/spec review 004")]);
    const tick = await writes.tick(s, "004", "T2");
    expect([tick.status, await tick.json()]).toEqual([423, runLocked(s, "r-2", "/spec review 004")]);
    expect(changed(before, tree(s.repo))).toEqual([]);
  });

  test("run lock: a running run on a story refuses its allocation with 423 run-locked; byte-identical", async () => {
    const s = setup([{ run: "r-3", command: "/spec-idea console-audit-log", target: { idea: "console-audit-log" }, ago: 2 }]);
    const before = tree(s.repo);
    const res = await writes.allocate(s, "console-audit-log");
    expect([res.status, await res.json()]).toEqual([423, runLocked(s, "r-3", "/spec idea console-audit-log")]);
    expect(changed(before, tree(s.repo))).toEqual([]);
  });

  test("run lock: two running runs on one spec name the newest", async () => {
    const s = setup([
      { run: "r-old", command: "/spec-plan 003", target: { spec: "003" }, ago: 30 },
      { run: "r-new", command: "/spec-tasks 003", target: { spec: "003-config-loader" }, ago: 3 },
    ]);
    const res = await writes.transition(s, "003");
    expect([res.status, await res.json()]).toEqual([423, runLocked(s, "r-new", "/spec tasks 003")]);
  });

  test("run lock: an aborted run (older than the default 120 minutes) locks nothing: move, mark, tick and allocation are accepted", async () => {
    const s = setup([
      { run: "r-a", command: "/spec-tasks 003", target: { spec: "003" }, ago: 121 },
      { run: "r-b", command: "/spec-review 004", target: { spec: "004" }, ago: 300 },
      { run: "r-c", command: "/spec-idea console-audit-log", target: { idea: "console-audit-log" }, ago: 600 },
    ]);
    expect((await writes.transition(s, "003")).status).toBe(200);
    expect((await writes.gate(s, "004")).status).toBe(200);
    expect((await writes.tick(s, "004", "T2")).status).toBe(200);
    expect((await writes.allocate(s, "console-audit-log")).status).toBe(200);
  });

  test("run lock: the abort age comes from the settings (runAbortMinutes): a 30-minute run is aborted under a 20-minute age", async () => {
    const run: Run = { run: "r-s", command: "/spec-tasks 003", target: { spec: "003" }, ago: 30 };
    expect((await writes.transition(setup([run], { abortAfterMs: 20 * MINUTE }), "003")).status).toBe(200);
    expect((await writes.transition(setup([run], { abortAfterMs: 40 * MINUTE }), "003")).status).toBe(423);
  });

  test("run lock: an ended run, a run on another spec and a run on a story lock nothing on 003", async () => {
    const s = setup([
      { run: "r-e", command: "/spec-tasks 003", target: { spec: "003" }, ago: 20, ended: true },
      { run: "r-o", command: "/spec-tasks 004", target: { spec: "004" }, ago: 5 },
      { run: "r-i", command: "/spec-idea config-loader", target: { idea: "config-loader" }, ago: 5 },
    ]);
    expect((await writes.transition(s, "003")).status).toBe(200);
  });

  test("run lock order: 400, 404 and 409 come before the run; a claim lock answers locked first; the run's 423 comes before 422", async () => {
    const s = setup([
      { run: "r-3", command: "/spec-tasks 003", target: { spec: "003" }, ago: 5 },
      { run: "r-4", command: "/spec-review 004", target: { spec: "004" }, ago: 5 },
      { run: "r-2", command: "/spec-implement 002", target: { spec: "002" }, ago: 5 },
      { run: "r-i", command: "/spec-idea console-audit-log", target: { idea: "console-audit-log" }, ago: 5 },
    ]);
    const before = tree(s.repo);
    // 400: no request body the route reads.
    expect((await s.call(specRoutes.transition(SLUG, "003"), "POST", "not json")).status).toBe(400);
    expect((await s.call(workspaceRoutes.allocate(SLUG, "console-audit-log"), "POST", "not json")).status).toBe(400);
    // 404: no such task.
    expect((await s.call(specRoutes.taskCheck(SLUG, "004", "T99"), "POST", { checked: true, hash: await tasksHashOf(s, "004") })).status).toBe(404);
    // 409: a stale hash is still the plain conflict while a run is open, so the client reloads.
    const stale = await s.call(specRoutes.transition(SLUG, "003"), "POST", { to: "review", hash: "0".repeat(64) });
    expect([stale.status, ((await stale.json()) as { error: string }).error]).toEqual([409, "hash-mismatch"]);
    const staleIdea = await s.call(workspaceRoutes.allocate(SLUG, "console-audit-log"), "POST", { hash: "0".repeat(64) });
    expect([staleIdea.status, ((await staleIdea.json()) as { error: string }).error]).toEqual([409, "hash-mismatch"]);
    // 423 locked: 002's claim lock (ISC-74) is named before the run on 002.
    const claim = await writes.gate(s, "002");
    expect([claim.status, ((await claim.json()) as { error: string }).error]).toEqual([423, "locked"]);
    // 423 run-locked before 422: a move the workflow refuses is still the run's 423 while the run is open.
    const refusable = await writes.transition(s, "003", "done");
    expect([refusable.status, await refusable.json()]).toEqual([423, runLocked(s, "r-3", "/spec tasks 003")]);
    expect(changed(before, tree(s.repo))).toEqual([]);
    // Without the run the same move is the workflow's 422.
    expect((await writes.transition(setup([]), "003", "done")).status).toBe(422);
  });
});
