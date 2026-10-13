import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../../../core/fixtures/harbor.golden.json';
import harborTech from '../../../../../core/fixtures/harbor.tech.golden.json';
import type { TechModel } from '../../../../../core/src/files';
import type { Unavailable } from '../../../../../server/src/spec-routes.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { withTechPage } from './tech-page.testing';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { TECH_TABS, TechTabCounts } from '../../layout/shell/page-tabs';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { techTabCounts } from './tech-page';

// T14 · ISC-134.1: the tech page frame against the harbor tech golden: the head (title and the mono subline with and
// without specs/tech.md), the tab counts it hands the tab bar, one panel placeholder per tab, the loading, error,
// unavailable and not-found states, and the rail-less shell.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const HARBOR = harborTech as unknown as TechModel;
const NEVER = new Promise<never>(() => undefined);

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'actors' | 'boardQuery' | 'tech'>;

let harness: RouterTestingHarness;

/** `tech` answers per workspace; an unknown workspace is the contract's 404 on the dashboard and the tech route. */
async function open(url: string, tech: (ws: string) => Promise<ApiResult<TechModel>> = () => Promise.resolve(ok(HARBOR)), tier: Tier = 'wide', settle = true): Promise<HTMLElement> {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'nope' ? { kind: 'not-found', served: true } : ok(dashboard)),
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve(ok({ query: '' })),
    tech: (ws) => (ws === 'nope' ? Promise.resolve({ kind: 'not-found', served: true }) : tech(ws)),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(withTechPage(routes)), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
  TestBed.inject(ShellState).tier.set(tier);
  harness = await RouterTestingHarness.create();
  return go(url, settle);
}

/** `settle: false` for a read that never answers: the app never becomes stable, so only the queued tasks run. */
async function go(url: string, settle = true): Promise<HTMLElement> {
  await harness.navigateByUrl(url);
  if (settle) await harness.fixture.whenStable();
  else for (let i = 0; i < 3; i++) await new Promise((done) => setTimeout(done));
  harness.fixture.detectChanges();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const page = (root: HTMLElement): HTMLElement | null => root.querySelector<HTMLElement>('app-tech-page');
const counts = (): unknown => TestBed.inject(TechTabCounts).counts();

describe('TechPage (T14, ISC-134.1)', () => {
  it('heads every tab with "Tech" and the mono subline naming specs/tech.md and the spec count', async () => {
    const root = await open('/w/harbor/tech/overview');
    expect(text(page(root)?.querySelector('h1'))).toBe('Tech');
    expect(text(page(root)?.querySelector('[data-subline]'))).toBe('specs/tech.md · 8 specs');
    await go('/w/harbor/tech/open');
    expect(text(page(root)?.querySelector('h1'))).toBe('Tech');
    expect(text(page(root)?.querySelector('[data-subline]'))).toBe('specs/tech.md · 8 specs');
  });

  it('reads the shared ShellData.tech resource: a new value there is the page\'s model', async () => {
    const root = await open('/w/harbor/tech/overview');
    const data = TestBed.inject(ShellData);
    expect(data.techModel()).toEqual(HARBOR);
    data.tech.set(ok({ ...HARBOR, specs: HARBOR.specs.slice(0, 3) }));
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
    expect(text(page(root)?.querySelector('[data-subline]'))).toBe('specs/tech.md · 3 specs');
    expect(counts()).toMatchObject({ status: 3, specs: 3 });
  });

  it('says "no specs/tech.md" when the model carries no pages', async () => {
    const root = await open('/w/harbor/tech/overview', () => Promise.resolve(ok({ ...HARBOR, pages: null })));
    expect(text(page(root)?.querySelector('[data-subline]'))).toBe('no specs/tech.md · 8 specs');
  });

  it('fills the tab counts: Status and Specs count the specs, Open the fog lines of open specs', async () => {
    const root = await open('/w/harbor/tech/overview');
    expect(counts()).toEqual({ status: 8, specs: 8, open: 2 });
    const links = [...(page(root)?.querySelectorAll('app-tab-bar a') ?? [])].map((a) => text(a));
    expect(links).toEqual(['Overview', 'Architecture', 'Status 8', 'Specs 8', 'Open 2']);
  });

  it('counts no fog of a complete spec', () => {
    const [first, second] = HARBOR.specs;
    const model: TechModel = { ...HARBOR, specs: [{ ...first, phase: 'complete', fog: ['left over'] }, { ...second, fog: ['a', 'b', 'c'] }] };
    expect(techTabCounts(model)).toEqual({ status: 2, specs: 2, open: 3 });
  });

  // Spec 024 (ISC-149): the prototype tab bar under the header on every width, compact included.
  it('mounts the tab bar under the head on every tier, compact included', async () => {
    const root = await open('/w/harbor/tech/status', undefined, 'medium');
    expect(page(root)?.querySelector('app-tab-bar-slot app-tab-bar')).not.toBeNull();
    TestBed.inject(ShellState).tier.set('compact');
    await harness.fixture.whenStable();
    harness.fixture.detectChanges();
    expect(page(root)?.querySelector('app-tab-bar-slot app-tab-bar')).not.toBeNull();
    expect(root.querySelector('header app-tab-bar')).toBeNull();
    expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
  });

  it('renders the current tab panel only and switches it with the tab, the page instance kept', async () => {
    const root = await open('/w/harbor/tech/overview');
    const first = page(root);
    for (const tab of TECH_TABS) {
      await go(`/w/harbor/tech/${tab}`);
      const panels = [...(page(root)?.querySelectorAll<HTMLElement>('[data-tech-tab]') ?? [])].map((el) => el.dataset['techTab']);
      expect(panels, tab).toEqual([tab]);
      expect(page(root), tab).toBe(first);
    }
  });

  it('shows skeleton lines in the panel while loading, head and tab bar already there, no counts yet', async () => {
    const root = await open('/w/harbor/tech/overview', () => NEVER, 'wide', false);
    const tech = page(root);
    expect(tech?.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Loading the tech page');
    expect(tech?.querySelectorAll('ui-skeleton').length).toBeGreaterThan(0);
    expect(tech?.querySelector('[data-tech-tab]')).toBeNull();
    expect(text(tech?.querySelector('h1'))).toBe('Tech');
    expect(tech?.querySelector('app-tab-bar')).not.toBeNull();
    expect(counts()).toEqual({});
  });

  it('shows the error notice in the panel on a failed read, head and tab bar kept', async () => {
    const root = await open('/w/harbor/tech/status', () => Promise.resolve({ kind: 'error', status: 500 }));
    const tech = page(root);
    const notice = tech?.querySelector('ui-notice');
    expect(notice?.getAttribute('data-tone')).toBe('error');
    expect(text(notice)).toBe('Could not load the tech page.');
    expect(tech?.querySelector('[data-tech-tab]')).toBeNull();
    expect(text(tech?.querySelector('h1'))).toBe('Tech');
    expect(tech?.querySelector('app-tab-bar')).not.toBeNull();
  });

  it('says the workspace cannot be read when the tech route answers unavailable', async () => {
    const summary: Unavailable = { slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: false, error: 'missing', counts: null };
    const root = await open('/w/harbor/tech/overview', () => Promise.resolve({ kind: 'unavailable', body: summary }));
    expect(text(page(root)?.querySelector('.unavailable'))).toBe('This workspace cannot be read');
    expect(page(root)?.querySelector('app-tab-bar')).toBeNull();
  });

  it('renders not-found for an unknown workspace, without head or tabs', async () => {
    const root = await open('/w/nope/tech/overview');
    expect(page(root)?.querySelector('app-not-found')).not.toBeNull();
    expect(page(root)?.querySelector('h1#tech')).toBeNull();
    expect(page(root)?.querySelector('app-tab-bar')).toBeNull();
  });

  it('resets the counts on a workspace change and when the page goes', async () => {
    const root = await open('/w/harbor/tech/overview', (ws) => (ws === 'harbor' ? Promise.resolve(ok(HARBOR)) : NEVER));
    expect(counts()).toEqual({ status: 8, specs: 8, open: 2 });
    await go('/w/lantern/tech/overview', false);
    expect(counts()).toEqual({});
    await go('/w/harbor/tech/overview');
    expect(counts()).toEqual({ status: 8, specs: 8, open: 2 });
    await go('/w/harbor');
    expect(page(root)).toBeNull();
    expect(counts()).toEqual({});
  });

  it('takes the full width: the shell sets data-no-rail', async () => {
    const root = await open('/w/harbor/tech/specs');
    expect(root.querySelector('app-shell')?.hasAttribute('data-no-rail')).toBe(true);
  });
});
