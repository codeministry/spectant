/**
 * The router the slices' route tables are composed with (spec 059, ISC-412): each slice describes its routes as a
 * `RouteFamily`, built from its contract table (`SPEC_ROUTE_TABLE`, `WORKSPACE_ROUTE_TABLE`, …), and hands one
 * handler per route name; `createRouter` joins the families and the handlers into one `ApiHandler`.
 *
 * Per request the first family that claims the path answers, in the order every route answers today:
 *
 * 1. the guard: 403 `{error: "forbidden"}` (`loopback`: `loopbackRefusal`; `prototype`: the same, except that the
 *    opaque `Origin: null` of a sandboxed page passes);
 * 2. the match: a claimed path no route matches is the family's 404 `{error: "not-found"}` (`unmatched:
 *    "not-found"`, a family that owns a whole subtree) or declined (`"decline"`);
 * 3. the method: one the family's `allow` does not name is 405 `{error: "method-not-allowed"}` with that `Allow`
 *    (`methodNotAllowed`); under the `prototype` guard an opaque request gets the 403 instead, so it learns nothing;
 * 4. the route's handler, with the match; it answers 404, 409, 400 and the domain answer itself.
 *
 * A decline, or a handler's synchronous `null`, passes the request on to the next family that claims it and, after
 * the last, out of the router, so `createRouter([a, b])` answers as `composeApi(createRouter([a]), createRouter([b]))`
 * and a router sits in a `composeApi` chain like any handler. Every answer of steps 1–3 goes through the family's
 * `respond`, so a family with its own headers (settings, prototype) keeps them on its refusals.
 *
 * A family with `unmatched: "decline"` claims only paths it matches: its guard runs on every path it claims, so a
 * broader claim would refuse paths another handler owns. A route the configuration does not serve (a database route
 * without a database) is left out of `claims` the same way, so the request reaches the next handler unguarded.
 *
 * `createRouter` throws when two families, or one family twice, name the same route, when a route has no handler,
 * and when a handler names no route: every route is answered exactly once, by exactly one handler.
 *
 * infra imports no slice: the families and the handlers come in from the slices.
 */
import { isLoopbackHost, isLoopbackOrigin, loopbackRefusal, methodNotAllowed, type Responder } from "./guard.ts";
import type { ApiHandler } from "./server.ts";

/** What a family's `match` finds: the route's name and its decoded params (a contract's `…RouteMatch` union). */
export interface RouteMatch<N extends string = string> {
  readonly route: N;
  readonly params: unknown;
}

/**
 * One family of routes: the routes of one contract table, answered by one slice. `M` is the family's match union, so a
 * handler gets its own route's params (`SpecRouteMatch`, `WorkspaceRouteMatch`); `RouteMatch<N>` without one.
 */
export interface RouteFamily<N extends string, M extends RouteMatch<N> = RouteMatch<N>> {
  /** The family's name, for the errors `createRouter` throws. */
  readonly name: string;
  /** Every route name `match` can answer, each once: the contract table's `route` column. */
  readonly routes: readonly N[];
  /** Whether the family owns the path (`URL.pathname`, still percent-encoded): its guard answers it. */
  claims(pathname: string): boolean;
  /** The route the path names and its params, whatever the method; null for a path no route matches. */
  match(pathname: string): M | null;
  /** The route's `Allow` header (`GET, HEAD`, `POST`, …): the methods it takes, and its 405's header. */
  allow(route: N, pathname: string): string;
  /** `loopback` for every API route; `prototype` lets the opaque `Origin: null` of a sandboxed page through. */
  readonly guard: "loopback" | "prototype";
  /** How the family's 403, 404 and 405 are answered: `json()` unless it brings its own headers. */
  readonly respond: Responder;
  /** A claimed path no route matches: the family's 404, or declined to the next handler. */
  readonly unmatched: "decline" | "not-found";
}

/** One route's answer; a synchronous `null` declines, as an `ApiHandler` does. */
export type RouteHandler<M extends RouteMatch = RouteMatch> = (req: Request, url: URL, match: M) => Response | Promise<Response> | null;

/** The match union of a family, or of a union of families. */
export type MatchOf<F> = F extends RouteFamily<string, infer M> ? M : never;

/** One handler per route name, each typed by its own route's match. */
export type RouteHandlers<M extends RouteMatch> = { readonly [R in M["route"]]: RouteHandler<Extract<M, { readonly route: R }>> };

/** A family of any route names and match shape; `MatchOf` narrows it back. */
type AnyFamily = RouteFamily<string, RouteMatch>;

/** The opaque origin a sandboxed page without `allow-same-origin` sends. */
const OPAQUE_ORIGIN = "null";

/** The family's 403 for a foreign `Host` or a cross-site `Origin`; null lets the request go on. */
function refusal(family: AnyFamily, req: Request): Response | null {
  if (family.guard === "loopback") return loopbackRefusal(req, family.respond);
  const origin = req.headers.get("Origin");
  if (isLoopbackHost(req.headers.get("Host")) && (origin === OPAQUE_ORIGIN || isLoopbackOrigin(origin))) return null;
  return family.respond(req, 403, { error: "forbidden" });
}

/** Whether the method is one the `Allow` header names (`HEAD` is named beside `GET` wherever a route takes it). */
function allows(allow: string, method: string): boolean {
  return allow.split(",").some((name) => name.trim() === method.toUpperCase());
}

/**
 * The one `ApiHandler` over `families`, in order (module header). Throws when a route name is taken twice, when a route
 * has no handler and when a handler names no route.
 */
export function createRouter<const F extends readonly AnyFamily[]>(families: F, handlers: RouteHandlers<MatchOf<F[number]>>): ApiHandler {
  const table = handlers as unknown as Readonly<Record<string, RouteHandler | undefined>>;
  const owner = new Map<string, string>();
  for (const family of families) {
    for (const route of family.routes) {
      const taken = owner.get(route);
      if (taken !== undefined) throw new Error(`route ${route} is named twice (${taken}, ${family.name})`);
      owner.set(route, family.name);
      if (typeof table[route] !== "function") throw new Error(`route ${route} of ${family.name} has no handler`);
    }
  }
  for (const route of Object.keys(table)) {
    if (!owner.has(route)) throw new Error(`handler ${route} names no route of any family`);
  }

  return (req, url) => {
    const { pathname } = url;
    for (const family of families) {
      if (!family.claims(pathname)) continue;
      const refused = refusal(family, req);
      if (refused !== null) return refused;
      const match = family.match(pathname);
      if (match === null) {
        if (family.unmatched === "not-found") return family.respond(req, 404, { error: "not-found" });
        continue;
      }
      const handler = owner.get(match.route) === family.name ? table[match.route] : undefined;
      if (handler === undefined) throw new Error(`${family.name} matched ${match.route}, which is not one of its routes`);
      const allow = family.allow(match.route, pathname);
      if (!allows(allow, req.method)) {
        if (family.guard === "prototype" && req.headers.get("Origin") === OPAQUE_ORIGIN) return family.respond(req, 403, { error: "forbidden" });
        return methodNotAllowed(req, allow, family.respond);
      }
      const answer = handler(req, url, match);
      if (answer !== null) return answer;
    }
    return null;
  };
}
