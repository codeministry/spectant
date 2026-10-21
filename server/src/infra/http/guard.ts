/**
 * The loopback guard and the 405 every API route shares.
 *
 * The server binds loopback only. A request whose `Host` is not a loopback name is DNS rebinding, and a browser
 * request whose `Origin` is not a loopback page is cross-site: both are 403 `{error: "forbidden"}` before anything else
 * of the route runs. A method the route does not take is 405 `{error: "method-not-allowed"}` with the route's `Allow`.
 * Both answers go through `json()` unless the route passes its own responder (settings, prototype headers). The
 * prototype route keeps its own guard: a sandboxed page's opaque `Origin: null` passes it for reads.
 */
import { json } from "./json.ts";

/** How a route answers JSON: `json()` of `json.ts` unless the route brings its own headers. */
export type Responder = (req: Request, status: number, value: unknown, headers?: Record<string, string>) => Response;

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** True for a loopback `host[:port]`. The server binds loopback only; a foreign name here means DNS rebinding. */
export function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

/** A browser sends `Origin` on a cross-origin request; it must be a loopback page too. Absent means a non-browser client. */
export function isLoopbackOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/** The guard's 403 for a foreign `Host` or a cross-site `Origin`; `null` lets the route go on. */
export function loopbackRefusal(req: Request, respond: Responder = json): Response | null {
  if (isLoopbackHost(req.headers.get("Host")) && isLoopbackOrigin(req.headers.get("Origin"))) return null;
  return respond(req, 403, { error: "forbidden" });
}

/** The 405 for a method the route does not take, naming the ones it does in `Allow`. */
export function methodNotAllowed(req: Request, allow: string, respond: Responder = json): Response {
  return respond(req, 405, { error: "method-not-allowed" }, { Allow: allow });
}
