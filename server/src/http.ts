/**
 * The loopback HTTP server (T10, ISC-8; plan 001 § Approach "Server and UI split", "Embedding").
 *
 * It serves the embedded web build from an `EmbeddedManifest` that the caller passes in. This module never imports
 * `server/embedded.gen.ts`: a fresh checkout has none, and only the compiled CLI entry binds it. The JSON API plugs
 * in through `ServeOptions.api`; this module implements no `/api/` route of its own.
 *
 * Request handling, in order:
 * 1. a path under `API_PREFIX` goes to `api` (any method); no handler, or a `null` answer, is a JSON 404;
 * 2. any method other than GET or HEAD is 405;
 * 3. an exact `path` match in the manifest serves that file with its content type, `cacheControlFor(immutable)` and
 *    a weak ETag, 304 on a matching `If-None-Match`;
 * 4. `isSpaRoute(pathname)` serves `manifest.index` as html, `no-cache`, with the same ETag handling;
 * 5. everything else is a plain-text 404.
 *
 * Only files named by the manifest are ever opened; nothing is looked up on disk by request path.
 */
import {
  API_PREFIX,
  CACHE_CONTROL,
  type EmbeddedManifest,
  WEB_INDEX,
  cacheControlFor,
  contentTypeFor,
  isSpaRoute,
} from "./assets.contract.ts";

/** The only address the server binds (ISC-1). Never `0.0.0.0` or `::`: Spectant is a local single-user tool. */
export const LOOPBACK_HOST = "127.0.0.1";

/** The default port. Falling forward to the next free port is the CLI's job (T50), not this module's. */
export const DEFAULT_PORT = 7717;

/** Answers an `/api/` request, or returns `null` when it does not handle the path. */
export type ApiHandler = (req: Request, url: URL) => Response | Promise<Response> | null;

export interface ServeOptions {
  manifest: EmbeddedManifest;
  /** `DEFAULT_PORT` when omitted; `0` picks an ephemeral port. A busy port makes `serve` throw. */
  port?: number;
  api?: ApiHandler;
}

export interface RunningServer {
  /** The port actually bound, resolved when `port` was `0`. */
  port: number;
  /** `http://127.0.0.1:<port>/`. */
  url: string;
  /** Stops listening and closes open connections, which frees the port. */
  stop(): void;
}

/** One servable file: what to open and the headers that go with it. */
type Entry = { file: string; headers: Record<string, string> };

const ALLOW = "GET, HEAD";

/**
 * A weak ETag from the URL path, the file size and the build stamp. The build stamp matters: a new binary's
 * `index.html` usually keeps its size (hashes have fixed length), and a tag from path and size alone would answer
 * 304 with the old document, which points at hashed files the new binary no longer has.
 */
function weakEtag(path: string, size: number, generatedAt: string): string {
  return `W/"${size.toString(36)}-${Bun.hash(`${generatedAt}\0${path}`).toString(36)}"`;
}

/** RFC 9110 weak comparison of `If-None-Match` against one tag: `*`, or any listed tag with `W/` stripped. */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const opaque = etag.replace(/^W\//, "");
  return header.split(",").some((raw) => {
    const tag = raw.trim();
    return tag === "*" || tag.replace(/^W\//, "") === opaque;
  });
}

function entryFor(file: string, path: string, contentType: string, cacheControl: string, generatedAt: string): Entry {
  const size = Bun.file(file).size;
  return {
    file,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      ETag: weakEtag(path, size, generatedAt),
      "Content-Length": String(size),
    },
  };
}

function respond(entry: Entry, req: Request): Response {
  const { "Content-Length": length, ...headers } = entry.headers;
  if (matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag ?? "")) {
    return new Response(null, { status: 304, headers });
  }
  if (req.method === "HEAD") return new Response(null, { headers: { ...headers, "Content-Length": length ?? "0" } });
  return new Response(Bun.file(entry.file), { headers });
}

function notFoundJson(): Response {
  return Response.json({ error: "not found" }, { status: 404 });
}

function notFoundText(): Response {
  return new Response("not found\n", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Starts the server on `LOOPBACK_HOST`. Throws when the port is taken; the CLI (T50) catches that and falls
 * forward. Every manifest file is sized once here, so a request never touches anything the manifest did not name.
 */
export function serve(opts: ServeOptions): RunningServer {
  const { manifest, api } = opts;
  const { generatedAt } = manifest;

  const assets = new Map<string, Entry>(
    manifest.assets.map((asset) => [
      asset.path,
      entryFor(asset.file, asset.path, asset.contentType, cacheControlFor(asset.immutable), generatedAt),
    ]),
  );
  const index = entryFor(manifest.index, `/${WEB_INDEX}`, contentTypeFor(WEB_INDEX), CACHE_CONTROL.mutable, generatedAt);

  const server = Bun.serve({
    hostname: LOOPBACK_HOST,
    port: opts.port ?? DEFAULT_PORT,
    // No development error pages: they would print stack traces with absolute paths into the browser (ISC-3).
    development: false,
    // With `development: false` Bun turns SO_REUSEPORT on by default, and a second instance then binds the same
    // port silently (the kernel splits requests between them) instead of failing. Off, a busy port throws, which
    // is what the CLI's fall-forward (T50) relies on.
    reusePort: false,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (pathname.startsWith(API_PREFIX)) return (await api?.(req, url)) ?? notFoundJson();

      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("method not allowed\n", {
          status: 405,
          headers: { Allow: ALLOW, "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      const asset = assets.get(pathname);
      if (asset) return respond(asset, req);
      if (isSpaRoute(pathname)) return respond(index, req);
      return notFoundText();
    },
  });

  const port = server.port ?? 0;
  return {
    port,
    url: `http://${LOOPBACK_HOST}:${port}/`,
    stop: () => void server.stop(true),
  };
}
