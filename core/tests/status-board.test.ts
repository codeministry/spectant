// The status board (spec 071, ISC-593, ISC-584, ISC-583, ISC-594): `statusBoard` turns one dashboard model per
// registered workspace into the status widget's answer: the open specs and those closed at most 24 hours before `now`,
// archived ones included, grouped by workspace in the caller's order, with the KPIs over exactly the listed specs.
// Spec 072 (ISC-599): each listed spec carries the dashboard row's next command, null for an archived spec.
// Spec 072 (ISC-604): `statusKpis` counts exactly the workspaces and rows it is given, so a filtered view counts its rows.
// The fixture is synthetic: three workspaces, one unreadable, with specs closed 2 h and 30 h before a fixed clock.
import { describe, expect, test } from 'bun:test';

import type { ArchivedSpec } from '../src/archive.ts';
import type { DashboardModel, DashboardSpecRow } from '../src/dashboard.ts';
import type { ItemState } from '../src/files.ts';
import * as barrel from '../src/index.ts';
import type { Stage } from '../src/stage.ts';
import { STATUS_CLOSED_WINDOW_MS, statusBoard, statusKpis } from '../src/status-board.ts';
import type { StatusInput, StatusKpis, StatusResponse, StatusSpec, StatusWorkspace } from '../src/status-board.ts';

const NOW = new Date('2026-03-10T12:00:00Z');
const H2 = '2026-03-10T10:00:00Z';
const H30 = '2026-03-09T06:00:00Z';
const H24 = '2026-03-09T12:00:00Z';

/** A dashboard row with only the fields the board reads; the rest of the row is irrelevant to it. */
function row(id: string, stage: Stage, closedAt: string | null, closed: number, total: number, state?: ItemState, nextCommand: string | null = null): DashboardSpecRow {
  return {
    id,
    slug: `${id}-spec-${id}`,
    title: `Spec ${id}`,
    stage,
    closedAt,
    progress: { closed, total },
    nextCommand,
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
      [row('001', 'build', null, 2, 5, 'running', '/spec implement 001'), row('002', 'done', H2, 4, 4, 'done'), row('003', 'done', H30, 3, 3, 'done'), row('004', 'done', null, 1, 1)],
      [archived('005', H2, 6, 6), archived('006', H30, 2, 2)],
    ),
  },
  { slug: 'gone', pathTail: 'gone', readable: false, error: 'missing' },
  { slug: 'harbor', pathTail: 'harbor', readable: true, model: model([row('010', 'plan', null, 0, 3)]) },
  { slug: 'quiet', pathTail: 'quiet', readable: true, model: model([row('020', 'done', H30, 5, 5)]) },
];

const board: StatusResponse = statusBoard(INPUT, NOW);
const ids = (slug: string): string[] => board.workspaces.find((w) => w.slug === slug)?.specs.map((s) => s.id) ?? [];
const spec = (slug: string, id: string): StatusSpec | undefined => board.workspaces.find((w) => w.slug === slug)?.specs.find((s) => s.id === id);

describe('the types and the barrel (ISC-593)', () => {
  test('the barrel exports the board and its window', () => {
    expect(barrel.statusBoard).toBe(statusBoard);
    expect(barrel.STATUS_CLOSED_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
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

  test('a spec carries id, slug, title, stage, claims, closedAt, state, archived and nextCommand, and nothing else', () => {
    expect(spec('lantern', '002')).toEqual({ id: '002', slug: '002-spec-002', title: 'Spec 002', stage: 'done', claims: { closed: 4, total: 4 }, closedAt: H2, state: 'done', archived: false, nextCommand: null });
  });

  test('no field names an absolute path', () => {
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(board);
    // A plugin command (`/spec implement 001`) starts with a slash but is no path: one slash, then the command words.
    const command = (s: string): boolean => /^\/spec [^/\\]+$/.test(s);
    expect(strings.filter((s) => (s.startsWith('/') && !command(s)) || /^[A-Za-z]:[\\/]/.test(s))).toEqual([]);
    expect(strings.filter(command)).toEqual(['/spec implement 001']);
  });
});

describe('statusBoard lists open and recently closed specs (ISC-584)', () => {
  test('open specs stay; a spec closed 2 h ago is listed, 30 h ago is not; done without closedAt is not', () => {
    expect(ids('lantern')).toEqual(['001', '002', '005']);
    expect(ids('harbor')).toEqual(['010']);
  });

  test('archived specs closed within the window come after the active rows', () => {
    expect(spec('lantern', '005')).toEqual({ id: '005', slug: '005-old-005', title: 'Old 005', stage: 'done', claims: { closed: 6, total: 6 }, closedAt: H2, state: 'done', archived: true, nextCommand: null });
    expect(spec('lantern', '006')).toBeUndefined();
  });

  test('a readable workspace with nothing listed stays in the list with no specs', () => {
    expect(board.workspaces.find((w) => w.slug === 'quiet')?.specs).toEqual([]);
  });

  test('the window is inclusive at exactly 24 hours and the clock comes from the caller', () => {
    expect(STATUS_CLOSED_WINDOW_MS).toBe(86_400_000);
    const edge = statusBoard([{ slug: 'e', pathTail: 'e', readable: true, model: model([row('030', 'done', H24, 1, 1)]) }], NOW);
    expect(edge.workspaces[0]?.specs.map((s) => s.id)).toEqual(['030']);
    const later = statusBoard([{ slug: 'e', pathTail: 'e', readable: true, model: model([row('030', 'done', H24, 1, 1)]) }], new Date(NOW.getTime() + 1));
    expect(later.workspaces[0]?.specs).toEqual([]);
  });

  test('an unparsable closedAt on a done spec lists nothing', () => {
    const odd = statusBoard([{ slug: 'o', pathTail: 'o', readable: true, model: model([row('040', 'done', 'not a date', 1, 1)], [archived('041', 'later', 1, 1)]) }], NOW);
    expect(odd.workspaces[0]?.specs).toEqual([]);
  });
});

describe('the KPIs count exactly the listed specs (ISC-583)', () => {
  test('repos with a listed spec, closed of listed, claims closed of total', () => {
    // lantern lists 001 (2/5), 002 (4/4, done), 005 (6/6, done, archived); harbor lists 010 (0/3); quiet and gone nothing.
    expect(board.kpis).toEqual({ repos: 2, closed: 2, listed: 4, claimsClosed: 12, claimsTotal: 18 });
  });

  test('no workspace at all: every KPI is zero', () => {
    expect(statusBoard([], NOW)).toEqual({ kpis: { repos: 0, closed: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 }, workspaces: [] });
  });
});

describe('the run state of a listed spec (ISC-594)', () => {
  test("a row takes its item state, an archived spec is done, a row without one carries null", () => {
    expect(spec('lantern', '001')?.state).toBe('running');
    expect(spec('lantern', '005')?.state).toBe('done');
    expect(spec('harbor', '010')?.state).toBeNull();
  });
});

describe('the next command of a listed spec (ISC-599)', () => {
  test('an open row carries its dashboard command in the plugin form', () => {
    expect(spec('lantern', '001')?.nextCommand).toBe('/spec implement 001');
  });

  test('a row without a next command carries null', () => {
    expect(spec('harbor', '010')?.nextCommand).toBeNull();
    expect(spec('lantern', '002')?.nextCommand).toBeNull();
  });

  test('an archived spec carries null', () => {
    expect(spec('lantern', '005')?.archived).toBe(true);
    expect(spec('lantern', '005')?.nextCommand).toBeNull();
  });

  test('the command comes from the row as it stands, never recomputed', () => {
    const own = statusBoard([{ slug: 'c', pathTail: 'c', readable: true, model: model([row('050', 'plan', null, 0, 2, undefined, '/spec review 050 code')]) }], NOW);
    expect(own.workspaces[0]?.specs[0]?.nextCommand).toBe('/spec review 050 code');
  });
});

describe('statusKpis counts exactly the rows it is given (ISC-604)', () => {
  /** The KPIs summed by hand over the given workspaces, independent of the implementation. */
  const sums = (ws: readonly StatusWorkspace[]): StatusKpis => {
    const rows = ws.flatMap((w) => w.specs);
    return {
      repos: ws.filter((w) => w.specs.length > 0).length,
      closed: rows.filter((s) => s.stage === 'done').length,
      listed: rows.length,
      claimsClosed: rows.reduce((n, s) => n + s.claims.closed, 0),
      claimsTotal: rows.reduce((n, s) => n + s.claims.total, 0),
    };
  };
  const ZERO: StatusKpis = { repos: 0, closed: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 };

  test('the barrel exports it; over every workspace it is the board KPIs, unchanged (ISC-583)', () => {
    expect(barrel.statusKpis).toBe(statusKpis);
    expect(statusKpis(board.workspaces)).toEqual(board.kpis);
    expect(board.kpis).toEqual({ repos: 2, closed: 2, listed: 4, claimsClosed: 12, claimsTotal: 18 });
  });

  test('over a subset of the workspaces it equals the sums over exactly those rows', () => {
    const harbor = board.workspaces.filter((w) => w.slug === 'harbor');
    expect(statusKpis(harbor)).toEqual({ repos: 1, closed: 0, listed: 1, claimsClosed: 0, claimsTotal: 3 });
    const lanternAndGone = board.workspaces.filter((w) => w.slug === 'lantern' || w.slug === 'gone');
    expect(statusKpis(lanternAndGone)).toEqual({ repos: 1, closed: 2, listed: 3, claimsClosed: 12, claimsTotal: 15 });
    expect(statusKpis(lanternAndGone)).toEqual(sums(lanternAndGone));
  });

  test('over workspaces whose specs were narrowed it counts only the remaining rows', () => {
    const open = board.workspaces.map((w) => ({ ...w, specs: w.specs.filter((s) => s.stage !== 'done') }));
    expect(statusKpis(open)).toEqual({ repos: 2, closed: 0, listed: 2, claimsClosed: 2, claimsTotal: 8 });
    expect(statusKpis(open)).toEqual(sums(open));
    const done = board.workspaces.map((w) => ({ ...w, specs: w.specs.filter((s) => s.stage === 'done') }));
    expect(statusKpis(done)).toEqual({ repos: 1, closed: 2, listed: 2, claimsClosed: 10, claimsTotal: 10 });
    expect(statusKpis(done)).toEqual(sums(done));
  });

  test('an unreadable workspace or an empty selection counts for nothing', () => {
    expect(statusKpis(board.workspaces.filter((w) => !w.readable))).toEqual(ZERO);
    expect(statusKpis([])).toEqual(ZERO);
  });
});
