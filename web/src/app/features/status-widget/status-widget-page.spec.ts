import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { type ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveUpdate } from '../../../../../server/src/contracts/spec-routes.contract';
import { STATUS_PATH, type StatusResponse } from '../../../../../server/src/contracts/status.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, WORKSPACES_URL } from '../../core/api.service';
import { LiveStreamService } from '../../core/live-stream.service';
import { RefreshService } from '../../layout/shell/refresh.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { WIDGET_BOUNDS_KEY } from '../../layout/shell/widget-window';
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
  nextCommand: `/spec implement ${id}`,
  ...over,
});

const done = (id: string, title: string): Spec =>
  spec(id, title, { stage: 'done', claims: { closed: 4, total: 4 }, closedAt: '2026-10-23T08:00:00.000Z', state: 'done', archived: true, nextCommand: null });

/** Three workspaces: harbor lists open and closed specs, lantern lists none, beacon cannot be read (T26, T27, T30). */
const MIXED: StatusResponse = {
  kpis: { repos: 1, listed: 3, claimsClosed: 6, claimsTotal: 10 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit'), done('001', 'Init')] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [] },
    { slug: 'beacon', pathTail: 'beacon', readable: false, error: 'unreadable', specs: [] },
  ],
};

/** No workspace lists a spec and every one is readable (T30). */
const EMPTY: StatusResponse = {
  kpis: { repos: 0, listed: 0, claimsClosed: 0, claimsTotal: 0 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor-app', readable: true, error: null, specs: [] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [] },
  ],
};

const BODY: StatusResponse = {
  kpis: { repos: 2, listed: 3, claimsClosed: 3, claimsTotal: 9 },
  workspaces: [
    { slug: 'harbor', pathTail: 'harbor', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit')] },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('001', 'Beam')] },
  ],
};

describe('StatusWidgetPage on /widget (spec 071, T25, ISC-582)', () => {
  let calls: number;

  async function land(body: StatusResponse = BODY, lang: (typeof LANGS)[number] = 'en'): Promise<RouterTestingHarness> {
    calls = 0;
    const api: Partial<ApiClient> = {
      status: (): Promise<ApiResult<StatusResponse>> => {
        calls += 1;
        return Promise.resolve({ kind: 'ok', body, etag: '"s1"', notModified: false });
      },
    };
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: lang }, preloadLangs: true })],
      providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
    });
    TestBed.inject(TranslocoService).setActiveLang(lang);
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

  it('renders outside the shell: no app-shell, no header but its own head, no nav', async () => {
    const rendered = (await land()).fixture.nativeElement as HTMLElement;
    expect(rendered.querySelector('app-status-widget-page main.widget')).not.toBeNull();
    expect(rendered.querySelector('app-shell')).toBeNull();
    expect([...rendered.querySelectorAll('header')].map((head) => head.closest('main.widget') !== null && head.matches('.head'))).toEqual([true]);
    expect(rendered.querySelector('nav')).toBeNull();
  });

  it('loads the status body once and lists each workspace with its spec ids, in the order answered', async () => {
    const root = (await land()).routeNativeElement as HTMLElement;
    expect(calls).toBe(1);
    const groups = [...root.querySelectorAll<HTMLElement>('section.groups [data-workspace]')];
    expect(groups.map((group) => group.dataset['workspace'])).toEqual(['harbor', 'lantern']);
    const ids = groups.map((group) => [...group.querySelectorAll<HTMLElement>('[data-spec]')].map((row) => row.dataset['spec']));
    expect(ids).toEqual([['002', '005'], ['001']]);
    expect(root.querySelector('header.head dl.kpis')).not.toBeNull();
  });

  /** Each figure of the head's flat row (spec 072, T9, ISC-602) as label, value and denominator, in row order. */
  const tiles = (root: HTMLElement): Array<{ label: string; value: string; den: string | null }> =>
    [...root.querySelectorAll<HTMLElement>('header.head dl.kpis > div.kpi')].map((kpi) => ({
      label: [...kpi.children].map((el) => el.tagName).join() === 'DT,DD' ? (kpi.querySelector('dt')?.textContent.trim() ?? '') : '!order',
      value: kpi.querySelector('dd')?.firstChild?.textContent?.trim() ?? '',
      den: kpi.querySelector('dd .den')?.textContent.trim().replace(/^\//, '') ?? null,
    }));

  it('heads the page with the brand mark first, then the flat KPI row and the filter button, no tiles and no accent (spec 072, T9, ISC-602)', async () => {
    const root = (await land(MIXED)).routeNativeElement as HTMLElement;
    const head = root.querySelector<HTMLElement>('main.widget header.head');
    expect([...(head?.children ?? [])].map((el) => el.tagName.toLowerCase())).toEqual(['ui-brand-mark', 'dl', 'button']);
    expect(head?.querySelector<HTMLElement>('ui-brand-mark')?.style.getPropertyValue('--brand-mark-size')).toBe('28px');
    expect(root.querySelectorAll('ui-kpi-tile, ui-card, header.head [data-accent], header.head [aria-live]')).toHaveLength(0);
    expect(head?.querySelectorAll('dl.kpis > div.kpi')).toHaveLength(3);
  });

  it('labels the KPI row in German too (spec 072, T9, ISC-602)', async () => {
    const root = (await land(MIXED, 'de')).routeNativeElement as HTMLElement;
    expect(tiles(root)).toEqual([
      { label: 'Repos', value: '1', den: null },
      { label: 'Specs', value: '3', den: null },
      { label: 'Claims', value: '6', den: '10' },
    ]);
  });

  it('shows the three KPIs of the body, which sum the listed rows (T26, ISC-583)', async () => {
    const root = (await land(MIXED)).routeNativeElement as HTMLElement;
    const { kpis } = MIXED;
    expect(tiles(root)).toEqual([
      { label: 'repos', value: String(kpis.repos), den: null },
      { label: 'specs', value: String(kpis.listed), den: null },
      { label: 'claims', value: String(kpis.claimsClosed), den: String(kpis.claimsTotal) },
    ]);
    const listed = MIXED.workspaces.filter((ws) => ws.readable).flatMap((ws) => ws.specs);
    const repos = MIXED.workspaces.filter((ws) => ws.readable && ws.specs.length > 0).length;
    const rendered = root.querySelectorAll('section.groups [data-spec]').length;
    expect(rendered).toBe(listed.length);
    expect([kpis.repos, kpis.listed, kpis.claimsClosed, kpis.claimsTotal]).toEqual([
      repos,
      listed.length,
      listed.reduce((sum, row) => sum + row.claims.closed, 0),
      listed.reduce((sum, row) => sum + row.claims.total, 0),
    ]);
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
    expect(tiles(root).map((tile) => tile.value)).toEqual(['1', '3', '6']);
    expect(root.querySelector('section.groups .meta')).toBeNull();
  });

  it('shows one empty line instead of an empty list when no workspace lists a spec (T30, ISC-588)', async () => {
    const root = (await land(EMPTY)).routeNativeElement as HTMLElement;
    const lines = root.querySelectorAll<HTMLElement>('section.groups .meta');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent.trim()).toBe('No open specs.');
    expect(root.querySelectorAll('section.groups [data-workspace], section.groups h2, section.groups ul')).toHaveLength(0);
    expect(tiles(root)).toEqual([
      { label: 'repos', value: '0', den: null },
      { label: 'specs', value: '0', den: null },
      { label: 'claims', value: '0', den: '0' },
    ]);
  });

  describe('status-widget specs kpi (spec 073, C4, ISC-615)', () => {
    /** Three workspaces, each listing open specs only: four rows in all. */
    const OPEN: StatusResponse = {
      kpis: { repos: 3, listed: 4, claimsClosed: 4, claimsTotal: 12 },
      workspaces: [
        { slug: 'harbor', pathTail: 'harbor', readable: true, error: null, specs: [spec('002', 'Console'), spec('005', 'Audit')] },
        { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('001', 'Beam')] },
        { slug: 'beacon', pathTail: 'beacon', readable: true, error: null, specs: [spec('003', 'Signal', { stage: 'plan' })] },
      ],
    };

    for (const [lang, label] of [
      ['en', 'specs'],
      ['de', 'Specs'],
    ] as const) {
      it(`shows "${label}" = the number of listed rows in the middle tile and no closed word in the head (${lang})`, async () => {
        const harness = await land(OPEN, lang);
        const root = harness.routeNativeElement as HTMLElement;
        const rows = root.querySelectorAll('section.groups [data-spec]').length;
        expect(rows).toBe(4);
        expect(tiles(root)[1]).toEqual({ label, value: String(rows), den: null });
        const head = root.querySelector<HTMLElement>('header.head dl.kpis');
        expect(head).not.toBeNull();
        const words = [head?.textContent ?? '', ...[...(head?.querySelectorAll('*') ?? [])].flatMap((el) => [...el.attributes].map((a) => a.value))].join(' ');
        expect(words).not.toMatch(/closed|geschlossen/i);
      });
    }
  });
});

/** The body after a change: 002 gains a claim, 005 moves to done (T34, ISC-587). */
const CHANGED: StatusResponse = {
  kpis: { repos: 2, listed: 3, claimsClosed: 7, claimsTotal: 10 },
  workspaces: [
    {
      slug: 'harbor',
      pathTail: 'harbor',
      readable: true,
      error: null,
      specs: [spec('002', 'Console', { claims: { closed: 2, total: 3 } }), done('005', 'Audit')],
    },
    { slug: 'lantern', pathTail: 'lantern', readable: true, error: null, specs: [spec('001', 'Beam')] },
  ],
};

/** The page over the real `ApiClient`, `RefreshService` and `ShellData`, with the stream and the shell state faked. */
describe('StatusWidgetPage live and bounds (spec 071, T34, ISC-587; T33, ISC-596)', () => {
  const connected = signal(true);
  const listeners = new Set<(update: LiveUpdate) => void>();
  const push = (update: LiveUpdate): void => listeners.forEach((listener) => listener(update));
  const onUpdate = (listener: (update: LiveUpdate) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  let http: HttpTestingController;

  beforeEach(() => {
    listeners.clear();
    TestBed.configureTestingModule({
      imports: [TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true })],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ShellState, useValue: { ws: signal(null), specId: signal(null) } },
        { provide: LiveStreamService, useValue: { connected, onUpdate } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  const settled = async (fixture: ComponentFixture<StatusWidgetPage>): Promise<void> => {
    await TestBed.inject(ApplicationRef).whenStable();
    TestBed.tick();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** Answers what the shell's own reads ask in the widget window: an empty workspace list, `{}` for the rest. */
  const answerOthers = (): void => {
    for (const request of http.match((req) => req.url !== STATUS_PATH)) {
      request.flush(request.request.url === WORKSPACES_URL ? [] : {}, { headers: { ETag: '"o0"' } });
    }
  };

  async function render(): Promise<ComponentFixture<StatusWidgetPage>> {
    const fixture = TestBed.createComponent(StatusWidgetPage);
    TestBed.tick();
    http.expectOne(STATUS_PATH).flush(BODY, { headers: { ETag: '"s0"' } });
    answerOthers();
    await settled(fixture);
    return fixture;
  }

  const kpis = (root: HTMLElement): string[] =>
    [...root.querySelectorAll<HTMLElement>('header.head dl.kpis dd')].map((dd) => dd.textContent.replace(/\s+/g, ''));
  const row = (root: HTMLElement, id: string): { count: string; stage: string } => {
    const entry = root.querySelector<HTMLElement>(`[data-workspace="harbor"] [data-spec="${id}"]`);
    return {
      count: entry?.querySelector('.entry-count')?.textContent.trim() ?? '',
      stage: entry?.querySelector('.entry-stage')?.textContent.trim() ?? '',
    };
  };

  it("a live frame carrying the status view re-reads it with the frame's ETag and renders its body in place", async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    const main = root.querySelector('main.widget');
    expect(kpis(root)).toEqual(['2', '3', '3/9']);
    expect(row(root, '002')).toEqual({ count: '1/3', stage: 'Build' });

    push({ ws: 'harbor', views: [{ path: STATUS_PATH, etag: '"s1"', body: CHANGED }] });
    TestBed.tick();
    const reread = http.expectOne(STATUS_PATH);
    expect(reread.request.headers.get('If-None-Match')).toBe('"s1"');
    reread.flush(null, { status: 304, statusText: 'Not Modified' });
    answerOthers();
    await settled(fixture);

    expect(kpis(root)).toEqual(['2', '3', '7/10']);
    expect(row(root, '002')).toEqual({ count: '2/3', stage: 'Build' });
    expect(row(root, '005')).toEqual({ count: '4/4', stage: 'Done' });
    expect(root.querySelector('main.widget')).toBe(main);
  });

  it('a refresh tick (the poll, the visibility refresh) re-reads the status and renders a changed answer', async () => {
    const fixture = await render();
    const root = fixture.nativeElement as HTMLElement;
    TestBed.inject(RefreshService).refresh();
    TestBed.tick();
    const reread = http.expectOne(STATUS_PATH);
    expect(reread.request.headers.get('If-None-Match')).toBe('"s0"');
    reread.flush(CHANGED, { headers: { ETag: '"s2"' } });
    answerOthers();
    await settled(fixture);
    expect(kpis(root)).toEqual(['2', '3', '7/10']);
    expect(row(root, '005').stage).toBe('Done');
  });

  it('announces no tick: no aria-live outside the copy chips (only a copy is announced, spec 072)', async () => {
    const root = (await render()).nativeElement as HTMLElement;
    expect([...root.querySelectorAll('[aria-live]')].filter((el) => el.closest('ui-command-chip') === null)).toHaveLength(0);
    expect(root.querySelectorAll('header.head [aria-live], section.groups > .group > [aria-live], ul.rows > [aria-live]')).toHaveLength(0);
  });

  /** Sets the window's outer size and position and the screen's available width as own, configurable properties. */
  const place = (outerWidth: number, outerHeight: number, screenX: number, screenY: number, availWidth = 1920): void => {
    for (const [key, value] of Object.entries({ outerWidth, outerHeight, screenX, screenY })) {
      Object.defineProperty(window, key, { configurable: true, value });
    }
    Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: availWidth });
  };
  /** The bounds the page wrote, parsed, in write order. */
  const boundsWrites = (setItem: { mock: { calls: unknown[][] } }): unknown[] =>
    setItem.mock.calls.filter(([key]) => key === WIDGET_BOUNDS_KEY).map(([, value]) => JSON.parse(String(value)) as unknown);

  it('saves the rounded bounds after a resize settles and again when the window closes (T33, ISC-596)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const fixture = await render();
    vi.useFakeTimers();
    try {
      place(500.4, 700.6, 100.2, 40.7);
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      expect(boundsWrites(setItem)).toEqual([]);
      vi.advanceTimersByTime(1000);
      expect(boundsWrites(setItem)).toEqual([{ width: 500, height: 701, left: 100, top: 41 }]);
      place(520, 720, 60, 30);
      window.dispatchEvent(new Event('pagehide'));
      expect(boundsWrites(setItem)).toEqual([
        { width: 500, height: 701, left: 100, top: 41 },
        { width: 520, height: 720, left: 60, top: 30 },
      ]);
      fixture.destroy();
      window.dispatchEvent(new Event('pagehide'));
      expect(boundsWrites(setItem)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves nothing in tab mode, the window as wide as the screen (T33, ISC-586.1)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await render();
    vi.useFakeTimers();
    try {
      place(390, 844, 0, 0, 390);
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(1000);
      window.dispatchEvent(new Event('pagehide'));
      expect(boundsWrites(setItem)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the page whole when the storage throws (T33, ISC-596)', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const fixture = await render();
    place(480, 720, 10, 10);
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    fixture.detectChanges();
    expect(kpis(fixture.nativeElement as HTMLElement)).toEqual(['2', '3', '3/9']);
  });
});
