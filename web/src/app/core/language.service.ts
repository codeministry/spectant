import { computed, DOCUMENT, inject, Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { isLang, type Lang, LANGS } from '../../i18n/catalogues';

/**
 * The UI language (FE-I18N-01 adapted: a setting, no route prefix, English default). `current` mirrors Transloco's
 * active language, so there is one source of truth; `set` switches it and keeps `<html lang>` in step for assistive
 * technology (WCAG 3.1.1).
 *
 * Not a store of its own: the stored language comes from `SettingsService` (`/api/settings`), and the app
 * initializer in `app.config.ts` calls `set` whenever that setting changes. A user's choice goes through
 * `SettingsService.update({ language })`, so it persists; calling `set` directly switches for this page only.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);

  readonly available: readonly Lang[] = LANGS;

  readonly current = computed<Lang>(() => {
    const active = this.transloco.activeLang();
    return isLang(active) ? active : 'en';
  });

  set(lang: Lang): void {
    this.transloco.setActiveLang(lang);
    this.document.documentElement.lang = lang;
  }
}
