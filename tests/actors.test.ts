// The actor names (spec 008 T91, ISC-119.2): `GET` / `PUT /api/actors` over the `actor` table of `spectant.db`, a
// route of its own beside `/api/settings`. GET lists the stored rows (`ActorMapping[]`, ordered by id, ETag, 304);
// PUT replaces the whole mapping with a validated array, `updatedAt` from the server clock. An id without a row is
// never invented: the list holds only what was stored, so the web shows an unmapped id raw. Every test runs against
// a fresh temp data directory; nothing touches the real `~/.spectant`. Names and addresses are synthetic.
import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actorsApi } from "../server/src/api.ts";
import { getActor, listActors, openDatabase } from "../server/src/db.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { ACTORS_ALLOW, ACTORS_PATH, type ActorMapping, JSON_ANSWER } from "../server/src/spec-routes.contract.ts";

const HOST = { Host: "127.0.0.1:7717" };
const HARBOR: ActorMapping = { id: "u:3f9c0a7d", displayName: "Harbor Master", gitIdentities: ["harbor@example.org"] };
const PILOT: ActorMapping = { id: "u:0b1c2d3e", displayName: "Pilot Boat", gitIdentities: ["pilot@example.org", "pilot@example.net"] };

let root: string;
let db: Database;
let api: ApiHandler;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-actors-"));
  db = openDatabase(join(root, "data"));
  api = actorsApi(db);
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(init: { method?: string; headers?: Record<string, string>; body?: unknown; path?: string } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${init.path ?? ACTORS_PATH}`);
  const body = init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) };
  const res = await api(new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers }, ...body }), url);
  if (res === null) throw new Error(`actorsApi declined ${url.pathname}`);
  return res;
}

describe("GET /api/actors (T91, ISC-119.2)", () => {
  test("a fresh database: 200 with an empty list, the JSON conventions, a strong ETag and a 304 on revalidation", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
    const etag = res.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
    expect(await res.json()).toEqual([]);
    const again = await call({ headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call({ method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);
  });

  test("an unknown id is absent: only stored rows come back, none is invented", async () => {
    expect((await call({ method: "PUT", body: [HARBOR] })).status).toBe(200);
    const list = (await (await call()).json()) as ActorMapping[];
    expect(list.map((a) => a.id)).toEqual([HARBOR.id]);
    expect(list.find((a) => a.id === "u:deadbeef")).toBeUndefined();
    expect(getActor(db, "u:deadbeef")).toBeNull();
  });

  test("other paths are declined, so the server's JSON 404 applies", () => {
    for (const path of ["/api/actors/", "/api/actors/u:3f9c0a7d", "/api/actorsx"]) {
      const url = new URL(`http://127.0.0.1:7717${path}`);
      expect({ path, answer: api(new Request(url.href, { headers: HOST }), url) }).toEqual({ path, answer: null });
    }
  });
});

describe("PUT /api/actors (T91, ISC-119.2)", () => {
  test("round trip: PUT answers the stored list ordered by id; GET returns it; the row's updatedAt is the server clock", async () => {
    const started = Date.now();
    const put = await call({ method: "PUT", body: [HARBOR, PILOT] });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual([PILOT, HARBOR]);
    const get = await call();
    expect(await get.json()).toEqual([PILOT, HARBOR]);
    const row = getActor(db, HARBOR.id);
    expect(row?.displayName).toBe(HARBOR.displayName);
    const stamped = Date.parse(row?.updatedAt ?? "");
    expect(stamped).toBeGreaterThanOrEqual(started - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("PUT replaces the whole mapping: a row left out is gone, a changed one is updated, the ETag moves", async () => {
    await call({ method: "PUT", body: [HARBOR, PILOT] });
    const before = (await call()).headers.get("etag");
    const renamed = { ...HARBOR, displayName: "Harbour Master" };
    expect(await (await call({ method: "PUT", body: [renamed] })).json()).toEqual([renamed]);
    expect(listActors(db).map((a) => [a.id, a.displayName])).toEqual([[HARBOR.id, "Harbour Master"]]);
    const after = await call({ headers: { "If-None-Match": before ?? "" } });
    expect(after.status).toBe(200);
    expect(await (await call({ method: "PUT", body: [] })).json()).toEqual([]);
    expect(listActors(db)).toEqual([]);
  });

  test("an invalid body is 400 invalid-body and leaves the table as it was", async () => {
    await call({ method: "PUT", body: [HARBOR] });
    const stored = listActors(db);
    for (const body of [
      "not json",
      "{",
      HARBOR, // one mapping, not the list
      { actors: [HARBOR] },
      [{ ...HARBOR, displayName: "  " }],
      [{ ...HARBOR, id: "" }],
      [{ ...HARBOR, gitIdentities: [1] }],
      [{ ...HARBOR, updatedAt: "2026-03-01T00:00:00Z" }],
      [{ ...HARBOR, id: "a:claude:sess-1" }], // an agent, not a person
      [{ ...HARBOR, id: "u:XYZ" }], // legacy, not the person grammar
      [HARBOR, { ...HARBOR, displayName: "Twice" }], // one id twice
      [HARBOR, null],
    ]) {
      const res = await call({ method: "PUT", body });
      expect({ body, status: res.status, answer: await res.json() }).toEqual({ body, status: 400, answer: { error: "invalid-body" } });
    }
    expect(listActors(db)).toEqual(stored);
  });

  test("405 with Allow: GET, HEAD, PUT for any other method; 403 for a foreign Host or Origin before anything is read", async () => {
    for (const method of ["POST", "DELETE", "PATCH"]) {
      const res = await call({ method, body: [] });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: ACTORS_ALLOW });
    }
    expect(ACTORS_ALLOW).toBe("GET, HEAD, PUT");
    expect((await call({ headers: { Host: "evil.example" } })).status).toBe(403);
    expect((await call({ method: "PUT", body: [HARBOR], headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect(listActors(db)).toEqual([]);
  });
});
