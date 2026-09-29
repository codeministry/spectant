import {
  ApplicationConfig,
  effect,
  inject,
  Injectable,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideTransloco, type Translation, type TranslocoLoader } from '@jsverse/transloco';
import { CATALOGUES, isLang, LANGS } from '../i18n/catalogues';
import { routes } from './app.routes';
import { LanguageService } from './core/language.service';
import { SettingsService } from './core/settings.service';
import { ThemeService } from './core/theme.service';

/**
 * Starts the settings before the first render (ISC-18.1, ISC-18.3): the theme service's `data-theme` effect runs from
 * the first tick, the language follows the stored setting, and bootstrap waits for `/api/settings` so the first view
 * renders in the stored language and theme. `load` never rejects; an unreachable server starts the app on defaults.
 */
function startSettings(): Promise<void> {
  const settings = inject(SettingsService);
  const language = inject(LanguageService);
  inject(ThemeService);
  effect(() => {
    language.set(settings.settings().language);
  });
  return settings.load();
}

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
    // The fetch backend is the default; the app only ever calls its own loopback `/api` with relative URLs (ISC-2).
    provideHttpClient(),
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
    provideAppInitializer(startSettings),
  ],
};
