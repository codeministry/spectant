import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, NavigationStart, provideRouter, Router } from '@angular/router';
import { routes, TECH_REDIRECTS } from './app.routes';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { LibraryPage } from './features/library/library-page';
import { SpecsPage } from './features/specs-page/specs-page';
import { NotFound } from './layout/not-found/not-found';
import { ShellState } from './layout/shell/shell-state.service';

/** Navigates the real route table without rendering it; the leaf-most component is what the shell's outlets would show. */
async function at(url: string) {
  TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  let component: unknown = null;
  for (let node: ActivatedRouteSnapshot | null = router.routerState.snapshot.root; node; node = node.firstChild) {
    component = node.component ?? component;
  }
  return { url: router.url, route: TestBed.inject(ShellState).route(), component };
}

describe('the former tech routes redirect to the Library (spec 017, T42, ISC-157.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const expected: Record<string, string> = {
    '/w/harbor/tech': '/w/harbor/library?section=overview#tech.md',
    '/w/harbor/tech/overview': '/w/harbor/library?section=overview#tech.md',
    '/w/harbor/tech/architecture': '/w/harbor/library?section=architecture#tech.md',
    '/w/harbor/tech/status': '/w/harbor/library',
    '/w/harbor/tech/specs': '/w/harbor/library',
    '/w/harbor/tech/open': '/w/harbor/library?state=open',
  };

  it('names a target for every former tab', () => {
    const tabs = ['overview', 'architecture', 'status', 'specs', 'open'];
    expect(Object.keys(TECH_REDIRECTS)).toEqual(tabs);
    expect(Object.keys(expected)).toEqual(['/w/harbor/tech', ...tabs.map((tab) => `/w/harbor/tech/${tab}`)]);
  });

  for (const [from, to] of Object.entries(expected)) {
    it(`redirects ${from} to ${to}, the Library on the route`, async () => {
      const { url, route, component } = await at(from);
      expect(url).toBe(to);
      expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, lens: null, wsPage: 'library', ideaSlug: null, notFound: false });
      expect(component).toBe(LibraryPage);
    });
  }

  it('drops the old query and fragment: the target names its own', async () => {
    expect((await at('/w/harbor/tech/open?q=x&section=risks#top')).url).toBe('/w/harbor/library?state=open');
  });

  it('keeps the workspace of the address', async () => {
    expect((await at('/w/other-ws/tech/architecture')).url).toBe('/w/other-ws/library?section=architecture#tech.md');
  });

  it('replaces the history entry on a first load: the tech address never stays behind the Library', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
    const router = TestBed.inject(Router);
    const navigations: Array<boolean | undefined> = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) navigations.push(router.currentNavigation()?.extras.replaceUrl);
    });
    await router.navigateByUrl('/w/harbor/tech/status', { replaceUrl: true });
    expect(router.url).toBe('/w/harbor/library');
    // One navigation, not a second one from /tech to /library: the redirect happens inside it.
    expect(navigations).toEqual([true]);
  });

  it('renders not-found below a former tech address that names no tab, the workspace still known', async () => {
    for (const url of ['/w/harbor/tech/nope', '/w/harbor/tech/status/extra']) {
      const { route, component } = await at(url);
      expect(component, url).toBe(NotFound);
      expect(route.notFound, url).toBe(true);
      expect(route.ws, url).toBe('harbor');
      expect(route.wsPage, url).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('keeps the spec status tab a spec tab', async () => {
    const { route } = await at('/w/harbor/s/002/status');
    expect(route.tab).toBe('status');
  });
});

describe('the workspace dashboard and the Specs page are two routes (spec 058, T3, T7)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const children = routes.find((route) => route.path === '')?.children ?? [];
  const child = (path: string) => children.find((route) => route.path === path);

  it('marks /w/:ws as the dashboard page (ISC-390)', async () => {
    expect(child('w/:ws')?.data).toEqual({ page: 'dashboard' });
    const { component } = await at('/w/harbor');
    expect(component).toBe(DashboardPage);
  });

  it('routes /w/:ws/specs to the lazy Specs page, before the catch-all (ISC-391)', async () => {
    const specs = child('w/:ws/specs');
    expect(specs?.data).toEqual({ page: 'specs' });
    expect(specs?.loadComponent).toBeTypeOf('function');
    expect(specs === undefined ? -1 : children.indexOf(specs)).toBeLessThan(children.findIndex((route) => route.path === '**'));
    const { url, route, component } = await at('/w/harbor/specs?phase=building');
    expect(url).toBe('/w/harbor/specs?phase=building');
    expect(component).toBe(SpecsPage);
    expect(route.ws).toBe('harbor');
    expect(route.notFound).toBe(false);
  });
});

describe('an old list address of the dashboard leads to the Specs page (spec 058, T20, T21, ISC-396, ISC-400)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const moved: Record<string, string> = {
    '/w/harbor?phase=building&sort=next': '/w/harbor/specs?phase=building&sort=next',
    '/w/harbor?q=api': '/w/harbor/specs?q=api',
    '/w/harbor?takeable=1&sel=spec:002#top': '/w/harbor/specs?takeable=1&sel=spec:002#top',
    '/w/harbor?open=specs': '/w/harbor/specs?open=specs',
    '/w/harbor?open=tldr,specs&density=compact': '/w/harbor/specs?open=tldr,specs&density=compact',
  };

  for (const [from, to] of Object.entries(moved)) {
    it(`redirects ${from} to ${to}, the same query on the Specs page`, async () => {
      const { url, route, component } = await at(from);
      expect(url).toBe(to);
      expect(component).toBe(SpecsPage);
      expect(route.ws).toBe('harbor');
    });
  }

  for (const stays of ['/w/harbor?sel=spec:002', '/w/harbor', '/w/harbor?open=tldr']) {
    it(`keeps ${stays} on the dashboard`, async () => {
      const { url, component } = await at(stays);
      expect(url).toBe(stays);
      expect(component).toBe(DashboardPage);
    });
  }

  it('replaces the history entry: the old list address never stays behind the Specs page', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
    const router = TestBed.inject(Router);
    const replaced: Array<boolean | undefined> = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) replaced.push(router.currentNavigation()?.extras.replaceUrl);
    });
    await router.navigateByUrl('/w/harbor?q=api');
    expect(router.url).toBe('/w/harbor/specs?q=api');
    expect(replaced.at(-1)).toBe(true);
  });
});
