/**
 * The gate route (T69, ISC-24): `POST …/:id/gate/reviewed`. The reviewer confirms the three files as the page showed
 * them; the server re-reads and re-hashes them (`hashForGate`), and only when all three still match and no lock holds
 * the spec does it write `.gates/reviewed.json` in the old skill's byte format (`reviewedMarkText`, over the server's
 * own hashes) and append exactly one `review → build` event line (actor `app`) to `events.jsonl`. The mark is written
 * first, then the event: a failure between them leaves a mark without its event, never an event without a mark.
 */
import { join } from "node:path";
import type { SpecRef } from "../../core/src/resolve.ts";
import type { GateReviewedRequest } from "./spec-routes.contract.ts";
import { readIfExists, readSpecFiles } from "./workspace-loader.ts";
import { EVENTS_PATH, eventAppendBytes, gateConflict, reviewedEvent, reviewedMarkText } from "./writes.contract.ts";
import { type WriteResult, appendInPlace, ensureGatesDir, gateHashes, runWrite, writeInPlace } from "./writes.ts";

export interface GateWriteInput {
  readonly root: string;
  readonly ref: Pick<SpecRef, "dir" | "slug">;
  readonly stateDir: string | null;
  readonly now: Date;
  readonly body: GateReviewedRequest;
  /** The workspace's constitution, for the lane table of the spec's task claims. */
  readonly constitution: string | null;
}

export function writeGateReviewed(input: GateWriteInput): Promise<WriteResult<"gateReviewed">> {
  const { ref, now } = input;
  return runWrite<"gateReviewed">({
    root: input.root,
    stateDir: input.stateDir,
    now,
    read: () => {
      const files = readSpecFiles(ref);
      const hashes = gateHashes(files.texts);
      const stale = gateConflict(input.body.hashes, hashes);
      if (stale !== null) return { stale };
      const withConstitution = input.constitution === null ? files : { folder: files.folder, texts: { ...files.texts, constitution: input.constitution } };
      return {
        files: withConstitution,
        claim: null,
        commit: (lockSource) => {
          const at = now.toISOString();
          const event = reviewedEvent(at, ref.slug);
          writeInPlace(join(ensureGatesDir(ref.dir), "reviewed.json"), reviewedMarkText(at, hashes));
          const events = join(ref.dir, EVENTS_PATH);
          appendInPlace(events, eventAppendBytes(readIfExists(events), event));
          return { at, hashes, lockSource, event };
        },
      };
    },
  });
}
