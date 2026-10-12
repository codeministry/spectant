// Placeholder for `/help` (T115); T129 builds the help page itself.
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';

/** The global help page (spec 008, ISC-116), inside the shell like settings and outside any workspace. */
@Component({
  selector: 'app-help-page',
  imports: [TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'help' },
  styles: `
    :host { display: block; }
    h1 { margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
  `,
  template: `
    <ui-card [padding]="24">
      <h1 id="help" tabindex="-1">{{ 'help.title' | transloco }}</h1>
    </ui-card>
  `,
})
export class HelpPage {}
