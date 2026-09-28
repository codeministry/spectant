// Pure unit tests for the build contract (T6, ISC-8). They pin the helpers that the embed generator
// (T9) and the server (T10) both rely on, so the two can be built without talking to each other.
import { describe, expect, test } from "bun:test";
import { dirname, posix } from "node:path";
import {
  API_PREFIX,
  CACHE_CONTROL,
  CONTENT_TYPES,
  EMBED_MANIFEST_PATH,
  HASHED_FILENAME,
  MANIFEST_TO_WEB_OUTPUT,
  SPA_FALLBACK_PREFIXES,
  WEB_BASE_HREF,
  WEB_INDEX,
  WEB_OUTPUT_DIR,
  cacheControlFor,
  contentTypeFor,
  embeddedAssetFor,
  isImmutable,
  isSpaRoute,
} from "../server/src/assets.contract.ts";

describe("paths", () => {
  test("constants match the plan", () => {
    expect(WEB_OUTPUT_DIR).toBe("web/dist/browser");
    expect(WEB_BASE_HREF).toBe("/");
    expect(WEB_INDEX).toBe("index.html");
    expect(EMBED_MANIFEST_PATH).toBe("server/embedded.gen.ts");
    expect(API_PREFIX).toBe("/api/");
    expect(SPA_FALLBACK_PREFIXES).toEqual(["/w/"]);
  });

  test("the manifest-relative prefix points from the manifest's folder to the web output", () => {
    expect(MANIFEST_TO_WEB_OUTPUT).toBe(posix.relative(dirname(EMBED_MANIFEST_PATH), WEB_OUTPUT_DIR));
  });
});

describe("contentTypeFor", () => {
  test("text types carry charset utf-8", () => {
    expect(contentTypeFor("/index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("/main-2GZVUD4R.js")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/chunk-VLFJUI4J.mjs")).toBe("text/javascript; charset=utf-8");
    expect(contentTypeFor("/styles-5INURTSO.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("/main.js.map")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("/i18n/de.json")).toBe("application/json; charset=utf-8");
    expect(contentTypeFor("/logo.svg")).toBe("image/svg+xml; charset=utf-8");
    expect(contentTypeFor("/3rdpartylicenses.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeFor("/manifest.webmanifest")).toBe("application/manifest+json; charset=utf-8");
  });

  test("binary types carry no charset", () => {
    expect(contentTypeFor("/favicon.ico")).toBe("image/x-icon");
    expect(contentTypeFor("/icon.png")).toBe("image/png");
    expect(contentTypeFor("/fonts/inter-variable.woff2")).toBe("font/woff2");
    expect(contentTypeFor("/fonts/old.woff")).toBe("font/woff");
  });

  test("the extension match ignores case", () => {
    expect(contentTypeFor("/LOGO.SVG")).toBe(CONTENT_TYPES[".svg"]);
  });

  test("an unknown or missing extension falls back to application/octet-stream", () => {
    expect(contentTypeFor("/blob.bin")).toBe("application/octet-stream");
    expect(contentTypeFor("/LICENSE")).toBe("application/octet-stream");
    expect(contentTypeFor("/.hidden")).toBe("application/octet-stream");
    expect(contentTypeFor("/dir.d/file")).toBe("application/octet-stream");
  });

  test("the map covers every type the plan names", () => {
    for (const ext of [".html", ".js", ".mjs", ".css", ".map", ".json", ".svg", ".png", ".ico", ".woff", ".woff2", ".txt", ".webmanifest"]) {
      expect(CONTENT_TYPES[ext]).toBeString();
    }
  });
});

describe("immutable (hashed filename)", () => {
  test("Angular's esbuild hashes are immutable", () => {
    for (const p of ["/main-2GZVUD4R.js", "/polyfills-FFHMD2TL.js", "/styles-5INURTSO.css", "/chunk-VLFJUI4J.js", "/media/inter-ABCDEFGH.woff2"]) {
      expect(isImmutable(p)).toBe(true);
    }
  });

  test("a lowercase hex hash with a dot separator is immutable", () => {
    expect(isImmutable("/main.3f2a1b4c5d6e7f80.js")).toBe(true);
  });

  test("index.html and plain public files are mutable", () => {
    for (const p of ["/index.html", "/favicon.ico", "/manifest.webmanifest", "/3rdpartylicenses.txt", "/fonts/inter-variable.woff2", "/fonts/JetBrainsMono-Regular.woff2", "/main-ABC123.js"]) {
      expect(isImmutable(p)).toBe(false);
    }
  });

  test("the regex is anchored on the basename", () => {
    expect(HASHED_FILENAME.test("main-2GZVUD4R.js")).toBe(true);
    expect(HASHED_FILENAME.test("main-2GZVUD4R.js.bak/x")).toBe(false);
  });

  test("cacheControlFor picks the matching header", () => {
    expect(cacheControlFor(true)).toBe(CACHE_CONTROL.immutable);
    expect(cacheControlFor(false)).toBe(CACHE_CONTROL.mutable);
    expect(CACHE_CONTROL).toEqual({ immutable: "public, max-age=31536000, immutable", mutable: "no-cache" });
  });
});

describe("isSpaRoute", () => {
  test("the root and deep links under /w/ fall back to index.html", () => {
    for (const p of ["/", "/w/", "/w/x", "/w/spectant/claims", "/w/example.com", "/w/my.repo/settings"]) {
      expect(isSpaRoute(p)).toBe(true);
    }
  });

  test("API paths never fall back", () => {
    for (const p of ["/api/", "/api/workspaces", "/api/w/x"]) expect(isSpaRoute(p)).toBe(false);
  });

  test("a path naming an asset type never falls back", () => {
    for (const p of ["/w/main-2GZVUD4R.js", "/w/x/styles.css", "/w/x/favicon.ico", "/w/x/de.json"]) {
      expect(isSpaRoute(p)).toBe(false);
    }
  });

  test("anything outside the fallback prefixes is not an SPA route", () => {
    for (const p of ["", "/w", "/x", "/index.html", "/main-2GZVUD4R.js", "/settings"]) expect(isSpaRoute(p)).toBe(false);
  });
});

describe("embeddedAssetFor", () => {
  test("derives URL path, import specifier, content type and immutability from the output-relative path", () => {
    expect(embeddedAssetFor("main-2GZVUD4R.js")).toEqual({
      path: "/main-2GZVUD4R.js",
      file: "../web/dist/browser/main-2GZVUD4R.js",
      contentType: "text/javascript; charset=utf-8",
      immutable: true,
    });
    expect(embeddedAssetFor("index.html")).toEqual({
      path: "/index.html",
      file: "../web/dist/browser/index.html",
      contentType: "text/html; charset=utf-8",
      immutable: false,
    });
  });

  test("normalises Windows separators and rejects paths that leave the output folder", () => {
    expect(embeddedAssetFor("media\\inter-ABCDEFGH.woff2").path).toBe("/media/inter-ABCDEFGH.woff2");
    expect(() => embeddedAssetFor("../secret.txt")).toThrow();
    expect(() => embeddedAssetFor("/abs.js")).toThrow();
    expect(() => embeddedAssetFor("")).toThrow();
  });
});
