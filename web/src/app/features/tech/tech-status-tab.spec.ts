import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { TechModel } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';

// T16 · ISC-134.1: the Status tab against the harbor goldens. Harbor's dashboard lists eight specs in the model's
// order 004 005 006 002 009 003 008 007; 007 stands at stage done (the KPI tile's "complete"), so it is listed last
// behind the divider. 005 carries the only fog lines (two) in the tech model; 004 and 002 have a tasks.md.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const HARBOR = harborTech as unknown as TechModel;

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'tech'>;

let harness: RouterTestingHarness;

async function open(tier: Tier = 'wide', tech: TechModel = HARBOR): Promise<HTMLElement> {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(dashboard)),
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    tech: () => Promise.resolve(ok(tech)),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/w/harbor/tech/status');
  await harness.fixture.whenStable();
  harness.fixture.detectChanges();
  return tab(harness.fixture.nativeElement as HTMLElement);
}

function tab(root: HTMLElement): HTMLElement {
  const el = root.querySelector<HTMLElement>('app-tech-status-tab');
  if (el === null) throw new Error('app-tech-status-tab is not mounted');
  return el;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const OPEN_ORDER = ['004', '005', '006', '002', '009', '003', '008'];

describe('TechStatusTab (T16, ISC-134.1)', () => {
  it('mounts in the status panel and sums the specs up as the KPI tile does, with the legend', async () => {
    const el = await open();
    expect(el.dataset['techTab']).toBe('status');
    expect(text(el.querySelector('[data-summary]'))).toBe('8 specs · 4 building · 3 scoping · 1 complete');
    expect(text(el.querySelector('[data-legend]'))).toBe('Complete specs are listed last.');
  });

  it('renders a real table at wide with Spec, Title, Type, Stage, Claims, Tasks and Fog columns', async () => {
    const el = await open('wide');
    const table = el.querySelector('table');
    expect(table).not.toBeNull();
    expect(text(table?.querySelector('caption'))).toBe('Status of every spec');
    const heads = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => th.getAttribute('data-col'));
    expect(heads).toEqual(['spec', 'title', 'type', 'stage', 'claims', 'tasks', 'fog']);
    for (const th of table?.querySelectorAll('thead th') ?? []) expect(th.getAttribute('scope')).toBe('col');
    expect(el.querySelector('[data-stacked]')).toBeNull();
  });

  it('drops the Type column at medium and keeps the table', async () => {
    const el = await open('medium');
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.getAttribute('data-col'));
    expect(heads).toEqual(['spec', 'title', 'stage', 'claims', 'tasks', 'fog']);
    expect(el.querySelector('td[data-col="type"]')).toBeNull();
  });

  it('lists the open specs in the dashboard order, then the divider "Complete · 1" and the complete spec', async () => {
    const el = await open();
    const bodies = el.querySelectorAll('tbody');
    expect(bodies).toHaveLength(2);
    const openIds = [...bodies[0].querySelectorAll<HTMLElement>('tr[data-spec]')].map((tr) => tr.dataset['spec']);
    expect(openIds).toEqual(OPEN_ORDER);
    const divider = bodies[1].querySelector('tr[data-divider] th');
    expect(text(divider)).toBe('Complete · 1');
    expect(divider?.getAttribute('colspan')).toBe('7');
    const done = [...bodies[1].querySelectorAll<HTMLElement>('tr[data-spec]')].map((tr) => tr.dataset['spec']);
    expect(done).toEqual(['007']);
  });

  it('mutes the complete rows by a flag (ink, never opacity) and gives their meter a muted fill, not the lime one', async () => {
    const el = await open();
    const done = el.querySelector<HTMLElement>('tr[data-spec="007"]');
    const live = el.querySelector<HTMLElement>('tr[data-spec="002"]');
    expect(done?.hasAttribute('data-complete')).toBe(true);
    expect(live?.hasAttribute('data-complete')).toBe(false);
    expect(done?.style.opacity).toBe('');
    const fill = (row: HTMLElement | null): string => row?.querySelector<HTMLElement>('ui-meter .fill')?.style.background ?? '';
    expect(fill(live)).toContain('--color-accent');
    expect(fill(done)).toContain('--color-success');
    expect(done?.querySelector('ui-meter')?.hasAttribute('data-muted')).toBe(true);
  });

  it('fills claims, tasks, stage and type from the dashboard row', async () => {
    const el = await open();
    const row = el.querySelector('tr[data-spec="002"]');
    expect(text(row?.querySelector('td[data-col="claims"] .frac'))).toBe('25/30');
    expect(row?.querySelector('ui-meter')?.getAttribute('aria-valuetext')).toBe('25 of 30 claims closed');
    expect(text(row?.querySelector('td[data-col="tasks"]'))).toBe('27/32');
    expect(text(row?.querySelector('td[data-col="stage"]'))).toBe('Build');
    expect(text(row?.querySelector('td[data-col="type"]'))).toBe('feature');
    expect(text(el.querySelector('tr[data-spec="005"] td[data-col="tasks"]'))).toContain('no tasks');
  });

  it('counts the fog lines of each spec from the tech model and explains the unit with a term', async () => {
    const el = await open();
    const fog = (id: string): string => text(el.querySelector(`tr[data-spec="${id}"] td[data-col="fog"]`));
    expect(fog('005')).toBe('2');
    expect(fog('002')).toBe('0');
    expect(el.querySelector(`tr[data-spec="005"] td[data-col="fog"]`)?.hasAttribute('data-has')).toBe(true);
    const term = el.querySelector('th[data-col="fog"] ui-term');
    expect(text(term?.querySelector('dfn'))).toBe('Fog');
    expect(text(term?.querySelector('[role="tooltip"]'))).toBe('Fog counts the open-question lines (- fog:) in this spec.');
    const extra = { ...HARBOR, specs: HARBOR.specs.map((spec) => (spec.id === '002' ? { ...spec, fog: ['a', 'b', 'c'] } : spec)) };
    TestBed.resetTestingModule();
    const again = await open('wide', extra);
    expect(text(again.querySelector('tr[data-spec="002"] td[data-col="fog"]'))).toBe('3');
  });

  it('links id and title of every row to the spec page, named "Status of <id>"', async () => {
    const el = await open();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('tr[data-spec] td[data-col="title"] a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([...OPEN_ORDER, '007'].map((id) => `/w/harbor/s/${id}`));
    const first = links[0];
    expect(text(first.querySelector('.sr'))).toBe('Status of 004');
    expect(text(first)).toContain('Delete old manifests');
    const id = el.querySelector<HTMLAnchorElement>('tr[data-spec="004"] td[data-col="spec"] a');
    expect(id?.getAttribute('href')).toBe('/w/harbor/s/004');
    expect(id?.getAttribute('tabindex')).toBe('-1');
    expect(id?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stacks the rows at compact with the same fields, order, divider and links, and no table', async () => {
    const el = await open('compact');
    expect(el.querySelector('table')).toBeNull();
    const lists = el.querySelectorAll('ul[data-stacked]');
    expect(lists).toHaveLength(2);
    const ids = (list: Element | undefined): Array<string | undefined> =>
      [...(list?.querySelectorAll<HTMLAnchorElement>('a[data-spec]') ?? [])].map((a) => a.dataset['spec']);
    expect(ids(lists[0])).toEqual(OPEN_ORDER);
    expect(ids(lists[1])).toEqual(['007']);
    expect(text(el.querySelector('[data-divider]'))).toBe('Complete · 1');
    const row = el.querySelector<HTMLAnchorElement>('a[data-spec="002"]');
    expect(row?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(text(row?.querySelector('.sr'))).toBe('Status of 002');
    expect(text(row?.querySelector('[data-field="stage"]'))).toBe('Build');
    expect(text(row?.querySelector('[data-field="tasks"]'))).toBe('27/32 tasks');
    expect(text(row?.querySelector('.frac'))).toBe('25/30');
    expect(row?.querySelector('[data-field="fog"]')).toBeNull();
    const foggy = el.querySelector('a[data-spec="005"]');
    expect(text(foggy?.querySelector('[data-field="fog"]'))).toBe('2 fog');
    expect(text(foggy?.querySelector('[data-field="tasks"]'))).toBe('no tasks');
    expect(el.querySelector('a[data-spec="007"]')?.hasAttribute('data-complete')).toBe(true);
  });
});
