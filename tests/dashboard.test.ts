// The workspace API (T47, ISC-16; plan 001 § Interfaces "HTTP"): `GET /api/workspaces` and
// `GET /api/workspaces/:slug/dashboard` over a registry holding two fixture trees, `core/fixtures/harbor` and
// `core/fixtures/lantern`, served in-process on an ephemeral loopback port against a temp data directory.
//
// Golden comparison: each dashboard body equals `core/fixtures/<name>.golden.json` field for field except `services`,
// which is runtime state (the listeners on this machine). The test injects one fake listener instead of running
// `lsof`, and asserts that field on its own: labelled from the fixture's constitution (`dev_services:`) where it names
// the port. The gate state needs no exclusion: neither fixture folder is a repository root (no `.git` in it), so the
// worktree tree id is null exactly as the goldens were built. The goldens carry no lock sources; harbor's activity log
// holds one claim, applied explicitly by `expected` (T51).
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardModel } from "../core/src/dashboard.ts";
import { WORKSPACES_PATH, composeApi, dashboardApi } from "../server/src/api.ts";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { openDatabase } from "../server/src/db.ts";
import { type RunningServer, serve } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import type { DevService } from "../server/src/services.ts";
import { DEFAULT_SETTINGS, openSettings, settingsApi } from "../server/src/settings.ts";
import { loadDashboard, worktreeTreeId } from "../server/src/workspace-loader.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const NAMES = ["harbor", "lantern"] as const;

type Name = (typeof NAMES)[number];
type ListEntry = { slug: string; name: string; pathTail: string; readable: boolean; error?: string; counts: unknown };

const golden = (name: Name): DashboardModel => JSON.parse(readFileSync(join(FIXTURES, `${name}.golden.json`), "utf8")) as DashboardModel;

/**
 * The model the route answers for a fixture. The goldens are built without lock sources; the route reads the
 * repository's `.spectant/activity.jsonl` (T51, ISC-37). harbor's log leaves ISC-74 of spec 002 claimed (ISC-72 is
 * claimed and released), so its model differs from the golden by exactly that lock: ISC-74 leaves 002's takeable list
 * and next reason, and the takeable count drops by one. lantern has no log and answers its golden unchanged.
 */
function expected(name: Name): DashboardModel {
  const model = golden(name);
  if (name !== "harbor") return model;
  return {
    ...model,
    kpis: { ...model.kpis, takeable: model.kpis.takeable - 1 },
    specs: model.specs.map((row) =>
      row.id !== "002"
        ? row
        : {
            ...row,
            takeable: row.takeable.filter((id) => id !== "ISC-74"),
            nextReason: "ISC-75, ISC-76 and 1 more are takeable",
            // The route reads harbor's activity log; the golden is built without lock sources (T115).
            taken: [{ id: "ISC-74", session: "spec-002-ISC-74", since: "2026-03-08T14:06:00Z", source: "activity" }],
          },
    ),
  };
}

/** The one listener the fake probe reports for every workspace: port 4200, a node process outside any worktree. */
const FAKE_LISTENER: DevService = { port: 4200, label: "node", kind: "node", worktree: false };
const probed: string[] = [];
const fakeServices = (repoRoot: string): Promise<DevService[]> => {
  probed.push(repoRoot);
  return Promise.resolve([FAKE_LISTENER]);
};

/** Every string anywhere in `value`, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

/**
 * An absolute path in a string: a leading `/segment/`, or the home, temp or fixture directory anywhere in it. A slash
 * command (`/spec-review 005`) starts with `/` too, but has no second segment, and is what the model must carry.
 */
const hasAbsolutePath = (s: string): boolean =>
  /^\/[^\s/]+\//.test(s) || [homedir(), tmpdir(), root, FIXTURES].some((dir) => s.includes(dir));

const withoutServices = (model: DashboardModel): Partial<DashboardModel> => ({ ...model, services: undefined });

let root: string;
const running: RunningServer[] = [];
const registries: Registry[] = [];

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-dashboard-"));
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

/** A fresh registry in its own data directory with `paths` registered in that order. */
function registryWith(...paths: string[]): Registry {
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  for (const path of paths) registry.add(path);
  return registry;
}

function start(registry: Registry): RunningServer {
  const server = serve({ manifest: manifest(), port: 0, api: dashboardApi({ registry, services: fakeServices }) });
  running.push(server);
  return server;
}

const get = (server: RunningServer, path: string, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(`${server.url}${path.replace(/^\//, "")}`, { headers });

describe("the two routes over two registered workspaces", () => {
  test("multi-workspace: GET /api/workspaces lists both in registry order, path tail only, counts from the model", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")));
    const res = await get(server, WORKSPACES_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const list = (await res.json()) as ListEntry[];
    expect(list).toEqual(
      NAMES.map((name) => ({ slug: name, name, pathTail: name, readable: true, counts: expected(name).kpis })),
    );
    // The list builds counts without a services probe: lsof stays off the polled overview route.
    expect(probed).toEqual([]);
  });

  test("multi-workspace: each dashboard route answers its fixture's golden model, services labelled from the constitution", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")));
    const labels: Record<Name, string | null> = { harbor: "Web dev", lantern: null };
    for (const name of NAMES) {
      const res = await get(server, `/api/workspaces/${name}/dashboard`);
      expect(res.status).toBe(200);
      const model = (await res.json()) as DashboardModel;
      expect(withoutServices(model)).toEqual(withoutServices(expected(name)));
      expect(model.services).toEqual([
        { port: 4200, url: "http://localhost:4200", process: "node", label: labels[name], worktree: false },
      ]);
    }
  });

  test("multi-workspace: both bodies and the list carry no absolute path", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")));
    const bodies = [await (await get(server, WORKSPACES_PATH)).json()];
    for (const name of NAMES) bodies.push(await (await get(server, `/api/workspaces/${name}/dashboard`)).json());
    expect(strings(bodies).filter(hasAbsolutePath)).toEqual([]);
    // The check itself bites: a path-shaped string is caught, a slash command is not.
    expect([join(FIXTURES, "harbor"), "/spec-review 005"].filter(hasAbsolutePath)).toEqual([join(FIXTURES, "harbor")]);
  });

  test("multi-workspace: every JSON answer sends a strong ETag, stable across requests, and a matching If-None-Match gets 304", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")));
    for (const path of [WORKSPACES_PATH, "/api/workspaces/harbor/dashboard", "/api/workspaces/lantern/dashboard"]) {
      const first = await get(server, path);
      const body = await first.text();
      const etag = first.headers.get("etag") ?? "";
      expect(etag).toMatch(/^"[^"]+"$/); // strong: no W/ prefix
      expect(etag).toBe(`"${createHash("sha256").update(body).digest("base64url")}"`);
      expect(first.headers.get("cache-control")).toBe("no-cache");
      const again = await get(server, path);
      expect(again.headers.get("etag")).toBe(etag);
      await again.body?.cancel();
      const cached = await get(server, path, { "If-None-Match": etag });
      expect(cached.status).toBe(304);
      expect(cached.headers.get("etag")).toBe(etag);
      expect(await cached.text()).toBe("");
      const other = await get(server, path, { "If-None-Match": '"something-else"' });
      expect(other.status).toBe(200);
      await other.body?.cancel();
    }
    // The two dashboards differ, so their tags do.
    const [harbor, lantern] = await Promise.all(
      NAMES.map(async (name) => (await get(server, `/api/workspaces/${name}/dashboard`)).headers.get("etag")),
    );
    expect(harbor).not.toBe(lantern);
  });

  test("multi-workspace: an unknown slug is a JSON 404, unknown sub-paths fall through, other methods are 405", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")));
    const unknown = await get(server, "/api/workspaces/nope/dashboard");
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "not-found" });
    for (const path of ["/api/workspaces/harbor", "/api/workspaces/harbor/specs", "/api/workspacesx"]) {
      const res = await get(server, path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      await res.body?.cancel();
    }
    const post = await fetch(`${server.url}api/workspaces`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    const head = await fetch(`${server.url}api/workspaces/harbor/dashboard`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toMatch(/^"/);
  });

  test("a non-loopback Host or a cross-site Origin is refused with 403, as on the settings route", async () => {
    const server = start(registryWith(join(FIXTURES, "harbor")));
    const rebound = await get(server, WORKSPACES_PATH, { Host: "evil.example" });
    expect(rebound.status).toBe(403);
    expect(await rebound.json()).toEqual({ error: "forbidden" });
    const foreign = await get(server, "/api/workspaces/harbor/dashboard", { Origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    await foreign.body?.cancel();
    const sameOrigin = await get(server, WORKSPACES_PATH, { Origin: server.url.replace(/\/$/, "") });
    expect(sameOrigin.status).toBe(200);
    await sameOrigin.body?.cancel();
  });
});

describe("an unreadable workspace", () => {
  test("a registered directory that no longer exists lists as readable: false, and its dashboard is a 409", async () => {
    const gone = join(root, "gone");
    mkdirSync(gone);
    const server = start(registryWith(join(FIXTURES, "harbor"), gone));
    rmSync(gone, { recursive: true });

    const list = (await (await get(server, WORKSPACES_PATH)).json()) as ListEntry[];
    expect(list.map((w) => w.slug)).toEqual(["harbor", "gone"]);
    expect(list[1]).toEqual({ slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null });

    const res = await get(server, "/api/workspaces/gone/dashboard");
    expect(res.status).toBe(409);
    expect(res.headers.get("etag")).toMatch(/^"/);
    const body = await res.json();
    expect(body).toEqual(list[1]);
    expect(strings([list, body]).filter(hasAbsolutePath)).toEqual([]);
  });

  test("a directory without read permission reads as permission-denied, never a throw", async () => {
    if (process.getuid?.() === 0) return; // root reads through any mode
    const locked = join(root, "locked");
    mkdirSync(locked);
    const registry = registryWith(locked);
    chmodSync(locked, 0o000);
    try {
      const server = start(registry);
      const list = (await (await get(server, WORKSPACES_PATH)).json()) as ListEntry[];
      expect(list).toEqual([{ slug: "locked", name: "locked", pathTail: "locked", readable: false, error: "permission-denied", counts: null }]);
      expect((await get(server, "/api/workspaces/locked/dashboard")).status).toBe(409);
    } finally {
      chmodSync(locked, 0o700);
    }
  });

  test("a regular file where the directory was reads as not-a-directory", async () => {
    const swapped = join(root, "swapped");
    mkdirSync(swapped);
    const registry = registryWith(swapped);
    rmSync(swapped, { recursive: true });
    writeFileSync(swapped, "not a directory");
    expect(await loadDashboard(swapped, null)).toEqual({ readable: false, error: "not-a-directory" });
    registry.close();
    registries.splice(registries.indexOf(registry), 1);
  });
});

describe("the loader reads a repository and writes nothing", () => {
  const git = (cwd: string, args: string[], env: Record<string, string> = {}): string => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
    return result.stdout.toString().trim();
  };

  /** Path → sha256 of every file and link under `dir`, `.git/` included. */
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

  function repository(): string {
    const repo = mkdtempSync(join(root, "repo-"));
    git(repo, ["init", "--quiet"]);
    mkdirSync(join(repo, "specs", "001-one", ".gates"), { recursive: true });
    mkdirSync(join(repo, "src", "deep"), { recursive: true });
    writeFileSync(join(repo, ".gitignore"), "ISA.md\nbuild/\n");
    writeFileSync(join(repo, "ISA.md"), "# ignored master\n");
    mkdirSync(join(repo, "build"));
    writeFileSync(join(repo, "build", "out.js"), "ignored\n");
    writeFileSync(join(repo, "specs", "001-one", "spec.md"), "---\ntask: one\nphase: build\n---\n\n# One\n");
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
    writeFileSync(join(repo, "src", "deep", "b.ts"), "export const b = 2;\n");
    writeFileSync(join(repo, "run.sh"), "#!/bin/sh\necho hi\n");
    chmodSync(join(repo, "run.sh"), 0o755);
    symlinkSync("src/a.ts", join(repo, "link.ts"));
    // One file committed and then changed on disk, one committed and then deleted: the worktree is what counts.
    git(repo, ["add", "src/a.ts", "run.sh"]);
    writeFileSync(join(repo, "gone.txt"), "soon gone\n");
    git(repo, ["add", "gone.txt"]);
    git(repo, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "--quiet", "-m", "init"]);
    rmSync(join(repo, "gone.txt"));
    writeFileSync(join(repo, "src", "a.ts"), "export const a = 3;\n");
    return repo;
  }

  /** What `git add -A && git write-tree` prints for the worktree, through a throwaway index outside the repository. */
  function gitTree(repo: string): string {
    const index = join(root, `index-${Math.random().toString(36).slice(2)}`);
    git(repo, ["read-tree", "HEAD"], { GIT_INDEX_FILE: index });
    git(repo, ["add", "-A"], { GIT_INDEX_FILE: index });
    return git(repo, ["write-tree"], { GIT_INDEX_FILE: index });
  }

  test("the worktree tree id equals git's, .gitignore applied, modes and links kept, without touching the repository", async () => {
    const repo = repository();
    const before = snapshot(repo);
    const tree = await worktreeTreeId(repo);
    expect(snapshot(repo)).toEqual(before);
    expect(tree).toBe(gitTree(repo));
  });

  test("a code-reviewed mark on the current tree reads fresh, and loading changes no byte, .git/ included", async () => {
    const repo = repository();
    // The mark itself is part of the tree it names only if it is tracked; keep it out, as a reviewer's local mark.
    writeFileSync(join(repo, ".git", "info", "exclude"), "specs/*/.gates/\n");
    const tree = gitTree(repo);
    const mark = { gate: "code-reviewed", at: "2026-09-29T10:00:00Z", tree, head: null, code: 0, security: 0 };
    writeFileSync(join(repo, "specs", "001-one", ".gates", "code-reviewed.json"), JSON.stringify(mark));
    const before = snapshot(repo);
    const load = await loadDashboard(repo, null);
    expect(snapshot(repo)).toEqual(before);
    if (!load.readable) throw new Error(`unreadable: ${load.error}`);
    expect(load.model.specs.map((r) => [r.id, r.gates.codeReviewed.state])).toEqual([["001", "fresh"]]);
  });

  test("a folder that is not a repository root gets no tree id", async () => {
    expect(await worktreeTreeId(join(FIXTURES, "harbor"))).toBeNull();
  });
});

describe("composed behind one api function", () => {
  test("composeApi: the first non-null answer wins, and null falls through to the server's JSON 404", async () => {
    const calls: string[] = [];
    const api = composeApi(
      (_req, url) => (calls.push(`a:${url.pathname}`), url.pathname === "/api/a" ? Response.json({ from: "a" }) : null),
      (_req, url) => (calls.push(`b:${url.pathname}`), url.pathname.startsWith("/api/") ? Response.json({ from: "b" }) : null),
    );
    const server = serve({ manifest: manifest(), port: 0, api: composeApi(api, () => null) });
    running.push(server);
    expect(await (await get(server, "/api/a")).json()).toEqual({ from: "a" });
    expect(await (await get(server, "/api/x")).json()).toEqual({ from: "b" });
    expect(calls).toEqual(["a:/api/a", "a:/api/x", "b:/api/x"]);
    const none = serve({ manifest: manifest(), port: 0, api: composeApi(() => null, () => null) });
    running.push(none);
    expect((await get(none, "/api/settings")).status).toBe(404);
  });

  test("settings and workspaces answer side by side from one composed handler", async () => {
    const db = openDatabase(mkdtempSync(join(root, "data-")));
    try {
      const registry = registryWith(join(FIXTURES, "lantern"));
      const api = composeApi(settingsApi(openSettings(db)), dashboardApi({ registry, services: fakeServices }));
      const server = serve({ manifest: manifest(), port: 0, api });
      running.push(server);
      expect(await (await get(server, "/api/settings")).json()).toEqual(DEFAULT_SETTINGS);
      expect(((await (await get(server, WORKSPACES_PATH)).json()) as ListEntry[]).map((w) => w.slug)).toEqual(["lantern"]);
    } finally {
      db.close();
    }
  });

  test("the CLI-started server serves the registry of its data directory", async () => {
    const xdg = mkdtempSync(join(root, "xdg-"));
    const env = { XDG_DATA_HOME: xdg };
    const lines: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
    const stop = new AbortController();
    try {
      expect(await run(["add", join(FIXTURES, "harbor")], manifest(), { env })).toBe(0);
      expect(await run(["add", join(FIXTURES, "lantern")], manifest(), { env })).toBe(0);
      const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: stop.signal });
      const deadline = Date.now() + 5_000;
      let url = "";
      while (url === "") {
        url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
        if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
        if (url === "") await Bun.sleep(5);
      }
      const list = (await (await fetch(`${url}/api/workspaces`)).json()) as ListEntry[];
      expect(list.map((w) => [w.slug, w.pathTail, w.readable])).toEqual([
        ["harbor", "harbor", true],
        ["lantern", "lantern", true],
      ]);
      const res = await fetch(`${url}/api/workspaces/lantern/dashboard`);
      expect(res.status).toBe(200);
      expect(withoutServices((await res.json()) as DashboardModel)).toEqual(withoutServices(expected("lantern")));
      expect((await fetch(`${url}/api/settings`)).status).toBe(200);
      stop.abort();
      expect(await done).toBe(0);
    } finally {
      stop.abort();
      log.mockRestore();
    }
  });
});
