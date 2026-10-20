// The workspace admin contract (spec 016, T1, ISC-303): the route builders and the matcher agree on every route, the
// image type comes from magic bytes alone (SVG and text never), the status follows from the read, the sort keys order
// the page, and the body parsers admit exactly the documented shapes.
import { describe, expect, test } from "bun:test";
import { SPEC_API_ROOT } from "../server/src/spec-routes.contract.ts";
import {
  DEFAULT_WORKSPACE_SORT,
  IMAGE_KINDS,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  WORKSPACE_ADMIN_ROUTE_TABLE,
  WORKSPACE_SORT_KEYS,
  type WorkspaceAdminSummary,
  compareWorkspaces,
  isAddWorkspaceRequest,
  isRenameWorkspaceRequest,
  matchWorkspaceAdminRoute,
  parseAddWorkspaceRequest,
  parseRenameWorkspaceRequest,
  sniffImageType,
  workspaceAdminAllowFor,
  workspaceAdminRoutes,
  workspaceSortKeyOf,
  workspaceStatusOf,
} from "../server/src/workspace-admin.contract.ts";

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const ascii = (text: string): number[] => Array.from(new TextEncoder().encode(text));

describe("route builders", () => {
  test("every builder names its path under the workspace root, each segment encoded once", () => {
    expect(SPEC_API_ROOT).toBe("/api/workspaces");
    expect(workspaceAdminRoutes.add()).toBe("/api/workspaces");
    expect(workspaceAdminRoutes.rename("alpha")).toBe("/api/workspaces/alpha");
    expect(workspaceAdminRoutes.remove("alpha")).toBe("/api/workspaces/alpha");
    expect(workspaceAdminRoutes.rescan("alpha")).toBe("/api/workspaces/alpha/rescan");
    expect(workspaceAdminRoutes.image("alpha", "logo")).toBe("/api/workspaces/alpha/images/logo");
    expect(workspaceAdminRoutes.image("a b", "screenshot")).toBe("/api/workspaces/a%20b/images/screenshot");
    expect(workspaceAdminRoutes.imageUrl("alpha", "logo", "3f2b")).toBe("/api/workspaces/alpha/images/logo?v=3f2b");
  });

  test("the matcher finds each built path with its method and decoded params", () => {
    expect(matchWorkspaceAdminRoute(workspaceAdminRoutes.add(), "POST")).toEqual({ route: "add", params: {} });
    expect(matchWorkspaceAdminRoute(workspaceAdminRoutes.rename("a b"), "PATCH")).toEqual({ route: "rename", params: { ws: "a b" } });
    expect(matchWorkspaceAdminRoute(workspaceAdminRoutes.remove("alpha"), "DELETE")).toEqual({ route: "remove", params: { ws: "alpha" } });
    expect(matchWorkspaceAdminRoute(workspaceAdminRoutes.rescan("alpha"), "POST")).toEqual({ route: "rescan", params: { ws: "alpha" } });
    const image = workspaceAdminRoutes.image("alpha", "screenshot");
    expect(matchWorkspaceAdminRoute(image, "PUT")).toEqual({ route: "putImage", params: { ws: "alpha", kind: "screenshot" } });
    expect(matchWorkspaceAdminRoute(image, "GET")).toEqual({ route: "getImage", params: { ws: "alpha", kind: "screenshot" } });
    expect(matchWorkspaceAdminRoute(image, "HEAD")).toEqual({ route: "getImage", params: { ws: "alpha", kind: "screenshot" } });
  });

  test("the list GET, other methods, unknown kinds and foreign paths are no admin route", () => {
    expect(matchWorkspaceAdminRoute("/api/workspaces", "GET")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/workspaces/alpha", "GET")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/workspaces/alpha/rescan", "GET")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/workspaces/alpha/images/banner", "PUT")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/workspaces/alpha/dashboard", "POST")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/workspaces//rescan", "POST")).toBeNull();
    expect(matchWorkspaceAdminRoute("/api/settings", "POST")).toBeNull();
  });

  test("the Allow table names every method of each path, null off the admin paths", () => {
    expect(workspaceAdminAllowFor("/api/workspaces")).toBe("GET, HEAD, POST");
    expect(workspaceAdminAllowFor("/api/workspaces/alpha")).toBe("PATCH, DELETE");
    expect(workspaceAdminAllowFor("/api/workspaces/alpha/rescan")).toBe("POST");
    expect(workspaceAdminAllowFor("/api/workspaces/alpha/images/logo")).toBe("GET, HEAD, PUT");
    expect(workspaceAdminAllowFor("/api/workspaces/alpha/images/banner")).toBeNull();
    expect(workspaceAdminAllowFor("/api/workspaces/alpha/dashboard")).toBeNull();
  });

  test("the route table lists each route once with its documented statuses", () => {
    const statuses = Object.fromEntries(WORKSPACE_ADMIN_ROUTE_TABLE.map((entry) => [entry.route, entry.statuses]));
    expect(Object.keys(statuses).sort()).toEqual(["add", "getImage", "putImage", "remove", "rename", "rescan"]);
    expect(statuses.add).toEqual([201, 400, 403, 405, 422]);
    expect(statuses.rename).toEqual([200, 400, 403, 404, 405]);
    expect(statuses.rescan).toEqual([200, 403, 404, 405]);
    expect(statuses.remove).toEqual([204, 403, 404, 405]);
    expect(statuses.putImage).toEqual([200, 403, 404, 405, 413, 415]);
    expect(statuses.getImage).toEqual([200, 304, 403, 404, 405]);
  });
});

describe("images", () => {
  test("kinds, types and the size limit", () => {
    expect(IMAGE_KINDS).toEqual(["logo", "screenshot"]);
    expect(IMAGE_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(Object.keys(IMAGE_TYPES).sort()).toEqual(["jpeg", "png", "webp"]);
    expect(IMAGE_TYPES.png).toMatchObject({ contentType: "image/png", ext: "png" });
    expect(IMAGE_TYPES.jpeg).toMatchObject({ contentType: "image/jpeg", ext: "jpg" });
    expect(IMAGE_TYPES.webp).toMatchObject({ contentType: "image/webp", ext: "webp" });
  });

  test("sniffImageType reads the three magic headers", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13))).toBe("png");
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 16))).toBe("jpeg");
    expect(sniffImageType(bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 ")))).toBe("webp");
  });

  test("sniffImageType refuses SVG, text, truncated headers and garbage", () => {
    const svg = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    expect(sniffImageType(new TextEncoder().encode(svg))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("just some text"))).toBeNull();
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(bytes(...ascii("RIFF"), 0x24, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
    expect(sniffImageType(bytes(...ascii("RIFF"), 0x24, 0, 0))).toBeNull();
    expect(sniffImageType(bytes(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});

describe("status", () => {
  test("missing when unreadable, empty with zero specs, ok otherwise", () => {
    expect(workspaceStatusOf(false, null)).toBe("missing");
    expect(workspaceStatusOf(false, 3)).toBe("missing");
    expect(workspaceStatusOf(true, 0)).toBe("empty");
    expect(workspaceStatusOf(true, null)).toBe("empty");
    expect(workspaceStatusOf(true, 4)).toBe("ok");
  });
});

describe("sort", () => {
  type Row = Pick<WorkspaceAdminSummary, "slug" | "name" | "status">;
  const rows: Row[] = [
    { slug: "delta", name: "delta", status: "ok" },
    { slug: "alpha", name: "Alpha", status: "empty" },
    { slug: "charlie", name: "charlie", status: "missing" },
    { slug: "bravo", name: "Bravo", status: "ok" },
    { slug: "echo", name: "echo", status: "missing" },
  ];
  const order = (key: (typeof WORKSPACE_SORT_KEYS)[number]): string[] => [...rows].sort(compareWorkspaces(key)).map((r) => r.slug);

  test("keys and default", () => {
    expect(WORKSPACE_SORT_KEYS).toEqual(["name", "status", "added"]);
    expect(DEFAULT_WORKSPACE_SORT).toBe("added");
    expect(workspaceSortKeyOf("status")).toBe("status");
    expect(workspaceSortKeyOf("bogus")).toBe("added");
    expect(workspaceSortKeyOf(null)).toBe("added");
  });

  test("name ignores case, added keeps the registry order, status runs missing, empty, ok with ties by name", () => {
    expect(order("name")).toEqual(["alpha", "bravo", "charlie", "delta", "echo"]);
    expect(order("added")).toEqual(["delta", "alpha", "charlie", "bravo", "echo"]);
    expect(order("status")).toEqual(["charlie", "echo", "alpha", "bravo", "delta"]);
  });
});

describe("request bodies", () => {
  test("add: a path string, an optional name; a blank path is invalid-path, a wrong shape invalid-body", () => {
    expect(parseAddWorkspaceRequest({ path: "/repos/alpha" })).toEqual({ ok: true, value: { path: "/repos/alpha", name: null } });
    expect(parseAddWorkspaceRequest({ path: "/repos/alpha", name: "  Alpha  " })).toEqual({ ok: true, value: { path: "/repos/alpha", name: "Alpha" } });
    expect(parseAddWorkspaceRequest({ path: "/repos/alpha", name: "   " })).toEqual({ ok: true, value: { path: "/repos/alpha", name: null } });
    expect(parseAddWorkspaceRequest({ path: "" })).toEqual({ ok: false, error: "invalid-path" });
    expect(parseAddWorkspaceRequest({ path: "   " })).toEqual({ ok: false, error: "invalid-path" });
    expect(parseAddWorkspaceRequest({})).toEqual({ ok: false, error: "invalid-body" });
    expect(parseAddWorkspaceRequest({ path: 7 })).toEqual({ ok: false, error: "invalid-body" });
    expect(parseAddWorkspaceRequest({ path: "/repos/alpha", name: 3 })).toEqual({ ok: false, error: "invalid-body" });
    expect(parseAddWorkspaceRequest(null)).toEqual({ ok: false, error: "invalid-body" });
    expect(parseAddWorkspaceRequest("/repos/alpha")).toEqual({ ok: false, error: "invalid-body" });
    expect(isAddWorkspaceRequest({ path: "/repos/alpha" })).toBe(true);
    expect(isAddWorkspaceRequest({ path: " " })).toBe(false);
  });

  test("rename: a trimmed non-empty name; blank is invalid-name, a wrong shape invalid-body", () => {
    expect(parseRenameWorkspaceRequest({ name: "  Alpha " })).toEqual({ ok: true, value: { name: "Alpha" } });
    expect(parseRenameWorkspaceRequest({ name: "" })).toEqual({ ok: false, error: "invalid-name" });
    expect(parseRenameWorkspaceRequest({ name: " \t " })).toEqual({ ok: false, error: "invalid-name" });
    expect(parseRenameWorkspaceRequest({})).toEqual({ ok: false, error: "invalid-body" });
    expect(parseRenameWorkspaceRequest({ name: ["a"] })).toEqual({ ok: false, error: "invalid-body" });
    expect(parseRenameWorkspaceRequest([])).toEqual({ ok: false, error: "invalid-body" });
    expect(isRenameWorkspaceRequest({ name: "Alpha" })).toBe(true);
    expect(isRenameWorkspaceRequest({ name: "  " })).toBe(false);
  });
});
