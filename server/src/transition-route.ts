/**
 * The transition route (spec 008, T83, ISC-130): `POST …/:id/transition`, the board's stage move. The body is
 * `{to, hash}` (`isTransitionRequest`, 400 otherwise), `hash` the raw sha256 of spec.md the client read
 * (`X-Spectant-Spec-Hash` on `GET …/:id`, or the planning holder's `hash`). The write is `writes.ts`'s
 * `writeTransition`: the lock sources (423 while a session holds a claim of the spec), the raw hash compare (409
 * `StaleSpec`, nothing written), `planTransition` (422 `TransitionRefused` with the stage row's `reason` and
 * `command`, nothing written), then spec.md in place and one event line appended to `events.jsonl`. The event's
 * actor is the viewer's `u:` id from the workspace reading, `VIEWER_ACTOR_FALLBACK` without one; the client never
 * names it. 403 (loopback guard), 404 (unknown workspace or spec) and the unreadable workspace's 409 are the route
 * layer's, as on every spec route (`spec-routes.ts`).
 */
import type { SpecRef } from "../../core/src/resolve.ts";
import { parseWriteBody } from "./writes.contract.ts";
import { type WriteResult, writeTransition } from "./writes.ts";

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
  const age = input.abortAfterMs === undefined ? {} : { abortAfterMs: input.abortAfterMs };
  return writeTransition({ root: input.root, ref: input.ref, stateDir: input.stateDir, now: input.now, body: parsed.body, ...age });
}
