/**
 * The workspace routes (T47, ISC-16; plan 001 § Interfaces "HTTP"), read-only over the registry and the files of the
 * registered repositories:
 *
 * - `GET /api/workspaces` → `WorkspaceSummary[]` in registry order: `{slug, name, pathTail, readable, error?, counts}`.
 *   `counts` is the workspace's `DashboardKpis`, built without a services probe; `null` when unreadable.
 * - `GET /api/workspaces/:slug/dashboard` → the `DashboardModel` of `core/src/dashboard.ts`, unchanged, its `services`
 *   from the local-listener probe labelled with the constitution's `dev_services:`.
 *
 * Answers:
 * - 200 with the JSON body; `HEAD` gets the same headers without it.
 * - 304 when `If-None-Match` matches. Every JSON answer carries a strong `ETag`, the sha256 of the exact body, and
 *   `Cache-Control: no-cache`, so the web app's polling revalidates every time and transfers only a change.
 * - 404 `{error: "not-found"}` for an unknown slug.
 * - 409 with the workspace's own summary (`readable: false`, `error` one of `missing`, `not-a-directory`,
 *   `permission-denied`, `unreadable`, `counts: null`) for a registered workspace whose directory cannot be read: the
 *   workspace exists, its files do not answer. The same entry appears in the list, so the client shows one notice for
 *   both, and a 2xx dashboard answer is always a model.
 * - 403 `{error: "forbidden"}` for a non-loopback `Host` or a cross-site `Origin`, the guard of `settingsApi`.
 * - 405 `{error: "method-not-allowed"}` with `Allow: GET, HEAD` for any other method.
 * - any other `/api/workspaces…` path is `null`, so the server's JSON 404 applies.
 *
 * No absolute path leaves this module (ISC-3): a workspace is its slug, its name and `pathTail`, the last path segment;
 * the unreadable codes replace OS messages, which would name the path.
 */
import type { DashboardKpis } from "../../core/src/dashboard.ts";
import type { ApiHandler } from "./http.ts";
import { matchesIfNoneMatch } from "./http.ts";
import type { Registry, Workspace } from "./registry.ts";
import { listServices } from "./services.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";
import { type DashboardLoad, type ServicesProbe, type UnreadableCode, loadDashboard } from "./workspace-loader.ts";

/** The list route; a dashboard is `${WORKSPACES_PATH}/:slug/dashboard`. */
export const WORKSPACES_PATH = "/api/workspaces";

const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;
const ALLOW = "GET, HEAD";

/** One entry of `GET /api/workspaces`, and the body of a 409 dashboard answer. */
export type WorkspaceSummary = {
  slug: string;
  name: string;
  /** The last segment of the workspace path; the path itself never leaves the server. */
  pathTail: string;
  readable: boolean;
  /** Present only when `readable` is false. */
  error?: UnreadableCode;
  /** The workspace's key numbers; null when it cannot be read. */
  counts: DashboardKpis | null;
};

export type DashboardApiOptions = {
  registry: Pick<Registry, "list" | "get">;
  /** Reads one workspace; `loadDashboard` by default. Tests inject another loader. */
  loadWorkspace?: (root: string, probe: ServicesProbe | null) => Promise<DashboardLoad>;
  /** Probes the local listeners for the dashboard route; `listServices` (lsof) by default. */
  services?: ServicesProbe;
};

/**
 * The first handler that answers wins; `null` from all of them lets the server's JSON 404 apply. A handler declines
 * with a synchronous `null` (`ApiHandler` allows no `Promise<null>`), so a returned promise is always its answer and
 * the composition never waits on a handler that does not own the path.
 */
export function composeApi(...handlers: ApiHandler[]): ApiHandler {
  return (req, url) => {
    for (const handler of handlers) {
      const answer = handler(req, url);
      if (answer !== null) return answer;
    }
    return null;
  };
}

/** The last path segment, whatever the separator. */
function pathTail(path: string): string {
  return path.split(/[\\/]/).filter((segment) => segment !== "").pop() ?? "";
}

function strongEtag(body: string): string {
  return `"${new Bun.CryptoHasher("sha256").update(body).digest("base64url")}"`;
}

/** A JSON answer with its ETag; 304 for a matching `If-None-Match` on a 200, no body on `HEAD`. */
function json(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: strongEtag(body),
    ...extra,
  };
  if (status === 200 && matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === "HEAD" ? null : body, { status, headers });
}

function summary(workspace: Workspace, load: DashboardLoad): WorkspaceSummary {
  const base = { slug: workspace.slug, name: workspace.name, pathTail: pathTail(workspace.path) };
  return load.readable
    ? { ...base, readable: true, counts: load.model.kpis }
    : { ...base, readable: false, error: load.error, counts: null };
}

const defaultServices: ServicesProbe = (repoRoot, labels) => listServices({ repoRoot, labels });

/**
 * `GET` / `HEAD` of the two workspace routes as an `ApiHandler`; `null` for every other path. Nothing is cached: each
 * request reads the registry and the files again, so a `spectant add` or an edited spec shows on the next poll, and
 * the ETag keeps an unchanged answer to a 304.
 */
export function dashboardApi(options: DashboardApiOptions): ApiHandler {
  const { registry } = options;
  const load = options.loadWorkspace ?? loadDashboard;
  const services = options.services ?? defaultServices;

  const list = async (req: Request): Promise<Response> => {
    const workspaces = registry.list();
    const loads = await Promise.all(workspaces.map((w) => load(w.path, null)));
    return json(req, 200, workspaces.map((w, i) => summary(w, loads[i] ?? { readable: false, error: "unreadable" })));
  };

  const dashboard = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await load(workspace.path, services);
    if (!loaded.readable) return json(req, 409, summary(workspace, loaded));
    return json(req, 200, loaded.model);
  };

  return (req, url) => {
    const { pathname } = url;
    const match = DASHBOARD_PATH.exec(pathname);
    if (pathname !== WORKSPACES_PATH && !match) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(req, 405, { error: "method-not-allowed" }, { Allow: ALLOW });
    if (!match) return list(req);
    let slug: string;
    try {
      slug = decodeURIComponent(match[1] ?? "");
    } catch {
      return json(req, 404, { error: "not-found" });
    }
    return dashboard(req, slug);
  };
}
