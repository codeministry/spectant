/**
 * Spec 064 (T1, ISC-466): who works a spec now, read off the dashboard model's rows. The "In Arbeit" list and the spec
 * table's `agent` both read the lock holder through `holderOf`, so a spec stands in the list exactly when its row
 * carries the agent dot. core puts only held locks in a row's `taken` (`heldLocks`): a released lock is gone from it.
 */

/** One spec a session holds a claim of, as the "In Arbeit" list shows it. */
export interface WorkingEntry {
  readonly id: string;
  /** The spec title; the id when the row carries none. */
  readonly title: string;
  /** The session holding the first lock in claim order. */
  readonly session: string;
  /** ISO 8601: when that lock was taken; null when the row carries no time. */
  readonly since: string | null;
}

type Loose = Readonly<Record<string, unknown>>;

const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The first entry of the row's `taken` that names a session, with its `since`; null without a held lock. */
export function holderOf(row: unknown): { session: string; since: string | null } | null {
  const taken = isLoose(row) ? row['taken'] : null;
  if (!Array.isArray(taken)) return null;
  for (const lock of taken) {
    const session = isLoose(lock) ? text(lock['session']) : null;
    if (isLoose(lock) && session !== null) return { session, since: text(lock['since']) };
  }
  return null;
}

/** The specs of the dashboard body with a lock holder, in served order; rows without an id are skipped. */
export function workingOf(body: unknown): readonly WorkingEntry[] {
  const specs = isLoose(body) && Array.isArray(body['specs']) ? (body['specs'] as unknown[]) : [];
  return specs.flatMap((row): WorkingEntry[] => {
    const id = isLoose(row) ? text(row['id']) : null;
    const holder = holderOf(row);
    if (!isLoose(row) || id === null || holder === null) return [];
    return [{ id, title: text(row['title']) ?? id, session: holder.session, since: holder.since }];
  });
}
