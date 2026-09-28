import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../i18n/catalogues';
import { HelloComponent } from './hello';

describe('HelloComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
    });
  });

  it('renders the Spectant heading and the greeting from the English catalogue', async () => {
    const fixture = TestBed.createComponent(HelloComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('h1')?.textContent.trim()).toBe('Spectant');
    expect(host.textContent).toContain('hello, spectant');
  });

  it('re-renders in German when the active language changes', async () => {
    const fixture = TestBed.createComponent(HelloComponent);
    await fixture.whenStable();

    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('hallo, spectant');
  });
});
