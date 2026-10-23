import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { KeyboardService } from './keyboard.service';
import { LockSourceService } from '../../core/lock-source.service';
import { navigatesNatively } from './shell-nav';
import type { LibraryCatalog, LibraryDoc } from '../../../../../core/src/files';
import { AREA_IDS, SPEC_AREAS } from './areas';
import { tierFor } from './tier';

/** Stands in for the browser's ResizeObserver: the test decides the shell container's width. */
class FakeResizeObserver {
  /** The shell's observer: the one watching `app-shell`, not a `uiClamp` watching its own text. */
  static last: FakeResizeObserver | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    // The test calls resize() itself.
    if (target.localName === 'app-shell') FakeResizeObserver.last = this;
  }
  unobserve(): void {
    // Nothing is observed.
  }
  disconnect(): void {
    // Nothing to release.
  }
  resize(width: number): void {
    this.callback([{ contentRect: { width } } as ResizeObserverEntry], this);
  }
}

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const HARBOR = {
  specs: [
    // Each row carries its coarse phase beside its stage, as core's rows do: the header shows the stage (spec 064, ISC-501).
    { id: '004', title: 'Retention policies', type: 'feature', stage: 'code-review', phase: 'climbing' },
    { id: '002', title: 'Web console', type: 'feature', stage: 'build', phase: 'building' },
    { id: '003', title: 'Config loader', type: 'refactor', stage: 'tasks', phase: 'scoping' },
  ],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

/**
 * Every harbor spec is a favourite by default (spec 052), so the header spec select lists all three as before. These
 * rows carry no folder slug, so `ShellData.favoriteRows` matches them by id.
 */
const ALL_FAVORITES = ['002', '003', '004'];

type FakeApi = Pick<
  ApiClient,
  | 'workspaces'
  | 'dashboard'
  | 'planning'
  | 'spec'
  | 'timeline'
  | 'claims'
  | 'library'
  | 'favorites'
  | 'putFavorite'
  | 'deleteFavorite'
  | 'putIdeaFavorite'
  | 'deleteIdeaFavorite'
>;

function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    workspaces: () =>
      Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(HARBOR) : { kind: 'not-found', served: true }),
    // The planning tree (spec 003, ShellData.planning): unserved here, so the spec head keeps its three crumbs.
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    // The stub today: no spec route, the server's catch-all 404.
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    // The area views land one by one; the shell specs need only the catch-all answer for each.
    timeline: () => Promise.resolve({ kind: 'not-found', served: false }),
    claims: () => Promise.resolve({ kind: 'not-found', served: false }),
    library: () => Promise.resolve({ kind: 'not-found', served: false }),
    favorites: () => Promise.resolve(ok({ specs: ALL_FAVORITES, ideas: [] })),
    putFavorite: () => Promise.resolve({ kind: 'error', status: 0, error: null }),
    deleteFavorite: () => Promise.resolve({ kind: 'error', status: 0, error: null }),
    putIdeaFavorite: () => Promise.resolve({ kind: 'error', status: 0, error: null }),
    deleteIdeaFavorite: () => Promise.resolve({ kind: 'error', status: 0, error: null }),
    ...overrides,
  };
}

let realResizeObserver: typeof ResizeObserver | undefined;
/** One harness per test (the router harness allows no second); `open` navigates it. */
let current: RouterTestingHarness | null = null;

/**
 * The route table as spec 058 splits the workspace: the root `/w/:ws` names the page `dashboard`, `/w/:ws/specs` the
 * spec list `specs`. Another task of the spec writes that data into `app.routes.ts`; this keeps the rail specs on it
 * either way and changes nothing once the table carries it.
 */
function splitRoutes(table: Routes): Routes {
  return table.map((route) => {
    const children = route.children;
    if (!children) return route;
    const hasSpecs = children.some((child) => child.path === 'w/:ws/specs');
    return {
      ...route,
      children: children.flatMap((child): Routes => {
        if (child.path !== 'w/:ws') return [child];
        const root = { ...child, data: { ...child.data, page: 'dashboard' } };
        return hasSpecs ? [root] : [root, { ...child, path: 'w/:ws/specs', data: { ...child.data, page: 'specs' } }];
      }),
    };
  });
}

/** A planning answer whose relation index holds spec 002, so `?sel=spec:002` is a selection (`DetailSelection.entry`). */
const PLANNING_002 = {
  asOf: '2026-03-20',
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: ['idea', 'plan', 'build', 'done'],
  stageCounts: {},
  ideas: [],
  features: [],
  milestones: [],
  recount: { closed: 0, total: 0 },
  diagnostics: [],
  relations: {
    'spec:002': { ref: 'spec:002', type: 'spec', id: '002', title: 'Web console', closed: 0, total: 0, parents: [], children: [], blockers: [] },
  },
} as unknown as PlanningBody;

function setUp(api: FakeApi = fakeApi(), table: Routes = routes): void {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(table), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
}

/** Opens `url` in the real route table, then sizes the shell container to `width` px. */
async function open(url: string, width = 1440): Promise<{ root: HTMLElement; harness: RouterTestingHarness }> {
  current ??= await RouterTestingHarness.create();
  const harness = current;
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  FakeResizeObserver.last?.resize(width);
  await harness.fixture.whenStable();
  return { root: harness.fixture.nativeElement as HTMLElement, harness };
}

const texts = (nodes: NodeListOf<Element>) => [...nodes].map((node) => node.textContent.trim());

describe('tierFor', () => {
  it('maps the container width onto compact < 640 ≤ medium < 1120 ≤ wide', () => {
    expect([0, 390, 639].map(tierFor)).toEqual(['compact', 'compact', 'compact']);
    expect([640, 820, 1119].map(tierFor)).toEqual(['medium', 'medium', 'medium']);
    expect([1120, 1440].map(tierFor)).toEqual(['wide', 'wide']);
  });
});

describe('ShellComponent', () => {
  beforeEach(() => {
    realResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = FakeResizeObserver;
    FakeResizeObserver.last = null;
    current = null;
  });
  afterEach(() => {
    if (realResizeObserver) globalThis.ResizeObserver = realResizeObserver;
    else Reflect.deleteProperty(globalThis, 'ResizeObserver');
  });

  it('renders exactly one header with the eight data-control slots on a spec page, six outside a workspace (ISC-140.2)', async () => {
    setUp();
    for (const url of ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/settings', '/nope']) {
      const { root } = await open(url);
      expect(root.querySelectorAll('header'), url).toHaveLength(1);
      const controls = [...root.querySelectorAll('header [data-control]')].map((el) => el.getAttribute('data-control'));
      // spec 024: PAGE select (principal 2026-10-13); spec 048 (ISC-280): the Area select, only on a spec route, before the Spec select
      const pills = url.startsWith('/w/') ? ['workspace', 'page', ...(url.includes('/s/') ? ['area'] : []), 'spec'] : ['workspace'];
      expect(controls, url).toEqual(['brand', ...pills, 'palette', 'live', 'zen', 'settings']);
    }
  });

  it('drops the rail column (data-no-rail) outside a workspace, on the dashboard, on the spec list without a selection, on the board, on the Library the tech addresses lead to and in the spec area Library (spec 023, spec 017, spec 058)', async () => {
    setUp(fakeApi(), splitRoutes(routes));
    const noRail = async (url: string): Promise<boolean> => (await open(url)).root.querySelector('app-shell')?.hasAttribute('data-no-rail') ?? false;
    for (const url of ['/', '/settings', '/w/harbor', '/w/harbor/specs', '/w/harbor/board', '/w/harbor/tech/overview', '/w/harbor/tech/status', '/w/harbor/s/002/library']) {
      expect(await noRail(url), url).toBe(true);
    }
    for (const url of ['/w/harbor/features', '/w/harbor/s/002', '/w/harbor/s/002/status']) {
      expect(await noRail(url), url).toBe(false);
    }
  });

  // Spec 058 (T16, ISC-392): the dashboard is one column at every tier; it never reaches the rail slot, so no
  // `shell.rail.pending` placeholder either.
  it.each([
    ['compact', 390],
    ['medium', 820],
    ['wide', 1440],
  ] as const)('draws no rail on the workspace dashboard at %s (spec 058, ISC-392)', async (_tier, width) => {
    setUp(fakeApi(), splitRoutes(routes));
    const { root } = await open('/w/harbor', width);
    expect(root.querySelector('app-shell')?.hasAttribute('data-no-rail')).toBe(true);
    expect(root.querySelector('.shell-rail')).toBeNull();
    expect(root.querySelector('app-rail-slot')).toBeNull();
  });

  // Spec 058 (T9, ISC-393): the spec list docks the detail sidebar into the rail at wide while a selection is open
  // (the Gantt's rule), and takes the full width without one and below wide.
  it('draws the rail on the spec list only at wide with a selection (spec 058, ISC-393)', async () => {
    setUp(fakeApi({ planning: () => Promise.resolve(ok(PLANNING_002)) }), splitRoutes(routes));
    const shellOf = (root: HTMLElement) => root.querySelector('app-shell');

    const { root: bare } = await open('/w/harbor/specs');
    expect(shellOf(bare)?.hasAttribute('data-no-rail')).toBe(true);
    expect(bare.querySelector('.shell-rail')).toBeNull();

    const { root: selected, harness } = await open('/w/harbor/specs?sel=spec:002');
    expect(shellOf(selected)?.hasAttribute('data-no-rail')).toBe(false);
    expect(selected.querySelector('.shell-rail')).not.toBeNull();

    FakeResizeObserver.last?.resize(820);
    await harness.fixture.whenStable();
    expect(shellOf(selected)?.hasAttribute('data-no-rail')).toBe(true);
    expect(selected.querySelector('.shell-rail')).toBeNull();
  });

  // Spec 067 (T9, ISC-524): the docked sidebar widens the rail column to `--detail`, only from DOCK_MIN (1280) on;
  // between the wide tier and DOCK_MIN the selection floats and the spec list keeps the full width.
  it('marks the rail column as the docked detail sidebar only from DOCK_MIN on (spec 067, ISC-524)', async () => {
    setUp(fakeApi({ planning: () => Promise.resolve(ok(PLANNING_002)) }), splitRoutes(routes));
    const { root, harness } = await open('/w/harbor/specs?sel=spec:002');
    const shell = root.querySelector('app-shell');
    expect(shell?.hasAttribute('data-detail-docked')).toBe(true);
    expect(root.querySelector('.shell-rail app-detail-sidebar[data-presentation="docked"]')).not.toBeNull();

    FakeResizeObserver.last?.resize(1279);
    await harness.fixture.whenStable();
    expect(shell?.hasAttribute('data-detail-docked')).toBe(false);
    expect(shell?.hasAttribute('data-no-rail')).toBe(true);
    expect(root.querySelector('app-detail-sidebar[slot="float"]')?.getAttribute('data-presentation')).toBe('floating');
  });

  it('sets data-tier and the tier class from the measured container width', async () => {
    setUp();
    const { root, harness } = await open('/w/harbor');
    const shell = root.querySelector('app-shell');
    for (const [width, tier] of [[390, 'compact'], [820, 'medium'], [1440, 'wide']] as const) {
      FakeResizeObserver.last?.resize(width);
      await harness.fixture.whenStable();
      expect(shell?.getAttribute('data-tier')).toBe(tier);
      expect(shell?.classList.contains(`tier-${tier}`)).toBe(true);
    }
  });

  // Spec 024 (ISC-149): the tab bar under the header on every width (principal 2026-10-12, design.md).
  it('puts the tab bar in main under the header on every width, never in the header', async () => {
    setUp();
    const { root, harness } = await open('/w/harbor/s/002/status', 390);
    expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
    expect(root.querySelector('main app-tab-bar')).not.toBeNull();
    expect(root.querySelector('header app-tab-bar')).toBeNull();

    for (const width of [820, 1440]) {
      FakeResizeObserver.last?.resize(width);
      await harness.fixture.whenStable();
      expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
      expect(root.querySelector('main app-tab-bar')).not.toBeNull();
      expect(root.querySelector('header app-tab-bar')).toBeNull();
    }
  });

  it("renders the current area's tabs from the registry, the open one aria-current", async () => {
    setUp();
    const { root } = await open('/w/harbor/s/002/claims');
    const links = root.querySelectorAll('app-tab-bar a');
    expect(texts(links)).toEqual(['Claims', 'Tasks']);
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].getAttribute('aria-current')).toBeNull();
    expect(links[1].getAttribute('href')).toBe('/w/harbor/s/002/tasks');
  });

  it('draws no tab bar for the spec dashboard and redirects an area name to its first tab', async () => {
    setUp();
    const { root } = await open('/w/harbor/s/002');
    expect(root.querySelector('app-tab-bar')).toBeNull();
    expect(root.querySelector('[data-page="placeholder"]')?.getAttribute('data-area')).toBe('dashboard');

    const { root: data } = await open('/w/harbor/s/002/data');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/claims');
    expect(texts(data.querySelectorAll('app-tab-bar a'))).toEqual(['Claims', 'Tasks']);
  });

  it('gives the Library area its bar with one tab, Documents, counting the spec list, and no rail (spec 017, T45, T46, ISC-158)', async () => {
    const doc = (spec: string, path: string, type: LibraryDoc['type'], state: LibraryDoc['state'] = 'ok'): LibraryDoc => ({
      path,
      type,
      spec,
      title: path,
      modified: state === 'missing' ? null : '2026-10-01T10:00:00Z',
      state,
      media: 'markdown',
    });
    const catalog: LibraryCatalog = {
      docs: [
        doc('workspace', 'constitution.md', 'constitution'),
        doc('workspace', 'tech.md', 'tech'),
        doc('002-web-console', '002-web-console/spec.md', 'spec'),
        doc('002-web-console', '002-web-console/plan.md', 'plan', 'stale'),
        doc('002-web-console', '002-web-console/tasks.md', 'tasks', 'missing'),
        doc('003-config-loader', '003-config-loader/spec.md', 'spec'),
      ],
      groups: [],
      fog: [],
      missing: 1,
      stale: 1,
    };
    setUp(fakeApi({ library: () => Promise.resolve(ok(catalog)) }));
    const { root } = await open('/w/harbor/s/002/library');
    const bar = root.querySelector('app-tab-bar');
    expect(bar?.querySelector('[data-area-eyebrow]')?.textContent.trim()).toBe('Library');
    const tabs = [...(bar?.querySelectorAll('a') ?? [])];
    expect(tabs.map((tab) => tab.getAttribute('data-tab'))).toEqual(['library']);
    expect(tabs[0]?.getAttribute('aria-current')).toBe('page');
    expect(tabs[0]?.getAttribute('href')).toBe('/w/harbor/s/002/library');
    expect(tabs[0]?.textContent).toContain('Documents');
    // spec.md, plan.md, the missing tasks.md and the constitution: 4, not the workspace's 6.
    expect(tabs[0]?.querySelector('[data-count="library"]')?.textContent.trim()).toBe('4');
    expect(root.querySelector('app-library-page')?.getAttribute('data-scope')).toBe('spec');
    expect(root.querySelector('app-shell')?.hasAttribute('data-no-rail')).toBe(true);
    expect(root.querySelector('.shell-rail')).toBeNull();
  });

  it('shows the placeholder, the spec head and the rail while the stub serves no spec route', async () => {
    setUp();
    const { root } = await open('/w/harbor/s/002/status');
    expect(root.querySelector('[data-page="not-found"]')).toBeNull();
    const placeholder = root.querySelector('[data-page="placeholder"]');
    expect(placeholder?.getAttribute('data-tab')).toBe('status');
    expect(placeholder?.textContent).toContain('The spec page is not served yet');
    expect(root.querySelector('h1')?.textContent).toContain('Web console');
    expect(root.querySelector('aside [data-slot="rail"]')).not.toBeNull();
  });

  it('renders the Matrix tab, not the placeholder, now every area is built', async () => {
    const empty = () => Promise.resolve({ kind: 'not-found', served: true });
    setUp({ ...fakeApi(), frames: empty, live: empty } as FakeApi);
    const { root } = await open('/w/harbor/s/002/matrix');
    expect(root.querySelector('[data-page="placeholder"]')).toBeNull();
    expect(root.querySelector('app-matrix-tab')).not.toBeNull();
  });

  it('renders the not-found page for notFound route data', async () => {
    setUp();
    for (const url of ['/nope', '/w/harbor/s/002/nope']) {
      const { root } = await open(url);
      expect(root.querySelector('app-not-found'), url).not.toBeNull();
      expect(root.querySelector('app-tab-bar'), url).toBeNull();
    }
  });

  it('renders the not-found page for a spec the dashboard does not list and for a served 404', async () => {
    setUp(fakeApi({ spec: (_ws, id) => Promise.resolve(id === '003' ? { kind: 'not-found', served: true } : { kind: 'not-found', served: false }) }));
    const { root } = await open('/w/harbor/s/999');
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(root.querySelector('app-not-found a')?.getAttribute('href')).toBe('/w/harbor');
    expect(root.querySelector('aside')).toBeNull();

    const { root: served } = await open('/w/harbor/s/003/status');
    expect(served.querySelector('app-not-found')).not.toBeNull();
    expect(served.querySelector('[data-page="placeholder"]')).toBeNull();

    const { root: workspace } = await open('/w/ghost');
    expect(workspace.querySelector('app-not-found a')?.getAttribute('href')).toBe('/');
  });

  it('toggles zen from the header button', async () => {
    setUp();
    const { root, harness } = await open('/w/harbor/s/002/status');
    const zen = root.querySelector<HTMLButtonElement>('[data-control="zen"]');
    zen?.click();
    await harness.fixture.whenStable();
    expect(root.querySelector('app-shell')?.hasAttribute('data-zen')).toBe(true);
    expect(zen?.getAttribute('aria-pressed')).toBe('true');
  });

  describe('header controls lead somewhere', () => {
    const control = (root: HTMLElement, name: string): HTMLElement => {
      const el = root.querySelector<HTMLElement>(`header [data-control="${name}"]`);
      if (!el) throw new Error(`${name} missing`);
      return el;
    };

    it('makes the workspace picker a link to the workspace, or to all workspaces without one', async () => {
      setUp();
      for (const [url, href] of [['/', '/'], ['/w/harbor', '/w/harbor'], ['/w/harbor/s/002/claims', '/w/harbor']] as const) {
        const { root } = await open(url);
        const picker = control(root, 'workspace');
        expect(picker.tagName, url).toBe('A');
        expect(picker.getAttribute('href'), url).toBe(href);
        expect(picker.querySelector('ui-icon'), url).not.toBeNull();
        expect(picker.getAttribute('aria-label'), url).toMatch(/^Workspace/);
      }
    });

    it('makes the spec picker a link to the open spec or the workspace spec list, and leaves it out without a workspace', async () => {
      setUp();
      const { root: home } = await open('/');
      expect(home.querySelector('header [data-control="spec"]')).toBeNull();

      const { root: workspace } = await open('/w/harbor');
      expect(control(workspace, 'spec').tagName).toBe('A');
      // Spec 058 (ISC-395): the spec list is the Specs page `/w/<ws>/specs`.
      expect(control(workspace, 'spec').getAttribute('href')).toBe('/w/harbor/specs');
      // The dashboard itself no longer carries the list (ISC-390).
      expect(workspace.querySelector('[data-page="workspace"] h2#specs')).toBeNull();

      const { root: spec } = await open('/w/harbor/s/002/claims');
      expect(control(spec, 'spec').tagName).toBe('A');
      expect(control(spec, 'spec').getAttribute('href')).toBe('/w/harbor/s/002');
      expect(control(spec, 'spec').textContent).toContain('Web console');
    });

    it('leaves the area trigger out while no workspace is open (ISC-140.2)', async () => {
      setUp();
      const { root } = await open('/');
      expect(root.querySelector('header [data-control="area"]')).toBeNull();
      expect(root.querySelector('header nav[aria-label="Areas"]')).toBeNull();
    });

    it('keeps the page menu disabled with its reason for a workspace the server does not know', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      try {
        setUp();
        for (const url of ['/w/nope', '/w/nope/features']) {
          const { root, harness } = await open(url);
          // spec 024: PAGE select (principal 2026-10-13): the workspace pages moved from the area select to the PAGE select
          const area = control(root, 'page');
          expect(area.getAttribute('aria-disabled')).toBe('true');
          expect(area.getAttribute('title')).toBe('Open a workspace to switch pages');
          expect(area.getAttribute('aria-label')).toBe('Pages');
          expect(area.textContent).not.toContain('Specs');
          expect(root.querySelector('header [data-control="area"]')).toBeNull();
          area.click();
          await harness.fixture.whenStable();
          expect(root.querySelector('app-area-menu')).toBeNull();
          expect(root.querySelector('header nav[aria-label="Pages"]')).toBeNull();
        }
      } finally {
        delete proto['showPopover'];
      }
    });

    it('enables the page trigger at workspace scope and names the current page', async () => {
      setUp();
      const { root } = await open('/w/harbor');
      // spec 024: PAGE select (principal 2026-10-13)
      const area = control(root, 'page');
      expect(area.getAttribute('aria-disabled')).toBeNull();
      // Spec 058 (T3, ISC-390): `/w/:ws` is the dashboard page; the Specs page has its own route.
      expect(area.textContent).toContain('Dashboard');
      expect(area.getAttribute('aria-expanded')).toBe('false');
      expect(area.getAttribute('aria-label')).toBe('Page: Dashboard');
    });

    it('names Library on every former tech address, enabled, without a trigger icon (spec 017 T42, ISC-157.1; spec 024 T80)', async () => {
      setUp();
      for (const url of ['/w/harbor/tech/overview', '/w/harbor/tech/open', '/w/harbor/library']) {
        const { root } = await open(url);
        // spec 024: PAGE select (principal 2026-10-13)
        const area = control(root, 'page');
        expect(area.getAttribute('aria-disabled'), url).toBeNull();
        expect(area.querySelector('.pick-text')?.textContent.trim(), url).toBe('Library');
        // spec 024: PAGE select without trigger icon (principal 2026-10-13): only the chevron, the menu row keeps `book`
        expect(area.querySelector('ui-icon:not(.chevron)'), url).toBeNull();
        expect(area.getAttribute('aria-label'), url).toBe('Page: Library');
      }
    });

    it('opens the page menu at workspace scope: Specs, Board, Planning, Tech and Library (spec 026)', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      proto['hidePopover'] = vi.fn(function (this: HTMLElement) {
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
      });
      try {
        setUp();
        const { root, harness } = await open('/w/harbor');
        // spec 024: PAGE select (principal 2026-10-13)
        const trigger = control(root, 'page');
        await harness.fixture.whenStable();
        trigger.click();
        await harness.fixture.whenStable();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const entries = [...root.querySelectorAll('header nav[aria-label="Pages"] [data-page]')];
        expect(entries.map((entry) => entry.getAttribute('data-page'))).toEqual(['dashboard', 'specs', 'board', 'planning', 'library']);
        // Spec 058 (T3, ISC-390): the root's route names the dashboard page, so the menu marks it current.
        expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual(['page', null, null, null, null]);
      } finally {
        delete proto['showPopover'];
        delete proto['hidePopover'];
      }
    });

    it('opens the area menu: six areas in registry order, one disabled, the current one marked, links to each area', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      proto['hidePopover'] = vi.fn(function (this: HTMLElement) {
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
      });
      try {
        setUp();
        const { root, harness } = await open('/w/harbor/s/002/claims');
        const trigger = control(root, 'area');
        expect(trigger.getAttribute('aria-disabled')).toBeNull();
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(trigger.textContent).toContain('Data');

        trigger.click();
        await harness.fixture.whenStable();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        const nav = root.querySelector('header nav[aria-label="Areas"]');
        expect(nav?.getAttribute('aria-label')).toBe('Areas');
        const entries = [...(nav?.querySelectorAll('[data-area]') ?? [])];
        expect(entries.map((entry) => entry.getAttribute('data-area'))).toEqual(['dashboard', 'status', 'live', 'data', 'library', 'notes']);
        expect(entries.map((entry) => entry.tagName)).toEqual(['A', 'A', 'A', 'A', 'A', 'A']);
        expect(entries.map((entry) => entry.getAttribute('href'))).toEqual([
          '/w/harbor/s/002',
          '/w/harbor/s/002/status',
          '/w/harbor/s/002/board',
          '/w/harbor/s/002/claims',
          '/w/harbor/s/002/library',
          '/w/harbor/s/002/notes',
        ]);
        expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual([null, null, null, 'page', null, null]);
        expect(entries.map((entry) => entry.getAttribute('aria-disabled'))).toEqual([null, null, null, null, null, null]);
        expect(entries.map((entry) => entry.querySelector('.dot')?.getAttribute('data-dot'))).toEqual([...AREA_IDS]);
        // spec 024: the area menu's sublines name each area's tabs.
        expect(texts(nav?.querySelectorAll('[data-area] .sub') as NodeListOf<Element>)).toEqual([
          'overview · next step · gates',
          'Status · Timeline',
          'Board · Matrix',
          'Claims · Tasks',
          'Spec · Plan · Tasks · Design · Evidence · Prototype',
          'Notes',
        ]);
        expect(texts(nav?.querySelectorAll('[data-area] .entry-name') as NodeListOf<Element>)).toEqual([
          'Dashboard',
          'Status',
          'Live',
          'Data',
          'Library',
          'Notes',
        ]);

        (entries[4] as HTMLElement).click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/library');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
      } finally {
        delete proto['showPopover'];
        delete proto['hidePopover'];
      }
    });

    it('opens the live popover from the indicator, with the round board only while a spec is open (spec 024 T40)', async () => {
      setUp();
      const { root: workspace } = await open('/w/harbor');
      const indicator = control(workspace, 'live');
      expect(indicator.tagName).toBe('BUTTON');
      expect(indicator.getAttribute('aria-haspopup')).toBe('dialog');
      expect(indicator.getAttribute('data-source')).toBe('none');
      expect(workspace.querySelector('[data-live-board]')).toBeNull();
      expect(workspace.querySelector('[data-live-reading]')).not.toBeNull();
      // The header stays narrow: icon and dot only; spec 071 (ISC-579) dropped the popover's "Updated n s ago" line.
      expect(indicator.textContent.trim()).toBe('');
      expect(workspace.querySelector('[data-live-updated]')).toBeNull();

      const { root: spec } = await open('/w/harbor/s/002/status');
      const live = control(spec, 'live');
      expect(live.tagName).toBe('BUTTON');
      // Spec 008 (T116): the spec's board is the "Round board", never the workspace's "Board".
      expect(live.getAttribute('title')).toBe('No agent source · No dev service running');
      expect(live.getAttribute('aria-label')).toBe('Live status and dev services · No agent source · No dev service running');
      expect(spec.querySelector('[data-live-board]')?.getAttribute('href')).toBe('/w/harbor/s/002/board');
      expect(spec.querySelector('[data-live-board]')?.textContent).toContain('Open the round board');
    });

    // spec 024 T40, T52: the settings control opens the settings popover; its "Workspaces…" entry leads to
    // the workspace management at /settings/workspaces.
    it('opens the settings popover from the settings control, whose Workspaces entry leads to the workspace management', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      proto['hidePopover'] = vi.fn(function (this: HTMLElement) {
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
      });
      setUp();
      const { root, harness } = await open('/w/harbor');
      const settings = control(root, 'settings');
      expect(settings.tagName).toBe('BUTTON');
      expect(settings.getAttribute('aria-haspopup')).toBe('dialog');
      expect(settings.getAttribute('aria-disabled')).toBeNull();
      expect(settings.getAttribute('aria-label')).toBe('Settings and help');

      try {
        settings.click();
        await harness.fixture.whenStable();
        expect(settings.getAttribute('aria-expanded')).toBe('true');
        const panel = root.querySelector('[data-menu="settings"]');
        expect(panel?.querySelector('[data-setting="theme"] [role="radiogroup"]')?.getAttribute('aria-label')).toBe('Theme');
        expect(panel?.querySelector('[data-setting="language"] [role="radiogroup"]')?.getAttribute('aria-label')).toBe('Language');
        expect(panel?.querySelector('[data-setting="single-keys"]')?.getAttribute('role')).toBe('switch');
        expect(panel?.querySelector('[data-settings-link="help"]')?.getAttribute('href')).toBe('/help');
        const workspaces = panel?.querySelector<HTMLAnchorElement>('[data-settings-link="workspaces"]');
        expect(workspaces?.getAttribute('href')).toBe('/settings/workspaces');
        workspaces?.click();
        await harness.fixture.whenStable();
      } finally {
        delete proto['showPopover'];
        delete proto['hidePopover'];
      }
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/settings/workspaces');
      const page = root.querySelector('[data-page="settings-workspaces"]');
      expect(page?.hasAttribute('data-demo')).toBe(false); // spec 016 T14: the page reads the registry, no longer a mock
      expect(page?.querySelector('h1')?.textContent).toContain('Workspaces');

      // The Settings page itself, with its card links to help and the workspace management (T52).
      await TestBed.inject(Router).navigateByUrl('/settings');
      await harness.fixture.whenStable();
      const settingsPage = root.querySelector('[data-page="settings"]');
      expect(settingsPage?.querySelector('h1')?.textContent).toContain('Settings');
      // spec 024 T60: the placeholder text gave way to the designed page; its card links to the workspace management
      // and to the keyboard guide, and the shortcut sheet opens from the Keyboard card.
      expect(settingsPage?.querySelector('a[data-action="workspaces"]')?.getAttribute('href')).toBe('/settings/workspaces');
      expect(settingsPage?.querySelector('a[data-action="help"]')?.getAttribute('href')).toBe('/help#keys');
      expect(settingsPage?.querySelector('button[data-action="shortcuts"]')).not.toBeNull();
      expect(root.querySelectorAll('header')).toHaveLength(1);
    });

    it('makes the palette trigger live: a dialog opener that sets the palette open (spec 001 T66)', async () => {
      setUp();
      const { root } = await open('/w/harbor/s/002');
      const palette = control(root, 'palette');
      expect(palette.hasAttribute('aria-disabled')).toBe(false);
      expect(palette.getAttribute('aria-haspopup')).toBe('dialog');
      const keyboard = TestBed.inject(KeyboardService);
      expect(keyboard.paletteOpen()).toBe(false);
      palette.click();
      expect(keyboard.paletteOpen()).toBe(true);
    });
  });

  describe('header pickers, area menu focus and live states (T36)', () => {
    const TWO = fakeApi({
      workspaces: () =>
        Promise.resolve(
          ok([
            { slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: { specs: 3 } },
            { slug: 'lantern', name: 'lantern', pathTail: 'lantern', readable: false, error: 'missing', counts: null },
          ]),
        ),
    });
    const control = (root: HTMLElement, name: string): HTMLElement => {
      const el = root.querySelector<HTMLElement>(`header [data-control="${name}"]`);
      if (!el) throw new Error(`${name} missing`);
      return el;
    };
    const click = (el: HTMLElement, init: MouseEventInit = {}): MouseEvent => {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
      el.dispatchEvent(event);
      return event;
    };
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const dialogProto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;

    beforeEach(() => {
      proto['showPopover'] = vi.fn();
      proto['hidePopover'] = vi.fn(function (this: HTMLElement) {
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
      });
      dialogProto['showModal'] = vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute('open', '');
      });
      dialogProto['close'] = vi.fn(function (this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      });
    });
    afterEach(() => {
      delete proto['showPopover'];
      delete proto['hidePopover'];
      delete dialogProto['showModal'];
      delete dialogProto['close'];
    });

    // Spec 058 (ISC-395): a link meaning the spec list leads to /w/<ws>/specs, one meaning the workspace to /w/<ws>.
    it.each(['/', '/w/harbor', '/w/harbor/s/002'])('on %s leads the workspace picker to /w/<ws> and the spec select "show all" to /w/<ws>/specs (spec 058, ISC-395)', async (url) => {
      setUp(TWO);
      const { root, harness } = await open(url);
      click(control(root, 'workspace'));
      await harness.fixture.whenStable();
      const workspaces = [...root.querySelectorAll<HTMLAnchorElement>('nav[data-picker="workspace"] a[data-workspace]')];
      expect(workspaces.map((entry) => entry.getAttribute('href')), url).toEqual(['/w/harbor', '/w/lantern']);
      if (url === '/') {
        expect(root.querySelector('header [data-control="spec"]'), url).toBeNull();
        return;
      }
      click(control(root, 'spec'));
      await harness.fixture.whenStable();
      const all = root.querySelector('nav[data-picker="spec"] .picker-all');
      expect(all?.getAttribute('href'), url).toBe('/w/harbor/specs');
    });

    // Spec 058 (ISC-395, T45): "show all" is a section jump like `g s`; focus lands on the list heading once it rendered.
    it.each(['/w/harbor', '/w/harbor/s/002', '/w/harbor/specs'])('on %s moves focus to the Specs heading after "show all" (spec 058, ISC-395)', async (url) => {
      setUp(TWO);
      const { root, harness } = await open(url);
      click(control(root, 'spec'));
      await harness.fixture.whenStable();
      const all = root.querySelector<HTMLAnchorElement>('nav[data-picker="spec"] .picker-all');
      if (!all) throw new Error(`show all missing on ${url}`);
      all.click();
      await harness.fixture.whenStable();
      for (let frame = 0; frame < 5 && document.activeElement?.id !== 'specs'; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        await harness.fixture.whenStable();
      }
      expect(TestBed.inject(Router).url, url).toBe('/w/harbor/specs');
      expect(document.activeElement?.id, url).toBe('specs');
      expect(document.activeElement?.tagName, url).toBe('H2');
    });

    it('opens the workspace picker on a plain click: all workspaces, every workspace with its specs, the current marked', async () => {
      setUp(TWO);
      const { root, harness } = await open('/w/harbor/s/002/claims');
      const picker = control(root, 'workspace');
      expect(picker.getAttribute('aria-expanded')).toBe('false');
      expect(picker.getAttribute('aria-haspopup')).toBe('dialog');

      const event = click(picker);
      await harness.fixture.whenStable();
      expect(event.defaultPrevented).toBe(true);
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/claims');
      expect(picker.getAttribute('aria-expanded')).toBe('true');

      const list = root.querySelector('nav[data-picker="workspace"]');
      expect(list?.getAttribute('aria-label')).toBe('Workspaces');
      const entries = [...(list?.querySelectorAll<HTMLAnchorElement>('.picker-entry') ?? [])];
      // spec 024: the workspace picker lists the workspaces, then "Show all n workspaces".
      expect(entries.map((entry) => entry.getAttribute('href'))).toEqual(['/w/harbor', '/w/lantern', '/']);
      expect(list?.querySelector('.menu-head')?.textContent.trim()).toBe('All workspaces (2)');
      expect(texts(list?.querySelectorAll('.entry-name') as NodeListOf<Element>)).toEqual(['harbor', 'lantern', 'Show all 2 workspaces']);
      // spec 024: the bare count, as the workspace picker shows it.
      expect(texts(list?.querySelectorAll('.entry-meta') as NodeListOf<Element>)).toEqual(['3', 'Cannot be read']);
      expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual(['true', null, null]);
      expect(document.activeElement).toBe(entries[0]);
      const footer = list?.querySelector('[data-picker-footer]');
      expect(footer?.getAttribute('href')).toBe('/settings');
      expect(footer?.textContent).toContain('Manage workspaces');

      entries[1]?.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/w/lantern');
      expect(picker.getAttribute('aria-expanded')).toBe('false');
    });

    it('leaves a modified or non-primary click to the anchor, which keeps its href', async () => {
      setUp(TWO);
      const { root, harness } = await open('/w/harbor/s/002');
      const picker = control(root, 'workspace');
      for (const init of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
        const event = click(picker, init);
        await harness.fixture.whenStable();
        expect(event.defaultPrevented, JSON.stringify(init)).toBe(false);
        expect(picker.getAttribute('aria-expanded'), JSON.stringify(init)).toBe('false');
      }
      expect(navigatesNatively(new MouseEvent('click', { button: 0 }))).toBe(false);
      expect(navigatesNatively(new MouseEvent('click', { button: 0, metaKey: true }))).toBe(true);
    });

    it("opens the spec picker with the workspace's specs: id, title, stage chip, the open one marked", async () => {
      setUp(TWO);
      const { root, harness } = await open('/w/harbor/s/002/claims');
      const picker = control(root, 'spec');
      click(picker);
      await harness.fixture.whenStable();
      expect(picker.getAttribute('aria-expanded')).toBe('true');

      const list = root.querySelector('nav[data-picker="spec"]');
      expect(list?.getAttribute('aria-label')).toBe('Specs');
      expect(list?.querySelector('.picker-all')?.getAttribute('href')).toBe('/w/harbor/specs');
      // spec 024: the spec picker ends with "Spec overview" (g s).
      expect(list?.querySelector('.picker-all')?.textContent).toContain('Spec overview');
      const rows = [...(list?.querySelectorAll<HTMLAnchorElement>('[data-spec]') ?? [])];
      expect(rows.map((row) => row.getAttribute('data-spec'))).toEqual(['004', '002', '003']);
      // Spec 051 (ISC-291): every entry keeps the open tab, Claims.
      expect(rows.map((row) => row.getAttribute('href'))).toEqual([
        '/w/harbor/s/004/claims',
        '/w/harbor/s/002/claims',
        '/w/harbor/s/003/claims',
      ]);
      expect(texts(list?.querySelectorAll('[data-spec] .entry-name') as NodeListOf<Element>)).toEqual([
        'Retention policies',
        'Web console',
        'Config loader',
      ]);
      expect(texts(list?.querySelectorAll('[data-spec] ui-chip') as NodeListOf<Element>)).toEqual(['Code review', 'Build', 'Tasks']);
      // Spec 064 (ISC-501): the chip names the stage in its own tone, never the phase.
      expect([...(list?.querySelectorAll('[data-spec] ui-chip') ?? [])].map((chip) => chip.getAttribute('data-tone'))).toEqual(['warning', 'primary', 'secondary']);
      expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true', null]);
      expect(document.activeElement).toBe(rows[1]);

      rows[2]?.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/003/claims');
    });

    it('opens the pickers as bottom sheets at compact, focused on the current entry', async () => {
      setUp(TWO);
      const { root, harness } = await open('/w/harbor/s/002', 390);
      // The workspace and spec pickers, the page menu (spec 024 T80), the area menu (T37), the overflow menu and the
      // settings panel (spec 024 T76, T40): all six are bottom sheets at compact. // spec 024: PAGE select (principal 2026-10-13)
      expect(root.querySelectorAll('ui-sheet')).toHaveLength(6);
      expect(root.querySelectorAll('ui-popover.picker-popover, ui-popover.area-popover')).toHaveLength(0);
      expect(root.querySelectorAll('header')).toHaveLength(1);

      const picker = control(root, 'spec');
      click(picker);
      await harness.fixture.whenStable();
      const sheet = root.querySelector('ui-sheet[data-tier="compact"] dialog[open]');
      expect(sheet?.getAttribute('aria-label')).toBe('Specs');
      expect(picker.getAttribute('aria-expanded')).toBe('true');
      expect(document.activeElement?.getAttribute('data-spec')).toBe('002');

      (sheet?.querySelector('[data-spec="004"]') as HTMLElement).click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/004');
      expect(root.querySelector('ui-sheet dialog[open]')).toBeNull();
      expect(picker.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens the area menu on the current area, with a g-key hint per area that has one', async () => {
      setUp();
      const { root, harness } = await open('/w/harbor/s/002/claims');
      control(root, 'area').click();
      await harness.fixture.whenStable();
      expect(document.activeElement?.getAttribute('data-area')).toBe('data');
      const keys = [...root.querySelectorAll('header nav[aria-label="Areas"] [data-area]')].map(
        (entry) => entry.querySelector('ui-kbd')?.textContent.trim() ?? null,
      );
      // spec 024: the area menu names g h for the dashboard.
      expect(keys).toEqual(['g h', 'g s', 'g l', 'g d', 'g o', 'g n']);
      expect(root.querySelector('header nav[aria-label="Areas"] ui-kbd')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('turns the live dot on while a dev service of the workspace is up, with a text alternative', async () => {
      const services = [{ port: 4200, url: 'http://localhost:4200', label: 'web', process: 'bun' }];
      setUp(fakeApi({ dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok({ ...HARBOR, services }) : { kind: 'not-found', served: true }) }));
      const { root } = await open('/w/harbor');
      const live = control(root, 'live');
      expect(live.getAttribute('data-services')).toBe('up');
      expect(live.getAttribute('aria-label')).toContain('1 dev service running');
      expect(root.querySelectorAll('[data-live-service]')).toHaveLength(1);

      const { root: overview } = await open('/');
      expect(control(overview, 'live').getAttribute('data-services')).toBe('down');
    });

    it('shows the live indicator state per lock source, with a text alternative', async () => {
      setUp();
      const { root, harness } = await open('/w/harbor/s/002/status');
      const lock = TestBed.inject(LockSourceService);
      for (const source of ['none', 'activity', 'frontier'] as const) {
        lock.connect(signal({ lockSource: source, lock: null, agentsWorking: 0 }));
        await harness.fixture.whenStable();
        const live = control(root, 'live');
        expect(live.getAttribute('data-source'), source).toBe(source);
        // spec 024 T40: the indicator is the live popover's trigger; its name carries the source.
        expect(live.getAttribute('aria-label'), source).toContain(
          { none: 'No agent source', activity: 'activity log', frontier: 'LifeOS frontier locks' }[source],
        );
      }
    });

    describe('spec select keeps the tab (spec 051)', () => {
      const TABS = SPEC_AREAS.flatMap((area) => area.tabs);
      const COMPACT = 390;
      const WIDTHS = [
        ['popover', undefined],
        ['bottom sheet', COMPACT],
      ] as const;
      // The Live and Tasks views read their own routes; the catch-all answer is enough for the spec select.
      const unserved = () => Promise.resolve({ kind: 'not-found', served: false } as const);
      const VIEWS = { ...TWO, tasks: unserved, live: unserved, frames: unserved };

      /** Opens `url` at `width`, opens the spec select and returns its entry for spec 003 (popover or bottom sheet). */
      const entryOf = async (url: string, width?: number): Promise<{ entry: HTMLAnchorElement; harness: RouterTestingHarness }> => {
        setUp(VIEWS);
        const { root, harness } = await open(url, width);
        click(control(root, 'spec'));
        await harness.fixture.whenStable();
        const scope = width === COMPACT ? 'ui-sheet[data-tier="compact"] dialog[open]' : 'ui-popover nav[data-picker="spec"]';
        const entry = root.querySelector<HTMLAnchorElement>(`${scope} [data-spec="003"]`);
        if (!entry) throw new Error(`entry 003 missing on ${url}`);
        return { entry, harness };
      };
      /** The path, query and fragment an href names, resolved against the base href as the browser would. */
      const resolved = (href: string | null): string => {
        const url = new URL(href ?? '', document.baseURI);
        return url.pathname + url.search + url.hash;
      };

      describe.each(WIDTHS)('in the %s', (_, width) => {
        it.each(TABS)('leads from /w/harbor/s/002/%s to the same tab of spec 003 (ISC-291)', async (tab) => {
          // Spec 051 (ISC-291): the entry's href and its click both name the open tab of the new spec.
          const { entry, harness } = await entryOf(`/w/harbor/s/002/${tab}`, width);
          expect(entry.getAttribute('href')).toBe(`/w/harbor/s/003/${tab}`);
          entry.click();
          await harness.fixture.whenStable();
          expect(TestBed.inject(Router).url).toBe(`/w/harbor/s/003/${tab}`);
        });

        it.each(['/w/harbor/s/002', '/w/harbor'])('leads from %s to the dashboard of spec 003 (ISC-292)', async (url) => {
          // Spec 051 (ISC-292): from the spec dashboard or a workspace page without a spec it stays the dashboard.
          const { entry, harness } = await entryOf(url, width);
          expect(entry.getAttribute('href')).toBe('/w/harbor/s/003');
          entry.click();
          await harness.fixture.whenStable();
          expect(TestBed.inject(Router).url).toBe('/w/harbor/s/003');
        });
      });

      it.each([
        ['/w/harbor/s/002/notes/new', '/w/harbor/s/003/notes'],
        ['/w/harbor/s/002/library?doc=plan', '/w/harbor/s/003/library'],
        ['/w/harbor/s/002/claims#claim-ISC-74', '/w/harbor/s/003/claims'],
      ])('drops what the old spec names under the tab: %s leads to %s (ISC-293)', async (url, target) => {
        // Spec 051 (ISC-293): no note id, no query and no fragment of the old spec go along.
        const { entry, harness } = await entryOf(url);
        expect(entry.getAttribute('href')).toBe(target);
        entry.click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe(target);
      });

      it.each(TABS)('anti: from the %s tab the click lands where the href points, never on the dashboard (ISC-295)', async (tab) => {
        // Spec 051 (ISC-295): opening the entry in a new tab and clicking it reach the same address, and that is not the dashboard.
        const { entry, harness } = await entryOf(`/w/harbor/s/002/${tab}`);
        const href = resolved(entry.getAttribute('href'));
        entry.click();
        await harness.fixture.whenStable();
        const url = TestBed.inject(Router).url;
        expect(url).toBe(href);
        expect(url).not.toBe('/w/harbor/s/003');
      });
    });

    describe('spec select lists the favourites (spec 052)', () => {
      const COMPACT = 390;
      const WIDTHS = [
        ['popover', 1440, 'ui-popover nav[data-picker="spec"]'],
        ['bottom sheet', COMPACT, 'ui-sheet[data-tier="compact"] dialog[open] nav[data-picker="spec"]'],
      ] as const;
      const SLUGS: Readonly<Record<string, string>> = { '002': '002-web-console', '003': '003-config-loader', '004': '004-retention-policies' };

      /** A workspace whose stored favourites start as `initial`; DELETE answers the remaining set, as the server does. */
      const withFavorites = (initial: readonly string[]) => {
        let stored = [...initial];
        const deleteFavorite = vi.fn((_ws: string, spec: string) => {
          stored = stored.filter((id) => id !== spec);
          return Promise.resolve({ kind: 'ok' as const, body: { specs: [...stored], ideas: [] } });
        });
        // The rows carry their folders here: a favourite is stored and unset by folder name, never by the bare id.
        const slugged = { ...HARBOR, specs: HARBOR.specs.map((spec) => ({ ...spec, slug: SLUGS[spec.id] })) };
        const api = fakeApi({
          ...TWO,
          dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(slugged) : { kind: 'not-found', served: true }),
          favorites: () => Promise.resolve(ok({ specs: [...stored], ideas: [] })),
          deleteFavorite,
        });
        return { api, deleteFavorite };
      };

      /** Opens `url` at `width`, opens the spec select and returns its nav (in the popover or the bottom sheet). */
      const openSelect = async (api: FakeApi, url: string, width: number, scope: string) => {
        setUp(api);
        const { root, harness } = await open(url, width);
        const picker = control(root, 'spec');
        click(picker);
        await harness.fixture.whenStable();
        const nav = root.querySelector<HTMLElement>(scope);
        if (!nav) throw new Error(`spec select missing at ${width}`);
        return { root, harness, picker, nav };
      };
      const ids = (nav: HTMLElement) => [...nav.querySelectorAll('a[data-spec]')].map((row) => row.getAttribute('data-spec'));

      describe.each(WIDTHS)('in the %s', (_, width, scope) => {
        it('lists exactly the favourites in dashboard order, not the open spec without a star, then all specs (ISC-298)', async () => {
          const { api } = withFavorites(['003-config-loader', '004-retention-policies']);
          const { nav } = await openSelect(api, '/w/harbor/s/002/claims', width, scope);
          expect(nav.querySelector('.menu-head')?.textContent.trim()).toBe('Favorites · harbor');
          // Dashboard order (004 before 003), and the open spec 002 has no star, so it is no row.
          expect(ids(nav)).toEqual(['004', '003']);
          expect(nav.querySelector('.picker-all')?.getAttribute('href')).toBe('/w/harbor/specs');
          expect(nav.querySelector('.picker-empty')).toBeNull();
          // Each row is the unchanged link plus its own star, a sibling of the link, never inside it.
          const stars = [...nav.querySelectorAll<HTMLButtonElement>('li > button[ui-star-toggle]')];
          expect(stars.map((star) => star.getAttribute('aria-pressed'))).toEqual(['true', 'true']);
          expect(stars.map((star) => star.getAttribute('aria-label'))).toEqual(['Favorite: 004 Retention policies', 'Favorite: 003 Config loader']);
          expect(nav.querySelector('a[data-spec] button')).toBeNull();
          // The roving list keeps one tab stop: the first row's link and its star.
          expect(stars.map((star) => star.tabIndex)).toEqual([0, -1]);
          // The open spec is no favourite: focus lands on the first favourite row.
          expect(document.activeElement?.getAttribute('data-spec')).toBe('004');
        });

        it('focuses the open spec when it is a favourite (ISC-298)', async () => {
          const { api } = withFavorites(['002-web-console', '003-config-loader']);
          const { nav } = await openSelect(api, '/w/harbor/s/002', width, scope);
          expect(ids(nav)).toEqual(['002', '003']);
          expect(document.activeElement?.getAttribute('data-spec')).toBe('002');
          expect(document.activeElement?.getAttribute('aria-current')).toBe('true');
        });

        it('shows no spec row but the star hint and all specs without favourites (ISC-299)', async () => {
          const { api } = withFavorites([]);
          const { nav } = await openSelect(api, '/w/harbor/s/002', width, scope);
          expect(nav.querySelector('.menu-head')?.textContent.trim()).toBe('Favorites · harbor');
          expect(ids(nav)).toEqual([]);
          const hint = nav.querySelector('p.picker-empty');
          expect(hint?.textContent.trim()).toBe('No favorites yet. Star a spec on its page or in the spec list to see it here.');
          expect(hint?.querySelector('ui-icon')?.getAttribute('aria-hidden')).toBe('true');
          const all = nav.querySelector<HTMLAnchorElement>('.picker-all');
          expect(all?.getAttribute('href')).toBe('/w/harbor/specs');
          expect(document.activeElement).toBe(all);
        });

        it('unstars a row without navigating, keeps the select open, then shows the empty state (ISC-301)', async () => {
          const { api, deleteFavorite } = withFavorites(['003-config-loader', '004-retention-policies']);
          const { root, harness, picker, nav } = await openSelect(api, '/w/harbor/s/002/claims', width, scope);
          const router = TestBed.inject(Router);
          const starOf = (id: string) => nav.querySelector<HTMLButtonElement>(`li:has(> a[data-spec="${id}"]) > button[ui-star-toggle]`);

          // A double click's second click lands on the next star, which slides under the pointer: it is ignored.
          click(starOf('004') as HTMLElement, { detail: 2 });
          await harness.fixture.whenStable();
          expect(deleteFavorite).not.toHaveBeenCalled();

          click(starOf('004') as HTMLElement, { detail: 1 });
          await harness.fixture.whenStable();
          expect(deleteFavorite).toHaveBeenCalledWith('harbor', '004-retention-policies');
          expect(router.url).toBe('/w/harbor/s/002/claims');
          expect(picker.getAttribute('aria-expanded')).toBe('true');
          expect(nav.isConnected).toBe(true);
          expect(ids(nav)).toEqual(['003']);
          // Focus moves to the star of the row that moved up; the removal is announced.
          expect(document.activeElement).toBe(starOf('003'));
          expect(nav.querySelector('ui-live-region')?.textContent.trim()).toBe('004 removed from favorites');

          click(starOf('003') as HTMLElement);
          await harness.fixture.whenStable();
          expect(router.url).toBe('/w/harbor/s/002/claims');
          expect(picker.getAttribute('aria-expanded')).toBe('true');
          expect(ids(nav)).toEqual([]);
          expect(nav.querySelector('p.picker-empty')).not.toBeNull();
          // No row left: focus falls back to "all specs".
          expect(document.activeElement).toBe(nav.querySelector('.picker-all'));
          expect(root.querySelector(scope)).toBe(nav);
        });
      });

      it('moves focus to the previous star when the last row is unstarred (ISC-301)', async () => {
        const { api } = withFavorites(['002-web-console', '003-config-loader', '004-retention-policies']);
        const { harness, nav } = await openSelect(api, '/w/harbor', 1440, WIDTHS[0][2]);
        click(nav.querySelector('li:has(> a[data-spec="003"]) > button[ui-star-toggle]') as HTMLElement);
        await harness.fixture.whenStable();
        expect(ids(nav)).toEqual(['004', '002']);
        expect(document.activeElement).toBe(nav.querySelector('li:has(> a[data-spec="002"]) > button[ui-star-toggle]'));
      });

      it('freezes the bottom sheet height while rows are unstarred, so it does not jump (ISC-301)', async () => {
        const { api } = withFavorites(['003-config-loader', '004-retention-policies']);
        const { harness, nav } = await openSelect(api, '/w/harbor/s/002', COMPACT, WIDTHS[1][2]);
        expect(nav.style.minBlockSize).not.toBe('');
        click(nav.querySelector('li:has(> a[data-spec="004"]) > button[ui-star-toggle]') as HTMLElement);
        await harness.fixture.whenStable();
        expect(nav.style.minBlockSize).not.toBe('');
      });

      describe('with idea favourites (spec 064, T54, ISC-498)', () => {
        const IDEAS = [
          { slug: 'buoy-map', title: 'Buoy map' },
          { slug: 'offline-sync', title: 'Offline sync' },
          { slug: 'tide-alerts', title: 'Tide alerts' },
        ];
        /** Spec and idea favourites as stored; DELETE on an idea answers the remaining set, as the server does. */
        const withIdeas = (specs: readonly string[], ideas: readonly string[]) => {
          let stored = [...ideas];
          const deleteIdeaFavorite = vi.fn((_ws: string, slug: string) => {
            stored = stored.filter((entry) => entry !== slug);
            return Promise.resolve({ kind: 'ok' as const, body: { specs: [...specs], ideas: [...stored] } });
          });
          const slugged = { ...HARBOR, specs: HARBOR.specs.map((spec) => ({ ...spec, slug: SLUGS[spec.id] })), ideas: { list: IDEAS } };
          const api = fakeApi({
            ...TWO,
            dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(slugged) : { kind: 'not-found', served: true }),
            favorites: () => Promise.resolve(ok({ specs: [...specs], ideas: [...stored] })),
            deleteIdeaFavorite,
          });
          return { api, deleteIdeaFavorite };
        };
        const ideaLinks = (nav: HTMLElement) => [...nav.querySelectorAll<HTMLAnchorElement>('a[data-idea]')];
        const ideaStar = (nav: HTMLElement, slug: string) =>
          nav.querySelector<HTMLButtonElement>(`li:has(> a[data-idea="${slug}"]) > button[ui-star-toggle]`);

        it('lists the idea favourites under the spec favourites, behind a hairline, each with icon, title, link and star', async () => {
          // A stored slug the dashboard lists no story for (`gone`) is no row.
          const { api } = withIdeas(['003-config-loader'], ['tide-alerts', 'offline-sync', 'gone']);
          const { nav } = await openSelect(api, '/w/harbor/s/002', 1440, WIDTHS[0][2]);
          expect(ids(nav)).toEqual(['003']);
          const links = ideaLinks(nav);
          expect(links.map((link) => link.getAttribute('data-idea'))).toEqual(['offline-sync', 'tide-alerts']);
          expect(links.map((link) => link.getAttribute('href'))).toEqual(['/w/harbor/ideas/offline-sync', '/w/harbor/ideas/tide-alerts']);
          expect(links.map((link) => link.querySelector('ui-icon')?.getAttribute('data-icon'))).toEqual(['lightbulb', 'lightbulb']);
          expect(links.map((link) => link.querySelector('.entry-name')?.textContent.trim())).toEqual(['Offline sync', 'Tide alerts']);
          expect(ideaStar(nav, 'offline-sync')?.getAttribute('aria-pressed')).toBe('true');
          expect(ideaStar(nav, 'offline-sync')?.getAttribute('aria-label')).toBe('Favorite: idea Offline sync');
          // Specs first, then the hairline, then the ideas.
          const spec = nav.querySelector('li:has(> a[data-spec="003"])') as HTMLElement;
          const sep = nav.querySelector('li[data-favorites-sep]') as HTMLElement;
          expect(sep).not.toBeNull();
          expect(spec.compareDocumentPosition(sep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(sep.compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
          expect(nav.querySelector('.picker-empty')).toBeNull();
        });

        it('unstars an idea without navigating and keeps the select open (ISC-301 for ideas)', async () => {
          const { api, deleteIdeaFavorite } = withIdeas(['003-config-loader'], ['offline-sync', 'tide-alerts']);
          const { harness, picker, nav } = await openSelect(api, '/w/harbor/s/002/claims', 1440, WIDTHS[0][2]);
          const router = TestBed.inject(Router);
          click(ideaStar(nav, 'offline-sync') as HTMLElement, { detail: 1 });
          await harness.fixture.whenStable();
          expect(deleteIdeaFavorite).toHaveBeenCalledWith('harbor', 'offline-sync');
          expect(router.url).toBe('/w/harbor/s/002/claims');
          expect(picker.getAttribute('aria-expanded')).toBe('true');
          expect(ideaLinks(nav).map((link) => link.getAttribute('data-idea'))).toEqual(['tide-alerts']);
          expect(document.activeElement).toBe(ideaStar(nav, 'tide-alerts'));
          expect(nav.querySelector('ui-live-region')?.textContent.trim()).toBe('Offline sync removed from favorites');
        });

        it('shows only the ideas, no hairline and no empty state, with idea favourites alone', async () => {
          const { api } = withIdeas([], ['tide-alerts']);
          const { nav } = await openSelect(api, '/w/harbor/s/002', COMPACT, WIDTHS[1][2]);
          expect(ids(nav)).toEqual([]);
          expect(ideaLinks(nav).map((link) => link.getAttribute('data-idea'))).toEqual(['tide-alerts']);
          expect(nav.querySelector('li[data-favorites-sep]')).toBeNull();
          expect(nav.querySelector('.picker-empty')).toBeNull();
          expect(document.activeElement?.getAttribute('data-idea')).toBe('tide-alerts');
        });

        it('shows the empty state only without spec and idea favourites, stale idea slugs included', async () => {
          const { api } = withIdeas([], ['gone']);
          const { nav } = await openSelect(api, '/w/harbor/s/002', 1440, WIDTHS[0][2]);
          expect(ideaLinks(nav)).toEqual([]);
          expect(nav.querySelector('p.picker-empty')).not.toBeNull();
          expect(document.activeElement).toBe(nav.querySelector('.picker-all'));
        });
      });
    });
  });

  it('walks the dashboard row order with ] and [ and leaves the spec with Esc', async () => {
    setUp();
    const { harness } = await open('/w/harbor/s/002/status');
    const router = TestBed.inject(Router);
    const press = async (key: string) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await harness.fixture.whenStable();
    };
    await press(']');
    expect(router.url).toBe('/w/harbor/s/003/status');
    await press('[');
    await press('[');
    expect(router.url).toBe('/w/harbor/s/004/status');
    await press('Escape');
    expect(router.url).toBe('/w/harbor');
  });
});
