/**
 * The app's own state in the spec routes contract (part of `contracts/spec-routes.contract.ts`): the actor names
 * route, a workspace's board query and its favourite specs, all answered from the app database alone, never a
 * repository file, with their body validators.
 */
import { API_PREFIX } from '../assets.contract.ts';
import { SPEC_FOLDER } from '../../../../core/src/spec-ref.ts';
import type { Forbidden, InvalidBody, MethodNotAllowed } from './api-answers.ts';
import { hasOnlyKeys, isPlainRecord } from './route-match.ts';

export const ACTORS_STATUSES = [200, 304, 400, 403, 405] as const;

/**
 * The actor names route (T91, ISC-119.2); it names no workspace and is no family's: `GET`/`HEAD` answer every stored
 * `ActorMapping` ordered by id (ETag, 304), `PUT` replaces the whole mapping with an array `isActorMappings` admits.
 * Statuses `ACTORS_STATUSES`, errors `ActorsError`, 405 with `ACTORS_ALLOW`.
 */
export const ACTORS_PATH = `${API_PREFIX}actors`;
export const ACTORS_ALLOW = 'GET, HEAD, PUT';

/**
 * One person of the actor table (`ActorRow` in `db.ts` without `updatedAt`, pinned by the contract test): the
 * `u:` id, the name the app shows, the git addresses seen for it. `GET /api/actors` answers every row ordered by id;
 * `PUT` takes the whole list (`isActorMappings`), replaces the table with it and answers the list as stored. The
 * handler checks each `id` with core's `parseActor`: only a person (`u:` + eight hex) has a row.
 */
export interface ActorMapping {
  readonly id: string;
  readonly displayName: string;
  readonly gitIdentities: readonly string[];
}

/** A workspace's remembered board filter: the board URL's query without `?`, `''` when none is stored. */
export interface BoardQuery {
  readonly query: string;
}

export const BOARD_QUERY_MAX = 2048;

/** A workspace's favourite specs (spec 052, T1, ISC-296): their folder names, `NNN-slug`, sorted, each once. */
export interface Favorites {
  readonly specs: readonly string[];
}

/** The actor names route's 200 body (`GET` and `PUT`) and its `PUT` body: the whole mapping. */
export type ActorsResponse = readonly ActorMapping[];
export type ActorsRequest = readonly ActorMapping[];

/** The error body the actor names route may send: no workspace, so no 404 slug, and no file, so no 409. */
export type ActorsError = Forbidden | MethodNotAllowed | InvalidBody;

export function isActorMapping(body: unknown): body is ActorMapping {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['id', 'displayName', 'gitIdentities'])) return false;
  const { id, displayName, gitIdentities } = body;
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof displayName === 'string' &&
    displayName.trim() !== '' &&
    Array.isArray(gitIdentities) &&
    gitIdentities.every((address) => typeof address === 'string')
  );
}

/** The `PUT /api/actors` body: an array of `ActorMapping`s, each id once. The handler adds the person-id check. */
export function isActorMappings(body: unknown): body is ActorsRequest {
  if (!Array.isArray(body) || !body.every((entry) => isActorMapping(entry))) return false;
  return new Set(body.map((entry: ActorMapping) => entry.id)).size === body.length;
}

export function isBoardQuery(body: unknown): body is BoardQuery {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['query'])) return false;
  const { query } = body;
  return typeof query === 'string' && query.length <= BOARD_QUERY_MAX && !query.startsWith('?');
}

/**
 * A spec id a favourite may name: a spec folder name as the loader lists it (core's `SPEC_FOLDER`, `NNN-slug`), and
 * never with a `/`, which no folder name holds. Whether the workspace has the spec is not checked (plan 052).
 */
export function isFavoriteSpec(spec: unknown): spec is string {
  return typeof spec === 'string' && SPEC_FOLDER.test(spec) && !spec.includes('/');
}

/** The `favorites` and `favorite` 200 body: `{specs}` and nothing else, each a favourite spec id. */
export function isFavorites(body: unknown): body is Favorites {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['specs'])) return false;
  const { specs } = body;
  return Array.isArray(specs) && specs.every((spec) => isFavoriteSpec(spec));
}
