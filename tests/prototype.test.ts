// The prototype route (spec 017 T20, ISC-159): `GET|HEAD /proto/:ws/:spec/:folder/*` served by `prototypeApi` through
// the loopback server, outside `/api/`, so a page and the files it links by relative URL load from one folder.
// This file holds the route's smoke test (`-t smoke`); the confinement probes (`-t traversal`, T21) and the CSP probes
// (`-t csp`, T23) join it later.
//
// Fixture: a temp copy of `core/fixtures/library` registered as a workspace (002's `prototype/board` with two pages,
// a stylesheet, a script and an image; 001's prototype directly in `.design/prototype/`). Nothing is ever written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { type RunningServer, serve } from "../server/src/http.ts";
import { prototypeApi } from "../server/src/prototype.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { PROTOTYPE_ALLOW, PROTOTYPE_CSP, prototypeRoute } from "../server/src/spec-routes.contract.ts";

const LIBRARY = join(import.meta.dir, "..", "core", "fixtures", "library");

let root: string;
let registry: Registry;
let server: RunningServer;
let ws: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-prototype-"));
  const shelf = join(root, "shelf");
  cpSync(LIBRARY, shelf, { recursive: true });
  registry = openRegistry(mkdtempSync(join(root, "data-")));
  ws = registry.add(shelf).slug;
  writeFileSync(join(root, "index.html"), "<!doctype html><title>app</title>");
  const manifest: EmbeddedManifest = {
    generatedAt: "2026-10-13T10:00:00.000Z",
    assets: [{ ...embeddedAssetFor("index.html"), file: join(root, "index.html") }],
    index: join(root, "index.html"),
  };
  server = serve({ manifest, port: 0, api: prototypeApi({ registry }) });
});

afterAll(() => {
  server.stop();
  registry.close();
  rmSync(root, { recursive: true, force: true });
});

const get = (path: string, init: RequestInit = {}): Promise<Response> => fetch(new URL(path, server.url), init);

describe("prototype route smoke", () => {
  test("smoke: a page and the files it links relatively load with their types, inline, nosniff and the CSP", async () => {
    const page = prototypeRoute(ws, "002-tide-board", "prototype/board", "index.html");
    const res = await get(page);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
    const html = await res.text();
    expect(html).toContain('href="styles.css"');

    // Relative links resolve against the page's own URL, without any rewriting.
    const expected: Record<string, string> = {
      "styles.css": "text/css; charset=utf-8",
      "app.js": "text/javascript; charset=utf-8",
      "detail.html": "text/html; charset=utf-8",
      "img/badge.png": "image/png",
    };
    for (const [href, type] of Object.entries(expected)) {
      const linked = await get(new URL(href, new URL(page, server.url)).href);
      expect(linked.status).toBe(200);
      expect(linked.headers.get("Content-Type")).toBe(type);
      expect(linked.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
      await linked.arrayBuffer();
    }

    // A prototype directly in `.design/prototype/` has the folder `prototype`.
    const root = await get(prototypeRoute(ws, "001-lighthouse-map", "prototype", "index.html"));
    expect(root.status).toBe(200);
    await root.arrayBuffer();
  });

  test("smoke: HEAD, 304, 405, 404 and 403 answer as the stub does, each with the CSP", async () => {
    const page = prototypeRoute(ws, "002-tide-board", "prototype/board", "styles.css");
    const head = await get(page, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const etag = head.headers.get("ETag");
    expect(etag).not.toBeNull();
    const again = await get(page, { headers: { "If-None-Match": etag ?? "" } });
    expect(again.status).toBe(304);

    const post = await get(page, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("Allow")).toBe(PROTOTYPE_ALLOW);

    const answers: Array<[string, number]> = [
      [prototypeRoute(ws, "002-tide-board", "prototype/board", "missing.html"), 404],
      [prototypeRoute("no-such-workspace", "002-tide-board", "prototype/board", "index.html"), 404],
      [prototypeRoute(ws, "009-no-such-spec", "prototype/board", "index.html"), 404],
      [prototypeRoute(ws, "000-first-light", "prototype", "index.html"), 404],
      [`/proto/${ws}/002-tide-board/prototype%2Fboard/..%252F..%252Fspec.md`, 403],
      [`/proto/${ws}/002-tide-board/prototype%2Fboard/%2Fetc%2Fpasswd`, 403],
      [`/proto/${ws}/002-tide-board/artifacts/index.html`, 404],
    ];
    for (const [path, status] of answers) {
      const res = await get(path);
      expect({ path, status: res.status }).toEqual({ path, status });
      expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
      await res.arrayBuffer();
    }

    const foreign = await get(page, { headers: { Origin: "https://example.com" } });
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
  });
});
