/**
 * The writes contract (T67, ISC-24 to ISC-27, ISC-86; plan 002 § Interfaces "HTTP", the two writes).
 *
 * The app's only two writes into a registered repository, both user-triggered: the reviewed mark
 * (`specs/NNN-slug/.gates/reviewed.json` plus one line in `events.jsonl`) and one task checkbox (one line of
 * `tasks.md`). This file is what `server/src/writes.ts` (T68), the gate route (T69), the checkbox route (T70), the lock
 * guard (T71), the e2e stub and the web client agree on. It writes nothing; every function is pure.
 *
 * It builds on `spec-routes.contract.ts` and never re-declares it: the routes, the request bodies
 * (`GateReviewedRequest`, `TaskCheckRequest`), the hash headers and the base answers (`GateReviewedResponse`,
 * `TaskCheckResponse`, `Conflict`, `Locked`, `InvalidBody`) live there and keep their names. It is a barrel of its own,
 * not part of the spec routes barrel: its `EVENTS_PATH` (`events.jsonl`) is another name than the live stream's.
 *
 * The contract lives in its parts below `writes/`; this barrel re-exports every public name of them:
 *
 * - `writes-table.ts`: `ReviewedFile`, `ReviewedMark`, the write routes and hash headers, the files the writes touch,
 *   `WRITE_TABLE`, `WRITE_PATHS`, `writePathsOf` and the request bodies (with the header's tables of every write).
 * - `write-events.ts`: the reviewed mark's bytes, the event lines and their actor, the run release's line.
 * - `write-answers.ts`: the 200, 409, 422 and 423 bodies, `WriteAnswer`, the conflict and lock builders.
 * - `write-answer-check.ts`: `writeAnswerOf`, the client's validators.
 *
 * Browser-safe like its base: imports are `spec-routes.contract.ts`, `core/src/actor.ts`, `core/src/events.ts` and
 * `core/src/files.ts` only (no Bun, no Node), and nothing from `core/src/gates.ts`, not even a type.
 */
export * from './writes/writes-table.ts';
export {
  REVIEWED_EVENT,
  VIEWER_ACTOR_FALLBACK,
  WRITE_ACTOR,
  eventAppendBytes,
  reviewedEvent,
  reviewedEventCommand,
  reviewedMarkText,
  runReleaseAppendBytes,
  runReleaseEvent,
  writeActorOf,
} from './writes/write-events.ts';
export * from './writes/write-answers.ts';
export * from './writes/write-answer-check.ts';
