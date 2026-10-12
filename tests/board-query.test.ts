// The remembered board query (spec 008 T92, ISC-129.1): `GET` / `PUT /api/workspaces/:ws/board-query`, a workspace
// route served by `dashboardApi` from the `board_query` table of `spectant.db`, never from a repository file. GET
// answers `{query}` (`''` when none is stored; ETag, 304), PUT validates with the contract's `isBoardQuery` (no
// leading `?`, at most `BOARD_QUERY_MAX` characters) and stores it per workspace; an unknown workspace is a 404.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dashboardApi } from "../server/src/api.ts";
import { getBoardQuery, openDatabase } from "../server/src/db.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import {
  BOARD_QUERY_MAX,
  JSON_ANSWER,
  WORKSPACE_ROUTE_TABLE,
  allowForWorkspace,
  matchWorkspacePath,
  workspaceRoutes,
} from "../server/src/spec-routes.contract.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const HOST = { Host: "127.0.0.1:7717" };

let root: string;
let db: Database;
let registry: Registry;
let api: ApiHandler;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-board-query-"));
  const data = join(root, "data");
  db = openDatabase(data);
  registry = openRegistry(data);
  registry.add(join(FIXTURES, "harbor"));
  registry.add(join(FIXTURES, "lantern"));
  api = dashboardApi({ registry, db, services: () => Promise.resolve([]) });
});

afterEach(() => {
  registry.close();
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const body = init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) };
  const res = await api(new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers }, ...body }), url);
  if (res === null) throw new Error(`dashboardApi declined ${path}`);
  return res;
}

describe("the board-query route in the workspace family (T92)", () => {
  test("the contract: builder, matcher, table entry with GET and PUT, Allow: GET, HEAD, PUT", () => {
    expect(workspaceRoutes.boardQuery("häfen")).toBe("/api/workspaces/h%C3%A4fen/board-query");
    expect(matchWorkspacePath(workspaceRoutes.boardQuery("a b"))).toEqual({ route: "boardQuery", params: { ws: "a b" } });
    const entry = WORKSPACE_ROUTE_TABLE.find((e) => e.route === "boardQuery");
    expect(entry).toEqual({
      route: "boardQuery",
      method: "GET",
      write: "PUT",
      pattern: "/api/workspaces/:ws/board-query",
      statuses: [200, 304, 400, 403, 404, 405],
      request: "BoardQuery",
      response: "BoardQuery",
    });
    expect(allowForWorkspace("boardQuery")).toBe("GET, HEAD, PUT");
  });
});

describe("GET / PUT /api/workspaces/:ws/board-query (T92, ISC-129.1)", () => {
  test("none stored: 200 {query: ''} with the JSON conventions and a 304 on revalidation; HEAD has no body", async () => {
    const res = await call(workspaceRoutes.boardQuery("harbor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(await res.json()).toEqual({ query: "" });
    const again = await call(workspaceRoutes.boardQuery("harbor"), { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    const head = await call(workspaceRoutes.boardQuery("harbor"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  test("round trip: PUT stores the query for that workspace alone; GET answers it; the ETag moves", async () => {
    const before = (await call(workspaceRoutes.boardQuery("harbor"))).headers.get("etag") ?? "";
    const query = "feature=F2&group=milestone";
    const put = await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body: { query } });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ query });
    const get = await call(workspaceRoutes.boardQuery("harbor"), { headers: { "If-None-Match": before } });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ query });
    expect(getBoardQuery(db, "harbor")?.query).toBe(query);
    expect(await (await call(workspaceRoutes.boardQuery("lantern"))).json()).toEqual({ query: "" });
    // Clearing is a PUT of the empty string, at the limit is accepted.
    expect(await (await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body: { query: "" } })).json()).toEqual({ query: "" });
    const longest = "x".repeat(BOARD_QUERY_MAX);
    expect((await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body: { query: longest } })).status).toBe(200);
    expect(getBoardQuery(db, "harbor")?.query).toBe(longest);
  });

  test("an invalid body is 400 invalid-body and leaves the stored query as it was", async () => {
    await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body: { query: "feature=F2" } });
    for (const body of ["not json", "{", { query: "?feature=F2" }, { query: "x".repeat(BOARD_QUERY_MAX + 1) }, { query: null }, { query: "a", extra: 1 }, ["feature=F2"]]) {
      const res = await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body });
      expect({ body, status: res.status, answer: await res.json() }).toEqual({ body, status: 400, answer: { error: "invalid-body" } });
    }
    expect(getBoardQuery(db, "harbor")?.query).toBe("feature=F2");
  });

  test("an unknown workspace is 404 for GET and PUT, and nothing is stored for it", async () => {
    for (const method of ["GET", "PUT"]) {
      const res = await call(workspaceRoutes.boardQuery("nowhere"), { method, ...(method === "PUT" ? { body: { query: "a=1" } } : {}) });
      expect({ method, status: res.status, body: await res.json() }).toEqual({ method, status: 404, body: { error: "not-found" } });
    }
    expect(getBoardQuery(db, "nowhere")).toBeNull();
  });

  test("405 with Allow: GET, HEAD, PUT for any other method; 403 for a foreign Host or Origin before anything is read", async () => {
    const res = await call(workspaceRoutes.boardQuery("harbor"), { method: "POST", body: { query: "" } });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD, PUT");
    expect((await call(workspaceRoutes.boardQuery("harbor"), { headers: { Host: "evil.example" } })).status).toBe(403);
    const cross = await call(workspaceRoutes.boardQuery("harbor"), { method: "PUT", body: { query: "a=1" }, headers: { Origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(getBoardQuery(db, "harbor")).toBeNull();
  });

  test("without a database the route is declined, so the server's JSON 404 applies", () => {
    const bare = dashboardApi({ registry, services: () => Promise.resolve([]) });
    const url = new URL(`http://127.0.0.1:7717${workspaceRoutes.boardQuery("harbor")}`);
    expect(bare(new Request(url.href, { headers: HOST }), url)).toBeNull();
  });
});
