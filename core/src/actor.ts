// The actor grammar (spec 008, ISC-119): `u:<8 hex>` a person, `a:<kind>:<id>` an agent, `a:<kind>:<id>/<task>` its
// sub-agent on one task; every other value is legacy, read and flagged, never dropped (FORMAT.md, `events`). T59
// fills the grammar; the per-file `actor-legacy` warning is T60, so this module raises no diagnostic. It stays
// browser-safe and rides the barrel: the id derivation (`actorIdOf`, `node:crypto`) lives in `actor-id.ts` beside
// `gates.ts`, off the barrel.
//
// Character classes, matched against the whole value with no trimming:
//   person    `u:` + exactly eight lower-case hex digits, `[0-9a-f]{8}` (what actor-id.ts prints);
//   agent     `a:` + kind + `:` + id, each `[a-z0-9][a-z0-9_-]*` — lower case, starting with a letter or digit, so
//             a separator `:` or `/` is never part of a segment;
//   sub-agent the agent form + `/` + a task id `T[0-9]+`, the task grammar of tasks.md (`T<n>`).
// Upper case in a segment, blanks, an empty segment or an extra segment make a value legacy.
import type { ActorRef } from './files.ts';

const PERSON = /^u:[0-9a-f]{8}$/;
const AGENT = /^(a:[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9_-]*)(?:\/(T[0-9]+))?$/;

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
