/**
 * Optional LifeOS (spec 002 T51, ISC-37; plan 002 § HTTP): the `GET /api/lifeos` route, the router's `LIFEOS_FAMILY`
 * (spec 059, ISC-412). Whether LifeOS is present is decided once at startup by `infra/lifeos.ts`, which also holds the
 * discovery rules.
 *
 * `GET /api/lifeos` → `{present: boolean}`, never the path (ISC-3). ETag, 304, `HEAD`, 405 and the loopback guard as
 * on the workspace routes (`workspace/routes.ts`).
 */
import { json } from "../infra/http/json.ts";
import { type PathMatch, type RouteHandlers, createRouter, pathFamily } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";
import type { LifeosDetection } from "../infra/lifeos.ts";

/** The route this module answers. */
export const LIFEOS_PATH = "/api/lifeos";

/** The LifeOS route as the router's family: `/api/lifeos` alone, `GET` and `HEAD`. */
export const LIFEOS_FAMILY = pathFamily("lifeos", LIFEOS_PATH, "GET, HEAD");

/** The handler of `GET` / `HEAD /api/lifeos`; the router has checked the guard and the method. */
export function lifeosHandlers(detection: LifeosDetection): RouteHandlers<PathMatch<"lifeos">> {
  const body = { present: detection.present };
  return { lifeos: (req) => json(req, 200, body) } satisfies RouteHandlers<PathMatch<"lifeos">>;
}

/** `GET` / `HEAD` of `/api/lifeos` alone as an `ApiHandler`; `null` for every other path. */
export function lifeosApi(detection: LifeosDetection): ApiHandler {
  return createRouter([LIFEOS_FAMILY], lifeosHandlers(detection));
}
