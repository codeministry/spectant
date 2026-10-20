// The actor grammar (spec 008, ISC-119): `u:<8 hex>` a person, `a:<kind>:<id>` an agent, `a:<kind>:<id>/<task>` its
// sub-agent on one task; every other value is legacy, read and flagged, never dropped (FORMAT.md, `events`). T59
// fills the grammar; T60 adds `legacyActorWarning`, the one `actor-legacy` warning per file that the readers share
// (events.ts for events.jsonl, locks.ts for the activity log and each frontier lock file). The once-per-file state is
// the reader's: it collects the actors of one file as it reads them and asks once, at the end. It stays
// browser-safe and rides the barrel: the id derivation (`actorIdOf`, `node:crypto`) lives in `actor-id.ts` beside
// `gates.ts`, off the barrel.
//
// Character classes, matched against the whole value with no trimming:
//   person    `u:` + exactly eight lower-case hex digits, `[0-9a-f]{8}` (what actor-id.ts prints);
//   agent     `a:` + kind + `:` + id, each `[a-z0-9][a-z0-9_-]*` — lower case, starting with a letter or digit, so
//             a separator `:` or `/` is never part of a segment;
//   sub-agent the agent form + `/` + a task id `[TC][0-9]+`: a task of tasks.md (`T<n>`) or, for a spec without
//             tasks.md, a claim unit of frontier (`C<n>`, spec 056).
// Upper case in a segment, blanks, an empty segment or an extra segment make a value legacy.
import type { Diagnostic } from './diagnostics.ts';
import type { ActorRef } from './files.ts';

const PERSON = /^u:[0-9a-f]{8}$/;
const AGENT = /^(a:[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*)(?:\/([TC][0-9]+))?$/;

/** Parses one `actor` value of an event, activity line, mark or lock. `raw` is always kept as written. */
export function parseActor(raw: string): ActorRef {
  if (PERSON.test(raw)) return { raw, kind: 'person', id: raw, legacy: false };
  const agent = AGENT.exec(raw);
  if (agent?.[1] !== undefined) {
    const id = agent[1];
    const task = agent[2];
    return task === undefined
      ? { raw, kind: 'agent', id, legacy: false }
      : { raw, kind: 'subagent', id, task, legacy: false };
  }
  return { raw, kind: 'legacy', id: raw, legacy: true };
}

/** One actor value as a reader met it: the parsed value and, when the file has lines, its 1-based line. */
export interface ActorSighting {
  readonly ref: ActorRef;
  readonly line?: number;
}

/**
 * The one `actor-legacy` warning of a file, or null when every actor in it fits the grammar. One per file, never one
 * per value: it names the first legacy value (`subject`, and `line` when the sighting has one) and counts the
 * legacy values. `key` is the field the file stores the actor in, `actor` (events, marks) or `session` (activity
 * lines, frontier locks); `holder` opens the message, `The file` unless the reader names the file otherwise (`The
 * frontier lock for ISC-75`). The values themselves stay read: this only flags them.
 */
export function legacyActorWarning(
  sightings: readonly ActorSighting[],
  key: 'actor' | 'session' = 'actor',
  holder = 'The file',
): Diagnostic | null {
  const legacy = sightings.filter((s) => s.ref.legacy);
  const first = legacy[0];
  if (first === undefined) return null;
  const count = `${legacy.length} ${key}${legacy.length === 1 ? '' : 's'}`;
  return {
    severity: 'warning',
    code: 'actor-legacy',
    message: `${holder} carries ${count} outside the actor grammar (u:<8 hex>, a:<kind>:<id>, a:<kind>:<id>/<task>), the first "${first.ref.raw}"; legacy values are read as written, never dropped.`,
    ...(first.line === undefined ? {} : { line: first.line }),
    subject: first.ref.raw,
  };
}
