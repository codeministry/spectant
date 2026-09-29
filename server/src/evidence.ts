/**
 * The evidence file route's answer (T47, ISC-83; plan 002 § Interfaces "HTTP"): `GET …/evidence/file?path=` serves one
 * file of the spec folder's `artifacts/` or `.evidence/`, and nothing else.
 *
 * Confinement is `core/`'s `resolveEvidencePath`, the same check the listing uses: the raw query value
 * (`evidencePathQuery`, never `URLSearchParams`) is decoded exactly once there, and a second encoding layer, `..`, an
 * absolute path, a backslash, a control character, a first segment other than the two folders, or a symlink whose real
 * path leaves them is refused. Answers:
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
 */
import { statSync } from "node:fs";
import { basename } from "node:path";
import { mediaTypeOf, resolveEvidencePath } from "../../core/src/evidence.ts";
import { json } from "./api.ts";
import { matchesIfNoneMatch } from "./http.ts";
import { evidenceFileHeaders, evidencePathQuery } from "./spec-routes.contract.ts";

/** The answer of the evidence file route for the spec folder `specDir` and the request's raw query (`URL.search`). */
export async function evidenceFileResponse(req: Request, specDir: string, search: string): Promise<Response> {
  const hit = await resolveEvidencePath(specDir, evidencePathQuery(search));
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
  const headers = { ...evidenceFileHeaders(mediaTypeOf(basename(hit.path))), ETag: etag };
  if (matchesIfNoneMatch(req.headers.get("If-None-Match"), etag)) return new Response(null, { status: 304, headers });
  if (req.method === "HEAD") return new Response(null, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  // Bun sets Content-Length from the file it opens, so a file that changed since the stat is never cut short.
  return new Response(Bun.file(hit.absolute), { status: 200, headers });
}
