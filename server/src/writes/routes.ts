/**
 * The write routes' answers over the write paths of this slice: the stage move on a spec (`transitionAnswer`, which
 * the spec routes dispatch) and the three workspace writes, the allocation, the backlog and the run release, each with
 * its route layer (`workspaceWriteRoutes`, which the workspace routes dispatch).
 *
 * The transition route (spec 008, T83, ISC-130): `POST …/:id/transition`, the board's stage move. The body is
 * `{to, hash}` (`isTransitionRequest`, 400 otherwise), `hash` the raw sha256 of spec.md the client read
 * (`X-Spectant-Spec-Hash` on `GET …/:id`, or the planning holder's `hash`). The write is `writeTransition`: the lock
 * sources (423 while a session holds a claim of the spec), the raw hash compare (409 `StaleSpec`, nothing written),
 * `planTransition` (422 `TransitionRefused` with the stage row's `reason` and `command`, nothing written), then spec.md
 * in place and one event line appended to `events.jsonl`. The event's actor is the viewer's `u:` id from the workspace
 * reading, `VIEWER_ACTOR_FALLBACK` without one; the client never names it. 403 (loopback guard), 404 (unknown
 * workspace or spec) and the unreadable workspace's 409 are the route layer's, as on every spec route (`spec/`).
 *
 * The allocation route (spec 008, T87, ISC-130.2): `POST /api/workspaces/:ws/ideas/:slug/allocate`, starting a story
 * from the board or the story page. The body is `{hash}` (`isAllocateRequest`, 400 otherwise), `hash` the raw sha256
 * of the story file the client read (`IdeaPage.hash` on `GET …/ideas/:slug`). The write is `writeAllocate`: 404 for a
 * slug `readIdeas` does not list, the raw hash compare (409 `StaleIdea`, nothing written), the index and the folder's
 * name (422 `AllocateRefused`, nothing written), then `specs/NNN-slug/` with `context.md`, `spec.md` and `events.jsonl`
 * and the story file removed. The creation event's actor is the viewer's `u:` id, `VIEWER_ACTOR_FALLBACK` without one;
 * the client never names it. A story has no claim lock, so the one 423 this route answers is the run lock's
 * `run-locked`, while a run on the story is running (spec 040, ISC-225; `writeAllocate`).
 *
 * The backlog route (spec 036, ISC-191, ISC-191.1): `POST /api/workspaces/:ws/backlog`, ranking the features of the
 * planning tree. The body is a `BacklogRequest` (`isBacklogRequest`, 400 otherwise): `{op: 'move', feature, before,
 * hash}` or `{op: 'priority', feature, priority, hash}`, `hash` the raw sha256 of `specs/backlog.md` the client read
 * (`PlanningModel.backlogHash`). The write is `writeBacklog`: the raw hash compare (409 `StaleBacklog`, nothing
 * written), core's plan (422 `BacklogRefused` with its reason, nothing written), then the whole list in
 * `specs/backlog.md` and one line in `specs/backlog.events.jsonl`. The event's actor is the viewer's `u:` id,
 * `VIEWER_ACTOR_FALLBACK` without one; the client never names it. No lock source is read, so no 423.
 *
 * The run release route (spec 040, T36, ISC-226): `POST /api/workspaces/:ws/runs/:run/release`, ending the open run
 * `:run` as `released` from the button on an item in `running`. It takes no body: the client sends the raw sha256 of
 * `.spectant/activity.jsonl` it rendered in `X-Spectant-Activity-Hash` (`runReleaseRequestFromHeader`; 400
 * `invalid-body` when absent or malformed). The write is `writeRunRelease`, in the order of the other write routes:
 * 404 (no such open run), 409 `StaleActivity` (the log changed since render), 422 `RunReleaseRefused` (`no-viewer`,
 * `run-aborted`), then one appended `run-end` line and 200 `RunReleased`. No claim lock is read and no run locks the
 * release, so no 423.
 *
 * On the three workspace writes, 403 (loopback guard) and 405 (`Allow: POST`) are the router's (the workspace family,
 * `workspace/family.ts`; spec 059, ISC-412); 404 (unknown workspace) and the unreadable workspace's 409 are
 * `readableWorkspace`'s, as on every workspace route.
 */
import type { SpecRef } from "../../../core/src/resolve.ts";
import {
  ACTIVITY_HASH_HEADER,
  type WorkspaceRouteMatch,
  isAllocateRequest,
  isBacklogRequest,
  runReleaseRequestFromHeader,
} from "../contracts/spec-routes.contract.ts";
import { type WriteAnswer, parseWriteBody } from "../contracts/writes.contract.ts";
import { abortAge } from "../infra/abort-age.ts";
import { json, parseJson } from "../infra/http/json.ts";
import type { RouteHandlers } from "../infra/http/router.ts";
import { type WorkspaceContext, readableWorkspace } from "../workspace/index.ts";
import { writeAllocate } from "./allocate.ts";
import { writeBacklog } from "./backlog.ts";
import { writeRunRelease } from "./run-release.ts";
import type { WriteResult } from "./run-write.ts";
import { writeTransition } from "./transition.ts";

export interface TransitionRouteInput {
  readonly root: string;
  readonly ref: Pick<SpecRef, "dir" | "slug">;
  readonly stateDir: string | null;
  readonly now: Date;
  /** The request body as sent. */
  readonly text: string;
  /** The run lock's abort age (`WriteInput.abortAfterMs`, spec 040). */
  readonly abortAfterMs?: number;
}

/** The answer of one stage move: 400 for a body that is no `TransitionRequest`, otherwise the write's own answer. */
export async function transitionAnswer(input: TransitionRouteInput): Promise<WriteResult<"transition">> {
  const parsed = parseWriteBody("transition", input.text);
  if (!parsed.ok) return { status: 400, body: parsed.error };
  const age = abortAge(input.abortAfterMs);
  return writeTransition({ root: input.root, ref: input.ref, stateDir: input.stateDir, now: input.now, body: parsed.body, ...age });
}

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
  const age = abortAge(input.abortAfterMs);
  return writeAllocate({ root: input.root, slug: input.slug, stateDir: input.stateDir, now: input.now, body: data, ...age });
}

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

export interface RunReleaseRouteInput {
  /** The repository root: the main checkout, where `.spectant/activity.jsonl` is. */
  readonly root: string;
  readonly now: Date;
  /** The route's `:run`, decoded once. */
  readonly run: string;
  /** The request's headers, for `X-Spectant-Activity-Hash`. */
  readonly headers: Headers;
  /** The `runAbortMinutes` setting × 60 000; core's default when absent. */
  readonly abortAfterMs?: number;
}

/** The answer of one release: 400 without a well-formed hash header, otherwise the write's own answer. */
export async function runReleaseAnswer(input: RunReleaseRouteInput): Promise<WriteResult<"runRelease">> {
  const request = runReleaseRequestFromHeader(input.headers.get(ACTIVITY_HASH_HEADER));
  if (request === null) return { status: 400, body: { error: "invalid-body" } };
  const age = abortAge(input.abortAfterMs);
  return writeRunRelease({ root: input.root, now: input.now, run: input.run, hash: request.hash, ...age });
}

/** The three workspace writes behind their route layer, each answering one `POST` the dispatcher has matched. */
export interface WorkspaceWriteRoutes {
  readonly allocate: (req: Request, slug: string, story: string) => Promise<Response>;
  readonly backlog: (req: Request, slug: string) => Promise<Response>;
  readonly runRelease: (req: Request, slug: string, run: string) => Promise<Response>;
}

/** The workspace writes over the family's one context: the lock source and the clock are the context's, as on the reads. */
export function workspaceWriteRoutes(ctx: WorkspaceContext): WorkspaceWriteRoutes {
  const { stateDir, clock } = ctx;

  // The one write of the family (T87): the route layer's 404 and 409 here, everything else in `allocateAnswer`.
  const allocate = (req: Request, slug: string, story: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const age = ctx.abortAge();
      const answer = await allocateAnswer({ root, slug: story, stateDir, now: clock(), text: await req.text(), ...age });
      return json(req, answer.status, answer.body);
    });

  // The backlog write (spec 036): the route layer's 404 and 409 here, everything else in `backlogAnswer`.
  const backlog = (req: Request, slug: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const answer = await backlogAnswer({ root, now: clock(), text: await req.text() });
      return json(req, answer.status, answer.body);
    });

  // The run release (spec 040, ISC-226): the route layer's 404 and 409 here, everything else in `runReleaseAnswer`.
  const runRelease = (req: Request, slug: string, run: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const age = ctx.abortAge();
      const answer = await runReleaseAnswer({ root, now: clock(), run, headers: req.headers, ...age });
      return json(req, answer.status, answer.body);
    });

  return { allocate, backlog, runRelease };
}

/** The workspace family's three writes. */
export type WorkspaceWriteRoute = keyof WorkspaceWriteRoutes;

/** The three workspace writes as handlers of the workspace family, each given its route's match. */
export function workspaceWriteHandlers(ctx: WorkspaceContext): RouteHandlers<Extract<WorkspaceRouteMatch, { route: WorkspaceWriteRoute }>> {
  const { allocate, backlog, runRelease } = workspaceWriteRoutes(ctx);
  return {
    allocate: (req, _url, match) => allocate(req, match.params.ws, match.params.slug),
    backlog: (req, _url, match) => backlog(req, match.params.ws),
    runRelease: (req, _url, match) => runRelease(req, match.params.ws, match.params.run),
  } satisfies RouteHandlers<Extract<WorkspaceRouteMatch, { route: WorkspaceWriteRoute }>>;
}
