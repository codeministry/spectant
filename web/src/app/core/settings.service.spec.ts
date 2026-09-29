import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_SETTINGS, type Settings, SETTINGS_URL, SettingsService } from './settings.service';

const stored: Settings = { theme: 'dark', language: 'de', refreshSeconds: 60, singleKeyShortcuts: false, railCollapsed: true, notesImportDismissed: true };

describe('SettingsService', () => {
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  /** The two PUTs in flight, in the order they were sent; fails the test on any other count. */
  const twoPuts = (): [TestRequest, TestRequest] => {
    const requests = http.match({ method: 'PUT', url: SETTINGS_URL });
    expect(requests).toHaveLength(2);
    return requests as [TestRequest, TestRequest];
  };

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('exposes the schema defaults until the server answers', () => {
    expect(DEFAULT_SETTINGS).toEqual({ theme: 'system', language: 'en', refreshSeconds: 30, singleKeyShortcuts: true, railCollapsed: false, notesImportDismissed: false });
    expect(service.settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('loads /api/settings once, relative to the page origin, and applies the stored values', async () => {
    const first = service.load();
    const second = service.load();

    const request = http.expectOne(SETTINGS_URL);
    expect(SETTINGS_URL).toBe('/api/settings');
    expect(request.request.method).toBe('GET');
    request.flush(stored);
    await Promise.all([first, second]);

    expect(service.settings()).toEqual(stored);
  });

  it('keeps the defaults when the server cannot be reached, without rejecting', async () => {
    const loading = service.load();
    http.expectOne(SETTINGS_URL).flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    await expect(loading).resolves.toBeUndefined();

    expect(service.settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('reads a malformed field as its default and keeps the valid ones', async () => {
    const loading = service.load();
    http.expectOne(SETTINGS_URL).flush({ theme: 'sepia', language: 'de', refreshSeconds: '10', extra: 1 });
    await loading;

    expect(service.settings()).toEqual({ ...DEFAULT_SETTINGS, language: 'de' });
  });

  it('applies an update at once, PUTs only the patch and reconciles with the full server answer', async () => {
    const saving = service.update({ theme: 'light' });

    expect(service.settings().theme).toBe('light'); // optimistic
    const request = http.expectOne({ method: 'PUT', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ theme: 'light' });
    request.flush({ ...DEFAULT_SETTINGS, theme: 'light', refreshSeconds: 45 });

    await expect(saving).resolves.toBe(true);
    expect(service.settings()).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', refreshSeconds: 45 });
  });

  it('rolls a refused update back and resolves false', async () => {
    const saving = service.update({ theme: 'dark', language: 'de' });
    expect(service.settings().theme).toBe('dark');

    http
      .expectOne({ method: 'PUT', url: SETTINGS_URL })
      .flush({ error: 'invalid-value', key: 'theme' }, { status: 400, statusText: 'Bad Request' });

    await expect(saving).resolves.toBe(false);
    expect(service.settings()).toEqual(DEFAULT_SETTINGS);
  });

  it('lets the latest update win when an earlier answer arrives late', async () => {
    const first = service.update({ theme: 'light' });
    const second = service.update({ theme: 'dark' });
    const [early, late] = twoPuts();

    late.flush({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await second;
    early.flush({ ...DEFAULT_SETTINGS, theme: 'light' });
    await first;

    expect(service.settings().theme).toBe('dark');
  });

  it('rolls back only the keys a failed update still owns', async () => {
    const failing = service.update({ theme: 'light' });
    const winning = service.update({ theme: 'dark' });
    const [early, late] = twoPuts();

    early.error(new ProgressEvent('error'));
    await expect(failing).resolves.toBe(false);
    expect(service.settings().theme).toBe('dark');

    late.flush({ ...DEFAULT_SETTINGS, theme: 'dark' });
    await expect(winning).resolves.toBe(true);
  });

  it('never keeps settings in browser storage, so they survive a port change (ISC-18.3)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    const loading = service.load();
    http.expectOne(SETTINGS_URL).flush(stored);
    await loading;
    const saving = service.update({ theme: 'light' });
    http.expectOne({ method: 'PUT', url: SETTINGS_URL }).flush({ ...stored, theme: 'light' });
    await saving;

    expect(setItem).not.toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });
});
