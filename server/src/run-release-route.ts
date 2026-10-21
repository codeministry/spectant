/**
 * The run release route (spec 040, T36, ISC-226): `POST /api/workspaces/:ws/runs/:run/release`, ending the open run
 * `:run` as `released` from the button on an item in `running`. It takes no body: the client sends the raw sha256 of
 * `.spectant/activity.jsonl` it rendered in `X-Spectant-Activity-Hash` (`runReleaseRequestFromHeader`; 400
 * `invalid-body` when absent or malformed). The write is `writes.ts`'s `writeRunRelease`, in the order of the other
 * write routes: 404 (no such open run), 409 `StaleActivity` (the log changed since render), 422 `RunReleaseRefused`
 * (`no-viewer`, `run-aborted`), then one appended `run-end` line and 200 `RunReleased`. No claim lock is read and no run
 * locks the release, so no 423. 403 (loopback guard), 405 (`Allow: POST`), 404 (unknown workspace) and the unreadable
 * workspace's 409 are the route layer's (`api.ts`), as on every workspace route.
 */
import { ACTIVITY_HASH_HEADER, runReleaseRequestFromHeader } from "./spec-routes.contract.ts";
import { type WriteResult, writeRunRelease } from "./writes.ts";
import { abortAge } from "./infra/abort-age.ts";

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
