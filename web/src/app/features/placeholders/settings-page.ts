import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { KeyboardService } from '../../core/keyboard.service';
import { UiButton } from '../../shared/ui/button/button';
import { UiCard } from '../../shared/ui/card/card';
import { UiPageHead } from '../../shared/ui/page-head/page-head';
import { ActorsSection } from '../settings/actors-section';

/**
 * `/settings` until T40/T41 bring the settings popover (theme, language, single-key shortcuts, help): the header's
 * gear leads here so it is a real link today. A heading, one card saying what comes later, the help entry that opens
 * the shortcut sheet (T102; it moves into the settings popover with T40/T41), and a way back.
 */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, TranslocoPipe, UiButton, UiCard, UiPageHead, ActorsSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings' },
  styles: `
    :host { display: block; }
    ui-page-head { margin-block-end: 16px; }
    h1 { margin: 0; }
    p { margin: 0; font-size: 14px; line-height: 20px; }
    button { margin-block-start: 16px; }
    ui-card a { margin-inline-start: 16px; }
    a { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-start: 16px; color: var(--disp-ink); }
  `,
  template: `
    <ui-page-head [segments]="[('shell.eyebrow.app' | transloco), ('settings.title' | transloco)]">
      <h1 class="type-page-title">{{ 'settings.title' | transloco }}</h1>
    </ui-page-head>
    <ui-card [padding]="24">
      <p>{{ 'shell.settingsPage.pending' | transloco }}</p>
      <button ui-button type="button" data-action="shortcuts" (click)="keyboard.openSheet()">
        {{ 'shortcuts.title' | transloco }}
      </button>
      <a routerLink="/help" data-action="help">{{ 'help.title' | transloco }}</a>
    </ui-card>
    <app-actors-section />
    <a routerLink="/">{{ 'shell.settingsPage.back' | transloco }}</a>
  `,
})
export class SettingsPage {
  protected readonly keyboard = inject(KeyboardService);
}
