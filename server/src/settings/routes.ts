/**
 * `GET` / `HEAD` / `PUT /api/settings` (T43, ISC-18.3; plan 001 § Interfaces) over the store in `schema.ts`. The route
 * keeps its own `no-store` JSON and its weak `ETag` over `Bun.hash`, byte-identical to what it always sent (a
 * recorded decision of spec 059), rather than `infra/http/json.ts`' strong one. The route is the router's
 * `SETTINGS_FAMILY` (spec 059, ISC-412), its 403 and 405 in that same JSON.
 */
import { isRecord } from "../contracts/guards.ts";
import type { Responder } from "../infra/http/guard.ts";
import { type PathMatch, type RouteHandlers, createRouter, pathFamily } from "../infra/http/router.ts";
import { type ApiHandler, matchesIfNoneMatch } from "../infra/http/server.ts";
import { type Settings, SettingsError, type SettingsStore } from "./schema.ts";

/** The route this module answers. */
export const SETTINGS_PATH = "/api/settings";

const ALLOW = "GET, HEAD, PUT";

function etagFor(body: string): string {
  return `W/"${Bun.hash(body).toString(36)}"`;
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

/** The guard's 403 and the 405 in this route's own `no-store` JSON. */
const respond: Responder = (_req, status, value, headers) => json(status, value, headers);

function settingsResponse(settings: Settings, req: Request): Response {
  const body = JSON.stringify(settings);
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ETag: etagFor(body) };
  if (req.method !== "PUT" && matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === "HEAD" ? null : body, { headers });
}

/** The settings route as the router's family: `/api/settings` alone, refused in the route's own JSON. */
export const SETTINGS_FAMILY = pathFamily("settings", SETTINGS_PATH, ALLOW, respond);

/**
 * The handler of `GET` / `HEAD` / `PUT /api/settings`; the router has checked the guard and the method. Responses
 * carry settings values and error codes only, never a path (ISC-3).
 */
export function settingsHandlers(store: SettingsStore): RouteHandlers<PathMatch<"settings">> {
  const put = async (req: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "invalid-body" });
    }
    if (!isRecord(body)) return json(400, { error: "invalid-body" });
    try {
      return settingsResponse(store.set(body), req);
    } catch (error) {
      if (error instanceof SettingsError) return json(400, { error: error.code, key: error.key });
      throw error;
    }
  };

  return {
    settings: (req) => (req.method === "PUT" ? put(req) : settingsResponse(store.get(), req)),
  } satisfies RouteHandlers<PathMatch<"settings">>;
}

/** `GET` / `HEAD` / `PUT /api/settings` alone as an `ApiHandler`; `null` for any other path, so the server's 404 applies. */
export function settingsApi(store: SettingsStore): ApiHandler {
  return createRouter([SETTINGS_FAMILY], settingsHandlers(store));
}
