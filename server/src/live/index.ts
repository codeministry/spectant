/**
 * The `live/` slice's one public surface (spec 059): the live update stream `GET /api/events` and the watch hub that
 * reports, per workspace, which specs changed; the stream as the router's family and handler, and alone.
 */
export { EVENTS_FAMILY, type EventsApiOptions, HEARTBEAT_MS, eventsApi, eventsHandlers, livePathsOf } from "./events.ts";
export {
  type LiveChange,
  type LiveListener,
  SETTLE_MS,
  type WatchFn,
  type WatchHub,
  type WatchHubOptions,
  createWatchHub,
} from "./hub.ts";
