import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { KeyboardService } from '../../core/keyboard.service';
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
