// The prototype route (spec 017 T20, ISC-159): `GET|HEAD /proto/:ws/:spec/:folder/*` served by `prototypeApi` through
// the loopback server, outside `/api/`, so a page and the files it links by relative URL load from one folder.
// This file holds the route's smoke test (`-t smoke`), the opaque-origin font rule (`-t fonts`), the opaque-origin
// module rule (`-t module`, T58, ISC-159.3, one check in headless Chromium), the confinement probes (`-t traversal`, T21, ISC-159.1) and the CSP
// probes (`-t csp`, T23, ISC-159.2).
//
// Fixture: a temp copy of `core/fixtures/library` registered as a workspace (002's `prototype/board` with two pages,
// a stylesheet, a script and an image; 001's prototype directly in `.design/prototype/`), plus one font the `fonts`
// probes add to the copy and one page with external sources the `csp` probes add. The `traversal` probes register a
// second copy of their own with marker files and symlinks out. The committed fixture never changes, and the route
// itself never writes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

type RawAnswer = { status: number; headers: Headers; body: string };

/**
 * One GET with the request target sent byte for byte, as `curl --path-as-is` would: `fetch` normalises `..`,
 * `%2e%2e` and `\` in the path before sending, so a traversal through it would never reach the server as written.
 * The answer is complete at its `Content-Length` (Bun keeps a file answer's socket open despite `Connection: close`).
 */
function raw(target: string, host?: string): Promise<RawAnswer> {
  const { hostname, port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname);
    let received = Buffer.alloc(0);
    const parse = (final: boolean): RawAnswer | null => {
      const split = received.indexOf("\r\n\r\n");
      if (split < 0) return null;
      const [statusLine = "", ...lines] = received.subarray(0, split).toString("latin1").split("\r\n");
      const headers = new Headers();
      for (const line of lines) {
        const colon = line.indexOf(":");
        headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
      const body = received.subarray(split + 4);
      const length = headers.get("Content-Length");
      if (!final && (length === null || body.length < Number(length))) return null;
      return { status: Number(statusLine.split(" ")[1]), headers, body: body.toString("latin1") };
    };
    const settle = (answer: RawAnswer | null): void => {
      if (answer === null) return;
      socket.destroy();
      resolve(answer);
    };
    socket.on("connect", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: ${host ?? `${hostname}:${port}`}\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      settle(parse(false));
    });
    socket.on("error", reject);
    socket.on("end", () => settle(parse(true) ?? { status: 0, headers: new Headers(), body: "" }));
  });
}

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
      // An archived spec's prototype opens like an active one (spec 034, ISC-187.1).
      [prototypeRoute(ws, "000-first-light", "prototype", "index.html"), 200],
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

describe("prototype route fonts", () => {
  // The sandboxed page runs on an opaque origin, so its `@font-face` fetch (CORS mode) sends `Origin: null` with
  // `Sec-Fetch-Mode: cors` and `Sec-Fetch-Dest: font` (T58: fonts follow the module rule, without them it is 403).
  const FONT = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0]);
  const board = (file: string): string => prototypeRoute(ws, "002-tide-board", "prototype/board", file);
  const font = (): string => board("fonts/tide.woff2");
  const asFont = { Origin: "null", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "font" };

  beforeAll(() => {
    const dir = join(root, "shelf", "specs", "002-tide-board", ".design", "prototype", "board", "fonts");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tide.woff2"), FONT);
  });

  test("fonts: Origin null gets a font with Access-Control-Allow-Origin *, Vary, the CSP and nosniff; 304 too", async () => {
    const res = await get(font(), { headers: asFont });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("font/woff2");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Vary")).toBe("Origin, Sec-Fetch-Mode, Sec-Fetch-Dest");
    expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(FONT);
    const etag = res.headers.get("ETag") ?? "";
    const again = await get(font(), { headers: { ...asFont, "If-None-Match": etag } });
    expect([again.status, again.headers.get("Access-Control-Allow-Origin")]).toEqual([304, "*"]);

    // Without an Origin (the app itself) the font loads as before, without the CORS header.
    const plain = await get(font());
    expect([plain.status, plain.headers.get("Access-Control-Allow-Origin"), plain.headers.get("Vary")]).toEqual([200, null, "Origin, Sec-Fetch-Mode, Sec-Fetch-Dest"]);
    await plain.arrayBuffer();
  });

  test("fonts: a foreign Origin is 403 even for a font", async () => {
    for (const origin of ["https://evil.example", "http://evil.example", "null2"]) {
      const res = await get(font(), { headers: { Origin: origin } });
      expect({ origin, status: res.status, acao: res.headers.get("Access-Control-Allow-Origin") }).toEqual({ origin, status: 403, acao: null });
      expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await res.arrayBuffer();
    }
  });

  test("fonts: Origin null without Sec-Fetch cors and a script, style or font destination is 403 without the CORS header for HTML, styles, scripts, images, fonts, misses and other methods", async () => {
    const cases: Array<[string, RequestInit]> = [
      [board("index.html"), {}],
      [board("styles.css"), {}],
      [board("app.js"), {}],
      [board("img/badge.png"), {}],
      [font(), {}],
      [board("fonts/missing.woff2"), {}],
      [prototypeRoute("no-such-workspace", "002-tide-board", "prototype/board", "fonts/tide.woff2"), {}],
      [`/proto/${ws}/002-tide-board/prototype%2Fboard/..%252F..%252Fspec.md`, {}],
      [font(), { method: "POST" }],
    ];
    for (const [path, init] of cases) {
      const res = await get(path, { ...init, headers: { Origin: "null" } });
      expect({ path, status: res.status, acao: res.headers.get("Access-Control-Allow-Origin") }).toEqual({ path, status: 403, acao: null });
      expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await res.arrayBuffer();
    }
  });
});

describe("prototype route module", () => {
  // The sandboxed page runs on an opaque origin, so `<script type="module">`, every `import` and every `@font-face`
  // source are fetched in CORS mode with `Origin: null`; Chromium sends no Referer for the document's own requests,
  // but always the fetch metadata `Sec-Fetch-Mode: cors` and `Sec-Fetch-Dest` (T58, ISC-159.3). The committed
  // fixture's `board/index.html` loads `main.js` as a module, which imports `./tide.mjs`.
  const board = (file: string): string => prototypeRoute(ws, "002-tide-board", "prototype/board", file);
  const opaque = (dest: string | null, mode: string | null = "cors", extra: Record<string, string> = {}): RequestInit => ({
    headers: {
      Origin: "null",
      ...(mode === null ? {} : { "Sec-Fetch-Mode": mode }),
      ...(dest === null ? {} : { "Sec-Fetch-Dest": dest }),
      ...extra,
    },
  });

  test("module: the page names a module script that imports an .mjs file", async () => {
    const page = await (await get(board("index.html"))).text();
    expect(page).toContain('<script type="module" src="main.js"></script>');
    const main = await (await get(board("main.js"))).text();
    expect(main).toContain('from "./tide.mjs"');
  });

  test("module: a module script, its .mjs import, a stylesheet and a font load for Origin null as script, style and font fetches", async () => {
    const cases: Array<[string, string, string, string]> = [
      ["module script", board("main.js"), "script", "text/javascript; charset=utf-8"],
      [".mjs import", board("tide.mjs"), "script", "text/javascript; charset=utf-8"],
      ["stylesheet", board("styles.css"), "style", "text/css; charset=utf-8"],
      ["font", board("fonts/manrope-variable.woff2"), "font", "font/woff2"],
    ];
    for (const [name, path, dest, type] of cases) {
      const res = await get(path, opaque(dest));
      const seen = {
        name,
        status: res.status,
        type: res.headers.get("Content-Type"),
        acao: res.headers.get("Access-Control-Allow-Origin"),
        vary: res.headers.get("Vary"),
        csp: res.headers.get("Content-Security-Policy"),
        nosniff: res.headers.get("X-Content-Type-Options"),
      };
      const vary = "Origin, Sec-Fetch-Mode, Sec-Fetch-Dest";
      expect(seen).toEqual({ name, status: 200, type, acao: "*", vary, csp: PROTOTYPE_CSP, nosniff: "nosniff" });
      const etag = res.headers.get("ETag") ?? "";
      await res.arrayBuffer();
      const again = await get(path, opaque(dest, "cors", { "If-None-Match": etag }));
      expect({ name, status: again.status, acao: again.headers.get("Access-Control-Allow-Origin") }).toEqual({ name, status: 304, acao: "*" });
    }
  });

  test("module: a fetch(), any other destination or mode and missing fetch metadata stay 403 for Origin null", async () => {
    const metadata: Array<[string | null, string | null]> = [
      ["empty", "cors"],
      ["document", "cors"],
      ["iframe", "cors"],
      ["image", "cors"],
      ["image", "no-cors"],
      ["script", "no-cors"],
      ["script", "navigate"],
      ["script", "same-origin"],
      ["font", null],
      [null, "cors"],
      [null, null],
      ["Script", "cors"],
      ["script", "CORS"],
    ];
    const files = [board("main.js"), board("tide.mjs"), board("app.js"), board("styles.css"), board("img/badge.png"), board("fonts/manrope-variable.woff2")];
    for (const [dest, mode] of metadata) {
      for (const path of files) {
        const res = await get(path, opaque(dest, mode));
        await res.arrayBuffer();
        const seen = { dest, mode, path, status: res.status, acao: res.headers.get("Access-Control-Allow-Origin") };
        expect(seen).toEqual({ dest, mode, path, status: 403, acao: null });
      }
    }
  });

  test("module: an HTML page is 403 for Origin null even as a script, style or font fetch, misses and other methods too", async () => {
    const cases: Array<[string, RequestInit]> = [
      [board("index.html"), opaque("script")],
      [board("index.html"), opaque("style")],
      [board("detail.html"), opaque("font")],
      [board("index.html"), opaque("document", "navigate")],
      [board("missing.mjs"), opaque("script")],
      [prototypeRoute("no-such-workspace", "002-tide-board", "prototype/board", "main.js"), opaque("script")],
      [`/proto/${ws}/002-tide-board/prototype%2Fboard/..%252F..%252Fspec.md`, opaque("script")],
      [board("main.js"), { ...opaque("script"), method: "POST" }],
    ];
    for (const [path, init] of cases) {
      const res = await get(path, init);
      await res.arrayBuffer();
      const seen = { path, status: res.status, acao: res.headers.get("Access-Control-Allow-Origin"), csp: res.headers.get("Content-Security-Policy") };
      expect(seen).toEqual({ path, status: 403, acao: null, csp: PROTOTYPE_CSP });
    }
  });

  test("module: in headless Chromium the fixture page runs its module script and .mjs import, no answer is 403", async () => {
    // The repository's pinned Playwright (web's `@playwright/test`), loaded as `scripts/extract-prototype.ts` loads it.
    type Page = {
      on(event: "response", listener: (res: { url(): string; status(): number }) => void): void;
      goto(url: string): Promise<unknown>;
      waitForFunction(fn: string, arg?: unknown, options?: { timeout: number }): Promise<unknown>;
      evaluate<T>(fn: string): Promise<T>;
    };
    type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
    const entry = pathToFileURL(join(import.meta.dir, "..", "web", "node_modules", "@playwright", "test", "index.mjs")).href;
    const pw = (await import(entry)) as { chromium: { launch(o: { headless: boolean }): Promise<Browser> } };
    const browser = await pw.chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const answers: Array<{ path: string; status: number }> = [];
      page.on("response", (res) => answers.push({ path: new URL(res.url()).pathname, status: res.status() }));
      await page.goto(new URL(board("index.html"), server.url).href);
      // `main.js` writes what it imported from `tide.mjs`; the stylesheet's font loads through `@font-face`.
      await page.waitForFunction("document.documentElement.dataset.tide === 'high'", undefined, { timeout: 10_000 });
      await page.waitForFunction("document.fonts.status === 'loaded'", undefined, { timeout: 10_000 });
      const fonts = await page.evaluate<string[]>("[...document.fonts].map((f) => f.family + ':' + f.status)");
      expect(fonts).toContain("Tide Sans:loaded");
      const files = answers.filter((a) => a.path.startsWith("/proto/")).map((a) => a.path.split("/").pop() ?? "");
      expect(files.sort()).toEqual(["app.js", "index.html", "main.js", "manrope-variable.woff2", "styles.css", "tide.mjs"]);
      expect(answers.filter((a) => a.status === 403)).toEqual([]);
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe("prototype route traversal", () => {
  // A second copy of the fixture with a marker beside every place a request must not reach: the spec folder, its
  // `.design/`, a non-prototype folder, another spec's prototype and a folder outside the workspace. Every marker
  // holds `SECRET`; no refused answer may carry it. The symlinks out live only in this temp copy.
  let trail: string;
  let wsT: string;
  let outside: string;
  const SECRET = "SECRET";

  beforeAll(() => {
    trail = join(root, "trail");
    cpSync(LIBRARY, trail, { recursive: true });
    wsT = registry.add(trail).slug;
    outside = join(root, "outside");
    mkdirSync(join(outside, "proto"), { recursive: true });
    mkdirSync(join(outside, "design", "prototype"), { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "OUTSIDE-SECRET");
    writeFileSync(join(outside, "proto", "index.html"), "<p>OUTSIDE-SECRET page</p>");
    writeFileSync(join(outside, "design", "prototype", "index.html"), "<p>OUTSIDE-SECRET design</p>");

    const specs = join(trail, "specs");
    const tide = join(specs, "002-tide-board");
    const board = join(tide, ".design", "prototype", "board");
    const map = join(specs, "001-lighthouse-map", ".design", "prototype");
    writeFileSync(join(tide, "secret.txt"), "SPEC-SECRET");
    writeFileSync(join(tide, ".design", "secret.txt"), "DESIGN-SECRET");
    mkdirSync(join(tide, ".design", "other"));
    writeFileSync(join(tide, ".design", "other", "index.html"), "<p>OTHER-FOLDER-SECRET</p>");
    writeFileSync(join(map, "other.txt"), "OTHER-SPEC-SECRET");

    // Symlinks in the folder: a file out, a dangling one out, a directory out, another spec's file, one that stays in.
    symlinkSync(join(outside, "secret.txt"), join(board, "leak.txt"));
    symlinkSync(join(outside, "missing.txt"), join(board, "dangling.txt"));
    symlinkSync(outside, join(board, "up"));
    symlinkSync(join(map, "other.txt"), join(board, "cross.txt"));
    symlinkSync("index.html", join(board, "alias.html"));
    // Symlinked prototype folders: one out of the workspace, one onto another spec's prototype.
    symlinkSync(join(outside, "proto"), join(tide, ".design", "prototype", "escape"));
    symlinkSync(map, join(tide, ".design", "prototype", "twin"));
    // A spec whose `.design` is a symlink out, one whose `prototype` is another spec's, and a spec folder that is a
    // symlink onto another spec (symlinked spec folders are no specs at all).
    mkdirSync(join(specs, "005-linked-design"));
    symlinkSync(join(outside, "design"), join(specs, "005-linked-design", ".design"));
    mkdirSync(join(specs, "006-linked-prototype", ".design"), { recursive: true });
    symlinkSync(map, join(specs, "006-linked-prototype", ".design", "prototype"));
    symlinkSync(join(specs, "001-lighthouse-map"), join(specs, "007-mirror"));
  });

  const board = (tail: string): string => `/proto/${wsT}/002-tide-board/prototype%2Fboard/${tail}`;
  const at = (spec: string, folder: string, tail: string): string => `/proto/${wsT}/${spec}/${folder}/${tail}`;

  const expectRefused = async (cases: ReadonlyArray<readonly [string, number]>): Promise<void> => {
    for (const [target, status] of cases) {
      const res = await raw(target);
      expect({ target, status: res.status, leaked: res.body.includes(SECRET) }).toEqual({ target, status, leaked: false });
      expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
    }
  };

  test("traversal: `..` in the tail and in the folder, raw and encoded once, is refused", async () => {
    await expectRefused([
      // Raw `..` is collapsed by the URL parser before routing: what is left names no prototype file.
      [board("../../../secret.txt"), 404],
      [board("img/../../../../secret.txt"), 404],
      [board("..%2F..%2F..%2Fsecret.txt"), 403],
      [board("..%2F..%2Fsecret.txt"), 403],
      [board("img/..%2F..%2F..%2F..%2Fsecret.txt"), 403],
      [board("..%2Fdetail.html"), 403],
      [at("002-tide-board", "prototype%2F..%2F..", "secret.txt"), 403],
      [at("002-tide-board", "prototype%2F..", "secret.txt"), 403],
      [at("002-tide-board", "prototype%2F.%2F..", "secret.txt"), 403],
    ]);
  });

  test("traversal: `%2e%2e` and double encoding (`%252e%252e`, `%252F`) are refused", async () => {
    await expectRefused([
      // `%2e%2e` as a whole segment is a dot segment to the URL parser and collapses like `..`.
      [board("%2e%2e/%2e%2e/%2e%2e/secret.txt"), 404],
      [board("%2e%2e%2f%2e%2e%2f%2e%2e%2fsecret.txt"), 403],
      [board("%2E%2E%2F%2E%2E%2Fsecret.txt"), 403],
      [board("%252e%252e%252f%252e%252e%252f%252e%252e%252fsecret.txt"), 403],
      [board("..%252F..%252F..%252Fsecret.txt"), 403],
      [board("%252e%252e/%252e%252e/%252e%252e/secret.txt"), 403],
      [board("index%252Ehtml"), 403],
      // A doubly encoded folder is no prototype folder once decoded.
      [at("002-tide-board", "prototype%252F..%252F..", "secret.txt"), 404],
      [at("002-tide-board", "prototype%2F%252e%252e", "secret.txt"), 403],
    ]);
  });

  test("traversal: an absolute path, a drive letter, a NUL and a backslash are refused", async () => {
    await expectRefused([
      [board(encodeURIComponent(join(outside, "secret.txt"))), 403],
      [board("%2Fetc%2Fhosts"), 403],
      [board("/etc/hosts"), 403],
      [board("C:%5Csecret.txt"), 403],
      [board("index.html%00"), 403],
      [board("secret.txt%00.html"), 403],
      [board("..%5C..%5C..%5Csecret.txt"), 403],
      [board("img%5C..%5C..%5C..%5C..%5Csecret.txt"), 403],
      [at("002-tide-board", "prototype%5C..%5C..", "secret.txt"), 404],
      [at("002-tide-board", "prototype%2Fboard%00", "index.html"), 403],
      // A raw backslash is a slash to the URL parser; the collapsed path names no prototype file.
      [board("..\\..\\..\\secret.txt"), 404],
    ]);
  });

  test("traversal: a symlink out of the folder, dangling or not, and a symlinked .design or prototype folder are refused", async () => {
    await expectRefused([
      [board("leak.txt"), 403],
      [board("dangling.txt"), 403],
      [board("up/secret.txt"), 403],
      [board("up/proto/index.html"), 403],
      [at("002-tide-board", "prototype%2Fescape", "index.html"), 403],
      [at("005-linked-design", "prototype", "index.html"), 403],
    ]);
  });

  test("traversal: another spec's prototype through the spec, the folder, the tail or a symlink is refused", async () => {
    await expectRefused([
      [board("cross.txt"), 403],
      [at("002-tide-board", "prototype%2Ftwin", "other.txt"), 403],
      [at("006-linked-prototype", "prototype", "other.txt"), 403],
      [board("..%2F..%2F..%2F..%2F001-lighthouse-map%2F.design%2Fprototype%2Fother.txt"), 403],
      [at("002-tide-board", "prototype%2F..%2F..%2F..%2F001-lighthouse-map%2F.design%2Fprototype", "other.txt"), 403],
      [at("..%2F001-lighthouse-map", "prototype", "other.txt"), 404],
      [at("002-tide-board%2F..%2F001-lighthouse-map", "prototype", "other.txt"), 404],
      [at("001-lighthouse-map%2F.design", "prototype", "other.txt"), 404],
      [at("007-mirror", "prototype", "other.txt"), 404],
    ]);
  });

  test("traversal: a folder other than `.design/prototype/` of the spec is refused", async () => {
    await expectRefused([
      [at("002-tide-board", "other", "index.html"), 404],
      [at("002-tide-board", ".design%2Fother", "index.html"), 404],
      [at("002-tide-board", "views", "index.html"), 404],
      [at("002-tide-board", "prototypes", "index.html"), 404],
      [at("002-tide-board", "prototype%2F..%2Fother", "index.html"), 403],
      [at("002-tide-board", "prototype", "..%2Fother%2Findex.html"), 403],
      [at("002-tide-board", "prototype", "..%2Fsecret.txt"), 403],
    ]);
  });

  test("traversal: after every refusal the spec's own prototype file is served, a symlink inside the folder too", async () => {
    for (const target of [board("index.html"), board("alias.html"), at("002-tide-board", "prototype", "board%2Findex.html")]) {
      const res = await raw(target);
      expect({ target, status: res.status }).toEqual({ target, status: 200 });
      expect(res.body).toContain("<title>Tide board</title>");
      expect(res.body.includes(SECRET)).toBe(false);
      expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
    }
    const map = await raw(at("001-lighthouse-map", "prototype", "other.txt"));
    expect([map.status, map.body]).toEqual([200, "OTHER-SPEC-SECRET"]);
  });
});

/** The CSP as directive → source list; a repeated directive would be ignored by a browser, so it fails here. */
function parseCsp(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === undefined || name === "") continue;
    expect(directives.has(name.toLowerCase())).toBe(false);
    directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

/**
 * Whether a source list admits `url` for a page served from `self`, matching the sources this policy may hold
 * (`'none'`, `'self'`, `'unsafe-inline'`, `data:`, `blob:`) as CSP Level 3 does; the policy test refuses any other.
 */
function admits(sources: readonly string[], url: URL, self: string): boolean {
  return sources.some((source) => {
    if (source === "'self'") return url.origin === self;
    if (source === "data:" || source === "blob:") return url.protocol === source;
    return false;
  });
}

describe("prototype route csp", () => {
  const EXTERNAL_PAGE = [
    "<!doctype html>",
    '<link rel="preconnect" href="https://fonts.example.com">',
    '<link rel="stylesheet" href="https://fonts.example.com/css2?family=Tide">',
    '<link rel="stylesheet" href="styles.css">',
    "<style>@font-face { font-family: Far; src: url(https://fonts.example.net/far.woff2) format('woff2'); }</style>",
    '<script src="https://cdn.example.org/lib.js"></script>',
    '<script>fetch("http://api.example.com/beacon"); new WebSocket("wss://socket.example.com/");</script>',
    '<img src="https://img.example.com/pixel.png" alt="">',
    "<title>External</title>",
  ].join("\n");
  let gone: string;

  beforeAll(() => {
    // A page with external sources, in the temp copy only: the committed fixture holds no external URL.
    const dir = join(root, "shelf", "specs", "002-tide-board", ".design", "prototype", "external");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.html"), EXTERNAL_PAGE);
    writeFileSync(join(dir, "styles.css"), "body { margin: 0 }");
    // A registered workspace whose folder is gone answers 409.
    const vanished = join(root, "vanished");
    cpSync(LIBRARY, vanished, { recursive: true });
    gone = registry.add(vanished).slug;
    rmSync(vanished, { recursive: true, force: true });
  });

  const board = (file: string): string => prototypeRoute(ws, "002-tide-board", "prototype/board", file);

  test("csp: every status the route answers (200, 304, 403, 404, 405, 409) carries exactly the CSP and nosniff", async () => {
    const font = board("fonts/manrope-variable.woff2");
    const etag = (await get(board("styles.css"), { method: "HEAD" })).headers.get("ETag") ?? "";
    const asFont = { Origin: "null", "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "font" };
    const fontTag = (await get(font, { method: "HEAD", headers: asFont })).headers.get("ETag") ?? "";
    const cases: Array<[string, string, RequestInit, number]> = [
      ["page", board("index.html"), {}, 200],
      ["HEAD", board("index.html"), { method: "HEAD" }, 200],
      ["304", board("styles.css"), { headers: { "If-None-Match": etag } }, 304],
      ["font for Origin null", font, { headers: asFont }, 200],
      ["font 304 for Origin null", font, { headers: { ...asFont, "If-None-Match": fontTag } }, 304],
      ["font for Origin null without Sec-Fetch", font, { headers: { Origin: "null" } }, 403],
      ["foreign Origin", board("index.html"), { headers: { Origin: "https://example.com" } }, 403],
      ["Origin null on HTML", board("index.html"), { headers: { Origin: "null" } }, 403],
      ["Origin null on POST", board("index.html"), { method: "POST", headers: { Origin: "null" } }, 403],
      ["refused path", `/proto/${ws}/002-tide-board/prototype%2Fboard/..%2F..%2Fspec.md`, {}, 403],
      ["missing file", board("missing.html"), {}, 404],
      ["unknown workspace", prototypeRoute("no-such-workspace", "002-tide-board", "prototype/board", "index.html"), {}, 404],
      ["unknown spec", prototypeRoute(ws, "009-no-such-spec", "prototype/board", "index.html"), {}, 404],
      ["no prototype folder", `/proto/${ws}/002-tide-board/views/index.html`, {}, 404],
      ["too short", `/proto/${ws}/002-tide-board`, {}, 404],
      ["POST", board("index.html"), { method: "POST" }, 405],
      ["PUT", board("index.html"), { method: "PUT", body: "x" }, 405],
      ["DELETE", board("index.html"), { method: "DELETE" }, 405],
      ["OPTIONS", board("index.html"), { method: "OPTIONS" }, 405],
      ["unreadable workspace", prototypeRoute(gone, "002-tide-board", "prototype/board", "index.html"), {}, 409],
    ];
    const seen = new Set<number>();
    for (const [name, path, init, status] of cases) {
      const res = await get(path, init);
      await res.arrayBuffer();
      const headers = { csp: res.headers.get("Content-Security-Policy"), nosniff: res.headers.get("X-Content-Type-Options") };
      expect({ name, status: res.status, ...headers }).toEqual({ name, status, csp: PROTOTYPE_CSP, nosniff: "nosniff" });
      seen.add(res.status);
    }
    // The host guard: a non-loopback Host is 403 with the CSP too (`fetch` would set the Host itself).
    const host = await raw(board("index.html"), "evil.example");
    expect([host.status, host.headers.get("Content-Security-Policy")]).toEqual([403, PROTOTYPE_CSP]);
    expect([...seen].sort()).toEqual([200, 304, 403, 404, 405, 409]);
  });

  test("csp: the policy names no host but its own origin, forbids fetches and sandboxes without allow-same-origin", () => {
    const directives = parseCsp(PROTOTYPE_CSP);
    // No fetch directive besides these: scripts, styles, fonts and images fall back to `default-src`.
    expect([...directives.keys()].sort()).toEqual(["connect-src", "default-src", "sandbox"]);
    expect(directives.get("default-src")).toEqual(["'self'", "'unsafe-inline'", "data:", "blob:"]);
    expect(directives.get("connect-src")).toEqual(["'none'"]);
    expect(directives.get("sandbox")).toEqual(["allow-scripts", "allow-popups"]);
    for (const [name, sources] of directives) {
      for (const source of sources) {
        // No host source, no scheme source of the network (`http:`, `https:`, `ws:`, `wss:`), no wildcard.
        const host = /[*]|\/\/|\.|^(https?|wss?|ftp|filesystem):$/i.test(source);
        expect({ name, source, host }).toEqual({ name, source, host: false });
      }
    }
    expect([...directives.keys()].some((name) => name.startsWith("report"))).toBe(false);
    expect(directives.get("sandbox")).not.toContain("allow-same-origin");
    expect(directives.get("sandbox")?.some((flag) => flag.startsWith("allow-top-navigation"))).toBe(false);
  });

  test("csp: a page with an external font, stylesheet, script, fetch and image is served under the CSP that refuses each", async () => {
    const page = prototypeRoute(ws, "002-tide-board", "prototype/external", "index.html");
    const res = await get(page);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Security-Policy")).toBe(PROTOTYPE_CSP);
    const html = await res.text();
    expect(html).toBe(EXTERNAL_PAGE);

    const self = new URL(server.url).origin;
    const base = new URL(page, server.url);
    const directives = parseCsp(res.headers.get("Content-Security-Policy") ?? "");
    const sourcesFor = (directive: string): string[] => directives.get(directive) ?? directives.get("default-src") ?? [];
    const external = [...html.matchAll(/(?:https?|wss?):\/\/[^"')\s]+/g)].map((m) => new URL(m[0]));
    expect(external.length).toBe(7);
    for (const url of external) {
      for (const directive of ["font-src", "style-src", "script-src", "img-src", "connect-src", "default-src"]) {
        const admitted = admits(sourcesFor(directive), url, self);
        expect({ url: url.href, directive, admitted }).toEqual({ url: url.href, directive, admitted: false });
      }
      expect(PROTOTYPE_CSP).not.toContain(url.hostname);
    }
    // The positive control: the page's own stylesheet and an inline data font stay admitted, a fetch to itself does not.
    expect(admits(sourcesFor("style-src"), new URL("styles.css", base), self)).toBe(true);
    expect(admits(sourcesFor("font-src"), new URL("data:font/woff2;base64,AAAA"), self)).toBe(true);
    expect(admits(sourcesFor("connect-src"), new URL("styles.css", base), self)).toBe(false);
    const css = await get(new URL("styles.css", base).pathname);
    expect([css.status, css.headers.get("Content-Security-Policy")]).toEqual([200, PROTOTYPE_CSP]);
    await css.arrayBuffer();
  });
});
