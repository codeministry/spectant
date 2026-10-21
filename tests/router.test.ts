/**
 * The router of the slices' route tables (spec 059, T53, ISC-412): `createRouter` refuses a route set that is not
 * answered exactly once, and per request answers in the order every route answers today: guard 403, then the family's
 * 404 or a decline, then 405 with the family's `Allow`, then the route's handler. Fake families stand in for the
 * contract tables, so nothing here depends on a slice.
 */
import { describe, expect, test } from "bun:test";
import { json } from "../server/src/infra/http/json.ts";
import { type RouteFamily, type RouteHandler, createRouter } from "../server/src/infra/http/router.ts";

const HOST = { Host: "127.0.0.1:7717" };
const BASE = "http://127.0.0.1:7717";

type ThingRoute = "thing" | "thingWrite";
type ThingMatch = { readonly route: "thing"; readonly params: { readonly id: string } } | { readonly route: "thingWrite"; readonly params: { readonly id: string } };

/** `/api/things/:id` (GET) and `/api/things/:id/write` (POST); the subtree `/api/things/…` is the family's. */
function things(overrides: Partial<RouteFamily<ThingRoute, ThingMatch>> = {}): RouteFamily<ThingRoute, ThingMatch> {
  return {
    name: "things",
    routes: ["thing", "thingWrite"],
    claims: (pathname) => pathname.startsWith("/api/things/"),
    match: (pathname) => {
      const found = /^\/api\/things\/([^/]+)(\/write)?$/.exec(pathname);
      if (found === null) return null;
      const id = found[1] ?? "";
      return found[2] === undefined ? { route: "thing", params: { id } } : { route: "thingWrite", params: { id } };
    },
    allow: (route) => (route === "thing" ? "GET, HEAD" : "POST"),
    guard: "loopback",
    respond: json,
    unmatched: "not-found",
    ...overrides,
  };
}

type OtherMatch = { readonly route: "other"; readonly params: Record<string, never> };

/** `/api/other` alone, declined everywhere else. */
function other(overrides: Partial<RouteFamily<"other", OtherMatch>> = {}): RouteFamily<"other", OtherMatch> {
  return {
    name: "other",
    routes: ["other"],
    claims: (pathname) => pathname === "/api/other",
    match: (pathname) => (pathname === "/api/other" ? { route: "other", params: {} } : null),
    allow: () => "GET, HEAD",
    guard: "loopback",
    respond: json,
    unmatched: "decline",
    ...overrides,
  };
}

const named = (name: string): RouteHandler => (req) => json(req, 200, { route: name });

const handlers = {
  thing: (req: Request, _url: URL, match: ThingMatch & { route: "thing" }) => json(req, 200, { route: "thing", id: match.params.id }),
  thingWrite: (req: Request, _url: URL, match: ThingMatch & { route: "thingWrite" }) => json(req, 200, { route: "thingWrite", id: match.params.id }),
  other: named("other"),
};

async function call(handler: ReturnType<typeof createRouter>, path: string, init: RequestInit = {}): Promise<Response | null> {
  const req = new Request(`${BASE}${path}`, { ...init, headers: { ...HOST, ...(init.headers as Record<string, string> | undefined) } });
  return (await handler(req, new URL(req.url))) ?? null;
}

async function body(res: Response | null): Promise<unknown> {
  if (res === null) throw new Error("declined");
  return res.json();
}

describe("router: createRouter", () => {
  test("throws when a route has no handler", () => {
    const partial = { thing: handlers.thing, other: handlers.other };
    expect(() => createRouter([things(), other()], partial as unknown as typeof handlers)).toThrow("route thingWrite of things has no handler");
  });

  test("throws when two families name the same route", () => {
    const twin = other({ name: "twin", routes: ["other"] });
    expect(() => createRouter([things(), other(), twin], handlers)).toThrow("route other is named twice (other, twin)");
  });

  test("throws when one family names a route twice", () => {
    expect(() => createRouter([things({ routes: ["thing", "thingWrite", "thing"] }), other()], handlers)).toThrow("route thing is named twice (things, things)");
  });

  test("throws when a handler names no route", () => {
    expect(() => createRouter([things()], handlers as unknown as Parameters<typeof createRouter<[RouteFamily<ThingRoute, ThingMatch>]>>[1])).toThrow(
      "handler other names no route of any family",
    );
  });
});

describe("router: dispatch", () => {
  const router = createRouter([things(), other()], handlers);

  test("dispatches the matched route with its params; HEAD reaches a GET route", async () => {
    expect(await body(await call(router, "/api/things/a1"))).toEqual({ route: "thing", id: "a1" });
    expect(await body(await call(router, "/api/things/a1/write", { method: "POST" }))).toEqual({ route: "thingWrite", id: "a1" });
    expect(await body(await call(router, "/api/other"))).toEqual({ route: "other" });
    const head = await call(router, "/api/things/a1", { method: "HEAD" });
    expect(head?.status).toBe(200);
  });

  test("a method the route does not take is 405 with the family's Allow", async () => {
    const put = await call(router, "/api/things/a1", { method: "PUT" });
    expect(put?.status).toBe(405);
    expect(put?.headers.get("Allow")).toBe("GET, HEAD");
    expect(await body(put)).toEqual({ error: "method-not-allowed" });
    const get = await call(router, "/api/things/a1/write");
    expect(get?.status).toBe(405);
    expect(get?.headers.get("Allow")).toBe("POST");
  });

  test("declines a path no family claims", async () => {
    expect(await call(router, "/api/nothing")).toBeNull();
    expect(await call(router, "/")).toBeNull();
  });

  test("a claimed path no route matches is the family's 404 when configured", async () => {
    const res = await call(router, "/api/things/a1/unknown");
    expect(res?.status).toBe(404);
    expect(await body(res)).toEqual({ error: "not-found" });
  });

  test("a declining family passes an unmatched path on to the next family, as composeApi would", async () => {
    const broad = other({ claims: (pathname) => pathname.startsWith("/api/") });
    const chained = createRouter([broad, things()], handlers);
    expect(await body(await call(chained, "/api/things/b2"))).toEqual({ route: "thing", id: "b2" });
    expect(await call(chained, "/api/nothing")).toBeNull();
  });

  test("a handler's null passes the request on", async () => {
    const declining = createRouter([things(), other()], { ...handlers, other: () => null });
    expect(await call(declining, "/api/other")).toBeNull();
  });

  test("refusals go through the family's responder", async () => {
    const tagged = createRouter([things({ respond: (req, status, value, extra = {}) => json(req, status, value, { ...extra, "X-Family": "things" }) }), other()], handlers);
    for (const res of [await call(tagged, "/api/things/a1", { method: "PUT" }), await call(tagged, "/api/things/x/y/z"), await call(tagged, "/api/things/a1", { headers: { Host: "evil.example" } })]) {
      expect(res?.headers.get("X-Family")).toBe("things");
    }
  });
});

describe("router: guard", () => {
  const router = createRouter([things(), other()], handlers);

  test("a foreign Host is 403 before the match, the method and the handler", async () => {
    for (const [path, method] of [["/api/things/a1", "GET"], ["/api/things/a1", "PUT"], ["/api/things/x/y/z", "GET"], ["/api/other", "POST"]] as const) {
      const res = await call(router, path, { method, headers: { Host: "evil.example" } });
      expect(res?.status).toBe(403);
      expect(await body(res)).toEqual({ error: "forbidden" });
    }
  });

  test("a cross-site Origin is 403, the opaque Origin null included", async () => {
    expect((await call(router, "/api/things/a1", { headers: { Origin: "http://evil.example" } }))?.status).toBe(403);
    expect((await call(router, "/api/things/a1", { headers: { Origin: "null" } }))?.status).toBe(403);
    expect((await call(router, "/api/things/a1", { headers: { Origin: "http://127.0.0.1:7717" } }))?.status).toBe(200);
  });

  test("an unclaimed path is declined unguarded", async () => {
    expect(await call(router, "/api/nothing", { headers: { Host: "evil.example" } })).toBeNull();
  });

  test("the prototype guard lets Origin null through, and refuses its wrong method with 403", async () => {
    const proto = createRouter([things({ guard: "prototype" }), other()], handlers);
    expect((await call(proto, "/api/things/a1", { headers: { Origin: "null" } }))?.status).toBe(200);
    expect((await call(proto, "/api/things/a1", { method: "PUT", headers: { Origin: "null" } }))?.status).toBe(403);
    expect((await call(proto, "/api/things/a1", { method: "PUT" }))?.status).toBe(405);
    expect((await call(proto, "/api/things/a1", { headers: { Origin: "http://evil.example" } }))?.status).toBe(403);
    expect((await call(proto, "/api/things/a1", { headers: { Host: "evil.example", Origin: "null" } }))?.status).toBe(403);
  });
});
