import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { tierFor } from './tier';

/** Stands in for the browser's ResizeObserver: the test decides the shell container's width. */
class FakeResizeObserver {
  static last: FakeResizeObserver | null = null;
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }
  observe(): void {
    // The test calls resize() itself.
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
    { id: '004', title: 'Retention policies', type: 'feature', stage: 'code-review' },
    { id: '002', title: 'Web console', type: 'feature', stage: 'build' },
    { id: '003', title: 'Config loader', type: 'refactor', stage: 'tasks' },
  ],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'spec'>;

function fakeApi(overrides: Partial<FakeApi> = {}): FakeApi {
  return {
    workspaces: () =>
      Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(HARBOR) : { kind: 'not-found', served: true }),
    // The stub today: no spec route, the server's catch-all 404.
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    ...overrides,
  };
}

let realResizeObserver: typeof ResizeObserver | undefined;
/** One harness per test (the router harness allows no second); `open` navigates it. */
let current: RouterTestingHarness | null = null;

function setUp(api: FakeApi = fakeApi()): void {
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

  it('renders exactly one header with the eight data-control slots on every route', async () => {
    setUp();
    for (const url of ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/nope']) {
      const { root } = await open(url);
      expect(root.querySelectorAll('header'), url).toHaveLength(1);
      const controls = [...root.querySelectorAll('header [data-control]')].map((el) => el.getAttribute('data-control'));
      expect(controls, url).toEqual(['brand', 'workspace', 'spec', 'area', 'palette', 'live', 'zen', 'settings']);
    }
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

  it('puts the tab bar in the header at compact and in main at medium and wide', async () => {
    setUp();
    const { root, harness } = await open('/w/harbor/s/002/status', 390);
    expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
    expect(root.querySelector('header app-tab-bar')).not.toBeNull();

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
    expect(texts(links)).toEqual(['Claims', 'Tasks', 'Evidence']);
    expect(links[0].getAttribute('aria-current')).toBe('page');
    expect(links[1].getAttribute('aria-current')).toBeNull();
    expect(links[1].getAttribute('href')).toBe('/w/harbor/s/002/tasks');
  });

  it('draws no tab bar for the spec dashboard and redirects an area name to its first tab', async () => {
    setUp();
    const { root } = await open('/w/harbor/s/002');
    expect(root.querySelector('app-tab-bar')).toBeNull();
    expect(root.querySelector('[data-page="placeholder"]')?.getAttribute('data-area')).toBe('dashboard');

    const { root: docs } = await open('/w/harbor/s/002/docs');
    expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/plan');
    expect(texts(docs.querySelectorAll('app-tab-bar a'))).toEqual(['Plan', 'Design', 'Decisions', 'Constitution']);
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

  it('marks unbuilt areas as coming with later tasks', async () => {
    setUp();
    const { root } = await open('/w/harbor/s/002/board');
    expect(root.querySelector('[data-page="placeholder"]')?.textContent).toContain("Comes with this spec's later tasks");
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
