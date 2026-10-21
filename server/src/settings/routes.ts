/**
 * `GET` / `HEAD` / `PUT /api/settings` (T43, ISC-18.3; plan 001 § Interfaces) over the store in `schema.ts`. The route
 * keeps its own `no-store` JSON and its weak `ETag` over `Bun.hash`, byte-identical to what it always sent (a
 * recorded decision of spec 059), rather than `infra/http/json.ts`' strong one.
 */
import { isRecord } from "../contracts/guards.ts";
import { loopbackRefusal, methodNotAllowed, type Responder } from "../infra/http/guard.ts";
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

/**
 * `GET` / `HEAD` / `PUT /api/settings` as an `ApiHandler` for `serve({ api })`; `null` for any other path, so the
 * server's JSON 404 applies. Responses carry settings values and error codes only, never a path (ISC-3).
 */
export function settingsApi(store: SettingsStore): ApiHandler {
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

  return (req, url) => {
    if (url.pathname !== SETTINGS_PATH) return null;
    const refused = loopbackRefusal(req, respond);
    if (refused !== null) return refused;
    if (req.method === "GET" || req.method === "HEAD") return settingsResponse(store.get(), req);
    if (req.method === "PUT") return put(req);
    return methodNotAllowed(req, ALLOW, respond);
  };
}
