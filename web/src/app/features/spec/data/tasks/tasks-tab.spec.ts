import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import golden from '../../../../../../../core/fixtures/harbor.tasks.golden.json';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult, type TasksResult } from '../../../../core/api.service';
import { TasksTab, type TasksBody } from './tasks-tab';

const GOLDEN = golden['specs/002-web-console'] as unknown as TasksBody;
const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const DASHBOARD = { specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }], archive: [] };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'spec' | 'tasks'>;

function setUp(tasks: TasksBody | null = GOLDEN): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve(ok(DASHBOARD)),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    tasks: (): Promise<TasksResult> => Promise.resolve({ ...ok(tasks), hash: tasks === null ? null : 'ab12' }),
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
  it('renders one row per task line and the landed fraction from the golden counts', async () => {
    setUp();
    const { root } = await open();
    expect(rows(root)).toHaveLength(GOLDEN.counts.rows);
    expect(root.querySelector('[data-tasks-landed]')?.textContent).toContain(
      `${String(GOLDEN.counts.boxes.landed)}/${String(GOLDEN.counts.boxes.total)}`,
    );
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

  it('renders every checkbox disabled, checked from the done state, described by the helper line', async () => {
    setUp();
    const { root } = await open();
    const boxes = [...root.querySelectorAll<HTMLInputElement>('[data-task-row] input[type="checkbox"]')];
    expect(boxes).toHaveLength(GOLDEN.counts.boxes.total);
    expect(boxes.every((box) => box.disabled)).toBe(true);
    expect(boxes.filter((box) => box.checked)).toHaveLength(GOLDEN.counts.boxes.landed);
    const described = boxes[0]?.getAttribute('aria-describedby') ?? '';
    expect(described.split(' ').every((id) => root.querySelector(`#${id}`) !== null)).toBe(true);
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
    expect(footer?.textContent).toContain(`${String(done)} done hidden`);
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
