import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { relativeParts, UiRelativeTime } from './relative-time';

describe('UiRelativeTime', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
    });
  });

  it('buckets elapsed time into s, min, h and d', () => {
    const now = Date.UTC(2026, 8, 28, 12);
    expect(relativeParts(now - 12_000, now)).toEqual({ value: 12, unit: 's' });
    expect(relativeParts(now - 3 * 60_000, now)).toEqual({ value: 3, unit: 'min' });
    expect(relativeParts(now - 26 * 3_600_000, now)).toEqual({ value: 1, unit: 'd' });
  });

  it('renders a hidden time element with a machine-readable datetime', async () => {
    const fixture = TestBed.createComponent(UiRelativeTime);
    fixture.componentRef.setInput('date', new Date(Date.now() - 5_000));
    await fixture.whenStable();
    const time = (fixture.nativeElement as HTMLElement).querySelector('time');

    expect(time?.getAttribute('aria-hidden')).toBe('true');
    expect(time?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(time?.textContent).toMatch(/^\d+ s ago$/);
  });

  // Spec 066, T2 · ISC-518: the tile's waiting time reads "25 d" / „25 T", without "ago" or "waiting", from the
  // catalogue keys `relativeTime.short.*`, in the current language.
  it('renders the short format without "ago", in English and German', async () => {
    const fixture = TestBed.createComponent(UiRelativeTime);
    const time = () => (fixture.nativeElement as HTMLElement).querySelector('time')?.textContent;
    fixture.componentRef.setInput('format', 'short');
    const cases: Array<[number, string, string]> = [
      [25 * 86_400_000 + 60_000, '25 d', '25 T'],
      [3 * 3_600_000 + 5_000, '3 h', '3 Std.'],
      [12 * 60_000 + 5_000, '12 min', '12 Min.'],
      // A half-second margin: the component read its clock before this date was made.
      [7_500, '7 s', '7 s'],
    ];
    const transloco = TestBed.inject(TranslocoService);
    for (const [ago, en, de] of cases) {
      fixture.componentRef.setInput('date', new Date(Date.now() - ago));
      transloco.setActiveLang('en');
      await fixture.whenStable();
      expect(time()).toBe(en);
      transloco.setActiveLang('de');
      await fixture.whenStable();
      expect(time()).toBe(de);
    }
    transloco.setActiveLang('en');
  });

  it('keeps a passed format function as it is', async () => {
    const fixture = TestBed.createComponent(UiRelativeTime);
    fixture.componentRef.setInput('date', new Date(Date.now() - 2 * 86_400_000 - 60_000));
    fixture.componentRef.setInput('format', (value: number, unit: string) => `waiting ${value} ${unit}`);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('time')?.textContent).toBe('waiting 2 d');
  });
});
