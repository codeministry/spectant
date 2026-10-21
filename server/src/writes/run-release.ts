/**
 * The run release (spec 040, T35, ISC-226): `writeRunRelease`, the eighth write path and its one file,
 * `.spectant/activity.jsonl` at the main checkout: exactly one `run-end` line with `outcome: released` and the
 * viewer's `u:` id, appended under the raw sha256 of the whole file; never a rewrite, no directory created.
 */
import { abortAge } from "../infra/abort-age.ts";
import { join } from "node:path";
import { type RunLockTarget, runLockOf } from "../../../core/src/item-state.ts";
import { activityReading } from "../../../core/src/locks.ts";
import { ACTIVITY_PATH, activityConflict, runReleaseAppendBytes, runReleaseEvent } from "../contracts/writes.contract.ts";
import { appendInPlace } from "../infra/fs/in-place.ts";
import { readBytesIfExists } from "../infra/fs/read.ts";
import { rawSha256 } from "../infra/hash.ts";
import { viewerActorOf } from "../workspace/index.ts";
import type { WriteResult } from "./run-write.ts";

export interface RunReleaseWriteInput {
  /** The repository root: the activity log lives once per repository, at the main checkout (`WRITE_TABLE.runRelease.root`). */
  readonly root: string;
  readonly now: Date;
  /** The run id of the route, decoded once. */
  readonly run: string;
  /** The raw sha256 of `.spectant/activity.jsonl` the client rendered (`X-Spectant-Activity-Hash`). */
  readonly hash: string;
  /** The age after which an open run reads `aborted` (`runAbortMinutes` × 60 000); core's default when absent. */
  readonly abortAfterMs?: number;
}

/**
 * One run release (`WRITE_PATHS.runRelease`). Before the write's one await: the viewer's actor (`viewerActorOf`, no
 * fallback: the release names a person or is refused). Then synchronously, so nothing in this process runs between the
 * read, the checks and the append:
 *
 * 1. `.spectant/activity.jsonl` is read once (the empty text without it) and read by core (`activityReading`): no open
 *    run with the id, unknown or already ended, is 404, nothing written;
 * 2. its raw sha256 against the client's: a mismatch is 409 `StaleActivity` with the hash now, nothing written. The
 *    hash covers the whole file, so a line the plugin appended since render is the 409, never a race;
 * 3. no `u:` viewer is 422 `no-viewer`; a run core reads `aborted` (`runLockOf` over that run alone, at `now` and the
 *    abort age) is 422 `run-aborted`: it locks nothing, so there is nothing to release. Nothing written;
 * 4. on yes: one `appendInPlace` of the one `run-end` line (`runReleaseEvent`), after a newline when the log lacks its
 *    last one. The run is then ended and the run lock of ISC-225 on its item lifted (another open run may still hold
 *    it). No other file changes, and no directory is created.
 */
export async function writeRunRelease(input: RunReleaseWriteInput): Promise<WriteResult<"runRelease">> {
  const { root, now, run, hash } = input;
  const viewer = await viewerActorOf(root);
  const path = join(root, ACTIVITY_PATH);
  const raw = readBytesIfExists(path) ?? Buffer.alloc(0);
  const text = raw.toString("utf8");
  const open = (activityReading(text).openRuns ?? []).find((r) => r.run === run);
  if (open === undefined) return { status: 404, body: { error: "not-found" } };
  const stale = activityConflict(hash, rawSha256(raw));
  if (stale !== null) return { status: 409, body: stale };
  if (viewer === null) return { status: 422, body: { error: "release-refused", reason: "no-viewer" } };
  const target: RunLockTarget = open.spec === undefined ? { idea: open.idea ?? "" } : { spec: open.spec };
  const running = runLockOf([open], target, { now, ...abortAge(input.abortAfterMs) });
  if (running === null) return { status: 422, body: { error: "release-refused", reason: "run-aborted" } };
  const event = runReleaseEvent(now.toISOString(), open, viewer);
  const bytes = runReleaseAppendBytes(text, event);
  appendInPlace(path, bytes);
  return { status: 200, body: { hash: rawSha256(Buffer.concat([raw, Buffer.from(bytes, "utf8")])), event } };
}
