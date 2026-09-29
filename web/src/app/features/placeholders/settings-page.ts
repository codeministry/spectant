import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';

/**
 * `/settings` until T40/T41 bring the settings popover (theme, language, single-key shortcuts, help): the header's
 * gear leads here so it is a real link today. A heading, one card saying what comes later, and a way back.
 */
@Component({
  selector: 'app-settings-page',
  imports: [RouterLink, TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'settings' },
  styles: `
    :host { display: block; }
    h1 { margin: 0 0 16px; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
    p { margin: 0; font-size: 14px; line-height: 20px; }
    a { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-start: 16px; color: var(--disp-ink); }
  `,
  template: `
    <h1>{{ 'settings.title' | transloco }}</h1>
    <ui-card [padding]="24">
      <p>{{ 'shell.settingsPage.pending' | transloco }}</p>
    </ui-card>
    <a routerLink="/">{{ 'shell.settingsPage.back' | transloco }}</a>
  `,
})
export class SettingsPage {}
