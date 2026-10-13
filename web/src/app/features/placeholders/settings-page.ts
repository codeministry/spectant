import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { LANGS } from '../../../i18n/catalogues';
import { KeyboardService } from '../../core/keyboard.service';
import { LanguageService } from '../../core/language.service';
import { SettingsService, type ThemeMode } from '../../core/settings.service';
import { ThemeService } from '../../core/theme.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { type SegmentedOption, UiSegmented } from '../../shared/ui/segmented/segmented';
import { HelpNav } from '../help/help-nav';
import type { HelpSection } from '../help/help-sections';
import { ActorsSection } from '../settings/actors-section';

const THEMES: ReadonlyArray<{ readonly key: ThemeMode; readonly icon: 'monitor' | 'sun' | 'moon' }> = [
  { key: 'system', icon: 'monitor' },
  { key: 'light', icon: 'sun' },
  { key: 'dark', icon: 'moon' },
];

/** The anchor pills in page order (design.md § Settings): each a section id and the id of its heading. */
const SECTIONS: readonly HelpSection[] = [
  { id: 'appearance', heading: 'settings-appearance', label: 'settings.nav.appearance' },
  { id: 'actors', heading: 'actors-heading', label: 'settings.nav.actors' },
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
 * anchor pills (the Help nav), then five cards. Appearance holds theme and language as stored settings; density and
 * reduced motion are not stored by the core yet, so they sit in one disabled demo block. Actors, Workspaces (the
 * registry summary and the row link to `/settings/workspaces`), Keyboard (the single-key switch, the common keys and
 * the shortcut sheet) and About follow. The way back is the header.
 */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiIcon, UiKbd, UiPageHead, UiSegmented, HelpNav, ActorsSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings' },
  styles: `
    :host { display: block; }
    ui-page-head { margin-block-end: 4px; }
    h1 { margin: 0; }
    .page-meta { margin: 0 0 16px; color: var(--muted); font-size: 13px; line-height: 20px; }
    app-help-nav { margin-block-end: var(--space-4); }
    .main { display: grid; gap: var(--space-5); max-inline-size: 1040px; margin-inline: auto; container-type: inline-size; }
    .main > * { scroll-margin-block-start: 128px; }
    .c-head { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; justify-content: space-between; padding: 12px var(--space-3); border-block-end: 1px solid var(--line); }
    .c-head h2 { margin: 0; font-family: var(--font-brand); font-size: 15px; font-weight: 600; line-height: 24px; }
    .card-pad { padding: var(--space-3); }
    .meta { margin: 0; color: var(--muted); font-size: 13px; line-height: 20px; }
    .eyebrow { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 0.06em; line-height: 16px; text-transform: uppercase; }
    .set-row { display: grid; gap: var(--space-2); align-items: center; padding: 12px 0; border-block-start: 1px solid var(--line); }
    .set-row:first-of-type { border-block-start: 0; }
    .set-row ui-segmented, .set-row .switch { justify-self: start; }
    @container (inline-size >= 560px) { .set-row { grid-template-columns: 200px minmax(0, 1fr); } }
    .demo-block { margin-block-start: 12px; padding-block-start: 12px; border-block-start: 1px solid var(--line); }
    .demo-head { display: flex; gap: 8px; align-items: center; }
    fieldset { min-inline-size: 0; margin: 0; padding: 0; border: 0; }
    .switch { position: relative; flex: none; inline-size: 32px; block-size: 18px; padding: 0; border: 0; border-radius: 9px; background: var(--track); cursor: pointer; transition: background-color var(--dur-pop) var(--ease); }
    .switch::after { position: absolute; inset-block-start: 2px; inset-inline-start: 2px; inline-size: 14px; block-size: 14px; border-radius: 50%; background: var(--color-base-100); content: ''; transition: translate var(--dur-pop) var(--ease); }
    .switch[aria-checked='true'] { background: var(--badge); }
    .switch[aria-checked='true']::after { translate: 14px 0; }
    .switch:disabled { cursor: not-allowed; }
    @media (pointer: coarse) { .switch::before { position: absolute; inset: -13px -6px; content: ''; } }
    .sum-line { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
    .check-line { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; line-height: 20px; }
    .sdot { inline-size: 8px; block-size: 8px; border-radius: 50%; }
    .s-ok .sdot { background: var(--color-accent); }
    .s-red .sdot { background: var(--color-error); }
    .row-link { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; min-block-size: 48px; padding: 0 var(--space-3); border-block-start: 1px solid var(--line); color: var(--color-base-content); font-size: 14px; text-decoration: none; }
    .row-link:hover { background: var(--lane); }
    .row-link .end { margin-inline-start: auto; color: var(--muted); }
    .link { display: inline-flex; gap: 4px; align-items: center; color: var(--disp-text); font-size: 13px; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .key-row { display: flex; gap: 12px; align-items: center; justify-content: space-between; min-block-size: 36px; padding: 8px 0; border-block-end: 1px solid var(--line); font-size: 13px; }
    .key-row .k { display: inline-flex; gap: 4px; }
    .sheet-row { inline-size: 100%; border-inline: 0; border-block-start: 0; border-block-end: 0; background: transparent; color: inherit; font: inherit; font-size: 13px; text-align: start; cursor: pointer; }
    .sheet-row:hover { background: var(--lane); }
    .single { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding-block-end: 12px; border-block-end: 1px solid var(--line); }
    .single .meta { font-size: 12px; line-height: 16px; }
    .mono { font-family: var(--font-mono); }
  `,
  template: `
    <ui-page-head [segments]="[('shell.eyebrow.app' | transloco), ('settings.title' | transloco)]">
      <h1 class="type-page-title">{{ 'settings.title' | transloco }}</h1>
    </ui-page-head>
    <p class="page-meta">{{ 'settings.meta' | transloco }}</p>
    <app-help-nav [sections]="sections" />

    <div class="main">
      <section id="appearance" aria-labelledby="settings-appearance">
        <ui-card [padding]="0">
          <div class="c-head"><h2 id="settings-appearance">{{ 'settings.nav.appearance' | transloco }}</h2></div>
          <div class="card-pad">
            <p class="meta">{{ 'settings.appearance.intro' | transloco }}</p>
            <div class="set-row">
              <span class="eyebrow" aria-hidden="true">{{ 'settings.theme.label' | transloco }}</span>
              <ui-segmented
                data-setting="theme"
                [label]="'settings.theme.label' | transloco"
                [options]="themeOptions()"
                [value]="theme.mode()"
                (valueChange)="setTheme($event)"
              />
            </div>
            <div class="set-row">
              <span class="eyebrow" aria-hidden="true">{{ 'settings.language.label' | transloco }}</span>
              <ui-segmented
                data-setting="language"
                [label]="'settings.language.label' | transloco"
                [options]="langOptions"
                [value]="language.current()"
                (valueChange)="setLanguage($event)"
              />
            </div>
            <div class="demo-block" data-demo>
              <div class="demo-head" data-demo-head>
                <span class="eyebrow">{{ 'settings.appearance.display' | transloco }}</span>
                <ui-chip variant="demo" />
              </div>
              <fieldset disabled>
                <div class="set-row">
                  <span class="eyebrow" aria-hidden="true">{{ 'settings.appearance.density' | transloco }}</span>
                  <ui-segmented [label]="'settings.appearance.density' | transloco" [options]="densityOptions()" value="comfortable" />
                </div>
                <div class="set-row">
                  <span class="eyebrow" aria-hidden="true">{{ 'settings.appearance.reducedMotion' | transloco }}</span>
                  <button
                    type="button"
                    class="switch"
                    role="switch"
                    aria-checked="false"
                    [attr.aria-label]="'settings.appearance.reducedMotion' | transloco"
                  ></button>
                </div>
              </fieldset>
            </div>
          </div>
        </ui-card>
      </section>

      <app-actors-section id="actors" />

      <section id="workspaces" aria-labelledby="settings-workspaces">
        <ui-card [padding]="0">
          <div class="c-head">
            <h2 id="settings-workspaces">{{ 'settings.nav.workspaces' | transloco }}</h2>
            <span class="meta">{{ 'settings.workspacesCard.registered' | transloco: { count: registry().total } }}</span>
          </div>
          <div class="card-pad">
            <div class="sum-line" data-workspaces-summary>
              <span class="check-line s-ok"
                ><span class="sdot" aria-hidden="true"></span
                >{{ 'settings.workspacesCard.readable' | transloco: { count: registry().readable } }}</span
              >
              @if (registry().missing > 0) {
                <span class="check-line s-red"
                  ><span class="sdot" aria-hidden="true"></span
                  >{{ 'settings.workspacesCard.missing' | transloco: { count: registry().missing } }}</span
                >
              }
              <span class="meta">{{ 'settings.workspacesCard.registry' | transloco }}</span>
            </div>
          </div>
          <a class="row-link" routerLink="/settings/workspaces" data-action="workspaces">
            <ui-icon name="folder" [size]="16" />
            <span>{{ 'settings.workspacesCard.manage' | transloco }}</span>
            <span class="meta">{{ 'settings.workspacesCard.manageMeta' | transloco }}</span>
            <ui-icon class="end" name="arrow-right" [size]="16" />
          </a>
        </ui-card>
      </section>

      <section id="keyboard" aria-labelledby="settings-keyboard">
        <ui-card [padding]="0">
          <div class="c-head">
            <h2 id="settings-keyboard">{{ 'settings.nav.keyboard' | transloco }}</h2>
            <a class="link" routerLink="/help" fragment="keys" data-action="help"
              >{{ 'settings.keyboard.guide' | transloco }} <ui-icon name="arrow-right" [size]="14"
            /></a>
          </div>
          <div class="card-pad">
            <div class="single">
              <div>
                <span class="eyebrow" aria-hidden="true">{{ 'settings.singleKey' | transloco }}</span>
                <p class="meta">{{ 'settings.keyboard.singleKeyHint' | transloco }}</p>
              </div>
              <button
                type="button"
                class="switch"
                role="switch"
                data-setting="single-keys"
                [attr.aria-checked]="singleKeys()"
                [attr.aria-label]="'settings.singleKey' | transloco"
                (click)="toggleSingleKeys()"
              ></button>
            </div>
            @for (row of keys; track row.label) {
              <div class="key-row">
                <span class="k">
                  @for (key of row.keys; track key) {
                    <ui-kbd>{{ key }}</ui-kbd>
                  }
                </span>
                <span>{{ row.label | transloco }}</span>
              </div>
            }
            <button type="button" class="key-row sheet-row" data-action="shortcuts" (click)="keyboard.openSheet()">
              <span class="k"><ui-kbd>?</ui-kbd></span>
              <span>{{ 'settings.keyboard.all' | transloco }}</span>
            </button>
          </div>
        </ui-card>
      </section>

      <section id="about" aria-labelledby="settings-about">
        <ui-card [padding]="0">
          <div class="c-head"><h2 id="settings-about">{{ 'settings.nav.about' | transloco }}</h2></div>
          <div class="card-pad">
            <p class="meta mono">
              Spectant · {{ host }} · {{ 'settings.about.loopback' | transloco }} ·
              <a class="link" routerLink="/help">{{ 'settings.about.guide' | transloco }}</a>
            </p>
          </div>
        </ui-card>
      </section>
    </div>
  `,
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
    const next = LANGS.find((key) => key === lang);
    if (next === undefined) return;
    this.language.set(next);
    void this.settings.update({ language: next });
  }

  protected toggleSingleKeys(): void {
    void this.settings.update({ singleKeyShortcuts: !this.singleKeys() });
  }
}
