import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { StatusResponse } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { StatusWidgetPage } from './status-widget-page';

// Spec 071 (T25, ISC-582): `/widget` renders the status widget page outside `app-shell`, lazy like `/__ui`; the page
// loads the status body through `ApiClient` and lists what it answered.

type Spec = StatusResponse['workspaces'][number]['specs'][number];

const spec = (id: string, title: string, over: Partial<Spec> = {}): Spec => ({
  id,
  slug: `${id}-${title.toLowerCase()}`,
  title,
  stage: 'build',
  claims: { closed: 1, total: 3 },
  closedAt: null,
  state: 'open',
  archived: false,
  ...over,
});

const done = (id: string, title: string): Spec =>
  spec(id, title, { stage: 'done', claims: { closed: 4, total: 4 }, closedAt: '2026-10-23T08:00:00.000Z', state: 'done', archived: true });

/** Three workspaces: harbor lists open and closed specs, lantern lists none, beacon cannot be read (T26, T27, T30). */
const MIXED: StatusResponse = {
  kpis: { repos: 1, closed: 1, listed: 3, claimsClosed: 6, claimsTotal: 10 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit'), done('001', 'Init')] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [] },
    { slug: 'beacon', pathTail: 'beacon', readable: false, error: 'unreadable', specs: [] },
  ],
};

/** No workspace lists a spec and every one is readable (T30). */
const EMPTY: StatusResponse = {
  kpis: { repos: 0, closed: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [] },
  ],
};

const BODY: StatusResponse = {
  kpis: { repos: 2, closed: 0, listed: 3, claimsClosed: 3, claimsTotal: 9 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit')] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('001', 'Beam')] },
  ],
};

describe('StatusWidgetPage on /widget (spec 071, T25, ISC-582)', () => {
  let calls: number;

  async function land(body: StatusResponse = BODY): Promise<RouterTestingHarness> {
    calls = 0;
    const api: Partial<ApiClient> = {
      status: (): Promise<ApiResult<StatusResponse>> => {
        calls += 1;
        return Promise.resolve({ kind: 'ok', body, etag: '"s1"', notModified: false });
      },
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/widget');
    await harness.fixture.whenStable();
    harness.detectChanges();
    return harness;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('routes /widget to the page, with no shell route above it', async () => {
    await land();
    const router = TestBed.inject(Router);
    const components: unknown[] = [];
    for (let node: ActivatedRouteSnapshot | null = router.routerState.snapshot.root; node; node = node.firstChild) {
      if (node.component) components.push(node.component);
    }
    expect(router.url).toBe('/widget');
    expect(components).toEqual([StatusWidgetPage]);
  });

  it('renders outside the shell: no app-shell, no header, no nav', async () => {
    const rendered = (await land()).fixture.nativeElement as HTMLElement;
    expect(rendered.querySelector('app-status-widget-page main.widget')).not.toBeNull();
    expect(rendered.querySelector('app-shell')).toBeNull();
    expect(rendered.querySelector('header')).toBeNull();
    expect(rendered.querySelector('nav')).toBeNull();
  });

  it('loads the status body once and lists each workspace with its spec ids, in the order answered', async () => {
    const root = (await land()).routeNativeElement as HTMLElement;
    expect(calls).toBe(1);
    const groups = [...root.querySelectorAll<HTMLElement>('section.groups [data-workspace]')];
    expect(groups.map((group) => group.dataset['workspace'])).toEqual(['harbor', 'lantern']);
    const ids = groups.map((group) => [...group.querySelectorAll<HTMLElement>('[data-spec]')].map((row) => row.dataset['spec']));
    expect(ids).toEqual([['002', '005'], ['001']]);
    expect(root.querySelector('section.kpis')).not.toBeNull();
  });

  /** Each tile as label, value and denominator, in band order. */
  const tiles = (root: HTMLElement): Array<{ label: string; value: string; den: string | null }> =>
    [...root.querySelectorAll<HTMLElement>('section.kpis ui-kpi-tile')].map((tile) => ({
      label: tile.querySelector('.eyebrow-text')?.textContent.trim() ?? '',
      value: tile.querySelector('.value')?.textContent.trim() ?? '',
      den: tile.querySelector('.den')?.textContent.trim().replace(/^\//, '') ?? null,
    }));

  it('shows the three KPIs of the body, which sum the listed rows (T26, ISC-583)', async () => {
    const root = (await land(MIXED)).routeNativeElement as HTMLElement;
    const { kpis } = MIXED;
    expect(tiles(root)).toEqual([
      { label: 'repos', value: String(kpis.repos), den: null },
      { label: 'closed', value: String(kpis.closed), den: String(kpis.listed) },
      { label: 'claims', value: String(kpis.claimsClosed), den: String(kpis.claimsTotal) },
    ]);
    const listed = MIXED.workspaces.filter((ws) => ws.readable).flatMap((ws) => ws.specs);
    const repos = MIXED.workspaces.filter((ws) => ws.readable && ws.specs.length > 0).length;
    const rendered = root.querySelectorAll('section.groups [data-spec]').length;
    expect(rendered).toBe(listed.length);
    expect([kpis.repos, kpis.closed, kpis.listed, kpis.claimsClosed, kpis.claimsTotal]).toEqual([
      repos,
      listed.filter((row) => row.stage === 'done').length,
      listed.length,
      listed.reduce((sum, row) => sum + row.claims.closed, 0),
      listed.reduce((sum, row) => sum + row.claims.total, 0),
    ]);
    const cards = [...root.querySelectorAll<HTMLElement>('section.kpis ui-kpi-tile')].map((tile) => tile.querySelector<HTMLElement>('ui-card'));
    expect(cards.map((card) => card?.dataset['accent'] ?? null)).toEqual([null, 'success', null]);
    expect(cards[1]?.hasAttribute('data-edge')).toBe(true);
    expect(cards[1]?.hasAttribute('data-glow')).toBe(false);
    expect(root.querySelectorAll('section.kpis ui-kpi-tile[data-variant="sm"]')).toHaveLength(3);
  });

  it('heads each workspace that lists a spec with its path tail, in body order, none for an empty one (T27, ISC-584)', async () => {
    const root = (await land(MIXED)).routeNativeElement as HTMLElement;
    const heads = [...root.querySelectorAll<HTMLElement>('section.groups h2.group-head')];
    expect(heads.map((head) => head.closest<HTMLElement>('[data-workspace]')?.dataset['workspace'])).toEqual(['harbor', 'beacon']);
    expect(heads.map((head) => head.textContent.trim())).toEqual(['harbor-app', 'beacon']);
    expect(heads.map((head) => head.getAttribute('title'))).toEqual(['harbor-app', 'beacon']);
    expect(root.querySelector('[data-workspace="lantern"]')).toBeNull();
    const rows = [...root.querySelectorAll<HTMLElement>('[data-workspace="harbor"] [data-spec]')].map((row) => row.dataset['spec']);
    expect(rows).toEqual(['002', '005', '001']);
  });

  it('marks an unreadable workspace with a warning under its head and keeps the rest (T30, ISC-588)', async () => {
    const root = (await land(MIXED)).routeNativeElement as HTMLElement;
    const beacon = root.querySelector<HTMLElement>('[data-workspace="beacon"]');
    const notice = beacon?.querySelector<HTMLElement>('ui-notice');
    expect(notice?.dataset['tone']).toBe('warning');
    expect(notice?.textContent.trim()).toBe('This workspace could not be read.');
    expect(beacon?.querySelectorAll('[data-spec]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-workspace="harbor"] [data-spec]')).toHaveLength(3);
    expect(root.querySelectorAll('[data-workspace="harbor"] ui-notice')).toHaveLength(0);
    expect(tiles(root).map((tile) => tile.value)).toEqual(['1', '1', '6']);
    expect(root.querySelector('section.groups .meta')).toBeNull();
  });

  it('shows one empty line instead of an empty list when no workspace lists a spec (T30, ISC-588)', async () => {
    const root = (await land(EMPTY)).routeNativeElement as HTMLElement;
    const lines = root.querySelectorAll<HTMLElement>('section.groups .meta');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent.trim()).toBe('No open or recently closed specs.');
    expect(root.querySelectorAll('section.groups [data-workspace], section.groups h2, section.groups ul')).toHaveLength(0);
    expect(tiles(root)).toEqual([
      { label: 'repos', value: '0', den: null },
      { label: 'closed', value: '0', den: '0' },
      { label: 'claims', value: '0', den: '0' },
    ]);
  });
});
