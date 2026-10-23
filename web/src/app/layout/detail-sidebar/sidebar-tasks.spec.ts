import { ApplicationRef, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import golden from '../../../../../core/fixtures/harbor.tasks.golden.json';
import type { Relation, RelationRef } from '../../../../../core/src/relations';
import type { SpecRouteResponses } from '../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type TaskCheckResult, type TasksResult } from '../../core/api.service';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import type { Tier } from '../shell/tier';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { SidebarTasks } from './sidebar-tasks';

type TasksBody = NonNullable<SpecRouteResponses['tasks']>;
type TaskRow = TasksBody['tasks'][number];
const GOLDEN = golden['specs/002-web-console'] as unknown as TasksBody;

// Seven open tasks: the golden's five (T27, T28, T29, T31, T32) and two more on ISC-77, so the cap of five shows "+2".
const extra = (id: string): TaskRow => ({ ...(GOLDEN.tasks.find((row) => row.id === 'T31') as TaskRow), id, text: `extra task ${id}` });
const BODY: TasksBody = { ...GOLDEN, tasks: [...GOLDEN.tasks, extra('T40'), extra('T41')] };

const rel = (ref: RelationRef, extraFields: Partial<Relation> = {}): Relation => {
  const [type, ...rest] = ref.split(':');
  return { ref, type: type as Relation['type'], id: rest.join(':'), title: ref, closed: 0, total: 0, parents: [], children: [], blockers: [], ...extraFields };
};
const SPEC = rel('spec:002');
const CLAIM = rel('claim:ISC-77', { parents: ['spec:002', 'feature:F2'] });

const RUN_DASHBOARD = {
  kind: 'ok',
  body: {
    specs: [
      {
        id: '002',
        slug: '002-web-console',
        state: {
          kind: 'spec',
          id: '002',
          state: 'running',
          run: { source: 'run', run: 'r-0308-1452', command: '/spec implement 002', session: 'a:claude:s-9', actor: null, since: '', elapsedMs: 0 },
        },
      },
    ],
  },
};

describe('SidebarTasks (spec 067, T33, ISC-535)', () => {
  let reads: string[];
  let sent: Array<{ ws: string; id: string; tid: string; hash: string; checked: boolean }>;
  let answer: (result: TaskCheckResult) => void;
  let dashboard: WritableSignal<unknown>;
  let tier: WritableSignal<Tier>;

  function render(relation: Relation | null, body: TasksBody = BODY): { host: HTMLElement; detect: () => Promise<void> } {
    reads = [];
    sent = [];
    dashboard = signal<unknown>({ kind: 'ok', body: { specs: [] } });
    tier = signal<Tier>('wide');
    const api: Pick<ApiClient, 'tasks' | 'taskCheck'> = {
      tasks: (ws, id): Promise<TasksResult> => {
        reads.push(`${ws}/${id}`);
        return Promise.resolve({ kind: 'ok', body, etag: null, notModified: false, hash: 'h0' });
      },
      taskCheck: (ws, id, tid, hash, checked): Promise<TaskCheckResult> => {
        sent.push({ ws, id, tid, hash, checked });
        return new Promise((resolve) => (answer = resolve));
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
        provideRouter([]),
        { provide: ApiClient, useValue: api },
        { provide: ShellData, useValue: { dashboard: { value: () => dashboard() } } },
        { provide: ShellState, useValue: { ws: signal('harbor'), specId: signal(null), tier } },
      ],
    });
    const fixture = TestBed.createComponent(SidebarTasks);
    if (relation !== null) fixture.componentRef.setInput('relation', relation);
    const host = fixture.nativeElement as HTMLElement;
    const detect = async (): Promise<void> => {
      fixture.detectChanges();
      await TestBed.inject(ApplicationRef).whenStable();
      fixture.detectChanges();
    };
    return { host, detect };
  }

  const ids = (host: HTMLElement): string[] => [...host.querySelectorAll('[data-task]')].map((el) => el.getAttribute('data-task') ?? '');
  const box = (host: HTMLElement, id: string): HTMLInputElement => {
    const input = host.querySelector<HTMLInputElement>(`[data-task="${id}"] input[type="checkbox"]`);
    if (input === null) throw new Error(`no box for ${id}`);
    return input;
  };

  it('lists five open tasks of a spec, then "+2 more" linking to its Tasks tab, each box labelled by id and text', async () => {
    const { host, detect } = render(SPEC);
    await detect();
    expect(reads).toEqual(['harbor/002']);
    expect(ids(host)).toEqual(['T27', 'T28', 'T29', 'T31', 'T32']);
    const more = host.querySelector<HTMLAnchorElement>('a[data-tasks-more]');
    expect(more?.textContent.trim()).toBe('+2 more');
    expect(more?.getAttribute('href')).toBe('/w/harbor/s/002/tasks');
    const label = host.querySelector('[data-task="T28"] label');
    expect(label?.textContent.replace(/\s+/g, ' ').trim()).toMatch(/^T28 · \S/);
    expect(box(host, 'T28').checked).toBe(false);
    expect(host.querySelector('h3 [data-heading]')?.textContent.trim()).toBe('Open tasks');
    expect(host.querySelector('h3 [data-count]')?.textContent.trim()).toBe('7');
    expect(host.hidden).toBe(false);
  });

  it('lists only the tasks anchored on a claim, read from its holding spec', async () => {
    const { host, detect } = render(CLAIM);
    await detect();
    expect(reads).toEqual(['harbor/002']);
    // ISC-77 holds T30 (done), T31 (open) and the extra T40, T41; the done one is not listed.
    expect(ids(host)).toEqual(['T31', 'T40', 'T41']);
    expect(host.querySelector('a[data-tasks-more]')).toBeNull();
  });

  it('reads nothing before a selection is set', async () => {
    const { host, detect } = render(null);
    await detect();
    expect(reads).toEqual([]);
    expect(host.querySelector('section')).toBeNull();
  });

  it('renders nothing, no empty heading, when the spec has no open tasks', async () => {
    const done: TasksBody = { ...GOLDEN, tasks: GOLDEN.tasks.filter((row) => row.state !== 'open') };
    const { host, detect } = render(SPEC, done);
    await detect();
    expect(reads).toEqual(['harbor/002']);
    expect(host.querySelector('section')).toBeNull();
    expect(host.querySelector('h3')).toBeNull();
    // The empty host is hidden, so it takes no track and no gap in the sidebar body's grid (ISC-525).
    expect(host.hidden).toBe(true);
  });

  it('sends one write per tick, busy while it is in flight, and keeps the task listed, ticked, without a read', async () => {
    const { host, detect } = render(SPEC);
    await detect();
    const input = box(host, 'T29');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await detect();
    expect(sent).toEqual([{ ws: 'harbor', id: '002', tid: 'T29', hash: 'h0', checked: true }]);
    const row = host.querySelector('[data-task="T29"]');
    expect(row?.getAttribute('aria-busy')).toBe('true');
    expect(box(host, 'T29').disabled).toBe(true);
    answer({ kind: 'ok', body: { task: 'T29', checked: true, hash: 'h1', lockSource: 'none', line: { number: 47, text: '- [x] T29 · ISC-76 · web — done' } } });
    await detect();
    expect(sent.length).toBe(1);
    expect(reads).toEqual(['harbor/002']);
    expect(host.querySelector('[data-task="T29"]')?.getAttribute('aria-busy')).toBeNull();
    expect(ids(host)).toContain('T29');
    expect(box(host, 'T29').checked).toBe(true);
  });

  it('shows a 409 inline with Reload, which reads the list again', async () => {
    const { host, detect } = render(SPEC);
    await detect();
    const input = box(host, 'T27');
    input.checked = true;
    input.dispatchEvent(new Event('change'));
    await detect();
    answer({ kind: 'conflict', status: 409, body: { error: 'conflict' } } as unknown as TaskCheckResult);
    await detect();
    const alert = host.querySelector('[data-task="T27"] [data-check-conflict]');
    expect(alert?.getAttribute('role')).toBe('alert');
    host.querySelector<HTMLButtonElement>('[data-task="T27"] [data-check-reload]')?.click();
    await detect();
    expect(reads).toEqual(['harbor/002', 'harbor/002']);
  });

  it('locks every box while a run is open on the spec: no write, the run named as text', async () => {
    const { host, detect } = render(SPEC);
    dashboard.set(RUN_DASHBOARD);
    await detect();
    const input = box(host, 'T28');
    expect(input.getAttribute('aria-disabled')).toBe('true');
    input.click();
    await detect();
    expect(sent).toEqual([]);
    expect(input.checked).toBe(false);
    expect(host.querySelector('[data-tasks-run]')?.textContent).toContain('a:claude:s-9');
  });

  it('marks its rows for the 44 px sheet at compact', async () => {
    const { host, detect } = render(SPEC);
    tier.set('compact');
    await detect();
    expect(host.getAttribute('data-tier')).toBe('compact');
  });
});
