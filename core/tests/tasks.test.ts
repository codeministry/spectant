// The task line grammar in full (T23, ISC-82): flags, lane from the constitution's lane table, state from the checkbox
// and from rounds.jsonl, edges, paths, struck bullets and the probe mapping table, with the counts the Tasks tab's
// filter chips show.
//
// The real trees pin the numbers: spectant-001 (frozen fixture and this repository's live spec 001, which carries the
// two struck bullets), harbor 002 with its three rounds, and every fixture's rounds.jsonl as a parity oracle for the
// old SpecRun task reader (lane, flags, paths and text of every task a round line lists). Synthetic text covers what
// no tree carries: a code span holding ` · `, a lane outside the table, a planted probe-mapping inconsistency and
// malformed lines.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { listArchive } from '../src/archive.ts';
import { parseClaims } from '../src/claims.ts';
import type { TaskRow, TasksTab } from '../src/files.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { takeableSet } from '../src/takeable.ts';
import { lanesOf, parseTaskLines } from '../src/tasks.ts';
import { FIXTURES } from './helpers/read-tree.ts';

const read = (rel: string): string => readFileSync(join(FIXTURES, rel), 'utf8');
const REPO = join(import.meta.dir, '..', '..');

const byId = (model: TasksTab): Map<string, TaskRow> => new Map(model.tasks.map((t) => [t.id, t]));
const codes = (model: TasksTab): string[] => model.diagnostics.map((d) => d.code);
const ids = (rows: readonly TaskRow[]): string[] => rows.map((t) => t.id);
const range = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `T${from + i}`);

/** archive.ts's box count of one tasks.md: the fraction the archive listing and the dashboard show. */
function archiveBoxes(tasks: string): { landed: number; total: number } {
  const [row] = listArchive([{ folder: '001-x', texts: { spec: '# x\n', tasks } }]);
  if (!row) throw new Error('archive listed no row');
  return row.tasks;
}

describe('spectant-001, the frozen fixture', () => {
  const dir = 'spectant-001/specs/001-app-skeleton';
  const text = read(`${dir}/tasks.md`);
  const model = parseTaskLines({ tasks: text, constitution: read('spectant-001/specs/constitution.md') });
  const rows = byId(model);

  test('83 task lines, 27 checked, none struck; the box count equals archive.ts', () => {
    expect(model.tasks).toHaveLength(83);
    expect(model.counts.rows).toBe(83);
    expect(model.counts.boxes).toEqual({ landed: 27, total: 83 });
    expect(model.counts.boxes).toEqual(archiveBoxes(text));
    expect(model.tasks.filter((t) => t.state === 'struck')).toHaveLength(0);
    expect(model.tasks.filter((t) => t.state === 'done')).toHaveLength(27);
  });

  test('lanes from the constitution table, operator last, no unknown lane', () => {
    expect(lanesOf(read('spectant-001/specs/constitution.md'))).toEqual(['core', 'server', 'web', 'plugin', 'repo']);
    expect(model.counts.byLane).toEqual([
      { name: 'core', count: 11 },
      { name: 'server', count: 22 },
      { name: 'web', count: 43 },
      { name: 'repo', count: 5 },
      { name: 'operator', count: 2 },
    ]);
    expect(codes(model)).not.toContain('task-lane-unknown');
  });

  test('flags: six seams, [P] on every other non-operator task', () => {
    expect(ids(model.tasks.filter((t) => t.flags.seam))).toEqual(['T6', 'T11', 'T28', 'T33', 'T39', 'T59']);
    expect(model.tasks.filter((t) => t.flags.parallel && t.flags.seam)).toHaveLength(0);
    expect(ids(model.tasks.filter((t) => !t.flags.parallel && !t.flags.seam))).toEqual(['T16', 'T83']);
  });

  test('edges: T59 behind six tasks, and 23 tasks behind T59 (T60–T82)', () => {
    expect(rows.get('T59')?.edges).toEqual(['T24', 'T25', 'T26', 'T27', 'T39', 'T58']);
    expect(ids(model.tasks.filter((t) => t.edges.includes('T59')))).toEqual(range(60, 82));
    expect(rows.get('T11')?.edges).toEqual(['T9', 'T10']);
    expect(rows.get('T83')?.edges).toEqual(['T11', 'T78']);
    // The edge is gone from the display text; the rest of the sentence stays.
    expect(rows.get('T12')?.text).toBe('binary smoke: copy the host binary to an empty temp dir, `--no-browser --port 0`, three routes; `test:binary`');
  });

  test('path columns: one code span each, braces and trailing slashes kept, backticks gone', () => {
    expect(rows.get('T38')?.paths).toEqual(['core/src/{takeable,diagrams,tldr,markdown,archive}.ts']);
    expect(rows.get('T7')?.paths).toEqual(['web/']);
    expect(rows.get('T1')?.paths).toEqual(['package.json']);
    expect(model.tasks.every((t) => t.paths.length === 1 && t.pathNote === null)).toBe(true);
  });

  test('the probe mapping: 47 rows, ranges expanded, every task mapped once', () => {
    expect(model.probeMapping).toHaveLength(47);
    expect(model.probeMapping[1]).toMatchObject({ tasks: ['T2', 'T3', 'T4', 'T5'], claim: 'ISC-5.1' });
    // An escaped pipe inside a code span is a pipe in the probe.
    expect(model.probeMapping[0]?.probe).toBe('`bun run build && test $(ls dist/spectant-{darwin,linux}-{arm64,x64} | wc -l) -eq 4`');
    const mapped = model.probeMapping.flatMap((r) => r.tasks);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect(codes(model).filter((c) => c.startsWith('mapping-'))).toEqual([]);
  });

  test('state from rounds.jsonl: the newest result card of the same task', () => {
    const withRounds = parseTaskLines({ tasks: text, constitution: read('spectant-001/specs/constitution.md'), rounds: read(`${dir}/rounds.jsonl`) });
    const r = byId(withRounds);
    expect(r.get('T1')).toMatchObject({ status: 'closed', round: 9 });
    expect(r.get('T18')).toMatchObject({ status: 'done', round: 9 });
    expect(r.get('T26')).toMatchObject({ status: 'held', round: 9 });
    expect(r.get('T16')).toMatchObject({ status: 'open', round: 9 });
    // Checked boxes and rounds agree on this tree: nothing landed is shown as open.
    expect(withRounds.tasks.filter((t) => t.state === 'done' && !['done', 'closed'].includes(t.status))).toEqual([]);
    const total = withRounds.counts.byStatus.reduce((n, c) => n + c.count, 0);
    expect(total).toBe(83);
  });
});

describe("spectant's live spec 001: struck bullets", () => {
  const path = join(REPO, 'specs', '001-app-skeleton', 'tasks.md');
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';

  test('81 task lines, 2 struck bullets outside the count; done equals archive.ts', () => {
    const model = parseTaskLines({ tasks: text, constitution: readFileSync(join(REPO, 'specs', 'constitution.md'), 'utf8') });
    const struck = model.tasks.filter((t) => t.state === 'struck');
    expect(model.counts.boxes.total).toBe(81);
    expect(struck).toHaveLength(2);
    expect(model.counts.rows).toBe(83);
    expect(model.counts.boxes).toEqual(archiveBoxes(text));
    expect(model.tasks.filter((t) => t.state === 'done')).toHaveLength(archiveBoxes(text).landed);
    expect(ids(struck)).toEqual(['T32', 'T60']);
    expect(struck[0]).toMatchObject({
      claim: 'ISC-6',
      lane: 'core',
      status: 'struck',
      text: '`FORMAT.md`: the file contract as far as the dashboard reads it',
      paths: [],
    });
    expect(struck[0]?.note).toStartWith('struck 2026-09-29: `FORMAT.md` is owned by spec 002');
    expect(struck[1]?.note).toStartWith('struck 2026-09-29: the header is spec 002');
    // Struck tasks count nowhere in the box fraction, but the Tasks tab shows and counts them as rows.
    expect(model.counts.byStatus.find((c) => c.name === 'struck')).toEqual({ name: 'struck', count: 2 });
  });
});

describe('harbor 002: states from its three rounds', () => {
  const dir = 'harbor/specs/002-web-console';
  const constitution = read('harbor/specs/constitution.md');
  const text = read(`${dir}/tasks.md`);
  const model = parseTaskLines({ tasks: text, constitution, rounds: read(`${dir}/rounds.jsonl`) });
  const rows = byId(model);

  test('32 boxes, 27 checked, one struck bullet (T34) beside them, counts per lane', () => {
    expect(model.counts.boxes).toEqual({ landed: 27, total: 32 });
    expect(model.counts.boxes).toEqual(archiveBoxes(text));
    expect(model.counts.byLane).toEqual([
      { name: 'api', count: 1 },
      { name: 'web', count: 30 },
      { name: 'operator', count: 2 },
    ]);
  });

  test('the round states: closed through T26, T27 dispatched, T29 a question, operator T31 open', () => {
    expect(model.counts.byStatus).toEqual([
      { name: 'open', count: 1 },
      { name: 'dispatched', count: 1 },
      { name: 'held', count: 2 },
      { name: 'question', count: 1 },
      { name: 'done', count: 1 },
      { name: 'closed', count: 26 },
      { name: 'struck', count: 1 },
    ]);
    expect(rows.get('T34')).toMatchObject({ status: 'struck', state: 'struck', round: null, note: "struck 2026-03-08: covered by T32's keyboard probe" });
    expect(ids(model.tasks.filter((t) => t.status === 'closed'))).toEqual(range(1, 26));
    expect(rows.get('T27')).toMatchObject({ status: 'dispatched', round: 3, state: 'open' });
    expect(ids(model.tasks.filter((t) => t.status === 'held'))).toEqual(['T28', 'T32']);
    expect(rows.get('T29')).toMatchObject({ status: 'question', round: 3 });
    expect(rows.get('T30')).toMatchObject({ status: 'done', lane: 'operator', flags: { parallel: true, seam: false } });
    expect(rows.get('T31')).toMatchObject({ status: 'open', lane: 'operator', edges: ['T1', 'T30'] });
    expect(rows.get('T1')).toMatchObject({ builder: 'Engineer', flags: { parallel: false, seam: true }, lane: 'api' });
  });

  test('without rounds the checkboxes decide', () => {
    const plain = parseTaskLines({ tasks: text, constitution });
    expect(plain.counts.byStatus).toEqual([
      { name: 'open', count: 5 },
      { name: 'done', count: 27 },
      { name: 'struck', count: 1 },
    ]);
    expect(plain.tasks.every((t) => t.round === null && t.builder === null)).toBe(true);
  });

  test('the probe mapping covers every task, T30 and T31 on one row', () => {
    expect(model.probeMapping).toHaveLength(30);
    expect(model.probeMapping.at(-2)).toMatchObject({ tasks: ['T30', 'T31'], claim: 'ISC-77', probe: 'transcript in `.evidence/`' });
    expect(model.diagnostics).toEqual([]);
  });

  test('takeable.ts plans over the parsed model as over its own', () => {
    const spec = read(`${dir}/spec.md`);
    const plan = takeableSet({ reviewed: 'fresh', specType: parseFrontmatter(spec).data.specType, claims: parseClaims(spec).claims, tasks: model });
    expect(plan.tasks).toEqual({ landed: 27, total: 32 });
    const held = new Map(plan.held.map((h) => [h.task, h.reason]));
    expect(held.get('T31')).toStartWith('operator lane');
    expect(held.get('T32')).toBe('claim blocked by ISC-77');
    expect([...plan.dispatch.map((d) => d.task), ...held.keys()].sort()).toEqual(['T27', 'T28', 'T29', 'T31', 'T32']);
  });
});

describe('parity with the rounds.jsonl task lists (the old SpecRun reader)', () => {
  const cases = [
    'harbor/specs/002-web-console',
    'leadgen/specs/012-pwa-install',
    'leadgen/specs/022-chat-turn-status-and-bulk-delete',
    'spectant-001/specs/001-app-skeleton',
  ];

  /**
   * Where this parser deliberately differs from the old reader: it split the path column on every comma, so the brace
   * glob inside T38's one code span became five "paths". Here a code span is one path.
   */
  const DIVERGENT: Readonly<Record<string, readonly string[]>> = { 'spectant-001/specs/001-app-skeleton': ['T38'] };

  test.each(cases)('%s: claim, lane, flags and paths of every task on the newest line', (dir) => {
    const lines = read(`${dir}/rounds.jsonl`).split('\n').filter((l) => l.trim() !== '');
    const last = JSON.parse(lines.at(-1) ?? '{}') as {
      tasks: Array<{ id: string; claim: string; lane: string; seam: boolean; parallel: boolean; paths: string[] }>;
    };
    const rows = byId(parseTaskLines({ tasks: read(`${dir}/tasks.md`) }));
    expect(last.tasks.length).toBeGreaterThan(0);
    const differing = last.tasks
      .filter((t) => {
        const row = rows.get(t.id);
        const mine = { claim: row?.claim, lane: row?.lane, seam: row?.flags.seam, parallel: row?.flags.parallel, paths: row?.paths };
        return JSON.stringify(mine) !== JSON.stringify({ claim: t.claim, lane: t.lane, seam: t.seam, parallel: t.parallel, paths: t.paths });
      })
      .map((t) => t.id);
    expect(differing).toEqual([...(DIVERGENT[dir] ?? [])]);
  });

  test('leadgen 012: a path column without a file is a note, and the round state still matches the task', () => {
    const dir = 'leadgen/specs/012-pwa-install';
    const rows = byId(parseTaskLines({ tasks: read(`${dir}/tasks.md`), rounds: read(`${dir}/rounds.jsonl`) }));
    expect(rows.get('T14')).toMatchObject({
      text: "the anti search over the worker config, the manifest and the icons' names",
      edges: ['T3', 'T8'],
      paths: [],
      pathNote: 'probe only',
      status: 'closed',
    });
    expect(rows.get('T15')).toMatchObject({ lane: 'test', paths: [], pathNote: 'probe only, Interceptor', status: 'closed' });
    expect(rows.get('T16')).toMatchObject({ lane: 'operator', pathNote: 'probe only, a device', status: 'open' });
    expect(rows.get('T3')?.paths).toEqual(['frontend/tools/build-favicon.sh', 'frontend/public/icon-*.png', 'frontend/public/apple-touch-icon.png']);
  });
});

describe('the grammar on synthetic lines', () => {
  const constitution = ['# C', '', '## Lanes', '', '| Lane | Paths |', '|------|-------|', '| core | `core/` |', '| `web` | `web/` |', '', '## Other', ''].join('\n');

  test('lanesOf: first column, backticks stripped, empty without a table', () => {
    expect(lanesOf(constitution)).toEqual(['core', 'web']);
    expect(lanesOf('# no lanes\n')).toEqual([]);
  });

  test('a code span may hold ` · `; the last separator outside code spans starts the paths', () => {
    const m = parseTaskLines({ tasks: '- [ ] T1 · ISC-1 · core — split `a · b` then join · `x.ts`, `y · z.ts`\n' });
    expect(m.tasks[0]).toMatchObject({ text: 'split `a · b` then join', paths: ['x.ts', 'y · z.ts'] });
  });

  test('text may hold ` · ` itself; edges anywhere are removed from it', () => {
    const line =
      '- [ ] T57 · ISC-82 · web — Tasks tab: rows with lane, flags; stacked rows below wide · Mobile, Tablet (after: T35, T52) · `web/src/app/features/spec/data/tasks/`';
    const [t] = parseTaskLines({ tasks: `${line}\n- [x] T35 · ISC-1 · web — a\n- [x] T52 · ISC-1 · web — b\n` }).tasks;
    expect(t).toMatchObject({
      text: 'Tasks tab: rows with lane, flags; stacked rows below wide · Mobile, Tablet',
      edges: ['T35', 'T52'],
      paths: ['web/src/app/features/spec/data/tasks/'],
      line: 1,
    });
    const [u] = parseTaskLines({ tasks: '- [ ] T2 · ISC-1 · core — (after: T1) first the edge, then the text · `a.ts`\n- [ ] T1 · ISC-1 · core — x\n' }).tasks;
    expect(u).toMatchObject({ text: 'first the edge, then the text', edges: ['T1'], paths: ['a.ts'] });
  });

  test('a text without a path column keeps everything', () => {
    const [t] = parseTaskLines({ tasks: '- [ ] T1 · ISC-1 · core — one · two\n' }).tasks;
    expect(t).toMatchObject({ text: 'one · two', paths: [], pathNote: null });
  });

  test('flags in either order, [X] as done, claim ids of the other forms', () => {
    const m = parseTaskLines({
      tasks: ['- [X] T1 · ISC-60.1 · [seam] · [P] · core — a · `a.ts`', '  - [ ] T2 · H-AVAIL · [P] · web — b · `b.ts`', '- [ ] T3 · C4 · web — c'].join('\n'),
    });
    expect(m.tasks.map((t) => [t.id, t.claim, t.flags.parallel, t.flags.seam, t.state, t.lane])).toEqual([
      ['T1', 'ISC-60.1', true, true, 'done', 'core'],
      ['T2', 'H-AVAIL', true, false, 'open', 'web'],
      ['T3', 'C4', false, false, 'open', 'web'],
    ]);
    expect(m.diagnostics).toEqual([]);
  });

  test('a lane not in the table is kept with a diagnostic; operator is always valid', () => {
    const m = parseTaskLines({ tasks: '- [ ] T1 · ISC-1 · docs — a\n- [ ] T2 · ISC-1 · operator — b\n- [ ] T3 · ISC-1 · core — c\n', constitution });
    expect(m.tasks.map((t) => t.lane)).toEqual(['docs', 'operator', 'core']);
    expect(m.diagnostics.map((d) => [d.severity, d.code, d.line, d.message.includes('docs')])).toEqual([['warning', 'task-lane-unknown', 1, true]]);
    expect(m.counts.byLane).toEqual([
      { name: 'core', count: 1 },
      { name: 'docs', count: 1 },
      { name: 'operator', count: 1 },
    ]);
    // Without a constitution, or with one that has no lane table, every lane token stands as written.
    expect(codes(parseTaskLines({ tasks: '- [ ] T1 · ISC-1 · docs — a\n' }))).toEqual([]);
  });

  test('struck bullets: state struck, the note kept, no box counted', () => {
    const m = parseTaskLines({
      tasks: ['- [x] T1 · ISC-1 · core — a · `a.ts`', '- ~~T2 · ISC-2 · [P] · core — gone · `b.ts`~~ — struck 2026-09-29: moved to 003', '- ~~T3 · ISC-3 · web — plain~~'].join('\n'),
    });
    expect(m.tasks.map((t) => [t.id, t.state, t.status, t.note])).toEqual([
      ['T1', 'done', 'done', null],
      ['T2', 'struck', 'struck', 'struck 2026-09-29: moved to 003'],
      ['T3', 'struck', 'struck', null],
    ]);
    expect(m.tasks[1]).toMatchObject({ claim: 'ISC-2', flags: { parallel: true, seam: false }, text: 'gone', paths: ['b.ts'] });
    expect(m.counts.boxes).toEqual({ landed: 1, total: 1 });
  });

  test('headers, prose, table rows, fenced examples and non-task checkboxes are not tasks', () => {
    const tasks = [
      '# Tasks',
      '',
      'Prose mentioning T1 · ISC-1 · core — not a task.',
      '| T1 | ISC-1 | probe |',
      '- [ ] a checkbox without a task id',
      '- plain bullet T9',
      '```markdown',
      '- [ ] T8 · ISC-1 · core — an example inside a fence',
      '```',
      '- [ ] T1 · ISC-1 · core — the one task',
    ].join('\n');
    const m = parseTaskLines({ tasks });
    expect(m.tasks.map((t) => [t.id, t.line])).toEqual([['T1', 10]]);
  });

  test('malformed task lines stay rows (the box count holds) and carry a diagnostic; nothing throws', () => {
    const tasks = [
      '- [ ] T1 no separators at all',
      '- [ ] T2 · ISC-1 · [Q] · core — unknown flag',
      '- [ ] T3 · ISC-1 · core — edge on a claim (after: ISC-9, T77)',
      '- [ ] T3 · ISC-1 · core — duplicate id',
      '- [ ] T4 · not-a-claim · core — no claim',
      '- [ ] T5 · ISC-1 — no lane',
    ].join('\n');
    const m = parseTaskLines({ tasks });
    expect(m.counts.boxes).toEqual({ landed: 0, total: 6 });
    expect(m.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['task-malformed', 1],
      ['task-flag-unknown', 2],
      ['task-edge-not-task', 3],
      ['task-edge-unknown', 3],
      ['task-duplicate-id', 4],
      ['task-no-claim', 5],
      ['task-no-lane', 6],
    ]);
    expect(m.tasks[0]).toMatchObject({ id: 'T1', claim: '', lane: '', text: 'no separators at all' });
    expect(m.tasks[2]?.edges).toEqual(['T77']);
    expect(() => parseTaskLines({ tasks: '', rounds: '{not json\n{"round":1}\n' })).not.toThrow();
    expect(parseTaskLines({ tasks: '' }).tasks).toEqual([]);
  });
});

describe('the probe mapping table', () => {
  const tasks = [
    '## Tasks',
    '',
    '- [ ] T1 · ISC-1 · core — a · `a.ts`',
    '- [ ] T2 · ISC-2 · core — b · `b.ts`',
    '- [ ] T3 · ISC-3 · core — c · `c.ts`',
    '- [ ] T4 · ISC-3 · core — d · `d.ts`',
    '- ~~T5 · ISC-5 · core — e~~ — struck: gone',
    '',
    '## Probe Mapping',
    '',
    '| Task | Claim | Probe |',
    '|------|-------|-------|',
    '| T1, T9 | ISC-1 | `bun test a` |',
    '| T2 | ISC-9 | `bun test b \\| wc -l` |',
    '| T3–T4 | ISC-3 | manual |',
    '| T5 | ISC-5 | gone |',
    '',
    '## After',
    '',
    '| T2 | ISC-2 | not the mapping |',
  ].join('\n');
  const m = parseTaskLines({ tasks });

  test('rows with ranges expanded, pipes unescaped, a table outside the section ignored', () => {
    expect(m.probeMapping).toEqual([
      { tasks: ['T1', 'T9'], claim: 'ISC-1', probe: '`bun test a`', line: 13 },
      { tasks: ['T2'], claim: 'ISC-9', probe: '`bun test b | wc -l`', line: 14 },
      { tasks: ['T3', 'T4'], claim: 'ISC-3', probe: 'manual', line: 15 },
      { tasks: ['T5'], claim: 'ISC-5', probe: 'gone', line: 16 },
    ]);
  });

  test('a planted inconsistency: unknown task, claim mismatch, struck task mapped, listed task unmapped', () => {
    expect(m.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['mapping-unknown-task', 13],
      ['mapping-claim-mismatch', 14],
      ['mapping-struck-task', 16],
    ]);
    const unmapped = parseTaskLines({ tasks: tasks.replace('| T3–T4 | ISC-3 | manual |', '| T3 | ISC-3 | manual |') });
    expect(unmapped.diagnostics.filter((d) => d.code === 'mapping-missing').map((d) => [d.message, d.line])).toEqual([
      [expect.stringContaining('T4') as unknown as string, 6],
    ]);
  });

  test('no Probe Mapping section: no rows and no missing-row diagnostics', () => {
    const none = parseTaskLines({ tasks: '- [ ] T1 · ISC-1 · core — a\n' });
    expect(none.probeMapping).toEqual([]);
    expect(none.diagnostics).toEqual([]);
  });
});
