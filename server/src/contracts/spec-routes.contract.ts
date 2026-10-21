/**
 * The spec routes contract (T44, ISC-78; plan 002 § Interfaces "HTTP").
 *
 * This file is the seam between three consumers that build against it without talking to each other:
 *
 * 1. `server/src/spec-routes.ts` (T45–T50) answers every route in `SPEC_ROUTE_TABLE`: `matchSpecPath` finds the route
 *    and its decoded params, `SpecRouteResponses` names the 200 body, the error interfaces name every other.
 * 2. `web/e2e/stub-api.ts` (T52) answers the same routes from the golden snapshots, `core/fixtures/<tree>.<family>.golden.json`,
 *    whose per-spec value is exactly the 200 body (`GOLDEN_FAMILY` says which family feeds which route).
 * 3. The web client (T35+) builds every URL with `specRoutes` and types every answer with `SpecRouteResponses`.
 *
 * Every body type is a `core/src/files.ts` type, imported by `import type` and never re-declared, so the three cannot
 * drift from the parser. The module is browser-safe: no Bun or Node import, and its only value imports outside its own
 * parts are `assets.contract.ts`, `core/src/files.ts` and `core/src/spec-ref.ts`, all pure.
 *
 * The contract lives in its parts below `spec-routes/`; this barrel re-exports every public name of them:
 *
 * - `spec-route-table.ts`: the spec family, `specRoutes`, `SPEC_ROUTE_TABLE`, `matchSpecPath`, `evidencePathQuery`.
 * - `workspace-route-table.ts`: the workspace family (planning, ideas, board query, favourites, writes, library), its
 *   table, matcher and 200 bodies.
 * - `prototype-route.ts`: `/proto/:ws/:spec/:folder/*`, outside `/api/`.
 * - `api-answers.ts`: `JSON_ANSWER`, the spec routes' 200 bodies, `GOLDEN_FAMILY`, every error body, the evidence
 *   file's headers.
 * - `write-requests.ts`: the write bodies, hash headers, refusals and their validators (§ Spec 008 bodies).
 * - `app-state.ts`: the actor names route, the board query and the favourites.
 * - `live.ts`: the live update stream, `EVENTS_PATH`.
 * - `route-match.ts`: the shared segment matcher and helpers; internal, not re-exported.
 */
export * from './spec-routes/spec-route-table.ts';
export * from './spec-routes/workspace-route-table.ts';
export * from './spec-routes/prototype-route.ts';
export * from './spec-routes/api-answers.ts';
export * from './spec-routes/write-requests.ts';
export * from './spec-routes/app-state.ts';
export * from './spec-routes/live.ts';
