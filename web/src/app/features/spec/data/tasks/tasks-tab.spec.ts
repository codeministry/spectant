import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import liveGolden from '../../../../../../../core/fixtures/harbor.live.golden.json';
import golden from '../../../../../../../core/fixtures/harbor.tasks.golden.json';
import specGolden from '../../../../../../../core/fixtures/harbor.spec.golden.json';
import stepsGolden from '../../../../../../../core/fixtures/harbor.steps.golden.json';
import type { ItemStateInfo, LiveFrame, SpecPageModel, TaskSteps } from '../../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult, type TaskCheckResult, type TasksResult } from '../../../../core/api.service';
import { ToastService } from '../../../../shared/ui/toast/toast';
import { runShort, TasksTab, type TasksBody } from './tasks-tab';

const GOLDEN = golden['specs/002-web-console'] as unknown as TasksBody;
const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const DASHBOARD = { specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }], archive: [] };

const LIVE = liveGolden['specs/002-web-console'] as unknown as LiveFrame;

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'spec' | 'tasks' | 'taskCheck' | 'live'>;

/** The steps the fake live frame carries; undefined sends the golden frame as it is (no steps). */
let liveSteps: TaskSteps | undefined;

/** What the fake write was sent, in order. */
let sent: Array<{ tid: string; hash: string; checked: boolean }> = [];

function setUp(tasks: TasksBody | null = GOLDEN, hash: string | null = 'ab12', spec: unknown = null): void {
  sent = [];
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve(ok(DASHBOARD)),
    spec: () => Promise.resolve(spec === null ? { kind: 'not-found', served: false } : ok(spec as never)),
    live: () => Promise.resolve(ok((liveSteps === undefined ? LIVE : { ...LIVE, steps: liveSteps }) as never)),
    tasks: (): Promise<TasksResult> => Promise.resolve({ ...ok(tasks), hash: tasks === null ? null : hash }),
    taskCheck: (_ws, _id, tid, sentHash, checked): Promise<TaskCheckResult> => {
      sent.push({ tid, hash: sentHash, checked });
      const line = { number: 49, text: `- [${checked ? 'x' : ' '}] ${tid} · ISC-77 · operator — pass` };
      return Promise.resolve({ kind: 'ok', body: { task: tid, checked, hash: `next-${String(sent.length)}`, lockSource: 'none', line } });
    },
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: 'w/:ws/s/:id/tasks', component: TasksTab }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
    ],
  });
}

async function open(query = ''): Promise<{ root: HTMLElement; harness: RouterTestingHarness }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(`/w/harbor/s/002/tasks${query}`);
  await harness.fixture.whenStable();
  return { root: harness.fixture.nativeElement as HTMLElement, harness };
}

const rows = (root: HTMLElement) => root.querySelectorAll('[data-task-row]');
const count = (n: number | undefined) => n ?? -1;
const laneCount = (lane: string) => count(GOLDEN.counts.byLane.find((c) => c.name === lane)?.count);
const statusCount = (status: string) => count(GOLDEN.counts.byStatus.find((c) => c.name === status)?.count);

describe('TasksTab', () => {
  it('renders one row per task line and the done rows of all rows from the golden counts', async () => {
    setUp();
    const { root } = await open();
    expect(rows(root)).toHaveLength(GOLDEN.counts.rows);
    expect(root.querySelector('[data-tasks-done]')?.textContent).toContain(
      `${String(GOLDEN.counts.done)} of ${String(GOLDEN.counts.rows)} tasks done or closed`,
    );
    // "hide done" stands in the head line, beside the count (spec 021, T43).
    expect(root.querySelector('.head [data-hide-done]')).not.toBeNull();
  });

  it('renders a row with its claim link, edges, lane, path tail, status and builder', async () => {
    setUp();
    const { root } = await open();
    const t2 = root.querySelector('#task-T2');
    expect(t2?.querySelector('a[data-claim]')?.getAttribute('href')).toBe('/w/harbor/s/002/claims#claim-ISC-51');
    expect(t2?.querySelector('a[data-edge]')?.getAttribute('href')).toBe('/w/harbor/s/002/tasks#task-T1');
    expect(t2?.querySelector('[data-lane]')?.textContent.trim()).toBe('web');
    const path = t2?.querySelector('[data-path]');
    expect(path?.textContent.trim()).toBe('registry-list/');
    expect(path?.getAttribute('title')).toBe('web/src/app/registry-list/');
    expect(t2?.getAttribute('data-status')).toBe('closed');
    expect(root.querySelector('#task-T1 [data-flag="seam"]')).not.toBeNull();
    expect(root.querySelector('#task-T27 [data-builder]')?.textContent.trim()).toBe('Engineer');
    expect(root.querySelector('#task-T28 [data-sub]')?.textContent).toContain('width 10 reached');
    expect(root.querySelector('#task-T31 [data-sub]')?.textContent).toContain('your step');
  });

  it('shows the agent of a task the live frame names (T27 of the golden, stale, no sub-agent), nothing on the others', async () => {
    setUp();
    const { root } = await open();
    const actors = root.querySelectorAll('[data-task-row] app-task-actors');
    expect(actors).toHaveLength(LIVE.cards.filter((c) => c.agent !== null || c.subagent !== null).length);
    const t27 = root.querySelector('#task-T27 app-task-actors');
    expect(t27?.querySelector('ui-actor-chip[data-task-agent] .label')?.textContent.trim()).toBe('a:claude:sess-2');
    expect(t27?.querySelector('ui-actor-chip[data-task-agent]')?.hasAttribute('data-stale')).toBe(true);
    expect(t27?.querySelector('[data-task-subagent]')).toBeNull();
    expect(root.querySelector('#task-T2 app-task-actors')).toBeNull();
  });

  it('names a row\'s holder once: a row with live holders shows no second actor chip in its state details (spec 040)', async () => {
    // T27 is held in the live frame; give its row the running item the server sends for such a task.
    const actor = { raw: 'a:claude:sess-2', kind: 'agent', id: 'a:claude:sess-2', legacy: false } as const;
    const held = { kind: 'task', id: 'T27', spec: '002', state: 'running', run: { run: 'a:claude:sess-2', command: '/spec-implement 002', session: 'a:claude:sess-2', actor, since: '2026-03-08T14:06:00Z', elapsedMs: 54 * 60_000, openRuns: 1, source: 'lock' } } as const;
    setUp({ ...GOLDEN, tasks: GOLDEN.tasks.map((t) => (t.id === 'T27' ? { ...t, itemState: held } : t)) });
    const { root } = await open();
    const rows = [...root.querySelectorAll('[data-task-row]')].filter((row) => row.querySelector('app-task-actors') !== null);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.querySelector('ui-item-state[data-task-item] ui-actor-chip')).toBeNull();
  });

  it('renders every checkbox enabled, checked from the done state, described by the helper line', async () => {
    setUp();
    const { root } = await open();
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-task-row] input[type="checkbox"]')];
    expect(boxes).toHaveLength(GOLDEN.counts.boxes.total);
    expect(boxes.every((box) => !box.disabled)).toBe(true);
    expect(boxes.filter((box) => box.checked)).toHaveLength(GOLDEN.counts.boxes.landed);
    const described = boxes[0]?.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').every((id) => root.querySelector(`#${id}`) !== null)).toBe(true);
  });

  it('disables every checkbox with the reason as visible text while the list has no hash', async () => {
    setUp(GOLDEN, null);
    const { root } = await open();
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-task-row] input[type="checkbox"]')];
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(root.querySelector('#task-T31 [data-check-no-hash]')?.textContent).toContain('without the tasks.md hash');
    const described = root.querySelector('#task-T31 input')?.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').every((id) => root.querySelector(`#${id}`) !== null)).toBe(true);
  });

  it('a tick posts the rendered hash, then the answer hash; the row and the toast follow the answer line', async () => {
    setUp();
    const { root, harness } = await open();
    const box = () => root.querySelector<HTMLInputElement>('#task-T31 input[data-task-check]');
    box()?.click();
    await harness.fixture.whenStable();
    expect(sent).toEqual([{ tid: 'T31', hash: 'ab12', checked: true }]);
    expect(root.querySelector('#task-T31')?.getAttribute('data-check')).toBe('written');
    expect(root.querySelector('#task-T31 .status')?.getAttribute('data-tone')).toBe('done');
    expect(box()?.checked).toBe(true);
    expect(TestBed.inject(ToastService).message()).toBe('T31 ticked in tasks.md, line 49');

    box()?.click();
    await harness.fixture.whenStable();
    expect(sent[1]).toEqual({ tid: 'T31', hash: 'next-1', checked: false });
    expect(box()?.checked).toBe(false);
  });

  it('offers lane chips in byLane order with their counts, and a lane narrows the rows', async () => {
    setUp();
    const { root, harness } = await open();
    const chips = [...root.querySelectorAll('[data-filter="lane"] button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
    expect(chips.slice(1)).toEqual(GOLDEN.counts.byLane.map((c) => `${c.name} ${String(c.count)}`));

    const web = [...root.querySelectorAll<HTMLButtonElement>('[data-filter="lane"] button')].find((b) => b.textContent.includes('web'));
    web?.click();
    await harness.fixture.whenStable();
    expect(rows(root)).toHaveLength(laneCount('web'));
  });

  it('narrows by status from the URL query', async () => {
    setUp();
    const { root } = await open('?status=held');
    expect(rows(root)).toHaveLength(statusCount('held'));
  });

  it('hides done rows behind a footer naming them, and Show brings them back', async () => {
    setUp();
    const { root, harness } = await open('?hideDone=1');
    const done = GOLDEN.tasks.filter((t) => t.state === 'done').length;
    expect(rows(root)).toHaveLength(GOLDEN.counts.rows - done);
    const footer = root.querySelector('[data-done-hidden]');
    // spec 024: prototype value (principal: the prototype wins): the fold row "+ 16 more done · T1–T11, T20–T26".
    expect(footer?.textContent).toContain(`+ ${String(done)} more done`);
    expect(footer?.textContent).toContain('T1–T26');
    footer?.querySelector('button')?.click();
    await harness.fixture.whenStable();
    expect(rows(root)).toHaveLength(GOLDEN.counts.rows);
  });

  it('shows a struck task struck through with its note and no checkbox', async () => {
    const tasks = GOLDEN.tasks.map((t) =>
      t.id === 'T32' ? { ...t, state: 'struck' as const, status: 'struck' as const, note: 'struck 2026-09-29: folded into T31' } : t,
    );
    setUp({ ...GOLDEN, tasks });
    const { root } = await open();
    const row = root.querySelector('#task-T32');
    expect(row?.getAttribute('data-state')).toBe('struck');
    expect(row?.querySelector('s')).not.toBeNull();
    expect(row?.querySelector('input')).toBeNull();
    expect(row?.querySelector('[data-sub]')?.textContent).toContain('folded into T31');
  });

  it('highlights and focuses the row a #task- deep link names', async () => {
    setUp();
    const { root } = await open('#task-T28');
    const row = root.querySelector<HTMLElement>('#task-T28');
    expect(row?.classList.contains('is-target')).toBe(true);
    expect(document.activeElement).toBe(row);
  });

  it('puts every row in one roving list with a single tab stop', async () => {
    setUp();
    const { root } = await open();
    const stops = [...rows(root)].filter((row) => (row as HTMLElement).tabIndex === 0);
    expect(stops).toHaveLength(1);
  });

  it('renders one probe mapping row per mapping entry', async () => {
    setUp();
    const { root } = await open();
    expect(root.querySelectorAll('[data-mapping-row]')).toHaveLength(GOLDEN.probeMapping.length);
    expect(root.querySelector('[data-mapping-row] code')?.textContent).toBe('bun run e2e -- registry-list -g render');
  });

  it('renders a type-aware empty state when the spec has no tasks.md', async () => {
    setUp(null);
    const { root } = await open();
    expect(rows(root)).toHaveLength(0);
    expect(root.querySelector('ui-empty-state')?.textContent).toContain('No tasks.md for a feature');
  });
});

describe('TasksTab tasks-tab counts (spec 021, T42, ISC-252)', () => {
  /** The status chips as `[label, count]`, the `all` chip first. */
  const statusChips = (root: HTMLElement): Array<[string, number]> =>
    [...root.querySelectorAll('[data-filter="status"] button')].map((b) => {
      const count = b.querySelector('.count')?.textContent.trim() ?? '';
      return [b.textContent.trim().slice(0, -count.length).trim(), Number(count)];
    });
  const head = (root: HTMLElement) => root.querySelector('[data-tasks-done]')?.textContent.replace(/\s+/g, ' ').trim();

  it('tasks-tab counts: head line, `all` and the sum of the status chips name the same row count (open, done, held)', async () => {
    // The golden 002 holds open, held, done and closed rows besides a struck one.
    expect(GOLDEN.tasks.some((t) => t.status === 'open')).toBe(true);
    expect(GOLDEN.tasks.some((t) => t.status === 'held')).toBe(true);
    expect(GOLDEN.tasks.some((t) => t.status === 'done')).toBe(true);
    setUp();
    const { root } = await open();
    const { rows: total, done } = GOLDEN.counts;
    expect(head(root)).toBe(`${String(done)} of ${String(total)} tasks done or closed`);
    const [all, ...chips] = statusChips(root);
    expect(all).toEqual(['all', total]);
    expect(chips.reduce((sum, [, n]) => sum + n, 0)).toBe(total);
    expect(chips.map(([label]) => label)).toContain('done');
    expect(rows(root)).toHaveLength(total);
  });

  it('tasks-tab counts: the chip "done" shows at 0, and one row reads the singular', async () => {
    const [first] = GOLDEN.tasks.filter((t) => t.status === 'open');
    const body: TasksBody = {
      ...GOLDEN,
      tasks: [first],
      counts: {
        rows: 1,
        done: 0,
        boxes: { landed: 0, total: 1 },
        byLane: [{ name: first.lane, count: 1 }],
        byStatus: [
          { name: 'open', count: 1 },
          { name: 'done', count: 0 },
        ],
      },
    };
    setUp(body);
    const { root } = await open();
    expect(head(root)).toBe('0 of 1 task done or closed');
    expect(statusChips(root)).toEqual([
      ['all', 1],
      ['open', 1],
      ['done', 0],
    ]);
  });
});

describe('TasksTab filter names (spec 021, T44, ISC-248)', () => {
  const allChip = (root: HTMLElement, group: string) => root.querySelector<HTMLButtonElement>(`[data-filter="${group}"] button`);

  it('names the two `all` chips by their group, the visible text first, so no two chips share a name', async () => {
    setUp();
    const { root } = await open();
    const total = GOLDEN.counts.rows;
    expect(allChip(root, 'lane')?.textContent.replace(/\s+/g, ' ').trim()).toBe(`all ${String(total)}`);
    expect(allChip(root, 'lane')?.getAttribute('aria-label')).toBe(`All ${String(total)} lanes`);
    expect(allChip(root, 'status')?.getAttribute('aria-label')).toBe(`All ${String(total)} statuses`);
    const named = [...root.querySelectorAll<HTMLButtonElement>('[data-filter] button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(new Set(named).size).toBe(named.length);
  });
});

describe('TasksTab spec waits (spec 025, T26, ISC-163)', () => {
  /** The golden with T27 held on 002, T28 on an unknown 042 and T29 on a met edge to 006 (no hold reason). */
  function waiting(): TasksBody {
    const open = GOLDEN.tasks.filter((t) => t.state === 'open').slice(0, 3).map((t) => t.id);
    const tasks = GOLDEN.tasks.map((t) => {
      if (t.id === open[0]) return { ...t, status: 'held' as const, reason: 'waits on 002', afterSpecs: ['002'] };
      if (t.id === open[1]) return { ...t, status: 'held' as const, reason: 'waits on 042', afterSpecs: ['042'] };
      if (t.id === open[2]) return { ...t, reason: null, afterSpecs: ['006'] };
      return t;
    });
    return { ...GOLDEN, tasks };
  }

  it('gives a held row the clock, "waits on NNN" with the blocker linked and a disabled box; a met edge none', async () => {
    const body = waiting();
    const [first, second, third] = body.tasks.filter((t) => t.afterSpecs !== undefined && t.afterSpecs.length > 0).map((t) => t.id);
    setUp(body);
    const { root } = await open();
    const row = (id: string) => root.querySelector<HTMLElement>(`#task-${id}`);
    const line = row(first)?.querySelector<HTMLElement>('[data-task-waits]');
    expect(line?.textContent).toContain('waits on');
    expect(line?.querySelector('ui-icon')).not.toBeNull();
    expect(row(first)?.querySelector('.box-lock')).toBeNull();
    expect(line?.querySelector('a[data-blocker="002"]')?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(row(first)?.querySelector<HTMLInputElement>('[data-task-check]')?.disabled).toBe(true);
    expect(row(first)?.querySelector('[data-sub]')).toBeNull();
    expect(row(second)?.querySelector('[data-task-waits] a')).toBeNull();
    expect(row(second)?.querySelector('[data-task-waits] [data-blocker="042"]')).not.toBeNull();
    expect(row(third)?.querySelector('[data-task-waits]')).toBeNull();
  });

  it('ISC-162.2: a task held only by its claim edge (no afterSpecs of its own) shows the wait from core reason', async () => {
    const id = GOLDEN.tasks.find((t) => t.state === 'open')?.id;
    setUp({ ...GOLDEN, tasks: GOLDEN.tasks.map((t) => (t.id === id ? { ...t, status: 'held' as const, reason: 'waits on 002', afterSpecs: [] } : t)) });
    const { root } = await open();
    const row = root.querySelector<HTMLElement>(`#task-${String(id)}`);
    expect(row?.querySelector('[data-task-waits] a[data-blocker="002"]')?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(row?.querySelector<HTMLInputElement>('[data-task-check]')?.disabled).toBe(true);
    expect(row?.querySelector('[data-sub]')).toBeNull();
  });
});

describe('TasksTab item state (spec 040, T52, ISC-224)', () => {
  const HEAD = (specGolden['specs/002-web-console'] as unknown as SpecPageModel).head;
  const session = 'a:claude:sess-9';
  const RUNNING: ItemStateInfo = {
    kind: 'spec',
    id: '002',
    state: 'running',
    stage: 'build',
    run: {
      run: 'r-1',
      command: '/spec-implement 002',
      session,
      actor: { raw: session, kind: 'agent', id: session, legacy: false },
      since: '2026-03-08T16:40:00Z',
      elapsedMs: 180_000,
      openRuns: 1,
      source: 'run',
    },
  };
  const specWith = (state: ItemStateInfo | undefined) => ({ ...specGolden['specs/002-web-console'], head: { ...HEAD, state } });
  const stateCell = (root: HTMLElement, id: string) => root.querySelector(`#task-${id} [data-item-state]`);

  it('shows the state word in the status cell, the fine running state as its detail, question beside it', async () => {
    setUp();
    const { root } = await open();
    expect(stateCell(root, 'T28')?.getAttribute('data-item-state')).toBe('running');
    expect(stateCell(root, 'T28')?.textContent.replace(/\s+/g, ' ').trim()).toBe('running · applied, open');
    expect(stateCell(root, 'T32')?.textContent.trim()).toBe('waiting');
    expect(stateCell(root, 'T34')?.textContent.replace(/\s+/g, ' ').trim()).toBe('done · struck');
    expect(stateCell(root, 'T29')?.textContent.trim()).toBe('open');
    expect(root.querySelector('#task-T29 .status[data-tone="question"]')).not.toBeNull();
  });

  it('keeps the old status chip on a row without itemState (older payloads)', async () => {
    setUp({ ...GOLDEN, tasks: GOLDEN.tasks.map((t) => ({ ...t, itemState: undefined })) });
    const { root } = await open();
    expect(root.querySelector('[data-item-state]')).toBeNull();
    expect(root.querySelector('#task-T2 .status')?.getAttribute('data-tone')).toBe('closed');
  });

  it('locks every checkbox and shows the notice while a run stands on the spec; a click writes nothing', async () => {
    setUp(GOLDEN, 'ab12', specWith(RUNNING));
    const { root, harness } = await open();
    await harness.fixture.whenStable();
    const notice = root.querySelector('[data-run-notice]');
    expect(notice?.textContent).toContain('/spec-implement 002');
    expect(notice?.textContent).toContain('3 min');
    const box = root.querySelector<HTMLInputElement>('#task-T31 [data-task-check]');
    expect(box?.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('#task-T31 .box-lock')).not.toBeNull();
    const reason = root.querySelector('#task-T31 [data-check-run-locked]');
    expect(reason?.textContent).toContain(`locked · ${session}`);
    expect(box?.getAttribute('aria-describedby')).toContain(reason?.id ?? '-');
    box?.click();
    await harness.fixture.whenStable();
    expect(sent).toEqual([]);
    expect(box?.checked).toBe(false);
  });

  it('shows no notice and no lock without a run on the spec', async () => {
    setUp(GOLDEN, 'ab12', specWith({ ...RUNNING, state: 'open', run: undefined, command: '/spec-implement 002' }));
    const { root } = await open();
    expect(root.querySelector('[data-run-notice]')).toBeNull();
    expect(root.querySelector('#task-T31 [data-task-check]')?.getAttribute('aria-disabled')).toBeNull();
  });
});

describe('TasksTab step timeline (spec 015, T23, ISC-232)', () => {
  // The golden steps of 002: T4 and T25 one claim release each, T26 and T28 seven steps ending in `apply`.
  const STEPS = stepsGolden['specs/002-web-console'] as unknown as TaskSteps;
  const WITH_STEPS = { ...GOLDEN, steps: STEPS } as TasksBody;
  const toggle = (root: HTMLElement, id: string) => root.querySelector<HTMLButtonElement>(`#task-${id} [data-steps-toggle]`);
  const panel = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`#task-${id} [data-steps]`);
  const url = () => TestBed.inject(Router).url;

  afterEach(() => {
    liveSteps = undefined;
  });

  it('timeline: only rows with steps get a toggle, every one collapsed by default', async () => {
    setUp(WITH_STEPS);
    const { root } = await open();
    const toggles = [...root.querySelectorAll<HTMLElement>('[data-steps-toggle]')];
    expect(toggles.map((t) => t.closest('[data-task-row]')?.id)).toEqual(['task-T4', 'task-T25', 'task-T26', 'task-T28']);
    expect(toggles.every((t) => t.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(root.querySelector('[data-steps]')).toBeNull();
    expect(toggle(root, 'T27')).toBeNull();
  });

  it('timeline: the toggle names the latest step with its kind, its clock with seconds and the count', async () => {
    setUp(WITH_STEPS);
    const { root } = await open();
    const t26 = toggle(root, 'T26');
    const latest = t26?.querySelector('[data-step-latest]');
    expect(latest?.getAttribute('data-step-kind')).toBe('apply');
    expect(latest?.textContent).toContain('Applied');
    expect(t26?.querySelector('time')?.getAttribute('datetime')).toBe('2026-03-08T16:12:00Z');
    expect(t26?.textContent).toContain('7 steps');
    expect(t26?.textContent).toContain('Agent steps of T26');
    // The claim's release reads its own word, never the run release of spec 040.
    expect(toggle(root, 'T4')?.querySelector('[data-step-latest]')?.textContent).toContain('Claim released');
    expect(toggle(root, 'T4')?.textContent).toContain('1 step');
  });

  it('timeline: ?steps=T26,T28 opens both rows with their full timeline, each wired to its toggle', async () => {
    setUp(WITH_STEPS);
    const { root } = await open('?steps=T26,T28');
    for (const id of ['T26', 'T28']) {
      expect(toggle(root, id)?.getAttribute('aria-expanded')).toBe('true');
      expect(toggle(root, id)?.getAttribute('aria-controls')).toBe(`task-${id}-steps`);
      expect(panel(root, id)?.id).toBe(`task-${id}-steps`);
      expect(panel(root, id)?.querySelectorAll('[data-step-kind]')).toHaveLength(7);
    }
    expect(panel(root, 'T4')).toBeNull();
  });

  it('timeline: a click toggles its own row through the query and leaves the others as they are', async () => {
    setUp(WITH_STEPS);
    const { root, harness } = await open('?steps=T26,T28');
    toggle(root, 'T26')?.click();
    await harness.fixture.whenStable();
    expect(url()).toContain('steps=T28');
    expect(url()).not.toContain('T26');
    expect(panel(root, 'T26')).toBeNull();
    expect(panel(root, 'T28')).not.toBeNull();
    toggle(root, 'T4')?.click();
    await harness.fixture.whenStable();
    expect(decodeURIComponent(url())).toContain('steps=T28,T4');
    expect(panel(root, 'T4')?.querySelector('[data-step-kind="release"]')).not.toBeNull();
  });

  it('timeline: ?steps=T26#task-T26 opens the row and scrolls to and focuses it', async () => {
    setUp(WITH_STEPS);
    const { root } = await open('?steps=T26#task-T26');
    expect(panel(root, 'T26')).not.toBeNull();
    expect(document.activeElement).toBe(root.querySelector('#task-T26'));
  });

  it('timeline: the live frame\'s steps win and a live update never opens a row', async () => {
    liveSteps = { ...STEPS, T27: [{ kind: 'probe', ts: '2026-03-08T16:20:05Z', actor: 'a:claude:sess-2/T27', result: 'red' }] };
    setUp(WITH_STEPS);
    const { root } = await open();
    expect(toggle(root, 'T27')?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle(root, 'T27')?.querySelector('[data-step-latest]')?.getAttribute('data-step-kind')).toBe('probe');
    expect(toggle(root, 'T27')?.textContent).toContain('Probe red');
    expect(root.querySelector('[data-steps]')).toBeNull();
  });
});

describe('runShort (spec 035, ISC-189)', () => {
  it('takes the worktree tail when the run names one, else the session tail, as for a dispatch without worktree', () => {
    expect(runShort({ session: 'a:claude:sess-2/T26', worktree: '.claude/worktrees/agent-a1b2' })).toBe('agent-a1b2');
    expect(runShort({ session: 'a:claude:sess-2/T26' })).toBe('T26');
  });
});
