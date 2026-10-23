// The status board (spec 071, ISC-593, ISC-583, ISC-594; spec 073, ISC-613): `statusBoard` turns one dashboard model
// per registered workspace into the status widget's answer: the open specs only (stage not `done`), never a closed or
// an archived one however recently it closed, grouped by workspace in the caller's order, with the KPIs over exactly
// the listed specs. The fixture is synthetic: three workspaces, one unreadable, with specs closed 2 h and 30 h before a
// fixed clock and archived specs closed as long before.
import { describe, expect, test } from 'bun:test';

import type { ArchivedSpec } from '../src/archive.ts';
import type { DashboardModel, DashboardSpecRow } from '../src/dashboard.ts';
import type { ItemState } from '../src/files.ts';
import * as barrel from '../src/index.ts';
import type { Stage } from '../src/stage.ts';
import { statusBoard } from '../src/status-board.ts';
import type { StatusInput, StatusResponse, StatusSpec } from '../src/status-board.ts';

const NOW = new Date('2026-03-10T12:00:00Z');
const H2 = '2026-03-10T10:00:00Z';
const H30 = '2026-03-09T06:00:00Z';
const H24 = '2026-03-09T12:00:00Z';

/** A dashboard row with only the fields the board reads; the rest of the row is irrelevant to it. */
function row(id: string, stage: Stage, closedAt: string | null, closed: number, total: number, state?: ItemState): DashboardSpecRow {
  return {
    id,
    slug: `${id}-spec-${id}`,
    title: `Spec ${id}`,
    stage,
    closedAt,
    progress: { closed, total },
    ...(state === undefined ? {} : { state: { kind: 'spec', id, state } }),
  } as unknown as DashboardSpecRow;
}

function archived(id: string, closedAt: string | null, closed: number, total: number): ArchivedSpec {
  return { id, slug: `${id}-old-${id}`, title: `Old ${id}`, type: null, closedAt, archived: '2026-03-10', archivedReason: null, claims: { closed, total }, tasks: { landed: 0, total: 0 }, goal: '' };
}

const model = (specs: DashboardSpecRow[], archive: ArchivedSpec[] = []): DashboardModel => ({ specs, archive }) as unknown as DashboardModel;

const INPUT: StatusInput[] = [
  {
    slug: 'lantern',
    pathTail: 'lantern',
    readable: true,
    model: model(
      [row('001', 'build', null, 2, 5, 'running'), row('002', 'done', H2, 4, 4, 'done'), row('003', 'done', H30, 3, 3, 'done'), row('004', 'done', null, 1, 1)],
      [archived('005', H2, 6, 6), archived('006', H30, 2, 2)],
    ),
  },
  { slug: 'gone', pathTail: 'gone', readable: false, error: 'missing' },
  { slug: 'harbor', pathTail: 'harbor', readable: true, model: model([row('010', 'plan', null, 0, 3)]) },
  { slug: 'quiet', pathTail: 'quiet', readable: true, model: model([row('020', 'done', H30, 5, 5)]) },
];

const board: StatusResponse = statusBoard(INPUT);
const ids = (slug: string): string[] => board.workspaces.find((w) => w.slug === slug)?.specs.map((s) => s.id) ?? [];
const spec = (slug: string, id: string): StatusSpec | undefined => board.workspaces.find((w) => w.slug === slug)?.specs.find((s) => s.id === id);

describe('the types and the barrel (ISC-593)', () => {
  test('the barrel exports the board and no closed window any more (ISC-613)', () => {
    expect(barrel.statusBoard).toBe(statusBoard);
    expect('STATUS_CLOSED_WINDOW_MS' in barrel).toBe(false);
  });

  test('one entry per workspace in the input order, slug, path tail, readability and error', () => {
    expect(board.workspaces.map((w) => [w.slug, w.pathTail, w.readable, w.error])).toEqual([
      ['lantern', 'lantern', true, null],
      ['gone', 'gone', false, 'missing'],
      ['harbor', 'harbor', true, null],
      ['quiet', 'quiet', true, null],
    ]);
    expect(board.workspaces.find((w) => w.slug === 'gone')?.specs).toEqual([]);
  });

  test('a spec carries id, slug, title, stage, claims, closedAt, state and archived, and nothing else', () => {
    expect(spec('lantern', '001')).toEqual({ id: '001', slug: '001-spec-001', title: 'Spec 001', stage: 'build', claims: { closed: 2, total: 5 }, closedAt: null, state: 'running', archived: false });
  });

  test('no field names an absolute path', () => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(board);
    expect(strings.filter((s) => s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s))).toEqual([]);
  });
});

describe('statusBoard lists open specs only (ISC-613)', () => {
  test('open specs stay; a spec closed 2 h ago is not listed, nor 30 h ago, nor done without closedAt', () => {
    expect(ids('lantern')).toEqual(['001']);
    expect(ids('harbor')).toEqual(['010']);
    expect(spec('lantern', '002')).toBeUndefined();
  });

  test('no archived spec is listed, not even one closed 2 h ago', () => {
    expect(spec('lantern', '005')).toBeUndefined();
    expect(spec('lantern', '006')).toBeUndefined();
  });

  test('no listed spec anywhere is done or archived, and none carries a closedAt', () => {
    const listed = board.workspaces.flatMap((w) => w.specs);
    expect(listed.filter((s) => s.stage === 'done' || s.archived || s.closedAt !== null)).toEqual([]);
  });

  test('a readable workspace with nothing listed stays in the list with no specs', () => {
    expect(board.workspaces.find((w) => w.slug === 'quiet')?.specs).toEqual([]);
  });

  test('a spec closed at the very clock, or 24 hours before it, is not listed either', () => {
    const now = statusBoard([{ slug: 'e', pathTail: 'e', readable: true, model: model([row('030', 'done', NOW.toISOString(), 1, 1)], [archived('031', NOW.toISOString(), 1, 1)]) }]);
    expect(now.workspaces[0]?.specs).toEqual([]);
    const edge = statusBoard([{ slug: 'e', pathTail: 'e', readable: true, model: model([row('030', 'done', H24, 1, 1)]) }]);
    expect(edge.workspaces[0]?.specs).toEqual([]);
  });

  test('an unparsable closedAt on a done spec lists nothing', () => {
    const odd = statusBoard([{ slug: 'o', pathTail: 'o', readable: true, model: model([row('040', 'done', 'not a date', 1, 1)], [archived('041', 'later', 1, 1)]) }]);
    expect(odd.workspaces[0]?.specs).toEqual([]);
  });
});

describe('the KPIs count exactly the listed specs (ISC-583)', () => {
  test('repos with a listed spec, closed of listed, claims closed of total', () => {
    // lantern lists 001 (2/5); harbor lists 010 (0/3); quiet and gone nothing. No listed spec is done, so closed is 0.
    expect(board.kpis).toEqual({ repos: 2, closed: 0, listed: 2, claimsClosed: 2, claimsTotal: 8 });
  });

  test('no workspace at all: every KPI is zero', () => {
    expect(statusBoard([])).toEqual({ kpis: { repos: 0, closed: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 }, workspaces: [] });
  });
});

describe('the run state of a listed spec (ISC-594)', () => {
  test('a row takes its item state, a row without one carries null', () => {
    expect(spec('lantern', '001')?.state).toBe('running');
    expect(spec('harbor', '010')?.state).toBeNull();
  });
});
