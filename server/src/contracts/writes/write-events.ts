/**
 * The reviewed mark, the app's event lines and the run release's line (part of `contracts/writes.contract.ts`): the
 * bytes the writes append or write, and the actor they record. Every function is pure.
 *
 * - The event is `review → build` in the stage table's names (the reviewed mark moves the spec from waiting for review to building, as `derived-stages.ts` derives it), as ISC-24 fixes it (decided 2026-09-29). Its actor is the viewer's `u:` id, `VIEWER_ACTOR_FALLBACK` without one (spec 008, T80; `app` before, now legacy).
 *
 * The run release (spec 040, T33, ISC-226), the eighth write path, appends one `run-end` line with `outcome: released`
 * and the viewer's `u:` id to `.spectant/activity.jsonl` at the main checkout, under the raw sha256 of the whole file.
 * Its order is 400 (no hash header) → 404 (no such open run) → 409 → 422 (`no-viewer`, `run-aborted`) → 200; it reads
 * no claim lock and no run locks it, so it has no 423.
 */
import type { EventLine } from '../../../../core/src/files.ts';
import { REVIEWED_HASH_FILES } from '../spec-routes.contract.ts';
import type { ReviewedHashFile, ReviewedHashes, RunReleaseEvent } from '../spec-routes.contract.ts';
import type { ReviewedFile, ReviewedMark } from './writes-table.ts';

// ─── The reviewed mark and its event ─────────────────────────────────────────────────────────────────────────────

/** The gate hash keys in `REVIEWED_HASH_FILES` order; shared with `write-answers.ts`, not re-exported by the barrel. */
export const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

/** The hashes keyed by file name, in `REVIEWED_FILES` order: the mark's `files`. */
function markFiles(hashes: ReviewedHashes): ReviewedMark['files'] {
  const files: Partial<Record<ReviewedFile, string | null>> = {};
  for (const key of HASH_FILES) files[REVIEWED_HASH_FILES[key] as ReviewedFile] = hashes[key];
  return files as ReviewedMark['files'];
}

/**
 * The bytes of `.gates/reviewed.json`, exactly as the old skill's SpecGate `mark` writes them:
 * `JSON.stringify({gate, at, files}, null, 2) + "\n"`, so `readGateMark` and the old tool read it alike. The hashes
 * are the server's own recomputation (equal to the client's, or it is a 409). The app never touches `.gitignore`.
 */
export function reviewedMarkText(at: string, hashes: ReviewedHashes): string {
  const mark: ReviewedMark = { gate: 'reviewed', at, files: markFiles(hashes) };
  return `${JSON.stringify(mark, null, 2)}\n`;
}

/** The transition the gate write records, in the stage table's names (ISC-24). */
export const REVIEWED_EVENT = { from: 'review', to: 'build' } as const;

/**
 * The actor the app's event lines named before spec 008 (T80). Outside the actor grammar, so it reads as legacy;
 * no write records it any more, and the events already written with it stay readable.
 */
export const WRITE_ACTOR = 'app';

/**
 * The actor every app write records when the viewer has no `u:` id (no git address configured): an agent id of the
 * grammar, where `WRITE_ACTOR` reads as legacy. With an id, the event names the viewer.
 */
export const VIEWER_ACTOR_FALLBACK = 'a:spectant:app';

/** The actor an app write records: the viewer's `u:` id (`actorIdOf` of the git address), else the fallback. */
export function writeActorOf(viewer: string | null): string {
  return viewer ?? VIEWER_ACTOR_FALLBACK;
}

/** The event's `command`: the app's action, not a skill command it did not run. */
export function reviewedEventCommand(specId: string): string {
  return `spectant mark-reviewed ${specId}`;
}

/** The one event the gate write appends. `ts` is the mark's `at`; `actor` is `writeActorOf(viewer)`. */
export function reviewedEvent(ts: string, specId: string, actor: string): EventLine {
  return { ts, ...REVIEWED_EVENT, command: reviewedEventCommand(specId), actor };
}

/**
 * The bytes appended to `events.jsonl` (null or `''` = no file yet): one JSON line and its newline, preceded by a
 * newline when the file does not end in one, so the new event never fuses with the last line.
 */
export function eventAppendBytes(existing: string | null, event: EventLine): string {
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  return `${lead}${JSON.stringify(event)}\n`;
}

// ─── The run release (spec 040, ISC-226) ─────────────────────────────────────────────────────────────────────────

/**
 * The one line the release appends for the open run `run` (an `OpenRun` of core's reading): `{ts, event: 'run-end',
 * run, command, session, spec | idea, outcome: 'released'}`, `command` and the item as the run's `run-start` wrote
 * them, `session` the viewer's `u:` id.
 */
export function runReleaseEvent(
  ts: string,
  run: { readonly run: string; readonly command: string; readonly spec?: string; readonly idea?: string },
  viewer: string,
): RunReleaseEvent {
  const item = run.spec === undefined ? { idea: run.idea ?? '' } : { spec: run.spec };
  return { ts, event: 'run-end', run: run.run, command: run.command, session: viewer, ...item, outcome: 'released' };
}

/** The bytes appended to `.spectant/activity.jsonl`: one JSON line, after a newline when the log lacks its last one. */
export function runReleaseAppendBytes(existing: string, event: RunReleaseEvent): string {
  const lead = existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  return `${lead}${JSON.stringify(event)}\n`;
}
