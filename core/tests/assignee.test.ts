// The assignee (spec 008, T65, ISC-131): the actor of a spec's newest open claim lock, else the actor of its last event,
// else null. Checked on the pure function and against the fixtures as the server reads them: harbor with its real
// `.spectant/activity.jsonl` through `readLockSources`, lantern with its legacy `principal` events. The dashboard row,
// the spec head and the planning holder must name the same actor over the same input.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseActor } from '../src/actor.ts';
import { assigneeOf } from '../src/assignee.ts';
import { buildDashboard } from '../src/dashboard.ts';
import { parseEvents } from '../src/events.ts';
import type { ActorRef, ClaimLock, SpecFiles } from '../src/files.ts';
import { readLockSources } from '../src/locks.ts';
import { buildPlanning } from '../src/planning.ts';
import { buildSpecPage } from '../src/spec.ts';
import { FIXTURES, readTree } from './helpers/read-tree.ts';

const lock = (claim: string, session: string, since: string, source: ClaimLock['source'] = 'activity'): ClaimLock => ({
  source,
  claim,
  session,
  actor: parseActor(session),
  since,
});

const events = (...actors: string[]) =>
  parseEvents(actors.map((actor, i) => JSON.stringify({ ts: `2026-03-0${i + 1}T10:00:00Z`, from: i === 0 ? null : 'review', to: i === 0 ? 'review' : 'build', command: '/spec-review 001', actor })).join('\n')).events;

describe('assigneeOf', () => {
  test('nobody without a lock or an event', () => {
    expect(assigneeOf({ claims: ['ISC-1'] })).toBeNull();
    expect(assigneeOf({ claims: ['ISC-1'], locks: [], events: [] })).toBeNull();
  });

  test('the last event’s actor without a lock', () => {
    expect(assigneeOf({ claims: ['ISC-1'], events: events('u:3f9c0a7d', 'a:claude:sess-7') })?.raw).toBe('a:claude:sess-7');
  });

  test('a lock beats every event, and only a lock on one of the spec’s claims counts', () => {
    const own = lock('ISC-1', 'a:claude:sess-2', '2026-03-01T09:00:00Z');
    const other = lock('ISC-9', 'a:claude:sess-9', '2026-03-09T09:00:00Z');
    expect(assigneeOf({ claims: ['ISC-1'], locks: [own, other], events: events('u:3f9c0a7d') })?.raw).toBe('a:claude:sess-2');
    expect(assigneeOf({ claims: ['ISC-2'], locks: [own, other], events: events('u:3f9c0a7d') })?.raw).toBe('u:3f9c0a7d');
  });

  test('the newest lock wins; on a tie the later entry, the frontier lock readLockSources puts last', () => {
    const older = lock('ISC-1', 'a:claude:sess-1', '2026-03-01T09:00:00Z');
    const newer = lock('ISC-2', 'a:claude:sess-2/T4', '2026-03-02T09:00:00Z');
    expect(assigneeOf({ claims: ['ISC-1', 'ISC-2'], locks: [newer, older] })).toEqual({ raw: 'a:claude:sess-2/T4', kind: 'subagent', id: 'a:claude:sess-2', task: 'T4', legacy: false });
    const frontier = lock('ISC-1', 'spec-001-ISC-1', '2026-03-01T09:00:00Z', 'frontier');
    expect(assigneeOf({ claims: ['ISC-1'], locks: [older, frontier] })?.raw).toBe('spec-001-ISC-1');
  });

  test('a lock whose time does not parse still beats the events, but loses to any timed lock', () => {
    const untimed = lock('ISC-1', 'a:claude:sess-1', 'yesterday');
    const timed = lock('ISC-1', 'a:claude:sess-2', '2026-03-01T09:00:00Z');
    expect(assigneeOf({ claims: ['ISC-1'], locks: [untimed], events: events('u:3f9c0a7d') })?.raw).toBe('a:claude:sess-1');
    expect(assigneeOf({ claims: ['ISC-1'], locks: [timed, untimed] })?.raw).toBe('a:claude:sess-2');
  });

  test('assignee.ts is browser-safe: no node: import', () => {
    const source = readFileSync(join(import.meta.dir, '..', 'src', 'assignee.ts'), 'utf8');
    expect(source).not.toMatch(/from 'node:/);
    expect(source).not.toMatch(/\bBun\./);
  });
});

const person = (raw: string): ActorRef => ({ raw, kind: 'person', id: raw, legacy: false });
const agent = (raw: string): ActorRef => ({ raw, kind: 'agent', id: raw, legacy: false });

/** Every active spec's assignee on the dashboard, the spec head and the planning holder, by folder. */
async function assigneesOf(tree: string): Promise<Record<string, ActorRef | null>> {
  const input = readTree(tree);
  const locks = await readLockSources({ repoRoot: join(FIXTURES, tree) });
  const rows = Object.fromEntries(buildDashboard({ ...input, locks }).specs.map((r) => [r.slug, r.assignee]));
  const planning = buildPlanning({ ...input, locks });
  const holders = new Map(planning.features.flatMap((f) => f.holders).map((h) => [h.slug, h.assignee]));
  for (const f of input.specs) {
    if (f.texts.spec === undefined) continue;
    const others: SpecFiles[] = [...input.specs, ...input.archived].filter((o) => o !== f);
    const head = buildSpecPage({ files: f, others, locks, ...(input.workflow ? { workflow: input.workflow } : {}) }).head;
    expect({ slug: f.folder, head: head.assignee }).toEqual({ slug: f.folder, head: rows[f.folder] ?? null });
    if (holders.has(f.folder)) expect({ slug: f.folder, holder: holders.get(f.folder) }).toEqual({ slug: f.folder, holder: rows[f.folder] ?? null });
  }
  return rows;
}

describe('assignee on the fixtures', () => {
  test('harbor: the open activity lock on ISC-74 makes 002 the session’s; the others follow their last event or have none', async () => {
    expect(await assigneesOf('harbor')).toEqual({
      // ISC-74 claimed by a:claude:sess-2 and never released beats 002's last event (u:3f9c0a7d, /spec-review 002).
      '002-web-console': agent('a:claude:sess-2'),
      // No events.jsonl and no lock on their claims: unassigned.
      '003-config-loader': null,
      '004-retention-policies': null,
      '005-config-format-choice': null,
      '007-rotate-mirror-token': null,
      // events.jsonl only: its last line's actor.
      '006-partial-push': person('u:3f9c0a7d'),
      '008-referrers-support': person('u:3f9c0a7d'),
      '009-chunked-upload-limits': person('u:3f9c0a7d'),
    });
  });

  test('harbor: a released claim assigns nobody (ISC-53 and ISC-72 of 002 were released)', async () => {
    const locks = await readLockSources({ repoRoot: join(FIXTURES, 'harbor') });
    expect(locks.locks.map((l) => l.claim)).toEqual(['ISC-74']);
  });

  test('lantern: events only, the legacy actor principal is the assignee, flagged legacy', async () => {
    expect(await assigneesOf('lantern')).toEqual({
      '001-reading-list': null,
      '002-duplicate-links': { raw: 'principal', kind: 'legacy', id: 'principal', legacy: true },
    });
  });
});
