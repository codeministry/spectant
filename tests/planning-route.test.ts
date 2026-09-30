// The planning route (spec 003 T19, ISC-103; plan 003 § Interfaces "Contract, new workspace route"):
// `GET|HEAD /api/workspaces/:ws/planning` answered by `dashboardApi` from the files of a registered workspace, with the
// JSON conventions of `api.ts` (strong ETag, 304, HEAD, 405 + Allow, the loopback guard, 404 unknown slug, 409 with
// the dashboard's unreadable summary).
//
// Golden comparison: the route's body is the whole `core/fixtures/<tree>.planning.golden.json` (`GOLDEN_FAMILY.planning`,
// the contract's "whole-file body"), byte for byte once both are compact JSON. The goldens are built with the clock
// pinned to `PLANNING_NOW`; the route takes "today" from its `today` option, which the test pins to the same date. The
// planning tree reads no lock source, so harbor's activity log changes nothing here (unlike the dashboard's golden).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanningModel } from "../core/src/planning.ts";
// The day every planning golden is built at: one constant, so moving the goldens' clock moves this route test with it.
import { PLANNING_NOW } from "../core/tests/helpers/planning-model.ts";
import { dashboardApi } from "../server/src/api.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import {
  GOLDEN_FAMILY,
  type WorkspaceRouteError,
  type WorkspaceRouteResponses,
  allowForWorkspace,
  workspaceRoutes,
} from "../server/src/spec-routes.contract.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const HOST = { Host: "127.0.0.1:7717" };

/** The golden file's text, as written (pretty-printed). */
const goldenText = (tree: string): string => readFileSync(join(FIXTURES, `${tree}.${GOLDEN_FAMILY.planning}.golden.json`), "utf8");

let root: string;
const registries: Registry[] = [];

/** A registry in its own data directory with `paths` registered in that order. */
function registryWith(...paths: string[]): Registry {
  const registry = openRegistry(mkdtempSync(join(root, "data-")));
  registries.push(registry);
  for (const path of paths) registry.add(path);
  return registry;
}

let api: ApiHandler;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-planning-"));
  api = dashboardApi({
    registry: registryWith(join(FIXTURES, "harbor"), join(FIXTURES, "lantern")),
    services: () => Promise.resolve([]),
    today: () => PLANNING_NOW,
  });
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string>; handler?: ApiHandler } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const req = new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } });
  const res = await (init.handler ?? api)(req, url);
  if (res === null) throw new Error(`the workspace routes declined ${path}`);
  return res;
}

describe("GET /api/workspaces/:ws/planning", () => {
  test("harbor: 200, the body is the whole planning golden byte for byte, with a strong ETag", async () => {
    const res = await call(workspaceRoutes.planning("harbor"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(JSON.parse(goldenText("harbor"))));
    const body = JSON.parse(text) as WorkspaceRouteResponses["planning"];
    expect(body.features.length).toBeGreaterThan(0);
    // The pinned day puts Harbor 0.9 behind and Harbor 1.0 ahead: the golden's states, not today's.
    expect(body.milestones.map((m) => m.state)).toEqual(["late", "upcoming"]);
  });

  test("lantern: the golden too, and `milestones` is empty (no spec carries one)", async () => {
    const res = await call(workspaceRoutes.planning("lantern"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(JSON.parse(goldenText("lantern"))));
    expect((JSON.parse(text) as PlanningModel).milestones).toEqual([]);
  });

  test("HEAD: 200 with the same headers and no body", async () => {
    const get = await call(workspaceRoutes.planning("harbor"));
    const head = await call(workspaceRoutes.planning("harbor"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(await head.text()).toBe("");
  });

  test("If-None-Match with the current ETag: 304 without a body", async () => {
    const etag = (await call(workspaceRoutes.planning("harbor"))).headers.get("etag") ?? "";
    const res = await call(workspaceRoutes.planning("harbor"), { headers: { "If-None-Match": etag } });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  test("the date is the only moving part: another day changes the milestone states and the ETag", async () => {
    const later = dashboardApi({ registry: registryWith(join(FIXTURES, "harbor")), today: () => "2026-06-01" });
    const res = await call(workspaceRoutes.planning("harbor"), { handler: later });
    expect(res.status).toBe(200);
    const body = (await res.json()) as PlanningModel;
    expect(body.milestones.every((m) => m.state !== "upcoming")).toBe(true);
    const pinned = (await call(workspaceRoutes.planning("harbor"))).headers.get("etag");
    expect(res.headers.get("etag")).not.toBe(pinned);
  });

  test("without a `today` option the route passes today's local date", async () => {
    const plain = dashboardApi({ registry: registryWith(join(FIXTURES, "harbor")) });
    const d = new Date();
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const pinnedToLocal = dashboardApi({ registry: registryWith(join(FIXTURES, "harbor")), today: () => local });
    const [a, b] = await Promise.all([call(workspaceRoutes.planning("harbor"), { handler: plain }), call(workspaceRoutes.planning("harbor"), { handler: pinnedToLocal })]);
    expect(a.status).toBe(200);
    expect(await a.text()).toBe(await b.text());
  });
});

describe("the planning route's errors", () => {
  test("an unknown slug is 404 not-found", async () => {
    const res = await call(workspaceRoutes.planning("nowhere"));
    expect(res.status).toBe(404);
    expect((await res.json()) as WorkspaceRouteError).toEqual({ error: "not-found" });
  });

  test("POST is 405 with the contract's Allow", async () => {
    const res = await call(workspaceRoutes.planning("harbor"), { method: "POST" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe(allowForWorkspace("planning"));
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(await res.json()).toEqual({ error: "method-not-allowed" });
  });

  test("a non-loopback Host or a cross-site Origin is 403, before the method and the slug", async () => {
    const host = await call(workspaceRoutes.planning("nowhere"), { method: "POST", headers: { Host: "evil.example" } });
    expect(host.status).toBe(403);
    expect(await host.json()).toEqual({ error: "forbidden" });
    const origin = await call(workspaceRoutes.planning("harbor"), { headers: { Origin: "https://evil.example" } });
    expect(origin.status).toBe(403);
  });

  test("the method is checked before the slug: POST on an unknown slug is 405", async () => {
    expect((await call(workspaceRoutes.planning("nowhere"), { method: "POST" })).status).toBe(405);
  });

  test("a registered workspace whose directory is gone is 409 with the dashboard's summary, no path", async () => {
    const gone = join(root, "gone");
    cpSync(join(FIXTURES, "lantern"), gone, { recursive: true });
    const handler = dashboardApi({ registry: registryWith(gone), today: () => PLANNING_NOW });
    rmSync(gone, { recursive: true, force: true });
    const res = await call(workspaceRoutes.planning("gone"), { handler });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null });
  });

  test("the route reads through the injectable `readWorkspace`, the seam `loadWorkspace` shares", async () => {
    const roots: string[] = [];
    const handler = dashboardApi({
      registry: registryWith(join(FIXTURES, "harbor")),
      today: () => PLANNING_NOW,
      readWorkspace: (workspaceRoot) => {
        roots.push(workspaceRoot);
        return Promise.resolve({ readable: false, error: "unreadable" });
      },
    });
    const res = await call(workspaceRoutes.planning("harbor"), { handler });
    expect(res.status).toBe(409);
    expect(roots).toEqual([join(FIXTURES, "harbor")]);
    expect(((await res.json()) as { error: string }).error).toBe("unreadable");
  });

  test("the route is exact: a trailing segment is no path of this handler, so the server's JSON 404 applies", () => {
    const url = new URL("http://127.0.0.1:7717/api/workspaces/harbor/planning/extra");
    expect(api(new Request(url.href, { headers: HOST }), url)).toBeNull();
  });
});
