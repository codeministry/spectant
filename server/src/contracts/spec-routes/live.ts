/**
 * The live update stream in the spec routes contract (part of `contracts/spec-routes.contract.ts`).
 */
import { API_PREFIX } from '../assets.contract.ts';
import { isRecord } from '../guards.ts';
import { hasOnlyKeys } from './route-match.ts';

// ─── Live update stream ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The live update stream (spec 030, ISC-28; plan 030 § Interfaces); it names no workspace and is no family's, like
 * `ACTORS_PATH`. `GET` answers `text/event-stream` and stays open: when a watched file of a registered repository
 * changes (`specs/`, `ISA.md`, `.spectant/`, in the checkout and in each spec worktree), one `LIVE_EVENT` frame carries
 * the read routes it touched as a `LiveUpdate`, and a comment line keeps the connection alive in between. 403 is a
 * foreign `Host` or `Origin`, 405 any other method with `EVENTS_ALLOW`.
 */
export const EVENTS_PATH = `${API_PREFIX}events`;
export const EVENTS_ALLOW = 'GET';
export const EVENTS_STATUSES = [200, 403, 405] as const;
/** The SSE `event:` name of a `LiveUpdate` frame. */
export const LIVE_EVENT = 'update';

/**
 * One read route's answer as a poll would get it: `path` is the request path (`/api/workspaces`,
 * `/api/workspaces/:ws/dashboard`, `…/planning`, `…/specs/:id`, and in every frame `/api/status`, the status widget's
 * view across all workspaces, spec 071 ISC-587), `etag` and `body` are byte for byte the `ETag` header and the parsed
 * JSON body of a `GET` on it.
 */
export interface LiveView {
  readonly path: string;
  readonly etag: string;
  readonly body: unknown;
}

/** One frame of the stream: the workspace whose files changed and the read routes that changed with them. */
export interface LiveUpdate {
  readonly ws: string;
  readonly views: readonly LiveView[];
}

/** A parsed `LIVE_EVENT` payload; anything else is dropped by the client. */
export function isLiveUpdate(body: unknown): body is LiveUpdate {
  if (!isRecord(body) || !hasOnlyKeys(body, ['ws', 'views'])) return false;
  const { ws, views } = body;
  return typeof ws === 'string' && Array.isArray(views) && views.every((view: unknown) => isLiveView(view));
}

function isLiveView(view: unknown): view is LiveView {
  if (!isRecord(view) || !hasOnlyKeys(view, ['path', 'etag', 'body'])) return false;
  const { path, etag } = view;
  return typeof path === 'string' && path.startsWith(API_PREFIX) && typeof etag === 'string' && 'body' in view;
}
