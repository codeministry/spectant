/**
 * The spec route family (part of `contracts/spec-routes.contract.ts`): every `/api/workspaces/:ws/specs/:id…` route,
 * its builders, `SPEC_ROUTE_TABLE` and `matchSpecPath`.
 *
 * Params: `:ws` is the workspace slug, `:id` the spec ref as `core/src/resolve.ts` `resolveSpec` reads it (`002`,
 * `002-web-console` or `web-console`; the web uses the dashboard row's `id`, `NNN`), `:tid` a task id (`T12`). Builders percent-encode each segment once; `matchSpecPath` decodes each segment once, so `%2541` arrives
 * as `%41`, never as `A`. The evidence file's `path` travels in the query and is passed on raw
 * (`evidencePathQuery`): `resolveEvidencePath` in `core/src/evidence.ts` decodes it exactly once and refuses a second
 * layer.
 */
import { API_PREFIX } from '../assets.contract.ts';
import { enc, matchSegments, READ, REFUSABLE_WRITE, WRITE } from './route-match.ts';

// ─── Paths ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The workspace routes' root; equal to `WORKSPACES_PATH` in `api.ts` (pinned by the contract test). */
export const SPEC_API_ROOT = `${API_PREFIX}workspaces`;

export type SpecRouteName =
  | 'spec'
  | 'timeline'
  | 'claims'
  | 'tasks'
  | 'evidenceFile'
  | 'frames'
  | 'live'
  | 'gateReviewed'
  | 'taskCheck'
  | 'transition';

export interface SpecParams {
  readonly ws: string;
  readonly id: string;
}

/** The decoded params of each route. */
export interface SpecRouteParams {
  spec: SpecParams;
  timeline: SpecParams;
  claims: SpecParams;
  tasks: SpecParams;
  /** The file's `path` is a query value: `evidencePathQuery(url.search)`. */
  evidenceFile: SpecParams;
  frames: SpecParams;
  live: SpecParams;
  gateReviewed: SpecParams;
  taskCheck: SpecParams & { readonly tid: string };
  transition: SpecParams;
}

/** What `matchSpecPath` returns: the route and its params, discriminated by `route`. */
export type SpecRouteMatch = { [R in SpecRouteName]: { readonly route: R; readonly params: SpecRouteParams[R] } }[SpecRouteName];

const base = (ws: string, id: string): string => `${SPEC_API_ROOT}/${enc(ws)}/specs/${enc(id)}`;

/** URL builders, one per route. Each segment is percent-encoded once; the result is a path (and query), no origin. */
export const specRoutes = {
  spec: (ws: string, id: string): string => base(ws, id),
  timeline: (ws: string, id: string): string => `${base(ws, id)}/timeline`,
  claims: (ws: string, id: string): string => `${base(ws, id)}/claims`,
  tasks: (ws: string, id: string): string => `${base(ws, id)}/tasks`,
  /** `path` is relative to the spec folder, as `EvidenceFile.path` gives it (`artifacts/T12-dashboard-model.md`). */
  evidenceFile: (ws: string, id: string, path: string): string => `${base(ws, id)}/evidence/file?path=${enc(path)}`,
  frames: (ws: string, id: string): string => `${base(ws, id)}/frames`,
  live: (ws: string, id: string): string => `${base(ws, id)}/live`,
  gateReviewed: (ws: string, id: string): string => `${base(ws, id)}/gate/reviewed`,
  taskCheck: (ws: string, id: string, tid: string): string => `${base(ws, id)}/tasks/${enc(tid)}/check`,
  transition: (ws: string, id: string): string => `${base(ws, id)}/transition`,
} as const satisfies Record<SpecRouteName, (...args: never[]) => string>;

export type SpecRouteMethod = 'GET' | 'POST';

export interface SpecRouteEntry {
  readonly route: SpecRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: SpecRouteMethod;
  /** The path pattern; `:ws`, `:id` and `:tid` are params. The evidence file adds the query `?path=`. */
  readonly pattern: string;
  /** Every status the route answers, ascending. */
  readonly statuses: readonly number[];
  /** The 200 body, by type name, for docs and the stub. */
  readonly response: string;
}

const P =`${SPEC_API_ROOT}/:ws/specs/:id`;

/** Every spec route exactly once. The matcher, the server's 405 `Allow`, the stub and the docs iterate it. */
export const SPEC_ROUTE_TABLE: readonly SpecRouteEntry[] = [
  { route: 'spec', method: 'GET', pattern: P, statuses: READ, response: 'SpecPageModel' },
  { route: 'timeline', method: 'GET', pattern: `${P}/timeline`, statuses: READ, response: 'TimelineEntry[]' },
  { route: 'claims', method: 'GET', pattern: `${P}/claims`, statuses: READ, response: 'ClaimViewModel' },
  { route: 'tasks', method: 'GET', pattern: `${P}/tasks`, statuses: READ, response: '(TasksTab & { steps: TaskSteps }) | null' },
  { route: 'evidenceFile', method: 'GET', pattern: `${P}/evidence/file`, statuses: READ, response: 'file bytes' },
  { route: 'frames', method: 'GET', pattern: `${P}/frames`, statuses: READ, response: 'Frame[]' },
  { route: 'live', method: 'GET', pattern: `${P}/live`, statuses: READ, response: 'LiveFrame & { steps: TaskSteps }' },
  { route: 'gateReviewed', method: 'POST', pattern: `${P}/gate/reviewed`, statuses: WRITE, response: 'GateReviewedResponse' },
  { route: 'taskCheck', method: 'POST', pattern: `${P}/tasks/:tid/check`, statuses: WRITE, response: 'TaskCheckResponse' },
  { route: 'transition', method: 'POST', pattern: `${P}/transition`, statuses: REFUSABLE_WRITE, response: 'TransitionWritten' },
];

/** The `Allow` header of a route's 405. */
export function allowFor(route: SpecRouteName): string {
  return SPEC_ROUTE_TABLE.find((entry) => entry.route === route)?.method === 'POST' ? 'POST' : 'GET, HEAD';
}

const COMPILED = SPEC_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The route a pathname names, whatever the method; null for any other path. Takes `URL.pathname` (still
 * percent-encoded). Each param segment is decoded once; a malformed escape or an empty segment is no match.
 */
export function matchSpecPath(pathname: string): SpecRouteMatch | null {
  const parts = pathname.split('/').slice(1);
  for (const { entry, segments } of COMPILED) {
    const params = matchSegments(segments, parts);
    // The pattern names exactly the params of its route (the round-trip test pins it), so the cast only restores the union.
    if (params !== null) return { route: entry.route, params } as unknown as SpecRouteMatch;
  }
  return null;
}

/** `matchSpecPath` restricted to the route's method (`HEAD` counts as `GET`); null otherwise. */
export function matchSpecRoute(pathname: string, method: string): SpecRouteMatch | null {
  const match = matchSpecPath(pathname);
  if (match === null) return null;
  const wanted = allowFor(match.route) === 'POST' ? ['POST'] : ['GET', 'HEAD'];
  return wanted.includes(method.toUpperCase()) ? match : null;
}

/**
 * The raw, still percent-encoded value of the first `path=` in a query (`URL.search`), or `''` when absent.
 * Deliberately not `URLSearchParams`, which decodes (and turns `+` into a space): `resolveEvidencePath` decodes once,
 * and a second decode here would let `%252e%252e` through as `..`. An absent or empty value is refused by core (403).
 */
export function evidencePathQuery(search: string): string {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if ((eq === -1 ? pair : pair.slice(0, eq)) === 'path') return eq === -1 ? '' : pair.slice(eq + 1);
  }
  return '';
}
