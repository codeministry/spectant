import { signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { WorkspacePageId } from './areas';
import { ShellData } from './shell-data.service';
import { ShellNav } from './shell-nav';
import { ShellState } from './shell-state.service';
import type { Tier } from './tier';

/** The strings this spec reads: the page pill's values and the pill labels, the former spec pill's two among them. */
const STUB = {
  en: {
    shell: {
      pages: { dashboard: 'Dashboard', specs: 'Specs' },
      pills: { workspace: 'Workspace', page: 'Page', specs: 'Specs', spec: 'Spec', area: 'Area', all: 'All' },
    },
  },
};

interface Route {
  readonly ws: string | null;
  readonly specId: string | null;
  readonly wsPage: WorkspacePageId | null;
}

/** The header nav alone, over a route-only `ShellState` and a `ShellData` that lists harbor 002; the menus stay deferred. */
async function open(route: Route, tier: Tier = 'wide'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: STUB, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })],
    providers: [
      provideRouter([]),
      {
        provide: ShellState,
        useValue: {
          ws: signal(route.ws),
          specId: signal(route.specId),
          area: signal(route.specId === null ? null : 'dashboard'),
          tier: signal(tier),
          route: signal({ ...route, area: null, tab: null, lens: null, ideaSlug: null, notFound: false }),
        },
      },
      {
        provide: ShellData,
        useValue: {
          workspaceName: () => 'Harbor',
          workspaceList: signal([{ slug: 'harbor' }]),
          specRows: signal([{ id: '002', slug: '002-web-console', title: 'Web console' }]),
          currentRow: signal(route.specId === null ? null : { id: '002', slug: '002-web-console', title: 'Web console' }),
          specMissing: signal(false),
          workspaceMissing: signal(false),
        },
      },
    ],
    deferBlockBehavior: DeferBlockBehavior.Manual,
  });
  const fixture = TestBed.createComponent(ShellNav);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const href = (root: Element, control: string): string | null | undefined =>
  root.querySelector(`[data-control="${control}"]`)?.getAttribute('href');
const pageValue = (root: Element): string | undefined => root.querySelector('[data-control="page"] [data-pill-value]')?.textContent.trim();

describe('ShellNav links (spec 058, ISC-395)', () => {
  it('on / leads the workspace pill to all workspaces and renders no page pill', async () => {
    const root = await open({ ws: null, specId: null, wsPage: null });
    expect(href(root, 'workspace')).toBe('/');
    expect(root.querySelector('[data-control="page"]')).toBeNull();
  });

  it('on the dashboard /w/harbor leads the workspace pill to the dashboard and names the Dashboard page', async () => {
    const root = await open({ ws: 'harbor', specId: null, wsPage: 'dashboard' });
    expect(href(root, 'workspace')).toBe('/w/harbor');
    expect(pageValue(root)).toBe('Dashboard');
  });

  it('on the Specs page names the Specs page', async () => {
    const root = await open({ ws: 'harbor', specId: null, wsPage: 'specs' });
    expect(pageValue(root)).toBe('Specs');
  });

  it('a workspace route the state names no page for reads as the dashboard, never as Specs', async () => {
    const root = await open({ ws: 'harbor', specId: null, wsPage: null });
    expect(pageValue(root)).toBe('Dashboard');
  });

  it('on /w/harbor/s/002 leads the workspace pill to the dashboard and names the Specs page', async () => {
    const root = await open({ ws: 'harbor', specId: '002', wsPage: null });
    expect(href(root, 'workspace')).toBe('/w/harbor');
    expect(pageValue(root)).toBe('Specs');
  });
});

// Spec 069 (ISC-554): the header's favourites select replaced the spec select; the nav carries no spec pill.
describe('ShellNav carries no spec select (spec 069, ISC-554)', () => {
  const ROUTES: readonly Route[] = [
    { ws: 'harbor', specId: null, wsPage: 'dashboard' },
    { ws: 'harbor', specId: '002', wsPage: null },
  ];
  const TIERS: readonly Tier[] = ['compact', 'medium', 'wide'];

  describe.each(TIERS)('at %s', (tier) => {
    it.each(ROUTES)('anti: on /w/$ws with spec $specId there is no spec pill, no "Spec" or "Specs" label, no spec picker', async (route) => {
      const root = await open(route, tier);
      expect(root.querySelector('[data-control="spec"]')).toBeNull();
      expect(root.querySelector('[aria-haspopup][data-control="spec"]')).toBeNull();
      const labels = [...root.querySelectorAll('[data-pill-label]')].map((label) => label.textContent.trim());
      expect(labels).not.toContain('Spec');
      expect(labels).not.toContain('Specs');
      expect(root.textContent).not.toMatch(/Specs\s*·\s*\d/u);
      expect(root.querySelector('[data-picker="spec"]')).toBeNull();
    });
  });
});
