import { ACTORS_PATH, type ActorMapping, type ActorsRequest, isActorMappings } from '../../../../../server/src/contracts/spec-routes.contract';
import type { ApiResult, HttpCore, PutResult } from './http-core';

/** The stored settings of the app beside the workspaces: the actor names (T111). */
export class ActorsClient {
  constructor(private readonly core: HttpCore) {}

  /** T111: the actor names (`GET /api/actors`), every stored `ActorMapping` ordered by id, ETag-cached. */
  actors(): Promise<ApiResult<readonly ActorMapping[]>> {
    return this.core.get(ACTORS_PATH);
  }

  /** T111: `PUT /api/actors` replaces the whole mapping; the answer is the list as stored. */
  putActors(list: ActorsRequest): Promise<PutResult<readonly ActorMapping[]>> {
    return this.core.put(ACTORS_PATH, list, isActorMappings);
  }
}
