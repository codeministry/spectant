import { LANGS } from '../../i18n/catalogues';
import type { LanguageService } from './language.service';
import type { SettingsService } from './settings.service';

/**
 * A user's language choice from a picker (the settings page and the shell's settings panel): a key outside `LANGS` is
 * ignored; a known one switches the UI now and persists through `/api/settings`.
 */
export function chooseLanguage(lang: string | undefined, language: LanguageService, settings: SettingsService): void {
  const next = LANGS.find((key) => key === lang);
  if (next === undefined) return;
  language.set(next);
  void settings.update({ language: next });
}
