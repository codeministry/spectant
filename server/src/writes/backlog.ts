/**
 * The backlog (spec 036, ISC-191, ISC-191.1): `writeBacklog`, the one write that reads no lock source:
 * `specs/backlog.md` belongs to no spec.
 */
import { join } from "node:path";
import { backlogFeatures, planBacklogMove, planBacklogPriority } from "../../../core/src/backlog.ts";
import type { BacklogRequest } from "../contracts/spec-routes.contract.ts";
import { BACKLOG_EVENTS_PATH, BACKLOG_PATH, type WriteAnswer, backlogConflict, writeActorOf } from "../contracts/writes.contract.ts";
import { appendInPlace, writeInPlace } from "../infra/fs/in-place.ts";
import { readBytesIfExists, readIfExists } from "../infra/fs/read.ts";
import { rawSha256 } from "../infra/hash.ts";
import { viewerActorOf } from "../workspace/index.ts";

export interface BacklogWriteInput {
  /** The repository root: the backlog lives once per repository, at the main checkout (`WRITE_TABLE.backlog.root`). */
  readonly root: string;
  readonly now: Date;
  readonly body: BacklogRequest;
}

/**
 * One backlog write (FORMAT.md § backlog, Writing). Before the write's one await: the viewer's actor (`writeActorOf`).
 * Then synchronously, with no lock source read (`specs/backlog.md` belongs to no spec, and no agent writes it, so
 * there is no claim to hold it):
 *
 * 1. `specs/backlog.md` is read once and hashed raw (the empty text when the file is missing) and compared with the
 *    client's hash: a mismatch is 409 `StaleBacklog` with the hash now, nothing written;
 * 2. core plans the write over exactly those bytes and the master's feature blocks (`backlogFeatures`,
 *    `planBacklogMove` / `planBacklogPriority`): a refusal is 422 `BacklogRefused` with core's reason, nothing written;
 * 3. on yes: `specs/backlog.md` rewritten in place with the whole list, then the one event line appended to
 *    `specs/backlog.events.jsonl` (created when missing), both with an fsync. `specs/` must exist; no directory is
 *    created (`WRITE_PATHS.backlog`). Nothing else changes, the master included.
 */
export async function writeBacklog(input: BacklogWriteInput): Promise<WriteAnswer<"backlog">> {
  const { root, now, body } = input;
  const actor = writeActorOf(await viewerActorOf(root));
  const path = join(root, BACKLOG_PATH);
  const bytes = readBytesIfExists(path);
  const stale = backlogConflict(body.hash, rawSha256(bytes ?? ""));
  if (stale !== null) return { status: 409, body: stale };
  const master = readIfExists(join(root, "ISA.md"));
  const base = { text: bytes === null ? null : bytes.toString("utf8"), features: master === null ? [] : backlogFeatures(master), feature: body.feature, actor, now };
  const plan = body.op === "move" ? planBacklogMove({ ...base, before: body.before }) : planBacklogPriority({ ...base, priority: body.priority });
  if (!plan.ok) return { status: 422, body: { error: "backlog-refused", reason: plan.reason } };
  writeInPlace(path, plan.text);
  const eventsPath = join(root, BACKLOG_EVENTS_PATH);
  const existing = readIfExists(eventsPath);
  // A log whose last line lacks its newline gets one first, so the new event never fuses with it.
  appendInPlace(eventsPath, `${existing !== null && existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${plan.line}`);
  return { status: 200, body: { hash: rawSha256(plan.text), event: plan.event } };
}
