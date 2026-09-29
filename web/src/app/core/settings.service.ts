import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { isLang, type Lang } from '../../i18n/catalogues';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * The browser-side copy of `Settings` from `server/src/settings.ts` (`SettingsSchema`, T43). Duplicated on purpose:
 * that module imports `bun:sqlite` and the server's HTTP layer, which must not reach the browser bundle. Keep the
 * keys, the defaults and the checks below in step with `SettingsSchema` when a key is added there.
 */
export interface Settings {
  theme: ThemeMode;
  language: Lang;
  refreshSeconds: number;
  singleKeyShortcuts: boolean;
  /** The context rail at wide shows as its 48 px strip (spec 002, ISC-75). */
  railCollapsed: boolean;
  /** The Notes area's import notice was dismissed (spec 002, ISC-95). */
  notesImportDismissed: boolean;
}

/** `SettingsSchema`'s defaults: what a fresh install gets, and what the app shows until `/api/settings` answers. */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: 'system',
  language: 'en',
  refreshSeconds: 30,
  singleKeyShortcuts: true,
  railCollapsed: false,
  notesImportDismissed: false,
});

/** Relative on purpose: the app talks only to the loopback server that served it, on whatever port (ISC-2). */
export const SETTINGS_URL = '/api/settings';

const isThemeMode = (value: unknown): value is ThemeMode => value === 'system' || value === 'light' || value === 'dark';
const isRefresh = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 5 && (value as number) <= 3600;

/** A server answer read field by field; a field that fails its check reads as its default, as the server does. */
function sanitize(raw: unknown): Settings {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const { theme, language, refreshSeconds, singleKeyShortcuts, railCollapsed, notesImportDismissed } = value;
  return {
    theme: isThemeMode(theme) ? theme : DEFAULT_SETTINGS.theme,
    language: typeof language === 'string' && isLang(language) ? language : DEFAULT_SETTINGS.language,
    refreshSeconds: isRefresh(refreshSeconds) ? refreshSeconds : DEFAULT_SETTINGS.refreshSeconds,
    singleKeyShortcuts: typeof singleKeyShortcuts === 'boolean' ? singleKeyShortcuts : DEFAULT_SETTINGS.singleKeyShortcuts,
    railCollapsed: typeof railCollapsed === 'boolean' ? railCollapsed : DEFAULT_SETTINGS.railCollapsed,
    notesImportDismissed: typeof notesImportDismissed === 'boolean' ? notesImportDismissed : DEFAULT_SETTINGS.notesImportDismissed,
  };
}

/**
 * The user's settings (theme mode, language, refresh interval, single-key shortcuts, the collapsed rail, the Notes import notice), stored server-side through
 * `GET` / `PUT /api/settings` so they survive a reload on a different port (ISC-18.3). Never in `localStorage`:
 * per-origin storage is lost when the port changes (web/CLAUDE.md § State).
 *
 * RxJS stays at the I/O boundary: each request is bridged to a promise and its result lands in the `settings` signal,
 * which holds the schema defaults until the first answer.
 *
 * `update` is optimistic: the patch applies at once, so a theme switch shows without a round trip, and the server's
 * full answer then reconciles the state. A refused or failed PUT rolls back the keys the patch still owns (a later
 * update to the same key keeps its value), and only the newest request's answer is applied, so a late answer cannot
 * undo a newer choice.
 */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly state = signal<Settings>(DEFAULT_SETTINGS);
  private loading: Promise<void> | undefined;
  private sequence = 0;

  readonly settings = this.state.asReadonly();

  /**
   * Loads the stored settings once; later calls return the same promise. Never rejects: an unreachable server keeps
   * the defaults, so the app still starts (and the first `update` that succeeds stores the user's choice).
   */
  load(): Promise<void> {
    this.loading ??= firstValueFrom(this.http.get<unknown>(SETTINGS_URL)).then(
      (answer) => {
        // An update issued while the GET was in flight is newer than the stored state; its own answer reconciles.
        if (this.sequence === 0) this.state.set(sanitize(answer));
      },
      () => undefined,
    );
    return this.loading;
  }

  /** Applies `patch` at once and PUTs it; resolves `true` once stored, `false` after a rollback. Never rejects. */
  async update(patch: Partial<Settings>): Promise<boolean> {
    const ticket = ++this.sequence;
    const before = this.state();
    this.state.set({ ...before, ...patch });
    try {
      const answer = await firstValueFrom(this.http.put<unknown>(SETTINGS_URL, patch));
      if (ticket === this.sequence) this.state.set(sanitize(answer));
      return true;
    } catch {
      this.state.update((current) => {
        const reverted: Settings = { ...current };
        for (const key of Object.keys(patch) as Array<keyof Settings>) {
          if (current[key] === patch[key]) (reverted as Record<keyof Settings, unknown>)[key] = before[key];
        }
        return reverted;
      });
      return false;
    }
  }
}
