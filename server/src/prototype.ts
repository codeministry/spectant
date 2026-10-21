/**
 * The prototype route (spec 017 T20, ISC-159; plan 017 § Interfaces "HTTP", § Risks): `GET`/`HEAD
 * /proto/:ws/:spec/:folder/*` serves one file of a spec's prototype under `.design/prototype/`, outside `/api/` so the
 * relative links of a prototype page (`styles.css`, `app.js`, `img/…`, `fonts/…`) resolve against its folder without
 * any rewriting. The contract (`matchPrototypePath`, `PROTOTYPE_ALLOW`, `PROTOTYPE_CSP`) is the one source of the path;
 * `http.ts` hands every `PROTOTYPE_PREFIX` path to the API seam, which this handler joins in `cli.ts`.
 *
 * Per request, in this order (the e2e stub's `prototypeFileRoute` answers the same way):
 *
 * - 403 `{error: "forbidden"}` for a non-loopback `Host` or a cross-site `Origin`, the guard of every route. The one
 *   exception is `Origin: null`, the opaque origin of the sandboxed page itself, which a browser sends for what it
 *   fetches in CORS mode (`<script type="module">`, every `import`, `@font-face` sources; T58, ISC-159.3): it is
 *   answered for any file but HTML (`text/html` by `prototypeMediaTypeOf`), and only for a request the browser makes
 *   to run or render the file, `Sec-Fetch-Mode: cors` with `Sec-Fetch-Dest` `script`, `style` or `font`; then 200 or
 *   304 with `Access-Control-Allow-Origin: *`. Not the `Referer`: Chromium sends none for the opaque document's own
 *   requests (its entry module, a font of an inline style), only for a nested `import`. A page cannot set the
 *   `Sec-Fetch-*` headers, so a `fetch()` (`Sec-Fetch-Dest: empty`) that would hand bytes to a script is refused, as is
 *   every other destination, a request without those headers, an HTML page always, misses, 405 and 409: the same 403
 *   without that header.
 * - 405 with `Allow: PROTOTYPE_ALLOW` for any method but `GET` and `HEAD`.
 * - 404 for a path the contract does not match, an unknown workspace, or a spec that is no spec folder
 *   (`specs/NNN-slug/` or, for an archived spec, `specs/archive/NNN-slug/` (ISC-187.1), exactly as `LibraryDoc.spec`
 *   names it; an active folder wins over an archived one of the same name).
 * - 409 with the workspace's summary when its folder cannot be read, as the library route answers.
 * - Confinement is core's `resolvePrototypePath`: the folder stays inside the spec's own `.design/prototype/`, the tail
 *   is decoded exactly once, and `..`, a second encoding layer, an absolute path, a backslash, a control character or
 *   a symlink out is refused. `outside` and `symlink-escape` are 403, `not-found` and `not-a-file` 404.
 * - 200 with the file's bytes streamed from its real path: `evidenceFileHeaders` for `prototypeMediaTypeOf(name)`
 *   (styles, scripts and fonts beside the evidence types, so `nosniff` does not refuse them), always `inline`, and a
 *   weak ETag `W/"<size>-<mtime ms>"` from one `stat`, 304 on a match. `HEAD` gets the headers alone. Every non-HTML
 *   answer carries `Vary: Origin, Sec-Fetch-Mode, Sec-Fetch-Dest` either way, since its CORS header depends on them.
 *
 * Every answer, errors included, carries `PROTOTYPE_CSP` (`sandbox` without `allow-same-origin`: the page runs on an
 * opaque origin and cannot call the app's API; `connect-src 'none'`) and `X-Content-Type-Options: nosniff`. No answer
 * carries a path (ISC-3). Read-only: `realpath`, `lstat`, `stat` and one open for reading (ISC-15).
 */
import { statSync } from "node:fs";
import { basename } from "node:path";
import { prototypeMediaTypeOf, resolvePrototypePath } from "../../core/src/evidence.ts";
import { listSpecs } from "../../core/src/resolve.ts";
import { json } from "./api.ts";
import type { ApiHandler } from "./http.ts";
import { matchesIfNoneMatch } from "./http.ts";
import type { Registry } from "./registry.ts";
import { isLoopbackHost, isLoopbackOrigin, methodNotAllowed } from "./infra/http/guard.ts";
import {
  PROTOTYPE_ALLOW,
  PROTOTYPE_CSP,
  PROTOTYPE_PREFIX,
  evidenceFileHeaders,
  matchPrototypePath,
} from "./spec-routes.contract.ts";
import { unreadableCode, workspaceUnreadable } from "./workspace-loader.ts";

export type PrototypeApiOptions = {
  registry: Pick<Registry, "get">;
};

/** The two headers every prototype answer carries, 200 or error. */
const ALWAYS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": PROTOTYPE_CSP,
  "X-Content-Type-Options": "nosniff",
};

/** A JSON error with the prototype headers on top of `json()`'s. */
function refuse(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return json(req, status, body, { ...extra, ...ALWAYS });
}

const notFound = (req: Request): Response => refuse(req, 404, { error: "not-found" });

const forbidden = (req: Request): Response => refuse(req, 403, { error: "forbidden" });

/** The `Origin` a sandboxed page without `allow-same-origin` sends: its origin is opaque. */
const OPAQUE_ORIGIN = "null";

/** HTML is never answered to `Origin: null`: a page is navigated to, never fetched by the sandboxed page in CORS mode. */
const isHtmlType = (mediaType: string): boolean => mediaType.startsWith("text/html");

/** What a non-HTML answer's CORS header depends on. */
const OPAQUE_VARY = "Origin, Sec-Fetch-Mode, Sec-Fetch-Dest";

/** The `Sec-Fetch-Dest` values of what a page runs or renders in CORS mode: module scripts, imports, styles, fonts. */
const OPAQUE_DESTINATIONS: ReadonlySet<string> = new Set(["script", "style", "font"]);

/**
 * Whether the browser itself fetches the file to run or render it (`Sec-Fetch-Mode: cors`, `Sec-Fetch-Dest` script,
 * style or font). Fetch metadata is set by the browser alone, so a page's `fetch()` always says `empty`.
 */
function renderFetch(req: Request): boolean {
  return req.headers.get("Sec-Fetch-Mode") === "cors" && OPAQUE_DESTINATIONS.has(req.headers.get("Sec-Fetch-Dest") ?? "");
}

/** The workspace's 409 body, as the library route sends it: the summary with the stable code, never the path. */
function unavailable(workspace: { slug: string; name: string; path: string }, error: string): unknown {
  return { slug: workspace.slug, name: workspace.name, pathTail: basename(workspace.path), readable: false, error, counts: null };
}

/** `GET`/`HEAD /proto/:ws/:spec/:folder/*` as an `ApiHandler`; `null` for every path outside `PROTOTYPE_PREFIX`. */
export function prototypeApi(options: PrototypeApiOptions): ApiHandler {
  const { registry } = options;

  /** `opaque`: the request came from `Origin: null` as a script, style or font fetch; HTML is refused to it. */
  const answer = async (req: Request, pathname: string, opaque: boolean): Promise<Response> => {
    const match = matchPrototypePath(pathname);
    if (match === null) return notFound(req);
    const { ws, spec, folder, file } = match.params;
    const workspace = registry.get(ws);
    if (!workspace) return notFound(req);
    const unreadable = workspaceUnreadable(workspace.path);
    if (unreadable !== null) return refuse(req, 409, unavailable(workspace, unreadable));
    let specDir: string | undefined;
    try {
      // The folder name exactly, never a path: a decoded `..` or `/` names no listed folder. `listSpecs` lists the
      // active folders first, so an active spec wins over an archived one of the same name.
      specDir = listSpecs(workspace.path).find((ref) => ref.slug === spec)?.dir;
    } catch (error) {
      return refuse(req, 409, unavailable(workspace, unreadableCode(error)));
    }
    if (specDir === undefined) return notFound(req);

    const hit = await resolvePrototypePath(specDir, folder, file);
    if (!hit.ok) {
      return hit.reason === "outside" || hit.reason === "symlink-escape"
        ? refuse(req, 403, { error: "forbidden" })
        : notFound(req);
    }
    // The media type of the name asked for; a confined symlink serves its target's bytes.
    const mediaType = prototypeMediaTypeOf(basename(hit.path));
    const html = isHtmlType(mediaType);
    if (opaque && html) return forbidden(req);
    let size: number;
    let etag: string;
    try {
      const stat = statSync(hit.absolute);
      if (!stat.isFile()) return notFound(req);
      size = stat.size;
      etag = `W/"${size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}"`;
    } catch {
      // Gone between the check and the stat.
      return notFound(req);
    }
    const headers: Record<string, string> = {
      ...evidenceFileHeaders(mediaType),
      "Content-Disposition": "inline",
      ...ALWAYS,
      ETag: etag,
      ...(html ? {} : { Vary: OPAQUE_VARY }),
      ...(opaque ? { "Access-Control-Allow-Origin": "*" } : {}),
    };
    if (matchesIfNoneMatch(req.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
    if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
    // Bun sets Content-Length from the file it opens, so a file that changed since the stat is never cut short.
    return new Response(Bun.file(hit.absolute), { status: 200, headers });
  };

  return (req, url) => {
    const { pathname } = url;
    if (!pathname.startsWith(PROTOTYPE_PREFIX)) return null;
    const origin = req.headers.get("Origin");
    const opaque = origin === OPAQUE_ORIGIN;
    if (!isLoopbackHost(req.headers.get("Host")) || (!opaque && !isLoopbackOrigin(origin))) return forbidden(req);
    if (req.method !== "GET" && req.method !== "HEAD") {
      return opaque ? forbidden(req) : methodNotAllowed(req, PROTOTYPE_ALLOW, refuse);
    }
    if (!opaque) return answer(req, pathname, false);
    // `Origin: null` for anything but a script, style or font fetch is refused before the file system is asked.
    if (!renderFetch(req)) return forbidden(req);
    // `Origin: null` learns nothing but a non-HTML file's bytes: every miss, 409 and refusal is the same 403.
    return answer(req, pathname, true).then((res) => (res.status === 200 || res.status === 304 ? res : forbidden(req)));
  };
}
