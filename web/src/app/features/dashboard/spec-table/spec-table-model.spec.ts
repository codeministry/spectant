import { describe, expect, it } from 'vitest';
import {
  applyListQuery,
  DEFAULT_QUERY,
  holdNewRows,
  type ListQuery,
  listQueryParams,
  parseListQuery,
  phaseOptions,
  readArchiveRows,
  readListCounts,
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
    stageGroup: 'scoping',
    stage: 'review',
    progress: { closed: 0, total: 4 },
    tasks: null,
    nextCommand: `/spec review ${id}`,
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
    wire('004', { phase: 'building', stageGroup: 'building', stage: 'code-review', progress: { closed: 30, total: 30 }, warnings: [{}, {}] }),
    wire('010', { type: 'bug', progress: { closed: 1, total: 4 }, fog: 2 }),
    wire('002', { phase: 'building', stageGroup: 'building', stage: 'build', progress: { closed: 25, total: 30 }, takeable: ['ISC-1', 'ISC-2'] }),
    wire('003', { type: 'refactor', phase: 'climbing', stageGroup: 'complete', stage: 'tasks', progress: { closed: 0, total: 13 }, nextCommand: null }),
  ],
  archive: [{ id: '001', slug: '001-first', title: 'First', type: 'feature' }],
  kpis: { specs: 4, stageGroups: { scoping: 1, building: 2, complete: 1 }, specsWithFog: 1, byType: { feature: 2, bug: 1, refactor: 1 } },
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
    // The phase chips filter by stage group (ISC-255): an old frontmatter value such as `climbing` reads as all.
    expect(parseListQuery(params({ phase: 'climbing' }))).toEqual(DEFAULT_QUERY);
    expect(parseListQuery(params({ phase: 'complete' })).phase).toBe('complete');
    expect(parseListQuery(params({ phase: 'fog' })).phase).toBe('fog');
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
    // By the stage group core derives, not the frontmatter `phase:` (003 is written `climbing`, grouped complete).
    expect(ids(applyListQuery(rows, query({ phase: 'complete' })))).toEqual(['003']);
    expect(ids(applyListQuery(rows, query({ phase: 'scoping' })))).toEqual(['010']);
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

describe('phaseOptions and typeOptions (spec 021, ISC-255: every count is the model\'s)', () => {
  const counts = readListCounts(BODY);

  it('reads the chip counts from the model kpis, and none from a body without them', () => {
    expect(counts).toEqual(BODY.kpis);
    expect(readListCounts({ specs: [] })).toBeNull();
    expect(phaseOptions(null)).toEqual([]);
    expect(typeOptions(null)).toEqual([]);
  });

  it('lists All, the stage groups in lifecycle order with the served counts, and fog when a spec has fog', () => {
    expect(phaseOptions(counts)).toEqual([
      { key: 'all', count: 4 },
      { key: 'scoping', count: 1 },
      { key: 'building', count: 2 },
      { key: 'complete', count: 1 },
      { key: 'fog', count: 1 },
    ]);
  });

  it('shows the served numbers, never a count of the rows', () => {
    // Counts no grouping of BODY's rows gives: the chips must carry these.
    const served = { specs: 9, stageGroups: { scoping: 7, building: 0, complete: 2 }, specsWithFog: 0, byType: { bug: 5, chore: 4 } };
    expect(phaseOptions(served)).toEqual([
      { key: 'all', count: 9 },
      { key: 'scoping', count: 7 },
      { key: 'complete', count: 2 },
    ]);
    expect(typeOptions(served)).toEqual([
      { key: 'all', count: 9 },
      { key: 'bug', count: 5 },
      { key: 'chore', count: 4 },
    ]);
  });

  it('lists types alphabetically, only when there are two or more', () => {
    expect(typeOptions(counts)).toEqual([
      { key: 'all', count: 4 },
      { key: 'bug', count: 1 },
      { key: 'feature', count: 2 },
      { key: 'refactor', count: 1 },
    ]);
    expect(typeOptions({ ...BODY.kpis, byType: { feature: 4 } })).toEqual([]);
  });
});

describe('holdNewRows (design.md § Live update: new specs never reflow under the reader)', () => {
  const rows = readSpecRows({ specs: [wire('002'), wire('003'), wire('004')] });

  it('shows every row while nothing has been seen yet (the first load)', () => {
    expect(holdNewRows(rows, null)).toEqual({ shown: rows, pending: [] });
  });

  it('holds back the rows the reader has not seen, in list order, and keeps the seen ones in place', () => {
    const { shown, pending } = holdNewRows(rows, new Set(['003']));
    expect(shown.map((row) => row.id)).toEqual(['003']);
    expect(pending).toEqual(['002', '004']);
  });

  it('shows nothing extra for a seen spec that has gone', () => {
    expect(holdNewRows(rows.slice(0, 1), new Set(['002', '009']))).toEqual({ shown: rows.slice(0, 1), pending: [] });
  });
});

describe('spec-table-model description beside the title (ISC-249)', () => {
  const described = (title: string, goal: string): SpecTableRow | undefined => readSpecRows({ specs: [wire('021', { title, goal })] })[0];

  it('spec-table-model drops the description when it equals the title', () => {
    expect(described('Keeps the manifest in step', 'Keeps the manifest in step')?.description).toBeNull();
  });

  it('spec-table-model drops the description when it differs from the title only by the trailing full stop or whitespace', () => {
    expect(described('Keeps the manifest in step', 'Keeps the manifest in step.')?.description).toBeNull();
    expect(described('Keeps the manifest  in step.', '  Keeps the manifest in\tstep ')?.description).toBeNull();
    expect(described('Keeps the manifest in step!', 'Keeps the manifest in step …')?.description).toBeNull();
  });

  it('spec-table-model keeps title and description when they differ, and shows the description as the model gives it', () => {
    const row = described('Keeps the manifest in step', 'The manifest never drifts from the folder.');
    expect(row).toMatchObject({ title: 'Keeps the manifest in step', description: 'The manifest never drifts from the folder.' });
    expect(described('Keeps the manifest', 'Keeps the manifest in step.')?.description).toBe('Keeps the manifest in step.');
  });
});
