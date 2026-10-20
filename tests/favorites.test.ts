// The favourite specs (spec 052 T6, ISC-296): `GET /api/workspaces/:ws/favorites` and `PUT` / `DELETE
// /api/workspaces/:ws/favorites/:spec`, workspace routes served by `dashboardApi` from the `spec_favorite` table of
// `spectant.db`, never from a repository file. Every answer is `{specs}`, the workspace's whole set, sorted. Setting
// and unsetting are idempotent, the set survives a restart over the same data directory, and two workspaces never share
// a favourite. A spec id outside `NNN-slug` is 400 `invalid-spec`; whether the workspace has the spec is not checked.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardApi } from "../server/src/api.ts";
import { listFavorites, openDatabase } from "../server/src/db.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import {
  JSON_ANSWER,
  WORKSPACE_ROUTE_TABLE,
  allowForWorkspace,
  isFavorites,
  matchWorkspacePath,
  workspaceRoutes,
} from "../server/src/spec-routes.contract.ts";

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
});

describe("GET /favorites, PUT and DELETE /favorites/:spec (spec 052 T4, ISC-296)", () => {
  test("none stored: 200 {specs: []} with the JSON conventions and a 304 on revalidation; HEAD has no body", async () => {
    const res = await call(workspaceRoutes.favorites("harbor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(await res.json()).toEqual({ specs: [] });
    expect((await call(workspaceRoutes.favorites("harbor"), { headers: { "If-None-Match": etag } })).status).toBe(304);
    const head = await call(workspaceRoutes.favorites("harbor"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("set, set twice, unset, unset never set: every answer is the whole set, sorted", async () => {
    expect(await set("harbor", "003-tide-tables")).toEqual({ status: 200, body: { specs: ["003-tide-tables"] } });
    expect(await set("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"] } });
    // Setting again keeps one entry.
    expect(await set("harbor", "003-tide-tables")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["001-moorings", "003-tide-tables"] } });
    expect(await unset("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["003-tide-tables"] } });
    // Unsetting again, and unsetting an id never set, are 200 with the set unchanged.
    expect(await unset("harbor", "001-moorings")).toEqual({ status: 200, body: { specs: ["003-tide-tables"] } });
    expect(await unset("harbor", "999-never-set")).toEqual({ status: 200, body: { specs: ["003-tide-tables"] } });
    expect(listFavorites(db, "harbor")).toEqual(["003-tide-tables"]);
  });

  test("the route does not check the spec exists in the workspace: an unknown id is set and unset like any other", async () => {
    expect(await set("harbor", "042-not-in-harbor")).toEqual({ status: 200, body: { specs: ["042-not-in-harbor"] } });
    expect(await unset("harbor", "042-not-in-harbor")).toEqual({ status: 200, body: { specs: [] } });
  });

  test("after a restart over the same data directory the route answers the same set", async () => {
    await set("harbor", "002-quay");
    await set("harbor", "005-buoys");
    await set("lantern", "001-wick");
    const before = await list("harbor");
    stop();
    start();
    expect(await list("harbor")).toEqual(before);
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["002-quay", "005-buoys"] } });
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: ["001-wick"] } });
  });

  test("two workspaces keep their favourites apart, the same spec id included", async () => {
    await set("harbor", "001-shared-id");
    await set("harbor", "002-harbor-only");
    expect(await list("lantern")).toEqual({ status: 200, body: { specs: [] } });
    await set("lantern", "001-shared-id");
    expect(await unset("lantern", "001-shared-id")).toEqual({ status: 200, body: { specs: [] } });
    expect(await list("harbor")).toEqual({ status: 200, body: { specs: ["001-shared-id", "002-harbor-only"] } });
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
