import { describe, expect, it } from 'vitest';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { workingOf } from '../../../core/model/working';
import {
  applyArchivedQuery,
  applyListQuery,
  type ArchiveRow,
  archivedTableRow,
  DEFAULT_QUERY,
  FOG,
  holdNewRows,
  LIST_QUERY_KEYS,
  type ListQuery,
  listQueryParams,
  parseListQuery,
  phaseOptions,
  readArchiveRows,
  readListCounts,
  readSpecRows,
  SORT_KEYS,
  SORT_MENU,
  type SpecTableRow,
  STAGE_GROUPS,
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
  archive: [
    { id: '001', slug: '001-first', title: 'First', type: 'feature', archived: '2026-09-01', archivedReason: null, claims: { closed: 5, total: 6 }, tasks: { landed: 3, total: 3 }, goal: 'Starts the workspace.' },
  ],
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

  it('carries the agent dot on exactly the specs "In Arbeit" lists, with its session (spec 064, T2, ISC-466)', () => {
    const lock = (session: unknown) => ({ id: 'ISC-3', session, since: '2026-10-21T09:00:00Z', source: 'activity' });
    const bodies: unknown[] = [
      harbor,
      { specs: [wire('005', { taken: [lock('a:claude:sess-5')] }), wire('006'), wire('007', { taken: [] })] },
      { specs: [wire('008', { taken: [{ id: 'ISC-1' }, lock('a:claude:sess-8')] }), wire('009', { taken: [lock(7)] })] },
      { specs: [wire('010', { taken: [null, 'x'] }), { title: 'no id', taken: [lock('a:claude:sess-0')] }] },
    ];
    for (const body of bodies) {
      const dotted = readSpecRows(body).flatMap((row) => (row.agent === null ? [] : [{ id: row.id, session: row.agent }]));
      expect(dotted).toEqual(workingOf(body).map(({ id, session }) => ({ id, session })));
    }
    expect(readSpecRows(bodies[2]).map((row) => row.agent)).toEqual(['a:claude:sess-8', null]);
  });

  it('reads nothing from a body that is not a dashboard, and skips rows without an id', () => {
    expect(readSpecRows(undefined)).toEqual([]);
    expect(readSpecRows({ specs: 'no' })).toEqual([]);
    expect(ids(readSpecRows({ specs: [{ title: 'x' }, wire('007')] }))).toEqual(['007']);
  });

  it('reads the archive rows with their claims, goal and archive date (spec 050, ISC-287)', () => {
    expect(readArchiveRows(BODY)).toEqual([
      { id: '001', slug: '001-first', title: 'First', type: 'feature', closed: 5, total: 6, goal: 'Starts the workspace.', archived: '2026-09-01' },
    ]);
  });

  it('reads an archive row without claims, goal or date as zero claims, no goal and no date', () => {
    expect(readArchiveRows({ archive: [{ id: '007', slug: '007-old', title: 'Old', type: null, claims: 'no', goal: 3 }, { title: 'x' }] })).toEqual([
      { id: '007', slug: '007-old', title: 'Old', type: null, closed: 0, total: 0, goal: '', archived: null },
    ]);
  });
});

describe('archivedTableRow (spec 050, ISC-287)', () => {
  const [archived] = readArchiveRows(BODY);

  it('builds a done row with the archive mark and no priority, stage group, phase or next step', () => {
    expect(archivedTableRow(archived)).toEqual({
      id: '001',
      title: 'First',
      type: 'feature',
      priority: null,
      phase: null,
      stage: 'done',
      stageGroup: null,
      closed: 5,
      total: 6,
      nextCommand: null,
      nextReason: '',
      takeable: [],
      warnings: 0,
      fog: 0,
      description: 'Starts the workspace.',
      agent: null,
      waits: null,
      archived: { on: '2026-09-01' },
    });
  });

  it('drops a goal that repeats the title and keeps a missing date as null', () => {
    const row = archivedTableRow({ id: '008', slug: '008-same', title: 'Same', type: null, closed: 0, total: 0, goal: 'Same.', archived: null });
    expect(row).toMatchObject({ description: null, archived: { on: null } });
  });

  it('leaves every active row without the archive mark', () => {
    expect(readSpecRows(BODY).every((row) => row.archived === undefined)).toBe(true);
  });
});

describe('parseListQuery and listQueryParams', () => {
  it('reads the five query params and falls back to the defaults', () => {
    expect(parseListQuery(params({}))).toEqual(DEFAULT_QUERY);
    expect(parseListQuery(params({ phase: 'building', type: 'bug', sort: 'id', takeable: '1', archived: '1' }))).toEqual({
      phase: 'building',
      type: 'bug',
      sort: 'id',
      takeable: true,
      working: false,
      archived: true,
    });
    expect(parseListQuery(params({ sort: 'nonsense', takeable: 'yes', archived: 'yes' }))).toEqual(DEFAULT_QUERY);
    // The phase chips filter by stage group (ISC-255): an old frontmatter value such as `climbing` reads as all.
    expect(parseListQuery(params({ phase: 'climbing' }))).toEqual(DEFAULT_QUERY);
    expect(parseListQuery(params({ phase: 'complete' })).phase).toBe('complete');
    expect(parseListQuery(params({ phase: 'fog' })).phase).toBe('fog');
  });

  it('starts with the working filter off and reads ?working=1 as on, like takeable (spec 064, T3, ISC-465)', () => {
    expect(DEFAULT_QUERY.working).toBe(false);
    expect(parseListQuery(params({ working: '1' }))).toEqual({ ...DEFAULT_QUERY, working: true });
    expect(parseListQuery(params({ working: '0' })).working).toBe(false);
    expect(parseListQuery(params({ working: 'yes' })).working).toBe(false);
    expect(listQueryParams(query({ working: true })).working).toBe('1');
    expect(listQueryParams(DEFAULT_QUERY).working).toBeNull();
  });

  it('starts with the archived specs hidden and reads ?archived=1 as shown (spec 050, ISC-287)', () => {
    expect(DEFAULT_QUERY.archived).toBe(false);
    expect(parseListQuery(params({ archived: '1' }))).toEqual({ ...DEFAULT_QUERY, archived: true });
    expect(parseListQuery(params({ archived: '0' })).archived).toBe(false);
    expect(listQueryParams(query({ archived: true })).archived).toBe('1');
    expect(listQueryParams(DEFAULT_QUERY).archived).toBeNull();
  });

  it('writes defaults as null, so the URL only carries what differs', () => {
    expect(listQueryParams(DEFAULT_QUERY)).toEqual({ phase: null, type: null, sort: null, takeable: null, working: null, archived: null });
    expect(listQueryParams(query({ phase: 'fog', sort: 'next', takeable: true }))).toEqual({
      phase: 'fog',
      type: null,
      sort: 'next',
      takeable: '1',
      working: null,
      archived: null,
    });
  });
});

describe('LIST_QUERY_KEYS (spec 058, T5, ISC-396)', () => {
  it('names every key listQueryParams can write', () => {
    const every = listQueryParams({ phase: FOG, type: 'feature', sort: 'next', takeable: true, working: true, archived: true });
    for (const key of Object.keys(every)) expect(LIST_QUERY_KEYS).toContain(key);
  });

  it('names search, the show-all fold and density beside the filters', () => {
    expect([...LIST_QUERY_KEYS].sort()).toEqual(['all', 'archived', 'density', 'phase', 'q', 'sort', 'takeable', 'type', 'working']);
  });

  it('never names sel: the dashboard keeps its own selection (ISC-400)', () => {
    expect(LIST_QUERY_KEYS).not.toContain('sel');
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

  it('keeps exactly the rows with an agent under the working filter (spec 064, T3, ISC-465)', () => {
    const lock = { id: 'ISC-1', session: 'a:claude:sess-1', since: '2026-10-21T09:00:00Z', source: 'activity' };
    const locked = readSpecRows({ specs: [wire('011', { taken: [lock] }), wire('012'), wire('013', { taken: [lock], type: 'bug' })] });
    expect(ids(applyListQuery(locked, query({ working: true })))).toEqual(['011', '013']);
    expect(ids(applyListQuery(locked, query({ working: true, type: 'bug' })))).toEqual(['013']);
    expect(ids(applyListQuery(locked, DEFAULT_QUERY))).toEqual(['011', '012', '013']);
    expect(applyListQuery(rows, query({ working: true }))).toEqual([]);
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

describe('applyArchivedQuery (spec 050, ISC-288: design.md § Across viewports, phase chips and order)', () => {
  /** An archive row as `readArchiveRows` gives it, only the fields that matter overridden. */
  const archive = (id: string, over: Partial<ArchiveRow> = {}): ArchiveRow => ({
    id,
    slug: `${id}-slug`,
    title: `Archived ${id}`,
    type: 'feature',
    closed: 0,
    total: 0,
    goal: '',
    archived: '2026-09-01',
    ...over,
  });
  /** Seventeen archived specs in model order (not by ID), three of them bugs, with mixed claim ratios. */
  const ARCHIVE: readonly ArchiveRow[] = [
    archive('009', { closed: 3, total: 4 }),
    archive('001', { closed: 6, total: 6 }),
    archive('017', { type: 'bug', closed: 1, total: 2 }),
    archive('005', { closed: 2, total: 4 }),
    archive('012', { closed: 9, total: 9 }),
    archive('002', { type: 'bug', closed: 0, total: 3 }),
    archive('010'),
    archive('003', { closed: 4, total: 4 }),
    archive('014', { closed: 1, total: 4 }),
    archive('006', { closed: 3, total: 4 }),
    archive('011', { closed: 5, total: 10 }),
    archive('004', { type: 'refactor', closed: 1, total: 1 }),
    archive('016', { closed: 2, total: 8 }),
    archive('007', { closed: 7, total: 7 }),
    archive('015', { type: 'bug', closed: 2, total: 3 }),
    archive('008', { closed: 0, total: 5 }),
    archive('013', { closed: 1, total: 3 }),
  ];
  const on = (over: Partial<ListQuery>): ListQuery => query({ archived: true, ...over });
  const descending = ARCHIVE.map((row) => row.id).sort((a, b) => b.localeCompare(a));

  it('shows no archived row while the switch is off', () => {
    expect(applyArchivedQuery(ARCHIVE, DEFAULT_QUERY)).toEqual([]);
    expect(applyArchivedQuery(ARCHIVE, query({ sort: 'id', type: 'bug' }))).toEqual([]);
  });

  it('builds every row through archivedTableRow, so each carries the archive mark', () => {
    const rows = applyArchivedQuery(ARCHIVE, on({}));
    expect(rows).toHaveLength(17);
    expect(rows.every((row) => row.archived !== undefined && row.stage === 'done' && row.stageGroup === null)).toBe(true);
    expect(rows.find((row) => row.id === '009')).toEqual(archivedTableRow(archive('009', { closed: 3, total: 4 })));
  });

  it('hides every archived row under a phase chip, the fog chip or takeable', () => {
    for (const phase of [...STAGE_GROUPS, FOG]) expect(applyArchivedQuery(ARCHIVE, on({ phase }))).toEqual([]);
    expect(applyArchivedQuery(ARCHIVE, on({ takeable: true }))).toEqual([]);
    // An archived spec holds no lock, so the working filter (spec 064, ISC-465) lists none of them either.
    expect(applyArchivedQuery(ARCHIVE, on({ working: true }))).toEqual([]);
  });

  it('lets the type filter reach the archived rows', () => {
    expect(ids(applyArchivedQuery(ARCHIVE, on({ type: 'bug' })))).toEqual(['017', '015', '002']);
    expect(ids(applyArchivedQuery(ARCHIVE, on({ type: 'refactor', sort: 'id' })))).toEqual(['004']);
    expect(applyArchivedQuery(ARCHIVE, on({ type: 'chore' }))).toEqual([]);
  });

  it('orders the archive by ID descending under Stage and Next, the last archived at the boundary', () => {
    expect(ids(applyArchivedQuery(ARCHIVE, on({ sort: 'stage' })))).toEqual(descending);
    expect(ids(applyArchivedQuery(ARCHIVE, on({ sort: 'next' })))).toEqual(descending);
  });

  it('orders the archive by ID ascending under ID, numerically', () => {
    expect(ids(applyArchivedQuery(ARCHIVE, on({ sort: 'id' })))).toEqual([...descending].reverse());
    expect(ids(applyArchivedQuery([archive('100'), archive('99'), archive('9')], on({ sort: 'id' })))).toEqual(['9', '99', '100']);
  });

  it('orders the archive by claim ratio descending under Progress, ties by ID descending', () => {
    expect(ids(applyArchivedQuery(ARCHIVE, on({ sort: 'progress' })))).toEqual([
      ...['012', '007', '004', '003', '001'], // 1
      ...['009', '006'], // 0.75
      '015', // 0.67
      ...['017', '011', '005'], // 0.5
      '013', // 0.33
      ...['016', '014'], // 0.25
      ...['010', '008', '002'], // 0, a spec without claims counting as 0
    ]);
  });

  it('yields nothing for an empty archive, so ?archived=1 alone changes nothing', () => {
    for (const sort of SORT_KEYS) expect(applyArchivedQuery([], on({ sort }))).toEqual([]);
  });

  it('leaves the active rows to applyListQuery unchanged', () => {
    const rows = readSpecRows(BODY);
    expect(applyListQuery(rows, on({}))).toEqual(applyListQuery(rows, DEFAULT_QUERY));
  });
});
