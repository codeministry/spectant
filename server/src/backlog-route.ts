/**
 * The backlog route (spec 036, ISC-191, ISC-191.1): `POST /api/workspaces/:ws/backlog`, ranking the features of the
 * planning tree. The body is a `BacklogRequest` (`isBacklogRequest`, 400 otherwise): `{op: 'move', feature, before,
 * hash}` or `{op: 'priority', feature, priority, hash}`, `hash` the raw sha256 of `specs/backlog.md` the client read
 * (`PlanningModel.backlogHash`). The write is `writes.ts`'s `writeBacklog`: the raw hash compare (409 `StaleBacklog`,
 * nothing written), core's plan (422 `BacklogRefused` with its reason, nothing written), then the whole list in
 * `specs/backlog.md` and one line in `specs/backlog.events.jsonl`. The event's actor is the viewer's `u:` id,
 * `VIEWER_ACTOR_FALLBACK` without one; the client never names it. No lock source is read, so no 423. 403 (loopback
 * guard), 405 (`Allow: POST`), 404 (unknown workspace) and the unreadable workspace's 409 are the route layer's
 * (`api.ts`), as on every workspace route.
 */
import { isBacklogRequest } from "./spec-routes.contract.ts";
import { parseJson } from "./infra/http/json.ts";
import type { WriteAnswer } from "./writes.contract.ts";
import { writeBacklog } from "./writes.ts";

export interface BacklogRouteInput {
  readonly root: string;
  readonly now: Date;
  /** The request body as sent. */
  readonly text: string;
}

/** The answer of one backlog write: 400 for a body that is no `BacklogRequest`, otherwise the write's own answer. */
export async function backlogAnswer(input: BacklogRouteInput): Promise<WriteAnswer<"backlog">> {
  const data = parseJson(input.text);
  if (!isBacklogRequest(data)) return { status: 400, body: { error: "invalid-body" } };
  return writeBacklog({ root: input.root, now: input.now, body: data });
}
