/**
 * Optional LifeOS (spec 002 T51, ISC-37; plan 002 § HTTP): the `GET /api/lifeos` route. Whether LifeOS is present is
 * decided once at startup by `infra/lifeos.ts`, which also holds the discovery rules.
 *
 * `GET /api/lifeos` → `{present: boolean}`, never the path (ISC-3). ETag, 304, `HEAD`, 405 and the loopback guard as
 * on the workspace routes (`api.ts`).
 */
import { json } from "./infra/http/json.ts";
import type { ApiHandler } from "./infra/http/server.ts";
import type { LifeosDetection } from "./infra/lifeos.ts";
import { loopbackRefusal, methodNotAllowed } from "./infra/http/guard.ts";

export * from "./infra/lifeos.ts";

/** The route this module answers. */
export const LIFEOS_PATH = "/api/lifeos";

const ALLOW = "GET, HEAD";

/** `GET` / `HEAD` of `/api/lifeos` as an `ApiHandler`; `null` for every other path. */
export function lifeosApi(detection: LifeosDetection): ApiHandler {
  const body = { present: detection.present };
  return (req, url) => {
    if (url.pathname !== LIFEOS_PATH) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed(req, ALLOW);
    return json(req, 200, body);
  };
}
