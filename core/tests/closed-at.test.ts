// The closing time (spec 071, ISC-592): `closedAtOf` reads the `ts` of the last transition to `done` in a spec's
// events.jsonl, null without one or after a later transition out of `done`; every dashboard row and every archive
// entry carries it as `closedAt`. The fixture is harbor with an open, a closed, an archived and a reopened spec.
import { describe, expect, test } from 'bun:test';

import { listArchive } from '../src/archive.ts';
import { buildDashboard } from '../src/dashboard.ts';
import type { DashboardInput } from '../src/dashboard.ts';
import { closedAtOf } from '../src/events.ts';
import { readTree } from './helpers/read-tree.ts';

/** One events.jsonl line in the schema. */
const line = (ts: string, from: string | null, to: string): string =>
  JSON.stringify({ ts, from, to, command: `/spec ${to}`, actor: 'u:3f9c0a7d' });

const OPEN = [line('2026-03-01T09:00:00Z', null, 'plan'), line('2026-03-02T09:00:00Z', 'plan', 'tasks')].join('\n');
const CLOSED = [OPEN, line('2026-03-03T09:00:00Z', 'tasks', 'build'), line('2026-03-04T09:00:00Z', 'build', 'close'), line('2026-03-05T15:00:00Z', 'close', 'done')].join('\n');
const REOPENED = [CLOSED, line('2026-03-06T10:00:00Z', 'done', 'build')].join('\n');
const RECLOSED = [REOPENED, line('2026-03-07T11:30:00+02:00', 'build', 'done')].join('\n');

describe('closedAtOf', () => {
  test('no events, an empty file and an open spec: null', () => {
    expect(closedAtOf(undefined)).toBeNull();
    expect(closedAtOf('')).toBeNull();
    expect(closedAtOf(OPEN)).toBeNull();
  });

  test('a closed spec: the ts of the transition to done, as written', () => {
    expect(closedAtOf(CLOSED)).toBe('2026-03-05T15:00:00Z');
  });

  test('a later transition out of done resets it to null; closing again sets the new ts', () => {
    expect(closedAtOf(REOPENED)).toBeNull();
    expect(closedAtOf(RECLOSED)).toBe('2026-03-07T11:30:00+02:00');
  });

  test('an old lifecycle word reads through its alias; a rejected line counts for nothing', () => {
    expect(closedAtOf([OPEN, line('2026-03-05T15:00:00Z', 'code-reviewed', 'done')].join('\n'))).toBe('2026-03-05T15:00:00Z');
    expect(closedAtOf([CLOSED, '{"ts":"2026-03-09T09:00:00Z","from":"done","to":"nowhere","command":"x","actor":"y"}', 'not json'].join('\n'))).toBe('2026-03-05T15:00:00Z');
  });
});

describe('closedAt on the dashboard rows and the archive entries', () => {
  const harbor = readTree('harbor');
  const events: Record<string, string> = { '002-web-console': OPEN, '003-config-loader': CLOSED, '004-retention-policies': REOPENED };
  const input: DashboardInput = {
    ...harbor,
    specs: harbor.specs.map((f) => (events[f.folder] === undefined ? f : { ...f, texts: { ...f.texts, events: events[f.folder] } })),
  };
  const model = buildDashboard(input);
  const closedAt = (id: string): string | null | undefined => model.specs.find((r) => r.id === id)?.closedAt;

  test('open: null, closed: the ts of → done, reopened: null', () => {
    expect(closedAt('002')).toBeNull();
    expect(closedAt('003')).toBe('2026-03-05T15:00:00Z');
    expect(closedAt('004')).toBeNull();
  });

  test('every row carries the field, null or a string', () => {
    for (const r of model.specs) expect(r.closedAt === null || typeof r.closedAt === 'string').toBe(true);
  });

  test('archived: harbor 001 closed on 2026-03-05T15:00:00Z, in the model and in listArchive', () => {
    expect(model.archive.map((a) => [a.id, a.closedAt])).toEqual([['001', '2026-03-05T15:00:00Z']]);
    expect(listArchive(input.archived)[0]?.closedAt).toBe('2026-03-05T15:00:00Z');
  });

  test('an archived folder without events.jsonl: null', () => {
    const [first] = input.archived;
    if (first === undefined) throw new Error('harbor archives 001');
    const texts = Object.fromEntries(Object.entries(first.texts).filter(([kind]) => kind !== 'events'));
    expect(listArchive([{ ...first, texts }])[0]?.closedAt).toBeNull();
  });
});
