import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LANGS } from '../../../i18n/catalogues';
import { KeyboardService } from '../../layout/shell/keyboard.service';
import { chooseLanguage } from '../../core/language-choice';
import { LanguageService } from '../../core/language.service';
import { isAgeMinutes, isDensity, SettingsService, type ThemeMode } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import { HelpNav } from '../../shared/page-nav/help-nav';
import type { HelpSection } from '../../shared/page-nav/help-nav';
import { ActorsSection } from './actors-section';

const THEMES: ReadonlyArray<{ readonly key: ThemeMode; readonly icon: 'monitor' | 'sun' | 'moon' }> = [
  { key: 'system', icon: 'monitor' },
  { key: 'light', icon: 'sun' },
  { key: 'dark', icon: 'moon' },
];

/** The anchor pills in page order (design.md § Settings): each a section id and the id of its heading. */
const SECTIONS: readonly HelpSection[] = [
  { id: 'appearance', heading: 'settings-appearance', label: 'settings.nav.appearance' },
  { id: 'actors', heading: 'actors-heading', label: 'settings.nav.actors' },
  { id: 'board', heading: 'settings-board', label: 'settings.nav.board' },
  { id: 'workspaces', heading: 'settings-workspaces', label: 'settings.nav.workspaces' },
  { id: 'keyboard', heading: 'settings-keyboard', label: 'settings.nav.keyboard' },
  { id: 'about', heading: 'settings-about', label: 'settings.nav.about' },
];

/** The most used shortcuts (prototype `settings.html`, card Keyboard); the fifth row, `?`, opens the sheet. */
const KEYS: ReadonlyArray<{ readonly keys: readonly string[]; readonly label: string }> = [
  { keys: ['⌘K'], label: 'settings.keyboard.palette' },
  { keys: ['g', 'd'], label: 'settings.keyboard.dashboard' },
  { keys: ['[', ']'], label: 'settings.keyboard.step' },
  { keys: ['z'], label: 'settings.keyboard.zen' },
];

/**
 * `/settings` (spec 024, T60; design.md § Settings and the static prototype `settings.html`): the page head, the
 * anchor pills (the Help nav), then six cards. Appearance holds theme, language and density (spec 021, ISC-254: the
 * default of board, flow view and spec row; `?density=` overrides it for one view and never changes it here) as stored
 * settings; reduced motion is not stored yet, so it sits alone in a disabled demo block. Actors, Board (the claim
 * stale age `staleMinutes`, spec 032, ISC-35: whole minutes from 5 to 1440, stored on commit), Workspaces (the
 * registry summary and the row link to `/settings/workspaces`), Keyboard (the single-key switch, the common keys and
 * the shortcut sheet) and About follow. The way back is the header.
 */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiIcon, UiKbd, UiPageHead, UiSegmented, HelpNav, ActorsSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings' },
  styleUrl: './settings-page.css',
  templateUrl: './settings-page.html',
})
export class SettingsPage {
  protected readonly keyboard = inject(KeyboardService);
  protected readonly theme = inject(ThemeService);
  protected readonly language = inject(LanguageService);
  private readonly settings = inject(SettingsService);
  private readonly transloco = inject(TranslocoService);
  private readonly data = inject(ShellData);

  /** The active catalogue: the option labels translate again once it has loaded or the language changed. */
  private readonly catalogue = toSignal(this.transloco.selectTranslation());

  protected readonly sections = SECTIONS;
  protected readonly keys = KEYS;
  protected readonly host = inject(DOCUMENT).location.host;

  protected readonly themeOptions = computed<readonly SegmentedOption[]>(() => {
    this.catalogue();
    return THEMES.map(({ key, icon }) => ({ key, icon, label: this.transloco.translate(`settings.theme.${key}`) }));
  });
  protected readonly densityOptions = computed<readonly SegmentedOption[]>(() => {
    this.catalogue();
    return (['comfortable', 'compact'] as const).map((key) => ({ key, label: this.transloco.translate(`settings.appearance.${key}`) }));
  });
  protected readonly langOptions: readonly SegmentedOption[] = LANGS.map((key) => ({ key, label: key.toUpperCase() }));
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  /** The stored density; `?density=` on a view never reaches it (ISC-254). */
  protected readonly density = computed(() => this.settings.settings().density);
  /** The stored claim age (spec 032, ISC-35): a claim without a release older than it reads stale on the board. */
  protected readonly staleMinutes = computed(() => this.settings.settings().staleMinutes);
  /** The last committed age was refused (not whole minutes from 5 to 1440); nothing was sent. */
  protected readonly staleInvalid = signal(false);

  /** The registry summary: every registered workspace, the readable ones and the ones whose folder is gone. */
  protected readonly registry = computed(() => {
    const list = this.data.workspaceList();
    const readable = list.filter((w) => w.readable).length;
    return { total: list.length, readable, missing: list.length - readable };
  });

  protected setTheme(mode: string | undefined): void {
    const next = THEMES.find((t) => t.key === mode);
    if (next !== undefined) void this.theme.setMode(next.key);
  }

  protected setLanguage(lang: string | undefined): void {
    chooseLanguage(lang, this.language, this.settings);
  }

  protected setDensity(value: string | undefined): void {
    if (isDensity(value) && value !== this.density()) void this.settings.update({ density: value });
  }

  /**
   * Stores a committed claim age (native `change`: on blur or Enter) when it is whole minutes from 5 to 1440 and not
   * the stored one; anything else marks the field invalid and sends nothing, so the server never sees a refused value.
   */
  protected setStaleMinutes(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const minutes = raw === '' ? Number.NaN : Number(raw);
    const valid = isAgeMinutes(minutes);
    this.staleInvalid.set(!valid);
    if (valid && minutes !== this.staleMinutes()) void this.settings.update({ staleMinutes: minutes });
  }

  protected toggleSingleKeys(): void {
    void this.settings.update({ singleKeyShortcuts: !this.singleKeys() });
  }
}
