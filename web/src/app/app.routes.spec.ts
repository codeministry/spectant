import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import { routes } from './app.routes';
import { TechPage } from './features/tech/tech-page';
import { NotFound } from './layout/not-found/not-found';
import { TECH_TABS } from './layout/shell/page-tabs';
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

describe('the tech page routes (spec 023, ISC-134.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('redirects /w/:ws/tech to its overview tab', async () => {
    const { url, route, component } = await at('/w/harbor/tech');
    expect(url).toBe('/w/harbor/tech/overview');
    expect(route.wsPage).toBe('tech');
    expect(route.techTab).toBe('overview');
    expect(component).toBe(TechPage);
  });

  for (const tab of TECH_TABS) {
    it(`resolves /w/:ws/tech/${tab} to the tech page on that tab`, async () => {
      const { url, route, component } = await at(`/w/harbor/tech/${tab}`);
      expect(url).toBe(`/w/harbor/tech/${tab}`);
      expect(route).toEqual({ ws: 'harbor', specId: null, area: null, tab: null, techTab: tab, lens: null, wsPage: 'tech', ideaSlug: null, notFound: false });
      expect(component).toBe(TechPage);
    });
  }

  it('renders not-found for an unknown tech tab, the workspace still known', async () => {
    for (const url of ['/w/harbor/tech/nope', '/w/harbor/tech/status/extra']) {
      const { route, component } = await at(url);
      expect(component, url).toBe(NotFound);
      expect(route.notFound, url).toBe(true);
      expect(route.ws, url).toBe('harbor');
      expect(route.wsPage, url).toBeNull();
      expect(route.techTab, url).toBeNull();
      TestBed.resetTestingModule();
    }
  });

  it('keeps the spec tab and the tech tab apart: a spec status tab is no tech tab', async () => {
    const { route } = await at('/w/harbor/s/002/status');
    expect(route.tab).toBe('status');
    expect(route.techTab).toBeNull();
  });
});
