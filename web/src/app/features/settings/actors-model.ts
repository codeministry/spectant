import { parseActor } from '../../../../../core/src/actor';
import type { ActorMapping } from '../../../../../server/src/contracts/spec-routes.contract';

/**
 * The Actors section's model (T140, ISC-119.2), pure: which person ids the app knows, the editable rows and the list
 * `PUT /api/actors` gets. The id grammar is core's (`parseActor`); nothing here decides what a person id is.
 */

/** One editable row: the id, its display name and its git identities as the comma-separated text of the input. */
export interface ActorDraft {
  readonly id: string;
  readonly displayName: string;
  readonly gitIdentities: string;
}

export interface ActorRow extends ActorDraft {
  /** The id has a stored mapping (`GET /api/actors`); a seen id without one is shown raw. */
  readonly stored: boolean;
}

const isPerson = (value: string): boolean => parseActor(value).kind === 'person';

/**
 * Every person id a served payload names as a whole value (an assignee's `id`, a lock's `session`, …): the payload is
 * walked as data, every string `parseActor` reads as a person collected. Agents and legacy values are not people.
 */
export function personIdsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (isPerson(value)) into.add(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) personIdsIn(entry, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) personIdsIn(entry, into);
  }
  return into;
}

/** The stored mappings and the seen ids, one row per person id, ordered by id; a seen id without a mapping is blank. */
export function actorRows(stored: readonly ActorMapping[], seen: Iterable<string>): ActorRow[] {
  const rows = new Map<string, ActorRow>();
  for (const id of seen) if (isPerson(id)) rows.set(id, { id, displayName: '', gitIdentities: '', stored: false });
  for (const m of stored) rows.set(m.id, { id: m.id, displayName: m.displayName, gitIdentities: m.gitIdentities.join(', '), stored: true });
  return [...rows.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The input's text as the stored array: split on commas, trimmed, empty and repeated entries dropped. */
export function parseIdentities(text: string): string[] {
  return [...new Set(text.split(',').map((part) => part.trim()).filter((part) => part !== ''))];
}

/**
 * The whole list `PUT /api/actors` replaces the mapping with: every row with a person id and a non-blank name. A blank
 * name leaves the id unmapped (shown raw); an id outside the person grammar is never sent.
 */
export function mappingsOf(rows: readonly ActorDraft[]): ActorMapping[] {
  return rows
    .filter((row) => isPerson(row.id) && row.displayName.trim() !== '')
    .map((row) => ({ id: row.id, displayName: row.displayName.trim(), gitIdentities: parseIdentities(row.gitIdentities) }));
}
