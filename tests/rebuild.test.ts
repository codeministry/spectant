// The rebuild check (T51, ISC-7; plan 001 § Data Model): deleting the data directory loses only what it holds, and a
// re-add rebuilds every view a repository's files decide. The flow is the user's: register two fixture trees,
// `core/fixtures/harbor` and `core/fixtures/lantern`, with the CLI `add`; serve with the CLI (`--port 0 --no-browser`,
// in-process, like `dashboard.test.ts`); keep the list and both dashboard bodies; stop; delete the data directory
// recursively; serve again on the same path; re-add; compare.
//
// Isolation: the data directory is always `$XDG_DATA_HOME/spectant` under a fresh temp root (the path `paths.ts`
// resolves for the CLI), never the real home one. No browser opens.
//
// What is lost and asserted lost: the workspace registry (the list comes back empty) and the settings (a stored
// `theme: dark` reads back as the default). What ISC-7 also names, notes and pins, cannot be exercised yet: this build's
// schema has no table for them (notes arrive with spec 002, T94; pins have no task in spec 001). The test asserts the
// schema holds exactly `setting` and `workspace` instead, so the day a notes or pins table lands this file fails and
// gets the matching loss assertion.
//
// Excluded from the before/after comparison: the dashboard's `services` field. It is runtime state, the loopback
// listeners `lsof` sees on this machine at the moment of the request, not anything the repository says; any process
// starting or stopping between the two reads would change it. Every other byte of each dashboard body, and the whole
// list body (which carries no services), must be equal. The fixture folders are no repository roots (no `.git` in
// them), so the gate state has no tree id and needs no exclusion; the git case is T52.
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { dataDir, dbPath } from "../server/src/paths.ts";
import { DEFAULT_SETTINGS } from "../server/src/settings.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const NAMES = ["harbor", "lantern"] as const;
type Name = (typeof NAMES)[number];

/** Everything a view is: the list body, and each dashboard body without its runtime `services` field. */
type View = { list: string; listEtag: string | null; dashboards: Record<Name, string> };

let root: string;
let lines: string[] = [];
let restoreLog: (() => void) | undefined;
const stops: AbortController[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-rebuild-"));
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop.abort();
  restoreLog?.();
  restoreLog = undefined;
  lines = [];
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function manifest(): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

/** A fresh `XDG_DATA_HOME` under the temp root, and the data directory the CLI resolves from it. */
function environment(): { env: Record<string, string>; dir: string } {
  const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
  const dir = dataDir(env);
  expect(dir.startsWith(root)).toBe(true);
  expect(dir).not.toBe(join(homedir(), ".spectant"));
  return { env, dir };
}

function captureLog(): void {
  if (restoreLog) return;
  const spy = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  restoreLog = () => spy.mockRestore();
}

/** `spectant add <path>` through the CLI, as a user registers a workspace. */
async function add(env: Record<string, string>, name: Name): Promise<void> {
  captureLog();
  expect(await run(["add", join(FIXTURES, name)], manifest(), { env })).toBe(0);
}

type Served = { url: string; stop: () => Promise<number> };

/** `spectant --port 0 --no-browser` in-process; resolves once the URL line is printed. */
async function serve(env: Record<string, string>): Promise<Served> {
  captureLog();
  const printed = lines.length;
  const controller = new AbortController();
  stops.push(controller);
  const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: controller.signal });
  const deadline = Date.now() + 5_000;
  let url = "";
  while (url === "") {
    const line = lines.slice(printed).find((l) => l.startsWith("spectant · ")) ?? "";
    url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)?.[1] ?? "";
    if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
    if (url === "") await Bun.sleep(5);
  }
  return {
    url,
    stop: () => {
      controller.abort();
      stops.splice(stops.indexOf(controller), 1);
      return done;
    },
  };
}

/** A dashboard body with `services` (runtime state, see the header) dropped, every other key in its original order. */
function withoutServices(body: string): string {
  const model = JSON.parse(body) as Record<string, unknown>;
  expect(Object.keys(model)).toContain("services");
  delete model.services;
  return JSON.stringify(model);
}

async function view(url: string): Promise<View> {
  const list = await fetch(`${url}/api/workspaces`);
  expect(list.status).toBe(200);
  const dashboards = {} as Record<Name, string>;
  for (const name of NAMES) {
    const res = await fetch(`${url}/api/workspaces/${name}/dashboard`);
    expect({ name, status: res.status }).toEqual({ name, status: 200 });
    dashboards[name] = withoutServices(await res.text());
  }
  return { list: await list.text(), listEtag: list.headers.get("etag"), dashboards };
}

/** Path → mode and sha256 of every file and link under `dir`. The fixtures have no `.git/`; T52 covers that case. */
function snapshot(dir: string, out = new Map<string, string>(), prefix = ""): Map<string, string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) snapshot(path, out, `${key}/`);
    else if (entry.isSymbolicLink()) out.set(key, `link:${readlinkSync(path)}`);
    else out.set(key, `${statSync(path).mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`);
  }
  return out;
}

const fixtureTrees = (): Record<Name, Map<string, string>> => ({
  harbor: snapshot(join(FIXTURES, "harbor")),
  lantern: snapshot(join(FIXTURES, "lantern")),
});

/** The user tables of `spectant.db`: what the data directory can lose. */
function tables(dir: string): string[] {
  const db = new Database(dbPath(dir), { readonly: true });
  try {
    return db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
}

const settings = async (url: string): Promise<unknown> => (await fetch(`${url}/api/settings`)).json();

describe("ISC-7: the data directory deleted, the view rebuilt by a re-add", () => {
  test("deleting the data directory loses the registry and the settings only; re-adding restores every body", async () => {
    for (const name of NAMES) expect(existsSync(join(FIXTURES, name, ".git"))).toBe(false);
    const treesBefore = fixtureTrees();
    const { env, dir } = environment();

    // (1) Register both, change a setting, keep the view.
    for (const name of NAMES) await add(env, name);
    let server = await serve(env);
    const put = await fetch(`${server.url}/api/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    expect(put.status).toBe(200);
    expect(await settings(server.url)).toEqual({ ...DEFAULT_SETTINGS, theme: "dark" });
    const before = await view(server.url);
    const listed = JSON.parse(before.list) as Array<{ slug: string; readable: boolean }>;
    expect(listed.map((w) => [w.slug, w.readable])).toEqual([
      ["harbor", true],
      ["lantern", true],
    ]);
    // The comparison below bites only on real bodies: two different, non-trivial models.
    expect(before.dashboards.harbor).not.toBe(before.dashboards.lantern);
    for (const name of NAMES) expect((JSON.parse(before.dashboards[name]) as { specs: unknown[] }).specs.length).toBeGreaterThan(0);
    expect(await server.stop()).toBe(0);

    // The data directory holds the database and its WAL companions, and the database only these two tables.
    expect(readdirSync(dir).every((file) => file.startsWith("spectant.db"))).toBe(true);
    expect(tables(dir)).toEqual(["setting", "workspace"]);

    // (2) The user's action: delete the data directory.
    rmSync(dir, { recursive: true });
    expect(existsSync(dir)).toBe(false);

    // (3) Serve again on the same path: the registry and the settings are gone, nothing else changed.
    server = await serve(env);
    expect(existsSync(dbPath(dir))).toBe(true);
    const empty = await fetch(`${server.url}/api/workspaces`);
    expect(await empty.json()).toEqual([]);
    expect(await settings(server.url)).toEqual(DEFAULT_SETTINGS);
    expect(fixtureTrees()).toEqual(treesBefore);
    expect(await server.stop()).toBe(0);

    // (4) Re-add in the same order: every body equals its before body.
    for (const name of NAMES) await add(env, name);
    server = await serve(env);
    const after = await view(server.url);
    expect(after.list).toBe(before.list);
    expect(after.listEtag).toBe(before.listEtag);
    for (const name of NAMES) expect({ name, body: after.dashboards[name] }).toEqual({ name, body: before.dashboards[name] });
    // The settings are not rebuilt: they were the user's, not the repository's.
    expect(await settings(server.url)).toEqual(DEFAULT_SETTINGS);
    expect(await server.stop()).toBe(0);

    expect(fixtureTrees()).toEqual(treesBefore);
  }, 30_000);

  test("re-adding in another order changes only the list order, never a dashboard body", async () => {
    const { env, dir } = environment();
    for (const name of NAMES) await add(env, name);
    let server = await serve(env);
    const before = await view(server.url);
    expect(await server.stop()).toBe(0);

    rmSync(dir, { recursive: true });
    expect(existsSync(dir)).toBe(false);

    for (const name of [...NAMES].reverse()) await add(env, name);
    server = await serve(env);
    const after = await view(server.url);
    expect(await server.stop()).toBe(0);

    const entries = (body: string): unknown[] => JSON.parse(body) as unknown[];
    expect(after.list).not.toBe(before.list);
    expect(entries(after.list)).toEqual([...entries(before.list)].reverse());
    for (const name of NAMES) expect({ name, body: after.dashboards[name] }).toEqual({ name, body: before.dashboards[name] });
  }, 30_000);
});
