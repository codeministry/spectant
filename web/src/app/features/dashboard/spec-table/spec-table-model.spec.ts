import { describe, expect, it } from 'vitest';
import {
  applyListQuery,
  DEFAULT_QUERY,
  type ListQuery,
  listQueryParams,
  parseListQuery,
  phaseOptions,
  readArchiveRows,
  readSpecRows,
  SORT_MENU,
  type SpecTableRow,
  typeOptions,
} from './spec-table-model';

/** A dashboard row as the server sends it (`DashboardSpecRow`), only the fields that matter overridden. */
function wire(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `${id}-slug`,
    title: `Spec ${id}`,
    type: 'feature',
    phase: 'scoping',
    stage: 'review',
    progress: { closed: 0, total: 4 },
    tasks: null,
    nextCommand: `/spec-review ${id}`,
    nextReason: '',
    takeable: [],
    taken: [],
    warnings: [],
    gates: {},
    fog: 0,
    updated: null,
    lastRound: null,
    goal: '',
    ...over,
  };
}

const BODY = {
  specs: [
    wire('004', { phase: 'building', stage: 'code-review', progress: { closed: 30, total: 30 }, warnings: [{}, {}] }),
    wire('010', { type: 'bug', progress: { closed: 1, total: 4 }, fog: 2 }),
    wire('002', { phase: 'building', stage: 'build', progress: { closed: 25, total: 30 }, takeable: ['ISC-1', 'ISC-2'] }),
    wire('003', { type: 'refactor', stage: 'tasks', progress: { closed: 0, total: 13 }, nextCommand: null }),
  ],
  archive: [{ id: '001', slug: '001-first', title: 'First', type: 'feature' }],
};

const ids = (rows: readonly SpecTableRow[]): string[] => rows.map((row) => row.id);
const query = (over: Partial<ListQuery>): ListQuery => ({ ...DEFAULT_QUERY, ...over });
const params = (entries: Record<string, string>) => ({ get: (name: string) => entries[name] ?? null });

describe('readSpecRows', () => {
  it('reads the rows in model order with the fields the panel shows', () => {
    const rows = readSpecRows(BODY);
    expect(ids(rows)).toEqual(['004', '010', '002', '003']);
    expect(rows[0]).toMatchObject({ id: '004', phase: 'building', stage: 'code-review', closed: 30, total: 30, warnings: 2 });
    expect(rows[2]?.takeable).toEqual(['ISC-1', 'ISC-2']);
    expect(rows[3]?.nextCommand).toBeNull();
  });

  it('reads the goal line as the row description and the first lock holder as its agent', () => {
    const lock = { id: 'ISC-3', session: 'spec-005-ISC-3', since: '2026-09-30T10:00:00Z', source: 'activity' };
    const rows = readSpecRows({ specs: [wire('005', { goal: 'Keeps the manifest in step.', taken: [lock] }), wire('006')] });
    expect(rows[0]).toMatchObject({ description: 'Keeps the manifest in step.', agent: 'spec-005-ISC-3' });
    expect(rows[1]).toMatchObject({ description: null, agent: null });
  });

  it('reads nothing from a body that is not a dashboard, and skips rows without an id', () => {
    expect(readSpecRows(undefined)).toEqual([]);
    expect(readSpecRows({ specs: 'no' })).toEqual([]);
    expect(ids(readSpecRows({ specs: [{ title: 'x' }, wire('007')] }))).toEqual(['007']);
  });

  it('reads the archive rows', () => {
    expect(readArchiveRows(BODY)).toEqual([{ id: '001', slug: '001-first', title: 'First', type: 'feature' }]);
  });
});

describe('parseListQuery and listQueryParams', () => {
  it('reads the four query params and falls back to the defaults', () => {
    expect(parseListQuery(params({}))).toEqual(DEFAULT_QUERY);
    expect(parseListQuery(params({ phase: 'building', type: 'bug', sort: 'id', takeable: '1' }))).toEqual({
      phase: 'building',
      type: 'bug',
      sort: 'id',
      takeable: true,
    });
    expect(parseListQuery(params({ sort: 'nonsense', takeable: 'yes' }))).toEqual(DEFAULT_QUERY);
  });

  it('writes defaults as null, so the URL only carries what differs', () => {
    expect(listQueryParams(DEFAULT_QUERY)).toEqual({ phase: null, type: null, sort: null, takeable: null });
    expect(listQueryParams(query({ phase: 'fog', sort: 'next', takeable: true }))).toEqual({
      phase: 'fog',
      type: null,
      sort: 'next',
      takeable: '1',
    });
  });
});

describe('applyListQuery', () => {
  const rows = readSpecRows(BODY);

  it('keeps the model order by default', () => {
    expect(ids(applyListQuery(rows, DEFAULT_QUERY))).toEqual(['004', '010', '002', '003']);
  });

  it('filters by phase, by fog, by type and by takeable', () => {
    expect(ids(applyListQuery(rows, query({ phase: 'building' })))).toEqual(['004', '002']);
    expect(ids(applyListQuery(rows, query({ phase: 'fog' })))).toEqual(['010']);
    expect(ids(applyListQuery(rows, query({ type: 'bug' })))).toEqual(['010']);
    expect(ids(applyListQuery(rows, query({ takeable: true })))).toEqual(['002']);
  });

  it('offers the prototype sort menu: Stage, ID, Progress', () => {
    expect(SORT_MENU).toEqual(['stage', 'id', 'progress']);
  });

  it('sorts by id, by progress and by next up, stable on the model order', () => {
    expect(ids(applyListQuery(rows, query({ sort: 'id' })))).toEqual(['002', '003', '004', '010']);
    expect(ids(applyListQuery(rows, query({ sort: 'progress' })))).toEqual(['004', '002', '010', '003']);
    expect(ids(applyListQuery(rows, query({ sort: 'next' })))).toEqual(['002', '004', '010', '003']);
  });
});

describe('phaseOptions and typeOptions', () => {
  const rows = readSpecRows(BODY);

  it('lists All, the phases in lifecycle order with counts, and fog when a spec has fog', () => {
    expect(phaseOptions(rows)).toEqual([
      { key: 'all', count: 4 },
      { key: 'scoping', count: 2 },
      { key: 'building', count: 2 },
      { key: 'fog', count: 1 },
    ]);
  });

  it('lists types only when there are two or more', () => {
    expect(typeOptions(rows).map((option) => option.key)).toEqual(['all', 'bug', 'feature', 'refactor']);
    expect(typeOptions(rows.filter((row) => row.type === 'feature'))).toEqual([]);
  });
});
