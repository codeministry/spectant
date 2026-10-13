// The library catalog route (spec 017 T16, ISC-156): `GET|HEAD /api/workspaces/:ws/library` answered by `dashboardApi`
// from the files of a registered workspace: core's `readCatalog` as it is, metadata only, with the JSON conventions of
// `api.ts` (strong ETag, 304, HEAD, 405 + Allow, 404 unknown slug, 409 with the summary for an unreadable folder).
//
// Fixture: a temp copy of `core/fixtures/library` (every zone, a prototype, an archived spec), a workspace without
// `specs/` (the empty state) and a registered folder that is removed (409). Nothing in a workspace is ever written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCatalog } from "../core/src/library.ts";
import { dashboardApi } from "../server/src/api.ts";
import type { ApiHandler } from "../server/src/http.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { type WorkspaceRouteResponses, allowForWorkspace, workspaceRoutes } from "../server/src/spec-routes.contract.ts";

const LIBRARY = join(import.meta.dir, "..", "core", "fixtures", "library");
const HOST = { Host: "127.0.0.1:7717" };

let root: string;
let shelf: string;
let bare: string;
let gone: string;
let registry: Registry;
let api: ApiHandler;

/** Every file under `dir` with its size, mtime and sha256, so any write shows. */
function fingerprint(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const path = join(d, name);
      const st = statSync(path, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(path);
      else out.push(`${path.slice(dir.length)} ${st.size} ${st.mtimeMs} ${new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex")}`);
    }
  };
  walk(dir);
  return out;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-library-"));
  shelf = join(root, "shelf");
  bare = join(root, "bare");
  gone = join(root, "gone");
  cpSync(LIBRARY, shelf, { recursive: true });
  mkdirSync(bare);
  writeFileSync(join(bare, "README.md"), "# A workspace without specs\n");
  mkdirSync(gone);
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  registry.add(shelf);
  registry.add(bare);
  registry.add(gone);
  rmSync(gone, { recursive: true });
  api = dashboardApi({ registry, services: () => Promise.resolve([]) });
});

afterAll(() => {
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

async function call(path: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  const url = new URL(`http://127.0.0.1:7717${path}`);
  const req = new Request(url.href, { method: init.method ?? "GET", headers: { ...HOST, ...init.headers } });
  const res = await api(req, url);
  if (res === null) throw new Error(`the workspace routes declined ${path}`);
  return res;
}

describe("GET /api/workspaces/:ws/library", () => {
  test("catalog: 200, the body exactly readCatalog over the workspace, metadata only, the archive left out", async () => {
    const res = await call(workspaceRoutes.library("shelf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(await readCatalog(shelf)));
    const catalog = JSON.parse(text) as WorkspaceRouteResponses["library"];
    expect(catalog.docs.length).toBeGreaterThan(0);
    // Every type of the fixture is present, each document once, with its spec, title and time.
    expect(new Set(catalog.docs.map((d) => d.type))).toEqual(
      new Set(["spec", "plan", "tasks", "design", "context", "artifact", "evidence", "prototype", "constitution", "tech", "tldr", "idea"]),
    );
    expect(new Set(catalog.docs.map((d) => d.path)).size).toBe(catalog.docs.length);
    for (const doc of catalog.docs) {
      expect(doc.title).not.toBe("");
      // A `missing` entry (ISC-155.2) names a file that does not exist, so it has no time.
      if (doc.state === "missing") expect(doc.modified).toBeNull();
      else expect(doc.modified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(doc.spec === "workspace" || /^\d{3}-/.test(doc.spec)).toBe(true);
    }
    expect(catalog.docs.filter((d) => d.type === "evidence" && d.spec === "001-lighthouse-map").map((d) => d.path)).toEqual([
      "001-lighthouse-map/.evidence/ISC-1/map.png",
      "001-lighthouse-map/.evidence/ISC-2/notes.md",
      "001-lighthouse-map/.evidence/summary.md",
    ]);
    // Metadata only: no document's text, no absolute path, nothing from specs/archive/.
    expect(text).not.toContain(root);
    expect(text).not.toContain("archive/");
    expect(text).not.toContain("000-first-light");
    // The group heads carry a spec's goal and first approach paragraph as their own short Markdown (ISC-157); the
    // document entries carry no text.
    const entries = JSON.stringify(catalog.docs);
    const plan = readFileSync(join(shelf, "specs", "001-lighthouse-map", "plan.md"), "utf8").split("\n").filter((l) => l.length > 40);
    for (const line of plan) expect(entries).not.toContain(line);
  });

  test("a workspace without documents: 200 and an empty catalog", async () => {
    const res = await call(workspaceRoutes.library("bare"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ docs: [], groups: [], fog: [], missing: 0, stale: 0 });
  });

  test("304 on a matching If-None-Match; HEAD gets the headers without a body", async () => {
    const path = workspaceRoutes.library("shelf");
    const etag = (await call(path)).headers.get("etag") ?? "";
    const again = await call(path, { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const head = await call(path, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(etag);
    expect(await head.text()).toBe("");
  });

  test("the ETag follows the files: an edited spec.md and a new evidence file are each a new tag", async () => {
    const path = workspaceRoutes.library("shelf");
    const before = (await call(path)).headers.get("etag") ?? "";
    const spec = join(shelf, "specs", "004-fog-horn", "spec.md");
    const original = readFileSync(spec);
    const stat = statSync(spec);
    try {
      writeFileSync(spec, `${original.toString("utf8")}\n`);
      utimesSync(spec, stat.atime, new Date(stat.mtimeMs + 60_000));
      const edited = await call(path, { headers: { "If-None-Match": before } });
      expect(edited.status).toBe(200);
      const tag = edited.headers.get("etag") ?? "";
      expect(tag).not.toBe(before);
      mkdirSync(join(shelf, "specs", "004-fog-horn", ".evidence"));
      writeFileSync(join(shelf, "specs", "004-fog-horn", ".evidence", "proof.md"), "# Proof\n");
      const added = await call(path, { headers: { "If-None-Match": tag } });
      expect(added.status).toBe(200);
      const catalog = (await added.json()) as WorkspaceRouteResponses["library"];
      expect(catalog.docs.find((d) => d.path === "004-fog-horn/.evidence/proof.md")?.title).toBe("Proof");
    } finally {
      rmSync(join(shelf, "specs", "004-fog-horn", ".evidence"), { recursive: true, force: true });
      writeFileSync(spec, original);
      utimesSync(spec, stat.atime, stat.mtime);
    }
  });

  test("404 for an unknown workspace, 409 for an unreadable one, 405 with Allow for another method, 403 off loopback", async () => {
    const missing = await call(workspaceRoutes.library("nowhere"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not-found" });
    const unreadable = await call(workspaceRoutes.library("gone"));
    expect(unreadable.status).toBe(409);
    expect(await unreadable.json()).toEqual({ slug: "gone", name: "gone", pathTail: "gone", readable: false, error: "missing", counts: null });
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await call(workspaceRoutes.library("shelf"), { method });
      expect({ method, status: res.status, allow: res.headers.get("allow") }).toEqual({ method, status: 405, allow: allowForWorkspace("library") });
      expect(await res.json()).toEqual({ error: "method-not-allowed" });
    }
    expect((await call(workspaceRoutes.library("shelf"), { headers: { Host: "evil.example" } })).status).toBe(403);
  });

  test("read-only: every answer above leaves the workspaces byte-identical", async () => {
    const before = [fingerprint(shelf), fingerprint(bare)];
    for (const ws of ["shelf", "bare", "gone"]) {
      await call(workspaceRoutes.library(ws));
      await call(workspaceRoutes.library(ws), { method: "HEAD" });
      await call(workspaceRoutes.library(ws), { method: "POST" });
    }
    expect([fingerprint(shelf), fingerprint(bare)]).toEqual(before);
  });
});
