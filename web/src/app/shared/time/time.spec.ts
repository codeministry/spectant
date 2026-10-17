import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { formatClock, formatDate, formatInstant } from './format';
import { UiTime } from './time';

const ISO = '2026-10-01T12:05:00.000Z';

describe('UiTime', () => {
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

  async function render(value: string, form?: 'instant' | 'date' | 'clock' | 'day'): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(UiTime);
    fixture.componentRef.setInput('value', value);
    if (form) fixture.componentRef.setInput('form', form);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders a time element whose datetime is exactly the ISO value, as an instant by default', async () => {
    const host = await render(ISO);
    const time = host.querySelector('time');

    expect(time?.getAttribute('datetime')).toBe(ISO);
    expect(time?.textContent).toBe(formatInstant(ISO, 'en'));
  });

  it('renders the date and the clock form', async () => {
    expect((await render(ISO, 'date')).querySelector('time')?.textContent).toBe(formatDate(ISO, 'en'));
    expect((await render(ISO, 'clock')).querySelector('time')?.textContent).toBe(formatClock(ISO, 'en'));
  });

  it('follows the active language when it switches', async () => {
    const fixture = TestBed.createComponent(UiTime);
    fixture.componentRef.setInput('value', ISO);
    await fixture.whenStable();

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).querySelector('time')?.textContent).toBe(formatInstant(ISO, 'de'));
  });

  it('renders a value that is not a date as raw text without a time element', async () => {
    const host = await render('soon');

    expect(host.querySelector('time')).toBeNull();
    expect(host.textContent).toBe('soon');
  });

  it('keeps a calendar day as its raw value in a time element until formatDay lands', async () => {
    const time = (await render('2026-12-31', 'day')).querySelector('time');

    expect(time?.getAttribute('datetime')).toBe('2026-12-31');
    expect(time?.textContent).toBe('2026-12-31');
  });
});
