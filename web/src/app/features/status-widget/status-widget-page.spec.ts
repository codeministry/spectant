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

const spec = (id: string, title: string): StatusResponse['workspaces'][number]['specs'][number] => ({
  id,
  slug: `${id}-${title.toLowerCase()}`,
  title,
  stage: 'build',
  claims: { closed: 1, total: 3 },
  closedAt: null,
  state: 'open',
  archived: false,
});

const BODY: StatusResponse = {
  kpis: { repos: 2, closed: 0, listed: 3, claimsClosed: 3, claimsTotal: 9 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit')] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('001', 'Beam')] },
  ],
};

describe('StatusWidgetPage on /widget (spec 071, T25, ISC-582)', () => {
  let calls: number;

  async function land(): Promise<RouterTestingHarness> {
    calls = 0;
    const api: Partial<ApiClient> = {
      status: (): Promise<ApiResult<StatusResponse>> => {
        calls += 1;
        return Promise.resolve({ kind: 'ok', body: BODY, etag: '"s1"', notModified: false });
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
});
