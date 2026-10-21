import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, NavigationStart, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import dashboard from '../../../core/fixtures/harbor.golden.json';
import type { DocsPage, LibraryCatalog, LibraryDoc } from '../../../core/src/files';
import { CATALOGUES, LANGS } from '../i18n/catalogues';
import { routes } from './app.routes';
import { ApiClient, type ApiResult } from './core/api.service';
import { NotFound } from './layout/not-found/not-found';
import { LEGACY_TAB_IDS } from './layout/shell/areas';
import { ShellState } from './layout/shell/shell-state.service';
import { LibraryPage } from './features/library/library-page';
import { LEGACY_REDIRECTS, VIEW_LOADERS } from './spec-area.routes';

// T48 · ISC-158.1: every former Docs and Evidence deep link under `/w/:ws/s/:id` redirects at route level into the
// spec's Library area (the old view never renders, no history entry of its own); a spec document is named by its kind
// (`?doc=`) and the page swaps that for the document's path as fragment once the catalog is loaded.

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

describe('the former Docs and Evidence tabs redirect to the Library area (spec 017, T48, ISC-158.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  const expected: Record<string, string> = {
    '/w/harbor/s/002/evidence': '/w/harbor/s/002/library?type=evidence',
    '/w/harbor/s/002/plan': '/w/harbor/s/002/library?doc=plan',
    '/w/harbor/s/002/design': '/w/harbor/s/002/library?doc=design',
    '/w/harbor/s/002/decisions': '/w/harbor/s/002/library?doc=spec&section=decisions',
    '/w/harbor/s/002/constitution': '/w/harbor/s/002/library#constitution.md',
    '/w/harbor/s/002/docs': '/w/harbor/s/002/library',
    '/w/harbor/s/002/docs/plan': '/w/harbor/s/002/library',
  };

  it('names a target for every former tab and registers no view for one', () => {
    expect(Object.keys(LEGACY_REDIRECTS).sort()).toEqual([...LEGACY_TAB_IDS].sort());
    for (const tab of LEGACY_TAB_IDS) expect(VIEW_LOADERS[tab], tab).toBeUndefined();
  });

  for (const [from, to] of Object.entries(expected)) {
    it(`redirects ${from} to ${to}, the Library area on the route`, async () => {
      const { url, route, component } = await at(from);
      expect(url).toBe(to);
      expect(component).toBe(LibraryPage);
      expect(route).toMatchObject({ ws: 'harbor', specId: '002', area: 'library', tab: 'library', notFound: false });
    });
  }

  it('drops the old query and fragment and keeps workspace and spec of the address', async () => {
    expect((await at('/w/other/s/017/design?q=x&section=risks#top')).url).toBe('/w/other/s/017/library?doc=design');
  });

  it('replaces the history entry on a first load: one navigation, the old address never stays behind', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting()] });
    const router = TestBed.inject(Router);
    const navigations: Array<boolean | undefined> = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) navigations.push(router.currentNavigation()?.extras.replaceUrl);
    });
    await router.navigateByUrl('/w/harbor/s/002/plan', { replaceUrl: true });
    expect(router.url).toBe('/w/harbor/s/002/library?doc=plan');
    expect(navigations).toEqual([true]);
  });

  it('keeps a path below a former tab not-found inside the spec', async () => {
    const { component, route } = await at('/w/harbor/s/002/plan/extra');
    expect(component).toBe(NotFound);
    expect(route.notFound).toBe(true);
    expect(route.specId).toBe('002');
  });
});

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const doc = (path: string, type: LibraryDoc['type'], title: string): LibraryDoc => ({
  path,
  type,
  spec: path.includes('/') ? (path.split('/')[0] ?? path) : 'workspace',
  title,
  modified: '2026-10-12T14:02:00Z',
  state: 'ok',
  media: 'markdown',
});

const CATALOG: LibraryCatalog = {
  docs: [
    doc('002-web-console/spec.md', 'spec', 'Web console'),
    doc('002-web-console/plan.md', 'plan', 'Approach'),
    doc('002-web-console/design.md', 'design', 'Design'),
    doc('002-web-console/.evidence/run-001/probe.md', 'evidence', 'Probe run 1'),
    doc('003-other/plan.md', 'plan', 'Other plan'),
    doc('constitution.md', 'constitution', 'Constitution'),
  ],
  groups: [],
  fog: [],
  missing: 0,
  stale: 0,
};

const page = (html: string): DocsPage => ({ html, toc: [], frontmatter: null, figures: [], sections: [], wordCount: 4 });
const SPEC_PAGE = page('<h2 id="goal">Goal</h2><p>Goal text</p><h2 id="decisions">Decisions</h2><p>Decided</p>');

describe('the Library area on a former Docs or Evidence address (T48, ISC-158.1)', () => {
  let harness: RouterTestingHarness;
  let jumped: string[];

  afterEach(() => vi.restoreAllMocks());

  async function settle(): Promise<HTMLElement> {
    for (let i = 0; i < 4; i += 1) {
      await harness.fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    harness.fixture.detectChanges();
    return harness.fixture.nativeElement as HTMLElement;
  }

  async function land(url: string): Promise<HTMLElement> {
    const api: Partial<ApiClient> = {
      workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
      dashboard: () => Promise.resolve(ok(dashboard)),
      planning: () => Promise.resolve({ kind: 'not-found', served: false }),
      spec: () => Promise.resolve({ kind: 'not-found', served: false }),
      actors: () => Promise.resolve(ok([])),
      boardQuery: () => Promise.resolve(ok({ query: '' })),
      library: () => Promise.resolve(ok(CATALOG)),
      libraryDoc: (_ws, path) => Promise.resolve(ok(path.endsWith('spec.md') ? SPEC_PAGE : page(`<p>${path}</p>`))),
      librarySearch: (_ws, q) => Promise.resolve(ok({ query: q, hits: [] })),
      libraryAssetUrl: (ws, path) => `/api/workspaces/${ws}/library/asset?path=${encodeURIComponent(path)}`,
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    TestBed.inject(ShellState).tier.set('wide');
    jumped = [];
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    Element.prototype.scrollIntoView = function (this: Element): void {
      jumped.push(this.id);
    };
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return settle();
  }

  const title = (root: HTMLElement): string | undefined => root.querySelector('.lib-reader-title')?.textContent.trim();

  it('opens plan.md of the spec from /plan, its path as fragment and no ?doc= left', async () => {
    const root = await land('/w/harbor/s/002/plan');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library#002-web-console/plan.md');
    expect(title(root)).toBe('Approach');
    expect(root.querySelector('app-docs-tab')).toBeNull();
  });

  it('opens design.md of the spec from /design', async () => {
    const root = await land('/w/harbor/s/002/design');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library#002-web-console/design.md');
    expect(title(root)).toBe('Design');
  });

  it('opens spec.md at its ## Decisions from /decisions, the heading focused', async () => {
    const root = await land('/w/harbor/s/002/decisions');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library?section=decisions#002-web-console/spec.md');
    expect(title(root)).toBe('Web console');
    expect(jumped).toEqual(['decisions']);
    expect(document.activeElement?.id).toBe('decisions');
  });

  it('opens the workspace constitution from /constitution', async () => {
    const root = await land('/w/harbor/s/002/constitution');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library#constitution.md');
    expect(title(root)).toBe('Constitution');
  });

  it('opens the spec’s evidence subgroup from /evidence', async () => {
    const root = await land('/w/harbor/s/002/evidence');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library?type=evidence');
    expect(root.querySelectorAll('[data-library-evidence="002"] [data-library-entry]').length).toBe(1);
    expect(root.querySelector('app-evidence-tab')).toBeNull();
  });

  it('opens the Library area from /docs', async () => {
    const root = await land('/w/harbor/s/002/docs');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library');
    expect(root.querySelector('app-library-page')).not.toBeNull();
  });
});
