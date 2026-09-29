import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, SETTINGS_URL, SettingsService } from './settings.service';
import { DARK_QUERY, ThemeService } from './theme.service';

/** A `MediaQueryList` the test drives: `setDark` flips `matches` and fires `change`, as the OS switch does. */
class FakeMediaQueryList extends EventTarget {
  constructor(
    readonly media: string,
    public matches: boolean,
  ) {
    super();
  }

  setDark(dark: boolean): void {
    this.matches = dark;
    this.dispatchEvent(Object.assign(new Event('change'), { matches: dark, media: this.media }));
  }
}

describe('ThemeService', () => {
  let system: FakeMediaQueryList;
  let http: HttpTestingController;
  let html: HTMLElement;

  const start = (systemDark: boolean) => {
    system = new FakeMediaQueryList(DARK_QUERY, systemDark);
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => {
        expect(query).toBe(DARK_QUERY);
        return system;
      }),
    );
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();
    return theme;
  };

  const loadStored = async (theme: 'system' | 'light' | 'dark') => {
    const loading = TestBed.inject(SettingsService).load();
    http.expectOne(SETTINGS_URL).flush({ ...DEFAULT_SETTINGS, theme });
    await loading;
    TestBed.tick();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    html = TestBed.inject(DOCUMENT).documentElement;
    html.removeAttribute('data-theme');
  });

  afterEach(() => {
    http.verify();
    vi.unstubAllGlobals();
    html.removeAttribute('data-theme');
  });

  it('starts in system mode and writes the system theme to <html data-theme>', () => {
    const theme = start(true);

    expect(theme.mode()).toBe('system');
    expect(theme.resolved()).toBe('dark');
    expect(html.getAttribute('data-theme')).toBe('spec-dark');
  });

  it('follows a prefers-color-scheme change while the page is open, both ways (ISC-18.1)', () => {
    const theme = start(false);
    expect(html.getAttribute('data-theme')).toBe('spec-light');

    system.setDark(true);
    TestBed.tick();
    expect(theme.resolved()).toBe('dark');
    expect(html.getAttribute('data-theme')).toBe('spec-dark');

    system.setDark(false);
    TestBed.tick();
    expect(theme.resolved()).toBe('light');
    expect(html.getAttribute('data-theme')).toBe('spec-light');
  });

  it('takes the stored mode from /api/settings, and a chosen mode wins over the system', async () => {
    const theme = start(true);
    await loadStored('light');

    expect(theme.mode()).toBe('light');
    expect(html.getAttribute('data-theme')).toBe('spec-light');

    system.setDark(false);
    system.setDark(true);
    TestBed.tick();
    expect(theme.resolved()).toBe('light');
    expect(html.getAttribute('data-theme')).toBe('spec-light');
  });

  it('returns to following the system when the mode goes back to system', async () => {
    const theme = start(false);
    await loadStored('dark');
    expect(html.getAttribute('data-theme')).toBe('spec-dark');

    const saving = theme.setMode('system');
    http.expectOne({ method: 'PUT', url: SETTINGS_URL }).flush({ ...DEFAULT_SETTINGS, theme: 'system' });
    await saving;
    TestBed.tick();
    expect(html.getAttribute('data-theme')).toBe('spec-light');

    system.setDark(true);
    TestBed.tick();
    expect(html.getAttribute('data-theme')).toBe('spec-dark');
  });

  it('persists setMode through a PUT to /api/settings and applies it before the answer', async () => {
    const theme = start(false);

    const saving = theme.setMode('dark');
    TestBed.tick();
    expect(html.getAttribute('data-theme')).toBe('spec-dark');

    const request = http.expectOne({ method: 'PUT', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ theme: 'dark' });
    request.flush({ ...DEFAULT_SETTINGS, theme: 'dark' });

    await expect(saving).resolves.toBe(true);
    expect(theme.mode()).toBe('dark');
  });

  it('falls back to light where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined);
    const theme = TestBed.inject(ThemeService);
    TestBed.tick();

    expect(theme.resolved()).toBe('light');
    expect(html.getAttribute('data-theme')).toBe('spec-light');
  });
});
