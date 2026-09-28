import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../i18n/catalogues';
import { LanguageService } from './language.service';

describe('LanguageService', () => {
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

  it('defaults to English and lists both languages', () => {
    const language = TestBed.inject(LanguageService);
    expect(language.current()).toBe('en');
    expect(language.available).toEqual(['en', 'de']);
  });

  it('switches Transloco, the current signal and the document language', () => {
    const language = TestBed.inject(LanguageService);
    const transloco = TestBed.inject(TranslocoService);

    language.set('de');

    expect(transloco.getActiveLang()).toBe('de');
    expect(language.current()).toBe('de');
    expect(TestBed.inject(DOCUMENT).documentElement.lang).toBe('de');
    expect(transloco.translate('stages.close')).toBe('Abschluss');
  });
});
