/**
 * The allocation route (spec 008, T87, ISC-130.2): `POST /api/workspaces/:ws/ideas/:slug/allocate`, starting a story
 * from the board or the story page. The body is `{hash}` (`isAllocateRequest`, 400 otherwise), `hash` the raw sha256
 * of the story file the client read (`IdeaPage.hash` on `GET …/ideas/:slug`). The write is `writes.ts`'s
 * `writeAllocate`: 404 for a slug `readIdeas` does not list, the raw hash compare (409 `StaleIdea`, nothing written),
 * the index and the folder's name (422 `AllocateRefused`, nothing written), then `specs/NNN-slug/` with `context.md`,
 * `spec.md` and `events.jsonl` and the story file removed. The creation event's actor is the viewer's `u:` id,
 * `VIEWER_ACTOR_FALLBACK` without one; the client never names it. A story has no claim lock, so the one 423 this route
 * answers is the run lock's `run-locked`, while a run on the story is running (spec 040, ISC-225; `writeAllocate`). 403 (loopback guard), 405 (`Allow: POST`), 404 (unknown workspace) and the unreadable
 * workspace's 409 are the route layer's (`api.ts`), as on every workspace route.
 */
import { isAllocateRequest } from "./spec-routes.contract.ts";
import { parseJson } from "./infra/http/json.ts";
import { type WriteResult, writeAllocate } from "./writes.ts";

export interface AllocateRouteInput {
  readonly root: string;
  /** The story's slug as the path names it, decoded once. */
  readonly slug: string;
  readonly stateDir: string | null;
  readonly now: Date;
  /** The request body as sent. */
  readonly text: string;
  /** The run lock's abort age (`WriteInput.abortAfterMs`, spec 040). */
  readonly abortAfterMs?: number;
}

/** The answer of one allocation: 400 for a body that is no `AllocateRequest`, otherwise the write's own answer. */
export async function allocateAnswer(input: AllocateRouteInput): Promise<WriteResult<"allocate">> {
  const data = parseJson(input.text);
  if (!isAllocateRequest(data)) return { status: 400, body: { error: "invalid-body" } };
  const age = input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs };
  return writeAllocate({ root: input.root, slug: input.slug, stateDir: input.stateDir, now: input.now, body: data, ...age });
}
