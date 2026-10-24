import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import frames from '../../../../../../../core/fixtures/harbor.frames.golden.json';
import live from '../../../../../../../core/fixtures/harbor.live.golden.json';
import type { Frame, LiveFrame, TaskSteps } from '../../../../../../../core/src/files';
import { ApiClient } from '../../../../core/api.service';
import { RefreshService } from '../../../../layout/shell/refresh.service';
import { type Density, SETTINGS_URL, SettingsService } from '../../../../core/settings.service';
import { ShellData } from '../../../../layout/shell/shell-data.service';
import { RailContent } from '../../../../layout/shell/rail-content';
import { ShellState } from '../../../../layout/shell/shell-state.service';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { BoardTab } from './board-tab';

// Spec 021 · T47 · ISC-254: board and flow view take the stored density as their default; `?density=` overrides it
// for the current view only, and the density switch in the board head writes only `?density=`, never the setting.

const KEY = 'specs/002-web-console';
const HISTORY = (frames as unknown as Record<string, Frame[]>)[KEY] ?? [];
const LIVE = (live as unknown as Record<string, LiveFrame>)[KEY];
// The live answer the stubbed client sends; spec 015 adds every task's steps beside the frame.
let liveBody: LiveFrame & { steps?: TaskSteps } = LIVE;

interface Harness {
  fixture: ComponentFixture<BoardTab>;
  host: HTMLElement;
  router: Router;
  http: HttpTestingController;
}

// The frames resources resolve after the first render; give them a few turns before reading the board.
async function settle(fixture: ComponentFixture<BoardTab>): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function render(url: string, stored: Density, zen = false): Promise<Harness> {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ApiClient,
        useValue: {
          frames: () => Promise.resolve({ kind: 'ok', body: HISTORY }),
          live: () => Promise.resolve({ kind: 'ok', body: liveBody }),
          // The operator steps and the card detail read the tasks tab; the density probe needs none of it.
          tasks: () => Promise.resolve({ kind: 'error', status: 404 }),
        },
      },
      { provide: ShellState, useValue: { ws: signal('harbor'), specId: signal('002'), tier: signal('wide'), zen: signal(zen) } },
      { provide: ShellData, useValue: { spec: { value: () => undefined }, specRows: () => [], archiveRows: () => [], planningModel: () => null } },
      { provide: RefreshService, useValue: { lastRefresh: signal(0), refreshes: signal(0) } },
    ],
  });
  const http = TestBed.inject(HttpTestingController);
  const settings = TestBed.inject(SettingsService);
  const loaded = settings.load();
  http.expectOne((r) => r.method === 'GET' && r.url === SETTINGS_URL).flush({ density: stored });
  await loaded;
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(BoardTab);
  await settle(fixture);
  return { fixture, host: fixture.nativeElement as HTMLElement, router, http };
}

const switchOf = (host: HTMLElement): HTMLButtonElement | null => host.querySelector<HTMLButtonElement>('button[data-density]');
// The operator's "Your steps" checklist keeps its own `step` cards whatever the density; every other card follows it.
const cardDensities = (host: HTMLElement, scope = ''): string[] =>
  [...host.querySelectorAll<HTMLElement>(`${scope} app-board-card:not([data-density='step'])`)].map((c) => c.getAttribute('data-density') ?? '');
const noSettingsWrite = (http: HttpTestingController): void => {
  expect(http.match((r) => r.url === SETTINGS_URL && r.method !== 'GET')).toEqual([]);
};

describe('BoardTab density (spec 021, T47, ISC-254)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('without ?density= the board takes the stored setting', async () => {
    const { host, http } = await render('/', 'compact');
    expect(switchOf(host)?.getAttribute('aria-pressed')).toBe('true');
    const densities = cardDensities(host);
    expect(densities.length).toBeGreaterThan(0);
    expect(new Set(densities)).toEqual(new Set(['compact']));
    noSettingsWrite(http);
  });

  it('without ?density= the flow view takes the stored setting', async () => {
    const { host } = await render('/?view=flow', 'compact');
    const densities = cardDensities(host, 'app-flow-view');
    expect(densities.length).toBeGreaterThan(0);
    expect(new Set(densities)).toEqual(new Set(['compact']));
  });

  it('a comfortable setting stays comfortable on board and flow view', async () => {
    const { host } = await render('/?view=flow', 'comfortable');
    expect(switchOf(host)?.getAttribute('aria-pressed')).toBe('false');
    expect(new Set(cardDensities(host, 'app-flow-view'))).toEqual(new Set(['comfortable']));
  });

  it('?density=compact overrides a comfortable setting for this view and writes no setting', async () => {
    const { host, http } = await render('/?density=compact', 'comfortable');
    expect(switchOf(host)?.getAttribute('aria-pressed')).toBe('true');
    expect(new Set(cardDensities(host))).toEqual(new Set(['compact']));
    expect(TestBed.inject(SettingsService).settings().density).toBe('comfortable');
    noSettingsWrite(http);
  });

  it('?density=comfortable overrides a compact setting; an unknown value falls back to the setting', async () => {
    const first = await render('/?density=comfortable', 'compact');
    expect(switchOf(first.host)?.getAttribute('aria-pressed')).toBe('false');
    await first.router.navigateByUrl('/?density=dense');
    await settle(first.fixture);
    expect(switchOf(first.host)?.getAttribute('aria-pressed')).toBe('true');
  });

  it('the head switch changes only ?density= and never PUTs the setting', async () => {
    const { host, router, fixture, http } = await render('/?view=flow', 'comfortable');
    const query = (): Record<string, string> => ({ ...router.parseUrl(router.url).queryParams });

    switchOf(host)?.click();
    await settle(fixture);
    expect(query()).toEqual({ view: 'flow', density: 'compact' });
    expect(new Set(cardDensities(host, 'app-flow-view'))).toEqual(new Set(['compact']));
    noSettingsWrite(http);

    // Back on the stored value the param goes, so the view follows the setting again.
    switchOf(host)?.click();
    await settle(fixture);
    expect(query()).toEqual({ view: 'flow' });
    expect(TestBed.inject(SettingsService).settings().density).toBe('comfortable');
    noSettingsWrite(http);
    http.verify();
  });

  it('with a compact setting the switch sets ?density=comfortable explicitly', async () => {
    const { host, router, fixture, http } = await render('/', 'compact');
    switchOf(host)?.click();
    await settle(fixture);
    expect(router.parseUrl(router.url).queryParams).toEqual({ density: 'comfortable' });
    expect(switchOf(host)?.getAttribute('aria-pressed')).toBe('false');
    expect(new Set(cardDensities(host))).toEqual(new Set(['comfortable']));
    noSettingsWrite(http);
  });
});

describe('BoardTab agent steps (spec 015, ISC-232)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })),
    );
    const steps: TaskSteps = Object.fromEntries(LIVE.cards.map((c) => [c.task, [{ kind: 'probe', ts: '2026-10-19T12:32:05Z', actor: 'a:claude:sess-2', result: 'green' }]]));
    liveBody = { ...LIVE, steps };
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    liveBody = LIVE;
  });

  it('the live answer’s steps reach the cards of the live frame, and a past frame names no latest step', async () => {
    const live = await render('/', 'comfortable');
    expect(live.host.querySelectorAll('app-board-card:not([data-density="step"]) [data-card-latest-step]').length).toBeGreaterThan(0);
    expect(live.host.querySelector('[data-card-latest-step] [data-step-word]')?.textContent.trim()).toBe('Probe green');
    TestBed.resetTestingModule();
    const past = await render('/?frame=0', 'comfortable');
    expect(past.host.querySelectorAll('app-board-card').length).toBeGreaterThan(0);
    expect(past.host.querySelector('[data-card-latest-step]')).toBeNull();
  });
});

// Spec 047 · ISC-279, spec 075 · ISC-634: the scrub row stands whole in zen and out of it (the frame bar that stepped
// the frames in zen is gone), and the board registers no rail blocks, bar or badges with the shell.
describe('BoardTab scrub row in zen (spec 047, spec 075)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const scrubParts = (host: HTMLElement): number[] =>
    ['.scrub', 'ui-scrubber', '[data-frame-chip]', '[data-progress]'].map((sel) => host.querySelectorAll(sel).length);

  it('ISC-634: in zen the scrub row stands whole and no rail block, bar or badge is registered', async () => {
    const { host } = await render('/', 'comfortable', true);
    expect(scrubParts(host)).toEqual([1, 1, 1, 1]);
    const rail = TestBed.inject(RailContent);
    expect([rail.blocks(), rail.bar(), rail.badges()]).toEqual([null, null, null]);
    expect(host.querySelector('app-live-rail, app-frame-bar, [data-bottom-bar]')).toBeNull();
  });

  it('ISC-279: out of zen the scrub row stands whole', async () => {
    const { host } = await render('/', 'comfortable');
    expect(scrubParts(host)).toEqual([1, 1, 1, 1]);
  });
});
