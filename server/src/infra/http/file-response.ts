/**
 * The evidence file route's answer (T47, ISC-83; plan 002 § Interfaces "HTTP"): `GET …/evidence/file?path=` serves one
 * file of the spec folder's `artifacts/`, `.evidence/` or `.design/` (the Design tab's images, spec 004), and nothing
 * else.
 *
 * Confinement is `core/`'s `resolveEvidencePath`, the same check the listing uses: the raw query value
 * (`evidencePathQuery`, never `URLSearchParams`) is decoded exactly once there, and a second encoding layer, `..`, an
 * absolute path, a backslash, a control character, a first segment other than the three folders, or a symlink whose
 * real path leaves them is refused. Answers:
 *
 * - 403 `{error: "forbidden"}` for `outside` and `symlink-escape`: a refusal, whether or not a file is there.
 * - 404 `{error: "not-found"}` for `not-found` and `not-a-file`: inside the folders, but no file.
 * - 200 with the file's bytes, streamed from its real path, and `evidenceFileHeaders(mediaTypeOf(name))` from the
 *   contract: charset for text and JSON, `inline` for images, markdown, plain text and JSON, `attachment` for HTML and
 *   anything unknown, `nosniff` and a sandboxing CSP always. `HEAD` gets the headers alone.
 * - 304 when `If-None-Match` matches. The ETag is weak, `W/"<size>-<mtime ms>"` in base 36, taken from one `stat`, so a
 *   revalidation never reads the file; it is weak because size and mtime name a version, not the exact bytes.
 *
 * No answer carries a path: the error bodies are the fixed codes, and the file's own name travels only as the media
 * type (ISC-3). Read-only: `stat` and one open for reading (ISC-15).
 *
 * The library's asset route (spec 017; formerly the tech asset route, spec 023 T7) answers through the same function with the workspace's `specs/` as the
 * root, `reach: 'tree'` (any file below it) and `serves` admitting images only: a file of another media type is 403.
 */
import { statSync } from "node:fs";
import { basename } from "node:path";
import { type PathReach, mediaTypeOf, resolveEvidencePath } from "../../../../core/src/evidence.ts";
import { matchesIfNoneMatch } from "./server.ts";
import { evidenceFileHeaders, evidencePathQuery } from "../../contracts/spec-routes.contract.ts";
import { json } from "./json.ts";

/** Which part of the root a file route may reach, and which media types it serves (every one by default). */
export interface FileRouteScope {
  readonly reach?: PathReach;
  readonly serves?: (mediaType: string) => boolean;
}

/** The answer of the evidence file route for the spec folder `specDir` and the request's raw query (`URL.search`). */
export async function evidenceFileResponse(
  req: Request,
  specDir: string,
  search: string,
  scope: FileRouteScope = {},
): Promise<Response> {
  const hit = await resolveEvidencePath(specDir, evidencePathQuery(search), scope.reach);
  if (!hit.ok) {
    return hit.reason === "outside" || hit.reason === "symlink-escape"
      ? json(req, 403, { error: "forbidden" })
      : json(req, 404, { error: "not-found" });
  }
  let size: number;
  let etag: string;
  try {
    const stat = statSync(hit.absolute);
    if (!stat.isFile()) return json(req, 404, { error: "not-found" });
    size = stat.size;
    etag = `W/"${size.toString(36)}-${Math.trunc(stat.mtimeMs).toString(36)}"`;
  } catch {
    // Gone between the check and the stat.
    return json(req, 404, { error: "not-found" });
  }
  // The media type of the name asked for, as the listing shows it; a confined symlink serves its target's bytes.
  const mediaType = mediaTypeOf(basename(hit.path));
  if (scope.serves !== undefined && !scope.serves(mediaType)) return json(req, 403, { error: "forbidden" });
  const headers = { ...evidenceFileHeaders(mediaType), ETag: etag };
  if (matchesIfNoneMatch(req.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
  if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  // Bun sets Content-Length from the file it opens, so a file that changed since the stat is never cut short.
  return new Response(Bun.file(hit.absolute), { status: 200, headers });
}
