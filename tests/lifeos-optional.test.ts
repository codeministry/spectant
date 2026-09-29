// Optional LifeOS (spec 002 T51, ISC-37), the server half: `GET /api/lifeos` and the dashboard's lock sources.
// The core half, `core/tests/lifeos-optional.test.ts`, covers `readLockSources` itself.
//
// Discovery: LifeOS is present only when `SPECTANT_LIFEOS_STATE_DIR` names an existing directory by an absolute path.
// No default location is derived or probed. Without it the dashboard still reads the repository's own
// `.spectant/activity.jsonl`, and a spy on `node:fs` and `node:fs/promises` proves no path outside the repository is
// handed to the file system while a request is answered.
//
// Every LifeOS state directory here is a fresh temp dir holding one synthetic frontier lock, laid out the way
// `core/src/locks.ts` documents it: `isa-locks/<first 16 hex of sha1(realpath(<repo>/ISA.md))>/<claim-id>.lock` with
// `{"session","ts","isa"}`. `locks.ts` exports no helper for the hash, so the documented formula is copied here. The
// repository is a temp copy of `core/fixtures/harbor`, whose activity log holds ISC-74 of spec 002; ISC-75 is the
// next takeable claim, so the frontier lock goes there.
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { DashboardModel } from "../core/src/dashboard.ts";
import { WORKSPACES_PATH, composeApi, dashboardApi } from "../server/src/api.ts";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { type RunningServer, serve } from "../server/src/http.ts";
import { LIFEOS_ENV, LIFEOS_PATH, type LifeosDetection, detectLifeos, lifeosApi } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import type { DevService } from "../server/src/services.ts";
import { readWorkspaceInput } from "../server/src/workspace-loader.ts";

const HARBOR = join(import.meta.dir, "..", "core", "fixtures", "harbor");
const SPEC = "002";
const ACTIVITY_CLAIM = "ISC-74";
const FRONTIER_CLAIM = "ISC-75";
const FRONTIER_SESSION = "spec-002-ISC-75";

let root: string;
const running: RunningServer[] = [];
const registries: Registry[] = [];

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-lifeos-")));
});

afterEach(() => {
  for (const server of running.splice(0)) server.stop();
  for (const registry of registries.splice(0)) registry.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function manifest(): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

/** A temp copy of harbor, `.spectant/activity.jsonl` included, registered under the slug `harbor`. */
function harborCopy(): string {
  const repo = join(mkdtempSync(join(root, "repo-")), "harbor");
  cpSync(HARBOR, repo, { recursive: true });
  return repo;
}

/** A LifeOS state directory with one fresh frontier lock on `FRONTIER_CLAIM` for the repository's ISA.md. */
function stateWithLock(repo: string): string {
  const state = mkdtempSync(join(root, "state-"));
  const isa = join(repo, "ISA.md");
  const hash = createHash("sha1").update(realpathSync(isa)).digest("hex").slice(0, 16);
  const dir = join(state, "isa-locks", hash);
  mkdirSync(dir, { recursive: true });
  const ts = new Date(Date.now() - 60_000).toISOString(); // a minute old: well inside LifeOS's two-hour stale TTL
  writeFileSync(join(dir, `${FRONTIER_CLAIM}.lock`), `${JSON.stringify({ session: FRONTIER_SESSION, ts, isa })}\n`);
  return state;
}

function registryWith(path: string): Registry {
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  registry.add(path);
  return registry;
}

const FAKE_LISTENER: DevService = { port: 4200, label: "node", kind: "node", worktree: false };
const fakeServices = (): Promise<DevService[]> => Promise.resolve([FAKE_LISTENER]);

/** The server as `cli.ts` composes it, for the detection `env` yields. */
function start(repo: string, env: Record<string, string | undefined>): { server: RunningServer; detection: LifeosDetection } {
  const detection = detectLifeos(env);
  const api = composeApi(lifeosApi(detection), dashboardApi({ registry: registryWith(repo), services: fakeServices, lifeos: detection }));
  const server = serve({ manifest: manifest(), port: 0, api });
  running.push(server);
  return { server, detection };
}

const get = (server: RunningServer, path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${server.url}${path.replace(/^\//, "")}`, init);

async function dashboard(server: RunningServer): Promise<DashboardModel> {
  const res = await get(server, `/api/workspaces/harbor/dashboard`);
  expect(res.status).toBe(200);
  return (await res.json()) as DashboardModel;
}

const takeableOf = (model: DashboardModel): readonly string[] => model.specs.find((row) => row.id === SPEC)?.takeable ?? [];

// ── the file-system spy ───────────────────────────────────────────────────────────────────────────────

const SYNC_READS = ["readFileSync", "readdirSync", "statSync", "lstatSync", "existsSync", "accessSync", "realpathSync", "readlinkSync", "openSync", "opendirSync"] as const;
const ASYNC_READS = ["readFile", "readdir", "stat", "lstat", "access", "realpath", "readlink", "open", "opendir"] as const;

/** Every path handed to `node:fs` or `node:fs/promises` while `body` runs. */
async function touched(body: () => Promise<unknown>): Promise<string[]> {
  const spies = [
    ...SYNC_READS.map((name) => spyOn(fs, name as "statSync")),
    ...ASYNC_READS.map((name) => spyOn(fsp, name as "stat")),
  ];
  try {
    await body();
    return spies.flatMap((spy) => spy.mock.calls.map((call) => String(call[0])));
  } finally {
    spies.forEach((spy) => spy.mockRestore());
  }
}

const inside = (dir: string) => (path: string) => path === dir || path.startsWith(dir + sep);

// ── read-only: the repository and the state directory keep every byte ──────────────────────────────────

/** Path → kind, mode and sha256 of every entry under `dir`. */
function snapshot(dir: string, prefix = "", out = new Map<string, string>()): Map<string, string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const key = `${prefix}${name}`;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) out.set(key, `link:${readlinkSync(path)}`);
    else if (stat.isDirectory()) {
      out.set(key, `dir:${stat.mode}`);
      snapshot(path, `${key}/`, out);
    } else out.set(key, `file:${stat.mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  }
  return out;
}

// ── detection ─────────────────────────────────────────────────────────────────────────────────────────

describe("detectLifeos: present only for an existing directory named by the variable", () => {
  test("unset, empty, relative, missing or a file: absent; an existing absolute directory: present", () => {
    const dir = mkdtempSync(join(root, "detect-"));
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "");
    expect(detectLifeos({})).toEqual({ present: false, stateDir: null });
    expect(detectLifeos({ [LIFEOS_ENV]: "" })).toEqual({ present: false, stateDir: null });
    expect(detectLifeos({ [LIFEOS_ENV]: "relative/state" })).toEqual({ present: false, stateDir: null });
    expect(detectLifeos({ [LIFEOS_ENV]: join(dir, "missing") })).toEqual({ present: false, stateDir: null });
    expect(detectLifeos({ [LIFEOS_ENV]: file })).toEqual({ present: false, stateDir: null });
    expect(detectLifeos({ [LIFEOS_ENV]: dir })).toEqual({ present: true, stateDir: dir });
  });

  test("detection stats the named path once and reads nothing inside it", async () => {
    const dir = mkdtempSync(join(root, "detect-"));
    writeFileSync(join(dir, "canary"), "");
    let detection: LifeosDetection | undefined;
    const paths = await touched(() => {
      detection = detectLifeos({ [LIFEOS_ENV]: dir });
      return Promise.resolve();
    });
    expect(detection?.present).toBe(true);
    expect(paths).toEqual([dir]);
  });

  test("unset: detection touches no path at all", async () => {
    const paths = await touched(() => Promise.resolve(detectLifeos({})));
    expect(paths).toEqual([]);
  });
});

// ── the route and the dashboard ───────────────────────────────────────────────────────────────────────

describe("LifeOS absent", () => {
  test("variable unset: GET /api/lifeos is {present: false}, the board still shows the repository's activity lock", async () => {
    const repo = harborCopy();
    const { server } = start(repo, {});
    const res = await get(server, LIFEOS_PATH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ present: false });

    const takeable = takeableOf(await dashboard(server));
    expect(takeable).not.toContain(ACTIVITY_CLAIM); // held in .spectant/activity.jsonl, so taken
    expect(takeable).toContain(FRONTIER_CLAIM); // no LifeOS: nothing holds it
  });

  test("variable unset: answering the dashboard and the list hands no path outside the repository to the file system", async () => {
    const repo = harborCopy();
    const { server } = start(repo, {});
    const paths = await touched(async () => {
      await dashboard(server);
      await (await get(server, WORKSPACES_PATH)).json();
      await (await get(server, LIFEOS_PATH)).json();
    });
    // The spy sees both kinds of read: the loader's sync ones and `locks.ts`'s promise ones.
    expect(paths).toContain(join(repo, "ISA.md"));
    expect(paths).toContain(join(repo, ".spectant", "activity.jsonl"));
    expect(paths.filter((p) => !inside(repo)(p))).toEqual([]);
  });

  test("variable naming a missing directory: {present: false}, no throw, and that path is never touched", async () => {
    const repo = harborCopy();
    const missing = join(root, "no-such-state");
    const { server, detection } = start(repo, { [LIFEOS_ENV]: missing });
    expect(detection).toEqual({ present: false, stateDir: null });
    const paths = await touched(async () => {
      expect(await (await get(server, LIFEOS_PATH)).json()).toEqual({ present: false });
      expect(takeableOf(await dashboard(server))).toContain(FRONTIER_CLAIM);
    });
    expect(paths.filter((p) => !inside(repo)(p))).toEqual([]);
  });
});

describe("LifeOS present", () => {
  test("variable set to a state directory with a frontier lock: {present: true}, the claim is taken on the board", async () => {
    const repo = harborCopy();
    const state = stateWithLock(repo);
    const { server } = start(repo, { [LIFEOS_ENV]: state });
    expect(await (await get(server, LIFEOS_PATH)).json()).toEqual({ present: true });

    const paths = await touched(async () => {
      const takeable = takeableOf(await dashboard(server));
      expect(takeable).not.toContain(FRONTIER_CLAIM); // the frontier lock
      expect(takeable).not.toContain(ACTIVITY_CLAIM); // the activity lock, still read beside it
      expect(takeable).toContain("ISC-76");
    });
    // The spy catches LifeOS reads when they are allowed, so its silence above is evidence.
    expect(paths.some(inside(state))).toBe(true);
  });

  test("the loader hands the dashboard both sources, the frontier lock with its session", async () => {
    const repo = harborCopy();
    const state = stateWithLock(repo);
    const reading = await readWorkspaceInput(repo, state);
    if (!reading.readable) throw new Error(`unreadable: ${reading.error}`);
    const locks = reading.input.locks;
    expect(locks?.source).toBe("frontier");
    expect(locks?.sources).toEqual(["frontier", "activity"]);
    expect(locks?.locks.map((l) => [l.source, l.claim, l.session])).toEqual([
      ["activity", ACTIVITY_CLAIM, "spec-002-ISC-74"],
      ["frontier", FRONTIER_CLAIM, FRONTIER_SESSION],
    ]);
    const without = await readWorkspaceInput(repo);
    if (!without.readable) throw new Error(`unreadable: ${without.error}`);
    expect(without.input.locks?.sources).toEqual(["activity"]);
  });

  test("the list counts agree with the dashboard: one takeable fewer per lock source", async () => {
    const repo = harborCopy();
    const absent = start(repo, {}).server;
    const present = start(repo, { [LIFEOS_ENV]: stateWithLock(repo) }).server;
    const count = async (server: RunningServer) =>
      ((await (await get(server, WORKSPACES_PATH)).json()) as Array<{ counts: { takeable: number } }>)[0]?.counts.takeable;
    const [a, p] = [await count(absent), await count(present)];
    expect(a).toBe((await dashboard(absent)).kpis.takeable);
    expect(p).toBe((await dashboard(present)).kpis.takeable);
    expect(p).toBe((a ?? 0) - 1);
  });

  test("the variable's value never appears in any response body or header", async () => {
    const repo = harborCopy();
    const state = stateWithLock(repo);
    const { server } = start(repo, { [LIFEOS_ENV]: state });
    const texts: string[] = [];
    for (const path of [LIFEOS_PATH, WORKSPACES_PATH, "/api/workspaces/harbor/dashboard"]) {
      const res = await get(server, path);
      texts.push(await res.text(), JSON.stringify([...res.headers]));
    }
    const needles = [state, realpathSync(state), state.split(sep).pop() ?? state];
    expect(texts.filter((t) => needles.some((n) => t.includes(n)))).toEqual([]);
  });

  test("nothing is written: the repository copy and the state directory keep every byte", async () => {
    const repo = harborCopy();
    const state = stateWithLock(repo);
    const before = [snapshot(repo), snapshot(state)];
    const { server } = start(repo, { [LIFEOS_ENV]: state });
    await (await get(server, LIFEOS_PATH)).json();
    await (await get(server, WORKSPACES_PATH)).json();
    await dashboard(server);
    expect([snapshot(repo), snapshot(state)]).toEqual(before);
  });
});

describe("GET /api/lifeos answers like the other JSON routes", () => {
  test("strong ETag and 304, HEAD without a body, 405 for other methods, 403 for a foreign Host", async () => {
    const { server } = start(harborCopy(), {});
    const first = await get(server, LIFEOS_PATH);
    const body = await first.text();
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toBe(`"${createHash("sha256").update(body).digest("base64url")}"`);
    expect(first.headers.get("cache-control")).toBe("no-cache");
    const cached = await get(server, LIFEOS_PATH, { headers: { "If-None-Match": etag } });
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    const head = await get(server, LIFEOS_PATH, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    const post = await get(server, LIFEOS_PATH, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    expect(await post.json()).toEqual({ error: "method-not-allowed" });
    const rebound = await get(server, LIFEOS_PATH, { headers: { Host: "evil.example" } });
    expect(rebound.status).toBe(403);
    await rebound.body?.cancel();
    const sub = await get(server, `${LIFEOS_PATH}/x`);
    expect(sub.status).toBe(404);
    await sub.body?.cancel();
  });
});

describe("the CLI wires the variable from its environment", () => {
  async function serveCli(env: Record<string, string>, body: (url: string) => Promise<void>): Promise<void> {
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      await body(url);
      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }
  }

  test("spectant serve: absent without the variable, present with it, and the frontier lock reaches the board", async () => {
    const repo = harborCopy();
    const state = stateWithLock(repo);
    const xdg = mkdtempSync(join(root, "xdg-"));
    const log = spyOn(console, "log").mockImplementation(() => undefined);
    try {
      expect(await run(["add", repo], manifest(), { env: { XDG_DATA_HOME: xdg } })).toBe(0);
    } finally {
      log.mockRestore();
    }
    const board = async (url: string) =>
      ((await (await fetch(`${url}/api/workspaces/harbor/dashboard`)).json()) as DashboardModel);
    await serveCli({ XDG_DATA_HOME: xdg }, async (url) => {
      expect(await (await fetch(`${url}${LIFEOS_PATH}`)).json()).toEqual({ present: false });
      expect(takeableOf(await board(url))).toContain(FRONTIER_CLAIM);
    });
    await serveCli({ XDG_DATA_HOME: xdg, [LIFEOS_ENV]: state }, async (url) => {
      expect(await (await fetch(`${url}${LIFEOS_PATH}`)).json()).toEqual({ present: true });
      expect(takeableOf(await board(url))).not.toContain(FRONTIER_CLAIM);
    });
  });
});
