import {
  ApplicationConfig,
  Injectable,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTransloco, type Translation, type TranslocoLoader } from '@jsverse/transloco';
import { CATALOGUES, isLang, LANGS } from '../i18n/catalogues';
import { routes } from './app.routes';

/** Serves the bundled catalogues; no HTTP loader, so no `/assets/i18n` request ever leaves the page (ISC-2). */
@Injectable({ providedIn: 'root' })
class BundledTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    return isLang(lang) ? Promise.resolve(CATALOGUES[lang]) : Promise.reject(new Error(`no catalogue for "${lang}"`));
  }
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Explicit on purpose: zoneless is the default in Angular 22, but the intent must not hang on a default.
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // Language is a setting, not a route prefix (plan.md § Stack Decisions, FE-I18N-01 adapted); English by default.
    provideTransloco({
      config: {
        availableLangs: [...LANGS],
        defaultLang: 'en',
        fallbackLang: 'en',
        reRenderOnLangChange: true,
        prodMode: !isDevMode(),
      },
      loader: BundledTranslocoLoader,
    }),
  ],
};
