/**
 * The actor names (spec 008 T91, ISC-119.2): `GET`/`HEAD`/`PUT /api/actors` (`ACTORS_PATH`), a route of its own like
 * `/api/settings`, under the same loopback guard; the router's `ACTORS_FAMILY` (spec 059, ISC-412). GET lists the
 * `actor` table's rows as `ActorMapping[]` ordered by id; an id without a row is never invented, so the web shows an
 * unmapped id raw. PUT replaces the whole mapping (`isActorMappings`, each id a person by core's `parseActor`; 400
 * `invalid-body` otherwise), `updatedAt` from the server clock, and answers the list as stored.
 */
import { parseActor } from "../../../core/src/actor.ts";
import { ACTORS_ALLOW, ACTORS_PATH, type ActorsResponse, isActorMappings } from "../contracts/spec-routes.contract.ts";
import type { Db } from "../infra/db/db.ts";
import { listActors, replaceActors } from "../infra/db/prefs-store.ts";
import { json, readJson } from "../infra/http/json.ts";
import { type PathMatch, type RouteHandlers, createRouter, pathFamily } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";

function actorList(db: Db): ActorsResponse {
  return listActors(db).map(({ id, displayName, gitIdentities }) => ({ id, displayName, gitIdentities }));
}

/** The actors route as the router's family: `/api/actors` alone. */
export const ACTORS_FAMILY = pathFamily("actors", ACTORS_PATH, ACTORS_ALLOW);

/**
 * The handler of `GET` / `HEAD` / `PUT /api/actors` over the `actor` table (header); the router has checked the guard
 * and the method. The answers carry ids, names and addresses only, never a path.
 */
export function actorsHandlers(db: Db): RouteHandlers<PathMatch<"actors">> {
  const put = async (req: Request): Promise<Response> => {
    const body = await readJson(req);
    // Only a person has a row: an agent id, a legacy value or a repeated id refuses the whole list.
    if (!isActorMappings(body) || !body.every((actor) => parseActor(actor.id).kind === "person")) {
      return json(req, 400, { error: "invalid-body" });
    }
    const updatedAt = new Date().toISOString();
    replaceActors(db, body.map((actor) => ({ ...actor, updatedAt })));
    return json(req, 200, actorList(db));
  };

  return {
    actors: (req) => (req.method === "PUT" ? put(req) : json(req, 200, actorList(db))),
  } satisfies RouteHandlers<PathMatch<"actors">>;
}

/** `GET` / `HEAD` / `PUT /api/actors` alone as an `ApiHandler`; `null` for any other path, so the server's 404 applies. */
export function actorsApi(db: Db): ApiHandler {
  return createRouter([ACTORS_FAMILY], actorsHandlers(db));
}
