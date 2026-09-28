// Loopback server over an embedded manifest (T10, ISC-8). The manifest is built here from a temp dir, the way
// `server/embedded.gen.ts` would bind it, so the suite runs on a fresh checkout without any web build.
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CACHE_CONTROL, type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { DEFAULT_PORT, LOOPBACK_HOST, serve } from "../server/src/http.ts";

const INDEX_HTML = "<!doctype html><title>spectant</title><script src=\"/main-ABCDEFGH.js\"></script>";
const MAIN_JS = "console.log('spectant');\n";
const STYLES_CSS = "body{margin:0}\n";

let dir: string;
let manifest: EmbeddedManifest;

/** A manifest whose `file` fields are absolute temp paths; only a test may do this, the generator never does. */
function buildManifest(root: string, generatedAt = "2026-09-28T10:00:00.000Z"): EmbeddedManifest {
  const files: Record<string, string> = {
    "index.html": INDEX_HTML,
    "main-ABCDEFGH.js": MAIN_JS,
    "styles-12345678.css": STYLES_CSS,
  };
  const assets = Object.entries(files)
    .map(([rel, body]) => {
      writeFileSync(join(root, rel), body);
      return { ...embeddedAssetFor(rel), file: join(root, rel) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  return { generatedAt, assets, index: join(root, "index.html") };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "spectant-http-"));
  manifest = buildManifest(dir);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const running: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const server of running.splice(0)) server.stop();
});

function start(api?: Parameters<typeof serve>[0]["api"]) {
  const server = serve({ manifest, port: 0, api });
  running.push(server);
  return server;
}

describe("serve", () => {
  test("binds the loopback host on an ephemeral port and reports its url", () => {
    expect(LOOPBACK_HOST).toBe("127.0.0.1");
    expect(DEFAULT_PORT).toBe(7717);
    const server = start();
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
  });

  test("/ returns index.html as no-cache html", async () => {
    const server = start();
    const res = await fetch(server.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL.mutable);
    expect(await res.text()).toBe(INDEX_HTML);
  });

  test("a hashed script is served as javascript with the immutable cache header and a weak ETag", async () => {
    const server = start();
    const res = await fetch(`${server.url}main-ABCDEFGH.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL.immutable);
    expect(res.headers.get("etag")).toMatch(/^W\/"[^"]+"$/);
    expect(await res.text()).toBe(MAIN_JS);
  });

  test("a hashed stylesheet is served as css", async () => {
    const server = start();
    const res = await fetch(`${server.url}styles-12345678.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL.immutable);
    expect(await res.text()).toBe(STYLES_CSS);
  });

  test("workspace deep links fall back to index.html", async () => {
    const server = start();
    for (const path of ["w/example.com", "w/x/s/001"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL.mutable);
      expect(await res.text()).toBe(INDEX_HTML);
    }
  });

  test("a missing asset under a deep link is a 404, never html", async () => {
    const server = start();
    const res = await fetch(`${server.url}w/x/main-ABC.js`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toStartWith("text/plain");
  });

  test("an unknown path outside the SPA routes is a plain 404", async () => {
    const server = start();
    for (const path of ["nope", "main-ZZZZZZZZ.js", "api"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toStartWith("text/plain");
    }
  });

  test("request paths never reach the filesystem outside the manifest", async () => {
    const server = start();
    writeFileSync(join(dir, "secret.txt"), "not embedded");
    for (const path of ["secret.txt", "%2e%2e/secret.txt", "w/../secret.txt"]) {
      const res = await fetch(`${server.url}${path}`);
      expect(await res.text()).not.toContain("not embedded");
    }
  });

  test("/api/ without a handler is a JSON 404", async () => {
    const server = start();
    const res = await fetch(`${server.url}api/anything`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toStartWith("application/json");
    expect(await res.json()).toEqual({ error: "not found" });
  });

  test("/api/ goes to the handler for every method, and a null answer is a JSON 404", async () => {
    const seen: string[] = [];
    const server = start((req, url) => {
      seen.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/api/anything") return Response.json({ ok: true });
      return null;
    });
    const hit = await fetch(`${server.url}api/anything`);
    expect(hit.status).toBe(200);
    expect(await hit.json()).toEqual({ ok: true });

    const put = await fetch(`${server.url}api/anything`, { method: "PUT", body: "{}" });
    expect(put.status).toBe(200);

    const miss = await fetch(`${server.url}api/other`);
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ error: "not found" });
    expect(seen).toEqual(["GET /api/anything", "PUT /api/anything", "GET /api/other"]);
  });

  test("an async handler is awaited", async () => {
    const server = start(() => new Response("late", { status: 202 }));
    const res = await fetch(`${server.url}api/x`);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe("late");
  });

  test("If-None-Match round-trips to 304 for an asset and for the SPA fallback", async () => {
    const server = start();
    for (const path of ["main-ABCDEFGH.js", "", "w/x"]) {
      const first = await fetch(`${server.url}${path}`);
      const etag = first.headers.get("etag");
      expect(etag).toBeTruthy();
      await first.arrayBuffer();
      const again = await fetch(`${server.url}${path}`, { headers: { "If-None-Match": `"other", ${etag ?? ""}` } });
      expect(again.status).toBe(304);
      expect(again.headers.get("etag")).toBe(etag);
      expect(await again.text()).toBe("");
      const stale = await fetch(`${server.url}${path}`, { headers: { "If-None-Match": 'W/"stale"' } });
      expect(stale.status).toBe(200);
      await stale.arrayBuffer();
    }
  });

  test("the ETag changes with a new build even when path and size stay the same", async () => {
    const other = mkdtempSync(join(tmpdir(), "spectant-http-next-"));
    try {
      const a = start();
      const b = serve({ manifest: buildManifest(other, "2026-09-29T10:00:00.000Z"), port: 0 });
      running.push(b);
      const etagA = (await fetch(a.url)).headers.get("etag");
      const etagB = (await fetch(b.url)).headers.get("etag");
      expect(etagA).toBeTruthy();
      expect(etagB).toBeTruthy();
      expect(etagA).not.toBe(etagB);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("POST outside the API is 405 with an Allow header", async () => {
    const server = start();
    const res = await fetch(server.url, { method: "POST", body: "x" });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });

  test("HEAD returns the headers without a body", async () => {
    const server = start();
    const res = await fetch(`${server.url}main-ABCDEFGH.js`, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL.immutable);
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(MAIN_JS)));
    expect(await res.text()).toBe("");
  });

  test("stop() frees the port", async () => {
    const server = serve({ manifest, port: 0 });
    const { port } = server;
    expect((await fetch(server.url)).status).toBe(200);
    server.stop();
    const again = serve({ manifest, port });
    running.push(again);
    expect(again.port).toBe(port);
    expect((await fetch(again.url)).status).toBe(200);
  });

  test("a busy port throws instead of falling forward (fallback belongs to the CLI)", () => {
    const server = start();
    expect(() => serve({ manifest, port: server.port })).toThrow();
  });
});
