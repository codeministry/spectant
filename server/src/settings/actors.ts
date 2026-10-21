/**
 * The actor names (spec 008 T91, ISC-119.2): `actorsApi` serves `GET`/`HEAD`/`PUT /api/actors` (`ACTORS_PATH`), a
 * route of its own like `/api/settings`, under the same loopback guard. GET lists the `actor` table's rows as
 * `ActorMapping[]` ordered by id; an id without a row is never invented, so the web shows an unmapped id raw. PUT
 * replaces the whole mapping (`isActorMappings`, each id a person by core's `parseActor`; 400 `invalid-body`
 * otherwise), `updatedAt` from the server clock, and answers the list as stored.
 */
import { parseActor } from "../../../core/src/actor.ts";
import { ACTORS_ALLOW, ACTORS_PATH, type ActorsResponse, isActorMappings } from "../contracts/spec-routes.contract.ts";
import type { Db } from "../infra/db/db.ts";
import { listActors, replaceActors } from "../infra/db/prefs-store.ts";
import { loopbackRefusal, methodNotAllowed } from "../infra/http/guard.ts";
import { json, readJson } from "../infra/http/json.ts";
import type { ApiHandler } from "../infra/http/server.ts";

function actorList(db: Db): ActorsResponse {
  return listActors(db).map(({ id, displayName, gitIdentities }) => ({ id, displayName, gitIdentities }));
}

/**
 * `GET` / `HEAD` / `PUT /api/actors` as an `ApiHandler` over the `actor` table (T91, ISC-119.2; header); `null` for
 * any other path, so the server's JSON 404 applies. The answers carry ids, names and addresses only, never a path.
 */
export function actorsApi(db: Db): ApiHandler {
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

  return (req, url) => {
    if (url.pathname !== ACTORS_PATH) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    if (req.method === "GET" || req.method === "HEAD") return json(req, 200, actorList(db));
    if (req.method === "PUT") return put(req);
    return methodNotAllowed(req, ACTORS_ALLOW);
  };
}
