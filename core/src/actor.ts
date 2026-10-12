// The actor grammar (spec 008, ISC-119): `u:<8 hex>` a person, `a:<kind>:<id>` an agent, `a:<kind>:<id>/<task>` its
// sub-agent; every other value is legacy, read and flagged, never dropped. Seam T37 holds the signature; T59 fills the
// grammar, T60 the legacy warning. This module stays browser-safe and rides the barrel: the id derivation
// (`actorIdOf`, `node:crypto`) belongs in a server-side module beside `gates.ts`, never here.
import type { ActorRef } from './files.ts';

/** Parses one `actor` value of an event, activity line, mark or lock. */
export function parseActor(raw: string): ActorRef {
  // stub (spec 008, T59): every value reads as legacy until the grammar lands.
  return { raw, kind: 'legacy', id: raw, legacy: true };
}
