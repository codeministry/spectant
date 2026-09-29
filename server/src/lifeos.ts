/**
 * Optional LifeOS (spec 002 T51, ISC-37; plan 002 § HTTP). LifeOS keeps frontier locks (who holds which claim) in its
 * state directory; when that directory is known, the dashboard shows them beside the repository's own
 * `.spectant/activity.jsonl` (read by `core/src/locks.ts` through `workspace-loader.ts`).
 *
 * Discovery: LifeOS is present only when `SPECTANT_LIFEOS_STATE_DIR` is set, is an absolute path and names an existing
 * directory. No default location is derived, spelled or probed: guessing a path under the user's home would read a
 * LifeOS path without being asked, which is what ISC-37 forbids, and would put a machine path into this public
 * repository. Detection is one `stat` on the named path; nothing inside it is read. It runs once, when the server
 * starts, so `GET /api/lifeos` and the dashboard see the same answer for the life of the process.
 *
 * `GET /api/lifeos` → `{present: boolean}`, never the path (ISC-3). ETag, 304, `HEAD`, 405 and the loopback guard as
 * on the workspace routes (`api.ts`).
 */
import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { json } from "./api.ts";
import type { ApiHandler } from "./http.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";

/** The environment variable that names the LifeOS state directory (the directory holding `isa-locks/`). */
export const LIFEOS_ENV = "SPECTANT_LIFEOS_STATE_DIR";

/** The route this module answers. */
export const LIFEOS_PATH = "/api/lifeos";

export type LifeosDetection =
  | { readonly present: true; readonly stateDir: string }
  | { readonly present: false; readonly stateDir: null };

export const LIFEOS_ABSENT: LifeosDetection = Object.freeze({ present: false, stateDir: null });

/**
 * Whether LifeOS is present for this process, from `env` alone. Unset, empty, relative, missing or not a directory:
 * absent, and then no path at all is touched (unset, empty, relative) or only the named one is stat'ed.
 */
export function detectLifeos(env: Record<string, string | undefined>): LifeosDetection {
  const dir = env[LIFEOS_ENV];
  if (dir === undefined || dir === "" || !isAbsolute(dir)) return LIFEOS_ABSENT;
  try {
    return statSync(dir).isDirectory() ? { present: true, stateDir: dir } : LIFEOS_ABSENT;
  } catch {
    return LIFEOS_ABSENT;
  }
}

const ALLOW = "GET, HEAD";

/** `GET` / `HEAD` of `/api/lifeos` as an `ApiHandler`; `null` for every other path. */
export function lifeosApi(detection: LifeosDetection): ApiHandler {
  const body = { present: detection.present };
  return (req, url) => {
    if (url.pathname !== LIFEOS_PATH) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(req, 405, { error: "method-not-allowed" }, { Allow: ALLOW });
    return json(req, 200, body);
  };
}
