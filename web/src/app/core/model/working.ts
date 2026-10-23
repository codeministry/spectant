/**
 * Spec 064 (T1, ISC-466): who works a spec now, read off the dashboard model's rows. The "In Arbeit" list and the spec
 * table's `agent` both read who works a spec through `agentOf`, so a spec stands in the list exactly when its row
 * carries the agent dot. core puts only held locks in a row's `taken` (`heldLocks`): a released lock is gone from it.
 * Spec 070 (C5, ISC-571, ISC-572): a spec with an open run (the row's `run`, absent once its `run-end` is read) works
 * too, with or without a held claim, and stands in the list once, with the run's phase, start and session.
 */

/** The latest step of an `implement` run (core's `DashboardRunStep`), as far as the tile reads it. */
export interface WorkingStep {
  /** `dispatch`, `build`, `patch`, `apply` or `probe`; the tile reads a `probe` as testing. */
  readonly kind: string;
  readonly task: string;
  /** ISO 8601: the step line's time. */
  readonly at: string;
}

/** A spec's open run (core's `DashboardOpenRun`), as far as the tile reads it. */
export interface WorkingRun {
  /** The `/spec` subcommand (`review`, `implement`, `done` …); null for a command without one. */
  readonly phase: string | null;
  /** The command in the plugin's form. */
  readonly command: string;
  /** ISO 8601: the run's start. */
  readonly since: string;
  readonly session: string;
  /** Only on an `implement` run with a step after its start. */
  readonly step: WorkingStep | null;
}

/** One spec a session works, as the "In Arbeit" list shows it. */
export interface WorkingEntry {
  readonly id: string;
  /** The spec title; the id when the row carries none. */
  readonly title: string;
  /** The open run's session, else the session holding the first lock in claim order. */
  readonly session: string;
  /** ISO 8601: when the open run started, else when that lock was taken; null when the row carries no time. */
  readonly since: string | null;
  /** The open run; absent while none is open on the spec (a held claim alone). */
  readonly run?: WorkingRun;
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

/** The step of a run, or null when it is absent or lacks a kind, task or time. */
function stepOf(value: unknown): WorkingStep | null {
  if (!isLoose(value)) return null;
  const kind = text(value['kind']);
  const task = text(value['task']);
  const at = text(value['at']);
  return kind === null || task === null || at === null ? null : { kind, task, at };
}

/** The row's open run (`row.run ?? null`), or null when it is absent or lacks its command, start or session. */
export function runOf(row: unknown): WorkingRun | null {
  const run = isLoose(row) ? row['run'] : null;
  if (!isLoose(run)) return null;
  const command = text(run['command']);
  const since = text(run['since']);
  const session = text(run['session']);
  if (command === null || since === null || session === null) return null;
  return { phase: text(run['phase']), command, since, session, step: stepOf(run['step']) };
}

/**
 * Who works the row's spec: the open run's session, else the lock holder's; null when neither. The spec table's agent
 * dot and its `?working=1` filter read it, so they list exactly the specs of the "In Arbeit" block.
 */
export function agentOf(row: unknown): string | null {
  return runOf(row)?.session ?? holderOf(row)?.session ?? null;
}

/** The specs of the body with an open run or a lock holder, each once, in served order; rows without an id are skipped. */
export function workingOf(body: unknown): readonly WorkingEntry[] {
  const specs = isLoose(body) && Array.isArray(body['specs']) ? (body['specs'] as unknown[]) : [];
  return specs.flatMap((row): WorkingEntry[] => {
    const id = isLoose(row) ? text(row['id']) : null;
    if (!isLoose(row) || id === null) return [];
    const title = text(row['title']) ?? id;
    const run = runOf(row);
    if (run !== null) return [{ id, title, session: run.session, since: run.since, run }];
    const holder = holderOf(row);
    return holder === null ? [] : [{ id, title, session: holder.session, since: holder.since }];
  });
}
