import { computed, DOCUMENT, effect, inject, Injectable, signal, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { fromEvent, map } from 'rxjs';
import { SettingsService, type ThemeMode } from './settings.service';

export type ResolvedTheme = 'light' | 'dark';

/** The one media query system mode follows; the pre-paint script in `src/index.html` asks the same question. */
export const DARK_QUERY = '(prefers-color-scheme: dark)';

/**
 * The theme (ISC-18.1): `mode` is the stored choice (system / light / dark, from `/api/settings`), `resolved` the
 * theme it lands on. In system mode `resolved` follows `prefers-color-scheme` live through the media query's
 * `change` event; a chosen light or dark mode wins over it.
 *
 * One effect writes `data-theme` on `<html>` as `spec-light` / `spec-dark`, the daisyUI theme names in
 * `src/styles.css`. Before Angular boots, the inline script in `src/index.html` has already written the system theme,
 * so system mode paints right from the first frame; there is no `prefers-color-scheme` block in CSS.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  readonly mode = computed<ThemeMode>(() => this.settings.settings().theme);

  /** True while the system prefers dark; `false` where `matchMedia` does not exist (a DOM emulation). */
  private readonly systemDark: Signal<boolean> = systemPrefersDark();

  readonly resolved = computed<ResolvedTheme>(() => {
    const mode = this.mode();
    if (mode !== 'system') return mode;
    return this.systemDark() ? 'dark' : 'light';
  });

  constructor() {
    const html = this.document.documentElement;
    effect(() => {
      html.setAttribute('data-theme', `spec-${this.resolved()}`);
    });
  }

  /** Stores the mode server-side (applied at once, rolled back if the PUT fails); resolves as `SettingsService.update`. */
  setMode(mode: ThemeMode): Promise<boolean> {
    return this.settings.update({ theme: mode });
  }
}

/** `matchMedia(DARK_QUERY)` as a signal, bridged at the I/O boundary; call in an injection context. */
function systemPrefersDark(): Signal<boolean> {
  if (typeof matchMedia !== 'function') return signal(false).asReadonly();
  const query = matchMedia(DARK_QUERY);
  return toSignal(fromEvent<MediaQueryListEvent>(query, 'change').pipe(map((event) => event.matches)), {
    initialValue: query.matches,
  });
}
