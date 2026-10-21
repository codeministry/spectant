/**
 * The spec route family (spec 059, ISC-412): `SPEC_ROUTE_TABLE`'s ten routes as the router's `RouteFamily`. It owns
 * every path under `/api/workspaces/:ws/specs`, so an unknown tab is its guarded 404, not the server's; the match is
 * the contract's `matchSpecPath`, the 405's `Allow` its `allowFor`.
 */
import { SPEC_API_ROOT, SPEC_ROUTE_TABLE, type SpecRouteMatch, type SpecRouteName, allowFor, matchSpecPath } from "../contracts/spec-routes.contract.ts";
import { json } from "../infra/http/json.ts";
import type { RouteFamily } from "../infra/http/router.ts";

/** Any path under `/api/workspaces/:ws/specs`: the spec routes own it. */
const SPECS_SUBTREE = new RegExp(`^${SPEC_API_ROOT}/[^/]+/specs(?:/.*)?$`);

export const SPEC_FAMILY: RouteFamily<SpecRouteName, SpecRouteMatch> = {
  name: "spec",
  routes: SPEC_ROUTE_TABLE.map((entry) => entry.route),
  claims: (pathname) => SPECS_SUBTREE.test(pathname),
  match: matchSpecPath,
  allow: (route) => allowFor(route),
  guard: "loopback",
  respond: json,
  unmatched: "not-found",
};
