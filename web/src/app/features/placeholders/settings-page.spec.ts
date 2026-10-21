import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { KeyboardService } from '../../layout/shell/keyboard.service';
import { DEFAULT_SETTINGS, SETTINGS_URL, SettingsService } from '../../core/settings.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ActorsSection } from '../settings/actors-section';
import { SettingsPage } from './settings-page';

/** The Actors card has its own spec; here it only holds its place. */
@Component({ selector: 'app-actors-section', template: '', changeDetection: ChangeDetectionStrategy.OnPush })
class ActorsStub {}

function setUp(): void {
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
      { provide: KeyboardService, useValue: { openSheet: () => undefined } },
      { provide: ShellData, useValue: { workspaceList: signal([]) } },
    ],
  });
  TestBed.overrideComponent(SettingsPage, { remove: { imports: [ActorsSection] }, add: { imports: [ActorsStub] } });
}

async function render() {
  const fixture = TestBed.createComponent(SettingsPage);
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

const radios = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('[data-setting="density"] [role="radio"]')];
const checked = (root: HTMLElement) => radios(root).find((b) => b.getAttribute('aria-checked') === 'true')?.textContent.trim();

describe('SettingsPage density (spec 021, T46, ISC-254)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows density as a stored setting beside theme and language: enabled, no demo chip, the stored value checked', async () => {
    setUp();
    const { fixture, root } = await render();
    const row = root.querySelector('[data-setting="density"]');
    expect(row).not.toBeNull();
    expect(row?.closest('fieldset[disabled]')).toBeNull();
    expect(row?.closest('[data-demo]')).toBeNull();
    expect(radios(root).map((b) => b.textContent.trim())).toEqual(['Comfortable', 'Compact']);
    expect(radios(root).every((b) => !b.disabled)).toBe(true);
    expect(checked(root)).toBe('Comfortable');

    const settings = TestBed.inject(SettingsService);
    const loading = settings.load();
    TestBed.inject(HttpTestingController).expectOne(SETTINGS_URL).flush({ ...DEFAULT_SETTINGS, density: 'compact' });
    await loading;
    await fixture.whenStable();
    expect(checked(root)).toBe('Compact');
  });

  it('stores the choice like the theme: one PUT of the density patch, the setting follows at once', async () => {
    setUp();
    const { fixture, root } = await render();
    radios(root)[1]?.click();
    await fixture.whenStable();

    const request = TestBed.inject(HttpTestingController).expectOne({ method: 'PUT', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ density: 'compact' });
    expect(TestBed.inject(SettingsService).settings().density).toBe('compact');
    request.flush({ ...DEFAULT_SETTINGS, density: 'compact' });
    await fixture.whenStable();
    expect(checked(root)).toBe('Compact');
  });

  it('keeps reduced motion in the demo block, with its chip, and density outside it', async () => {
    setUp();
    const { root } = await render();
    const demo = root.querySelector('[data-demo]');
    expect(demo?.querySelector('[data-demo-head] ui-chip')).not.toBeNull();
    expect(demo?.querySelector('fieldset[disabled] [role="switch"]')).not.toBeNull();
    expect(demo?.querySelector('ui-segmented')).toBeNull();
  });
});

const ageField = (root: HTMLElement) => root.querySelector<HTMLInputElement>('input[data-setting="stale-minutes"]');

/** Types `value` into the field and leaves it, as a user does: the native `change` fires on commit. */
function commit(field: HTMLInputElement, value: string): void {
  field.value = value;
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('change'));
}

describe('SettingsPage claim stale age (spec 032, T25, ISC-35)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows a labelled whole-minute field, 5 to 1440, with its hint, in its own Board card behind an anchor pill', async () => {
    setUp();
    const { root } = await render();
    const field = ageField(root);
    expect(field).not.toBeNull();
    expect(field?.type).toBe('number');
    expect([field?.min, field?.max, field?.step]).toEqual(['5', '1440', '1']);
    expect(field?.closest('section')?.id).toBe('board');
    expect(field?.labels?.[0]?.textContent.trim()).toBe('Stale after (minutes)');
    const hint = root.querySelector(`#${field?.getAttribute('aria-describedby') ?? 'none'}`);
    expect(hint?.textContent).toContain('A claim without a release older than this');
    expect(root.querySelector('[aria-labelledby="settings-board"] h2#settings-board')?.textContent.trim()).toBe('Board');
  });

  it('shows the stored age: the default 45 until the server answers, then the stored value', async () => {
    setUp();
    const { fixture, root } = await render();
    expect(ageField(root)?.value).toBe('45');

    const settings = TestBed.inject(SettingsService);
    const loading = settings.load();
    TestBed.inject(HttpTestingController).expectOne(SETTINGS_URL).flush({ ...DEFAULT_SETTINGS, staleMinutes: 90 });
    await loading;
    await fixture.whenStable();
    expect(ageField(root)?.value).toBe('90');
  });

  it('stores a valid age on commit: one PUT of the staleMinutes patch, the setting follows at once', async () => {
    setUp();
    const { fixture, root } = await render();
    const field = ageField(root);
    if (field === null) throw new Error('the age field is missing');
    commit(field, '20');
    await fixture.whenStable();

    const request = TestBed.inject(HttpTestingController).expectOne({ method: 'PUT', url: SETTINGS_URL });
    expect(request.request.body).toEqual({ staleMinutes: 20 });
    expect(TestBed.inject(SettingsService).settings().staleMinutes).toBe(20);
    request.flush({ ...DEFAULT_SETTINGS, staleMinutes: 20 });
    await fixture.whenStable();
    expect(field.getAttribute('aria-invalid')).toBeNull();
  });

  it.each(['4', '1441', '30.5', ''])('refuses %j without a PUT, marks the field invalid and names the range', async (value) => {
    setUp();
    const { fixture, root } = await render();
    const field = ageField(root);
    if (field === null) throw new Error('the age field is missing');
    commit(field, value);
    await fixture.whenStable();

    TestBed.inject(HttpTestingController).expectNone({ method: 'PUT', url: SETTINGS_URL });
    expect(TestBed.inject(SettingsService).settings().staleMinutes).toBe(45);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(root.querySelector('[data-setting-error="stale-minutes"]')?.textContent).toContain('5 to 1440');
  });

  it('sends nothing when the committed age is the stored one', async () => {
    setUp();
    const { fixture, root } = await render();
    const field = ageField(root);
    if (field === null) throw new Error('the age field is missing');
    commit(field, '45');
    await fixture.whenStable();
    TestBed.inject(HttpTestingController).expectNone({ method: 'PUT', url: SETTINGS_URL });
  });
});
