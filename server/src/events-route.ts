/**
 * The live update stream (spec 030, ISC-28; plan 030 § Interfaces): `GET /api/events` answers `text/event-stream`
 * and stays open. When the `WatchHub` reports a workspace's change, the read routes it touched are answered once by
 * the same handlers a poll reaches (`reads`), and every open stream gets one `LIVE_EVENT` frame with those answers as a
 * `LiveUpdate`: the workspace list, the dashboard, the planning tree and each changed spec, every `etag` and `body`
 * byte for byte what a `GET` on the `path` gives, so the client's next conditional read is a 304.
 *
 * - One build per workspace at a time. A change that arrives during a build is folded into one follow-up build, so a
 *   checkout or an implement round's burst costs at most two.
 * - A view whose read is not a 200 (a spec folder just removed, an unreadable workspace) is left out; the client's
 *   poll and its next read say the rest.
 * - A comment line every `HEARTBEAT_MS` keeps the connection under Bun's idle timeout (10 s) and re-syncs the hub's
 *   watchers with the registry and the spec worktrees.
 * - The guard is every route's: a foreign `Host` or `Origin` is 403, any method but `GET` 405 with `EVENTS_ALLOW`.
 *
 * Read-only: the stream reads what the read routes read and writes nothing (`tests/readonly.test.ts -t live`).
 */
import type { ApiHandler } from "./http.ts";
import { loopbackRefusal, methodNotAllowed } from "./infra/http/guard.ts";
import {
  EVENTS_ALLOW,
  EVENTS_PATH,
  LIVE_EVENT,
  type LiveUpdate,
  type LiveView,
  SPEC_API_ROOT,
  specRoutes,
  workspaceRoutes,
} from "./spec-routes.contract.ts";
import type { LiveChange, WatchHub } from "./watch.ts";

/** How often an idle stream gets a comment line; below Bun's default `idleTimeout` of 10 s. */
export const HEARTBEAT_MS = 5_000;
/** The reconnect delay the stream asks `EventSource` for after a drop. */
const RETRY_MS = 1_000;

export interface EventsApiOptions {
  readonly hub: WatchHub;
  /** The composed read handlers; the stream asks them as a poll would. */
  readonly reads: ApiHandler;
  /**
   * The server's workspace scan after a watcher change (spec 057 T1, ISC-352): run once per build, before the reads,
   * so the frame already shows its result. The favourites' prune (`favoritesScan`) is the one today; a failure is
   * swallowed and the frame still goes out.
   */
  readonly scan?: (change: LiveChange) => void | Promise<void>;
  readonly heartbeatMs?: number;
}

/** The read paths of one change, built by the contract's own builders so they equal the client's request paths. */
export function livePathsOf(change: LiveChange): string[] {
  const ws = encodeURIComponent(change.ws);
  return [
    SPEC_API_ROOT,
    `${SPEC_API_ROOT}/${ws}/dashboard`,
    workspaceRoutes.planning(change.ws),
    ...change.specIds.map((id) => specRoutes.spec(change.ws, id)),
  ];
}

const encoder = new TextEncoder();

export function eventsApi(options: EventsApiOptions): ApiHandler {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const building = new Map<string, { again: Set<string> | null }>();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const send = (chunk: string): void => {
    const bytes = encoder.encode(chunk);
    for (const controller of streams) {
      try {
        controller.enqueue(bytes);
      } catch {
        streams.delete(controller);
      }
    }
  };

  const read = async (path: string): Promise<LiveView | null> => {
    const url = new URL(`http://127.0.0.1${path}`);
    const req = new Request(url.href, { headers: { Host: "127.0.0.1" } });
    const res = await options.reads(req, url);
    if (res?.status !== 200) return null;
    const etag = res.headers.get("ETag");
    if (etag === null) return null;
    return { path, etag, body: JSON.parse(await res.text()) as unknown };
  };

  const build = async (change: LiveChange): Promise<void> => {
    try {
      await options.scan?.(change);
    } catch {
      // The scan is housekeeping; the live frame must not depend on it.
    }
    const views = await Promise.all(livePathsOf(change).map((path) => read(path).catch(() => null)));
    const update: LiveUpdate = { ws: change.ws, views: views.filter((view): view is LiveView => view !== null) };
    if (streams.size > 0) send(`event: ${LIVE_EVENT}\ndata: ${JSON.stringify(update)}\n\n`);
  };

  const onChange = (change: LiveChange): void => {
    const running = building.get(change.ws);
    if (running !== undefined) {
      running.again ??= new Set();
      for (const id of change.specIds) running.again.add(id);
      return;
    }
    const entry: { again: Set<string> | null } = { again: null };
    building.set(change.ws, entry);
    void (async () => {
      let next: LiveChange | null = change;
      while (next !== null) {
        await build(next).catch(() => undefined);
        const again: Set<string> | null = entry.again;
        entry.again = null;
        next = again === null ? null : { ws: change.ws, specIds: [...again].sort() };
      }
      building.delete(change.ws);
    })();
  };

  const open = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    streams.add(controller);
    controller.enqueue(encoder.encode(`retry: ${RETRY_MS}\n: connected\n\n`));
    unsubscribe ??= options.hub.subscribe(onChange);
    heartbeat ??= setInterval(() => {
      send(": ping\n\n");
      void options.hub.sync();
    }, heartbeatMs);
  };

  const close = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    if (!streams.delete(controller) || streams.size > 0) return;
    unsubscribe?.();
    unsubscribe = null;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
  };

  return (req, url) => {
    if (url.pathname !== EVENTS_PATH) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    if (req.method !== "GET") return methodNotAllowed(req, EVENTS_ALLOW);
    let self: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        open(controller);
      },
      cancel() {
        if (self !== null) close(self);
      },
    });
    req.signal.addEventListener("abort", () => {
      if (self === null) return;
      close(self);
      try {
        self.close();
      } catch {
        // Already closed by the client's cancel.
      }
    });
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}
