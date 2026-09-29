import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';

/** The context rail's slot: an empty placeholder card until T54 (Where it stands, Waiting on you) fills it. */
@Component({
  selector: 'app-rail-slot',
  imports: [TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'rail' },
  styles: `
    :host { display: block; }
    h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 24px; }
    p { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
  `,
  template: `
    <ui-card [padding]="24">
      <h2>{{ 'shell.rail.label' | transloco }}</h2>
      <p>{{ 'shell.rail.pending' | transloco }}</p>
    </ui-card>
  `,
})
export class RailSlot {}
