// The favourite specs (spec 052 T6, ISC-296): `GET /api/workspaces/:ws/favorites` and `PUT` / `DELETE
// /api/workspaces/:ws/favorites/:spec`, workspace routes served by `dashboardApi` from the `spec_favorite` table of
// `spectant.db`, never from a repository file. Every answer is `{specs}`, the workspace's whole set, sorted. Setting
// and unsetting are idempotent, the set survives a restart over the same data directory, and two workspaces never share
// a favourite. A spec id outside `NNN-slug` is 400 `invalid-spec`; whether the workspace has the spec is not checked.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardApi } from "../server/src/cli/index.ts";
import { listFavorites, listIdeaFavorites, openDatabase } from "../server/src/infra/db/db.ts";
import { eventsApi, type LiveChange, type LiveListener, type WatchHub } from "../server/src/live/index.ts";
import type { ApiHandler } from "../server/src/infra/http/server.ts";
import { type Registry, openRegistry } from "../server/src/infra/db/registry.ts";
import { specRoutesApi } from "../server/src/spec/index.ts";
import {
  EVENTS_PATH,
  JSON_ANSWER,
  LIVE_EVENT,
  SPEC_API_ROOT,
  WORKSPACE_ROUTE_TABLE,
  allowForWorkspace,
  isFavorites,
  matchWorkspacePath,
  specRoutes,
  workspaceRoutes,
} from "../server/src/contracts/spec-routes.contract.ts";
import { favoritesScan } from "../server/src/planning/index.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const HOST = { Host: "127.0.0.1:7717" };

let root: string;
let data: string;
let db: Database;
let registry: Registry;
let api: ApiHandler;

/** Opens the database and the registry over `data` and builds the API on them, as the server does at start. */
function start(): void {
  db = openDatabase(data);
  registry = openRegistry(data);
  api = dashboardApi({ registry, db, services: () => Promise.resolve([]) });
}

function stop(): void {
  registry.close();
  db.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-favorites-"));
  data = join(root, "data");
  start();
  registry.add(join(FIXTURES, "harbor"));
  registry.add(join(FIXTURES, "lantern"));
});

afterEach(() => {
  stop();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const res = await api(new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } }), url);
  if (res === null) throw new Error(`dashboardApi declined ${path}`);
  return res;
}

/** The answer's status and body, with the body checked against the contract's guard on a 200. */
async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  const body: unknown = await res.json();
  if (res.status === 200) expect(isFavorites(body)).toBe(true);
  return { status: res.status, body };
}

const list = async (ws: string) => answer(await call(workspaceRoutes.favorites(ws)));
const set = async (ws: string, spec: string) => answer(await call(workspaceRoutes.favorite(ws, spec), { method: "PUT" }));
const unset = async (ws: string, spec: string) => answer(await call(workspaceRoutes.favorite(ws, spec), { method: "DELETE" }));

describe("the favourite routes in the workspace family (spec 052 T1)", () => {
  test("the contract: builders, matcher, table entries, Allow", () => {
    expect(workspaceRoutes.favorites("häfen")).toBe("/api/workspaces/h%C3%A4fen/favorites");
    expect(workspaceRoutes.favorite("a b", "002-web-console")).toBe("/api/workspaces/a%20b/favorites/002-web-console");
    expect(matchWorkspacePath(workspaceRoutes.favorites("a b"))).toEqual({ route: "favorites", params: { ws: "a b" } });
    expect(matchWorkspacePath(workspaceRoutes.favorite("a b", "002-web-console"))).toEqual({
      route: "favorite",
      params: { ws: "a b", spec: "002-web-console" },
    });
    expect(WORKSPACE_ROUTE_TABLE.filter((e) => e.route === "favorites" || e.route === "favorite")).toEqual([
      { route: "favorites", method: "GET", pattern: "/api/workspaces/:ws/favorites", statuses: [200, 304, 403, 404, 405], response: "Favorites" },
      { route: "favorite", method: "PUT", write: "DELETE", pattern: "/api/workspaces/:ws/favorites/:spec", statuses: [200, 400, 403, 404, 405], response: "Favorites" },
    ]);
    expect(allowForWorkspace("favorites")).toBe("GET, HEAD");
    expect(allowForWorkspace("favorite")).toBe("PUT, DELETE");
  });

  test("the idea favourite (spec 064 T50): builder, matcher, table entry, Allow; it never collides with /favorites/:spec", () => {
    expect(workspaceRoutes.ideaFavorite("a b", "tide-alerts")).toBe("/api/workspaces/a%20b/favorites/idea/tide-alerts");
    expect(matchWorkspacePath(workspaceRoutes.ideaFavorite("a b", "tide-alerts"))).toEqual({
      route: "ideaFavorite",
      params: { ws: "a b", slug: "tide-alerts" },
    });
    // A slug spelled like a spec id still lands on the idea route, and `idea` is no spec id the spec route admits.
    expect(matchWorkspacePath(workspaceRoutes.ideaFavorite("harbor", "002-quay"))?.route).toBe("ideaFavorite");
    expect(matchWorkspacePath("/api/workspaces/harbor/favorites/idea")).toEqual({ route: "favorite", params: { ws: "harbor", spec: "idea" } });
    expect(WORKSPACE_ROUTE_TABLE.filter((e) => e.route === "ideaFavorite")).toEqual([
      { route: "ideaFavorite", method: "PUT", write: "DELETE", pattern: "/api/workspaces/:ws/favorites/idea/:slug", statuses: [200, 400, 403, 404, 405], response: "Favorites" },
    ]);
    expect(allowForWorkspace("ideaFavorite")).toBe("PUT, DELETE");
  });
});

const setIdea = async (ws: string, slug: string) => answer(await call(workspaceRoutes.ideaFavorite(ws, slug), { method: "PUT" }));
const unsetIdea = async (ws: string, slug: string) => answer(await call(workspaceRoutes.ideaFavorite(ws, slug), { method: "DELETE" }));

describe("PUT and DELETE /favorites/idea/:slug (spec 064 T50, ISC-494)", () => {
  test("set, set twice, unset, unset twice, list: every answer is the whole {specs, ideas}, sorted", async () => {
    await set("harbor", "003-tide-tables");
    expect(await setIdea("harbor", "tide-alerts")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["tide-alerts"] } });
    expect(await setIdea("harbor", "buoy-map")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map", "tide-alerts"] } });
    expect(await setIdea("harbor", "tide-alerts")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map", "tide-alerts"] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map", "tide-alerts"] } });
    expect(await unsetIdea("harbor", "tide-alerts")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map"] } });
    expect(await unsetIdea("harbor", "tide-alerts")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map"] } });
    expect(await unsetIdea("harbor", "never-set")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map"] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: ["buoy-map"] } });
    // The spec routes answer the idea favourites too, and leave them alone.
    expect(await unset("harbor", "003-tide-tables")).toEqual({ status: 200, body: { specs: [], ideas: ["buoy-map"] } });
    expect(listIdeaFavorites(db, "harbor")).toEqual(["buoy-map"]);
  });

  test("the slug need not name a story of the workspace; two workspaces keep their idea favourites apart; a restart keeps them", async () => {
    await setIdea("harbor", "no-such-story");
    await setIdea("lantern", "wick-trim");
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: [], ideas: ["wick-trim"] } });
    stop();
    start();
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: [], ideas: ["no-such-story"] } });
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: [], ideas: ["wick-trim"] } });
  });

  test("a slug outside kebab-case is 400 invalid-slug for PUT and DELETE, and nothing is stored", async () => {
    await setIdea("harbor", "buoy-map");
    for (const slug of ["Tide", "-lead", "a_b", "a b", "a/b", "a.md", "ü-mlaut"]) {
      for (const method of ["PUT", "DELETE"]) {
        const res = await call(workspaceRoutes.ideaFavorite("harbor", slug), { method });
        expect({ slug, method, ...(await answer(res)) }).toEqual({ slug, method, status: 400, body: { error: "invalid-slug" } });
      }
    }
    expect(listIdeaFavorites(db, "harbor")).toEqual(["buoy-map"]);
  });

  test("an unknown workspace is 404; any other method 405 with Allow PUT, DELETE; a foreign Origin 403 before anything is stored", async () => {
    expect(await setIdea("nowhere", "buoy-map")).toEqual({ status: 404, body: { error: "not-found" } });
    expect(await unsetIdea("nowhere", "buoy-map")).toEqual({ status: 404, body: { error: "not-found" } });
    for (const method of ["GET", "HEAD", "POST"]) {
      const res = await call(workspaceRoutes.ideaFavorite("harbor", "buoy-map"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: "PUT, DELETE" });
    }
    const cross = await call(workspaceRoutes.ideaFavorite("harbor", "buoy-map"), { method: "PUT", headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(listIdeaFavorites(db, "harbor")).toEqual([]);
    expect(listIdeaFavorites(db, "nowhere")).toEqual([]);
  });

  test("without a database the route is declined, so the server's JSON 404 applies", () => {
    const bare = dashboardApi({ registry, services: () => Promise.resolve([]) });
    const url = new URL(`http://127.0.0.1:7717${workspaceRoutes.ideaFavorite("harbor", "buoy-map")}`);
    expect(bare(new Request(url.href, { method: "PUT", headers: HOST }), url)).toBeNull();
  });
});

describe("GET /favorites, PUT and DELETE /favorites/:spec (spec 052 T4, ISC-296)", () => {
  test("none stored: 200 {specs: []} with the JSON conventions and a 304 on revalidation; HEAD has no body", async () => {
    const res = await call(workspaceRoutes.favorites("harbor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(await res.json()).toEqual({ specs: [], ideas: [] });
    expect((await call(workspaceRoutes.favorites("harbor"), { headers: { "If-None-Match": etag } })).status).toBe(304);
    const head = await call(workspaceRoutes.favorites("harbor"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("set, set twice, unset, unset never set: every answer is the whole set, sorted", async () => {
    expect(await set("harbor", "003-tide-tables")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: [] } });
    expect(await set("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"], ideas: [] } });
    // Setting again keeps one entry.
    expect(await set("harbor", "003-tide-tables")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"], ideas: [] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"], ideas: [] } });
    expect(await unset("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: [] } });
    // Unsetting again, and unsetting an id never set, are 200 with the set unchanged.
    expect(await unset("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: [] } });
    expect(await unset("harbor", "999-never-set")).toEqual({ status: 200, body: { specs: ["003-tide-tables"], ideas: [] } });
    expect(listFavorites(db, "harbor")).toEqual(["003-tide-tables"]);
  });

  test("the route does not check the spec exists in the workspace: an unknown id is set and unset like any other", async () => {
    expect(await set("harbor", "042-not-in-harbor")).toEqual({ status: 200, body: { specs: ["042-not-in-harbor"], ideas: [] } });
    expect(await unset("harbor", "042-not-in-harbor")).toEqual({ status: 200, body: { specs: [], ideas: [] } });
  });

  test("after a restart over the same data directory the route answers the same set", async () => {
    await set("harbor", "002-quay");
    await set("harbor", "005-buoys");
    await set("lantern", "001-wick");
    const before = await list("harbor");
    stop();
    start();
    expect(await list("harbor")).toEqual(before);
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["002-quay", "005-buoys"], ideas: [] } });
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: ["001-wick"], ideas: [] } });
  });

  test("two workspaces keep their favourites apart, the same spec id included", async () => {
    await set("harbor", "001-shared-id");
    await set("harbor", "002-harbor-only");
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: [], ideas: [] } });
    await set("lantern", "001-shared-id");
    expect(await unset("lantern", "001-shared-id")).toEqual({ status: 200, body: { specs: [], ideas: [] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["001-shared-id", "002-harbor-only"], ideas: [] } });
  });

  test("a spec id outside NNN-slug is 400 invalid-spec for PUT and DELETE, and nothing is stored", async () => {
    await set("harbor", "001-moorings");
    for (const spec of ["001", "1-short", "abc-slug", "001-", "0001slug", "001-a/b", "web-console"]) {
      for (const method of ["PUT", "DELETE"]) {
        const res = await call(workspaceRoutes.favorite("harbor", spec), { method });
        expect({ spec, method, ...(await answer(res)) }).toEqual({ spec, method, status: 400, body: { error: "invalid-spec" } });
      }
    }
    expect(listFavorites(db, "harbor")).toEqual(["001-moorings"]);
  });

  test("an unknown workspace is 404 for GET, PUT and DELETE, and nothing is stored for it", async () => {
    expect(await list("nowhere")).toEqual({ status: 404, body: { error: "not-found" } });
    expect(await set("nowhere", "001-moorings")).toEqual({ status: 404, body: { error: "not-found" } });
    expect(await unset("nowhere", "001-moorings")).toEqual({ status: 404, body: { error: "not-found" } });
    expect(listFavorites(db, "nowhere")).toEqual([]);
  });

  test("405 with the route's Allow for any other method; 403 for a foreign Host or Origin before anything is stored", async () => {
    for (const method of ["PUT", "DELETE", "POST"]) {
      const res = await call(workspaceRoutes.favorites("harbor"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: "GET, HEAD" });
    }
    for (const method of ["GET", "HEAD", "POST"]) {
      const res = await call(workspaceRoutes.favorite("harbor", "001-moorings"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: "PUT, DELETE" });
    }
    expect((await call(workspaceRoutes.favorites("harbor"), { headers: { Host: "evil.example" } })).status).toBe(403);
    const cross = await call(workspaceRoutes.favorite("harbor", "001-moorings"), { method: "PUT", headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(listFavorites(db, "harbor")).toEqual([]);
  });

  test("without a database both routes are declined, so the server's JSON 404 applies", () => {
    const bare = dashboardApi({ registry, services: () => Promise.resolve([]) });
    for (const path of [workspaceRoutes.favorites("harbor"), workspaceRoutes.favorite("harbor", "001-moorings")]) {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      expect(bare(new Request(url.href, { method: "PUT", headers: HOST }), url)).toBeNull();
    }
  });
});

// Spec 057 T1/T2 (ISC-352, ISC-353): a favourite whose spec the server's workspace scan no longer finds as an open spec
// (archived under `specs/archive/` or gone) is pruned in the scan path, the live stream's build after a watcher change
// (`eventsApi`'s `scan`, `favoritesScan`), never by a GET handler: a GET reads `spec_favorite` and writes nothing.
describe("favourites of specs that are no longer open (spec 057 T1, T2)", () => {
  /** Every row of `spec_favorite`, all columns, as one string: the table's bytes as the probe compares them. */
  const dump = (): string => JSON.stringify(db.query("SELECT * FROM spec_favorite ORDER BY ws, spec").all());

  /** A fake hub that hands the stream's listener to the test, so a watcher change can be raised by hand. */
  function fakeHub(): { hub: WatchHub; raise: (change: LiveChange) => void } {
    let listener: LiveListener | null = null;
    const hub: WatchHub = {
      subscribe(l) {
        listener = l;
        return () => {
          listener = null;
        };
      },
      sync: () => Promise.resolve(),
      announce: () => Promise.resolve(),
    };
    return {
      hub,
      raise: (change) => {
        if (listener === null) throw new Error("no stream is listening");
        listener(change);
      },
    };
  }

  test("prune on scan: archived or gone specs lose their star at the scan, and a spec brought back has none", async () => {
    const repo = join(root, "repo");
    for (const name of ["001-alpha", "002-beta"]) {
      mkdirSync(join(repo, "specs", name), { recursive: true });
      writeFileSync(join(repo, "specs", name, "spec.md"), `# ${name}\n`);
    }
    mkdirSync(join(repo, "specs", "archive"));
    const ws = registry.add(repo).slug;
    expect((await set(ws, "001-alpha")).status).toBe(200);
    expect((await set(ws, "002-beta")).status).toBe(200);

    const { hub, raise } = fakeHub();
    const events = eventsApi({ hub, reads: api, scan: favoritesScan({ db, registry }), heartbeatMs: 60_000 });
    const url = new URL(`http://127.0.0.1:7717${EVENTS_PATH}`);
    const controller = new AbortController();
    const res = await events(new Request(url.href, { headers: HOST, signal: controller.signal }), url);
    if (res?.body == null) throw new Error("no event stream");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    /** Raises one watcher change and waits for the stream's live frame, which goes out after the scan. */
    const scan = async (specIds: string[]): Promise<void> => {
      raise({ ws, specIds });
      let text = "";
      while (!text.includes(`event: ${LIVE_EVENT}`)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream closed before the live frame");
        text += decoder.decode(value);
      }
    };
    try {
      renameSync(join(repo, "specs", "001-alpha"), join(repo, "specs", "archive", "001-alpha"));
      await scan(["001"]);
      expect(db.query("SELECT * FROM spec_favorite WHERE ws = ? AND spec = '001-alpha'").all(ws)).toHaveLength(0);
      expect(listFavorites(db, ws)).toEqual(["002-beta"]);

      renameSync(join(repo, "specs", "archive", "001-alpha"), join(repo, "specs", "001-alpha"));
      await scan(["001"]);
      expect(listFavorites(db, ws)).toEqual(["002-beta"]);

      rmSync(join(repo, "specs", "002-beta"), { recursive: true });
      await scan(["002"]);
      expect(listFavorites(db, ws)).toEqual([]);

      // A scan that cannot list `specs/` at all (mid-checkout, unmounted) prunes nothing.
      expect((await set(ws, "001-alpha")).status).toBe(200);
      renameSync(join(repo, "specs"), join(repo, "specs-away"));
      await scan([]);
      expect(listFavorites(db, ws)).toEqual(["001-alpha"]);
    } finally {
      await reader.cancel();
      controller.abort();
    }
  });

  test("no write on get: favourites, workspace and spec reads leave spec_favorite byte-identical", async () => {
    const ws = registry.list()[0]?.slug ?? "";
    expect((await set(ws, "999-ghost")).status).toBe(200);
    const before = dump();
    const specs = specRoutesApi({ registry });
    const get = async (handler: ApiHandler, path: string): Promise<number> => {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      const res = await handler(new Request(url.href, { headers: HOST }), url);
      if (res === null) throw new Error(`declined ${path}`);
      await res.arrayBuffer();
      return res.status;
    };
    expect(await get(api, workspaceRoutes.favorites(ws))).toBe(200);
    expect(await get(api, SPEC_API_ROOT)).toBe(200);
    expect(await get(api, `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`)).toBe(200);
    expect(await get(api, workspaceRoutes.planning(ws))).toBe(200);
    expect(await get(specs, specRoutes.spec(ws, "002"))).toBe(200);
    expect(dump()).toBe(before);
    expect(listFavorites(db, ws)).toContain("999-ghost");
  });
});
