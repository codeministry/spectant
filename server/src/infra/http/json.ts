/**
 * The JSON answer every API route shares, the composition of route handlers and the request body reader.
 *
 * Every JSON answer carries a strong `ETag`, the sha256 of the exact body, and `Cache-Control: no-cache`, so the web
 * app's polling revalidates every time and transfers only a change; a matching `If-None-Match` on a 200 `GET` or
 * `HEAD` is a 304, and `HEAD` gets the same headers without the body.
 */
import type { ApiHandler } from "../../http.ts";
import { matchesIfNoneMatch } from "../../http.ts";

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

function strongEtag(body: string): string {
  return `"${new Bun.CryptoHasher("sha256").update(body).digest("base64url")}"`;
}

/** A JSON answer with its ETag; 304 for a matching `If-None-Match` on a 200, no body on `HEAD`. `lifeos.ts` shares it. */
export function json(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: strongEtag(body),
    ...extra,
  };
  const read = req.method === "GET" || req.method === "HEAD";
  if (status === 200 && read && matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === "HEAD" ? null : body, { status, headers });
}

/** The request's JSON body, or `undefined` when it is not JSON; the validators refuse `undefined`. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}
