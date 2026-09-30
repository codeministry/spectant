import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { KeyboardService } from '../../core/keyboard.service';
import { LockSourceService } from '../../core/lock-source.service';
import { navigatesNatively } from './shell-nav';
import { AREA_IDS } from './areas';
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

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'timeline' | 'claims' | 'docs'>;

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
    docs: () => Promise.resolve({ kind: 'not-found', served: false }),
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
    for (const url of ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/settings', '/nope']) {
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

    it('makes the spec picker a link to the open spec, the workspace spec list, or a disabled placeholder', async () => {
      setUp();
      const { root: home } = await open('/');
      const none = control(home, 'spec');
      expect(none.tagName).toBe('BUTTON');
      expect(none.getAttribute('aria-disabled')).toBe('true');
      expect(none.getAttribute('title')).toBe('Open a workspace to pick a spec');

      const { root: workspace } = await open('/w/harbor');
      expect(control(workspace, 'spec').tagName).toBe('A');
      expect(control(workspace, 'spec').getAttribute('href')).toBe('/w/harbor#specs');
      expect(workspace.querySelector('[data-page="workspace"] h2#specs')).not.toBeNull();

      const { root: spec } = await open('/w/harbor/s/002/claims');
      expect(control(spec, 'spec').tagName).toBe('A');
      expect(control(spec, 'spec').getAttribute('href')).toBe('/w/harbor/s/002');
      expect(control(spec, 'spec').textContent).toContain('Web console');
    });

    it('keeps the area menu disabled with its reason while no workspace is open', async () => {
      setUp();
      const { root } = await open('/');
      const area = control(root, 'area');
      expect(area.getAttribute('aria-disabled')).toBe('true');
      expect(area.getAttribute('title')).toBe('Open a spec to switch areas');
      expect(root.querySelector('header nav[aria-label="Areas"]')).toBeNull();
    });

    it('keeps the area menu disabled with its reason for a workspace the server does not know', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      try {
        setUp();
        for (const url of ['/w/nope', '/w/nope/features']) {
          const { root, harness } = await open(url);
          const area = control(root, 'area');
          expect(area.getAttribute('aria-disabled')).toBe('true');
          expect(area.getAttribute('title')).toBe('Open a workspace to switch pages');
          expect(area.getAttribute('aria-label')).toBe('Areas');
          expect(area.textContent).not.toContain('Specs');
          area.click();
          await harness.fixture.whenStable();
          expect(root.querySelector('app-area-menu')).toBeNull();
          expect(root.querySelector('header nav[aria-label="Areas"]')).toBeNull();
        }
      } finally {
        delete proto['showPopover'];
      }
    });

    it('enables the area trigger at workspace scope and names the current page', async () => {
      setUp();
      const { root } = await open('/w/harbor');
      const area = control(root, 'area');
      expect(area.getAttribute('aria-disabled')).toBeNull();
      expect(area.textContent).toContain('Specs');
      expect(area.getAttribute('aria-expanded')).toBe('false');
      expect(area.getAttribute('aria-label')).toBe('Page: Specs');
    });

    it('opens the area menu at workspace scope: Specs and Features while no milestone exists', async () => {
      const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
      proto['showPopover'] = vi.fn();
      proto['hidePopover'] = vi.fn(function (this: HTMLElement) {
        this.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed', oldState: 'open' }));
      });
      try {
        setUp();
        const { root, harness } = await open('/w/harbor');
        const trigger = control(root, 'area');
        await harness.fixture.whenStable();
        trigger.click();
        await harness.fixture.whenStable();
        expect(trigger.getAttribute('aria-expanded')).toBe('true');
        const entries = [...root.querySelectorAll('header nav[aria-label="Areas"] [data-page]')];
        expect(entries.map((entry) => entry.getAttribute('data-page'))).toEqual(['specs', 'features']);
        expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual(['page', null]);
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
        expect(entries.map((entry) => entry.getAttribute('data-area'))).toEqual(['dashboard', 'status', 'live', 'data', 'docs', 'notes']);
        expect(entries.map((entry) => entry.tagName)).toEqual(['A', 'A', 'A', 'A', 'A', 'A']);
        expect(entries.map((entry) => entry.getAttribute('href'))).toEqual([
          '/w/harbor/s/002',
          '/w/harbor/s/002/status',
          '/w/harbor/s/002/board',
          '/w/harbor/s/002/claims',
          '/w/harbor/s/002/plan',
          '/w/harbor/s/002/notes',
        ]);
        expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual([null, null, null, 'page', null, null]);
        expect(entries.map((entry) => entry.getAttribute('aria-disabled'))).toEqual([null, null, null, null, null, null]);
        expect(entries.map((entry) => entry.querySelector('.dot')?.getAttribute('data-dot'))).toEqual([...AREA_IDS]);
        expect(texts(nav?.querySelectorAll('[data-area] .sub') as NodeListOf<Element>)).toEqual([
          'Where the spec stands at a glance',
          'Stage, gates and timeline',
          'Agents at work, board and matrix',
          'Claims, tasks and evidence',
          'Plan, design, decisions, constitution',
          'Your notes on this spec',
        ]);
        expect(texts(nav?.querySelectorAll('[data-area] .entry-name') as NodeListOf<Element>)).toEqual([
          'Dashboard',
          'Status',
          'Live',
          'Data',
          'Docs',
          'Notes',
        ]);

        (entries[4] as HTMLElement).click();
        await harness.fixture.whenStable();
        expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/plan');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
      } finally {
        delete proto['showPopover'];
        delete proto['hidePopover'];
      }
    });

    it('links the live indicator to the live board only while a spec is open', async () => {
      setUp();
      const { root: workspace } = await open('/w/harbor');
      expect(control(workspace, 'live').tagName).toBe('SPAN');

      const { root: spec } = await open('/w/harbor/s/002/status');
      const live = control(spec, 'live');
      expect(live.tagName).toBe('A');
      expect(live.getAttribute('href')).toBe('/w/harbor/s/002/board');
      expect(live.getAttribute('title')).toBe('No agent source, open the live board');
      expect(live.getAttribute('data-source')).toBe('none');
    });

    it('links settings to the settings page, which renders inside the shell', async () => {
      setUp();
      const { root, harness } = await open('/w/harbor');
      const settings = control(root, 'settings');
      expect(settings.tagName).toBe('A');
      expect(settings.getAttribute('href')).toBe('/settings');
      expect(settings.getAttribute('aria-disabled')).toBeNull();
      expect(settings.getAttribute('aria-label')).toBe('Settings and help');

      settings.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/settings');
      const page = root.querySelector('[data-page="settings"]');
      expect(page?.querySelector('h1')?.textContent).toContain('Settings');
      expect(page?.textContent).toContain('Settings, workspaces and help come with later tasks of this spec');
      expect(page?.querySelector('a')?.getAttribute('href')).toBe('/');
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
      expect(entries.map((entry) => entry.getAttribute('href'))).toEqual(['/', '/w/harbor', '/w/lantern']);
      expect(texts(list?.querySelectorAll('.entry-name') as NodeListOf<Element>)).toEqual(['All workspaces', 'harbor', 'lantern']);
      expect(texts(list?.querySelectorAll('.entry-meta') as NodeListOf<Element>)).toEqual(['Specs: 3', 'Cannot be read']);
      expect(entries.map((entry) => entry.getAttribute('aria-current'))).toEqual([null, 'true', null]);
      expect(document.activeElement).toBe(entries[1]);
      const footer = list?.querySelector('[data-picker-footer]');
      expect(footer?.getAttribute('href')).toBe('/settings');
      expect(footer?.textContent).toContain('Manage workspaces');

      entries[2]?.click();
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
      expect(list?.querySelector('.picker-all')?.getAttribute('href')).toBe('/w/harbor#specs');
      expect(list?.querySelector('.picker-all')?.textContent).toContain('All specs in harbor');
      const rows = [...(list?.querySelectorAll<HTMLAnchorElement>('[data-spec]') ?? [])];
      expect(rows.map((row) => row.getAttribute('data-spec'))).toEqual(['004', '002', '003']);
      expect(rows.map((row) => row.getAttribute('href'))).toEqual(['/w/harbor/s/004', '/w/harbor/s/002', '/w/harbor/s/003']);
      expect(texts(list?.querySelectorAll('[data-spec] .entry-name') as NodeListOf<Element>)).toEqual([
        'Retention policies',
        'Web console',
        'Config loader',
      ]);
      expect(texts(list?.querySelectorAll('[data-spec] ui-chip') as NodeListOf<Element>)).toEqual(['Code review', 'Build', 'Tasks']);
      expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual([null, 'true', null]);
      expect(document.activeElement).toBe(rows[1]);

      rows[2]?.click();
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/003');
    });

    it('opens the pickers as bottom sheets at compact, focused on the current entry', async () => {
      setUp(TWO);
      const { root, harness } = await open('/w/harbor/s/002', 390);
      // The workspace and spec pickers, and the area menu (T37): all three are bottom sheets at compact.
      expect(root.querySelectorAll('ui-sheet')).toHaveLength(3);
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
      expect(keys).toEqual([null, 'g s', 'g l', 'g d', 'g o', 'g n']);
      expect(root.querySelector('header nav[aria-label="Areas"] ui-kbd')?.getAttribute('aria-hidden')).toBe('true');
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
        expect(live.querySelector('.visually-hidden')?.textContent, source).toContain(
          { none: 'No agent source', activity: 'activity log', frontier: 'LifeOS frontier locks' }[source],
        );
      }
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
