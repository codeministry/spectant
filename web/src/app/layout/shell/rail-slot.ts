import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';
import { RailContent } from './rail-content';

/**
 * The context rail's slot: the blocks the current view registered with `RailContent` (the board's This frame, Needs
 * you and Your steps, T88), else an empty placeholder card until T54 (Where it stands, Waiting on you) fills it.
 */
@Component({
  selector: 'app-rail-slot',
  imports: [NgTemplateOutlet, TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'rail' },
  styles: `
    :host { display: block; }
    .blocks { display: grid; gap: 16px; }
    h2 { margin: 0 0 8px; font-size: 16px; font-weight: 600; line-height: 24px; }
    p { margin: 0; color: var(--muted-ink); font-size: 13px; line-height: 20px; }
  `,
  template: `
    @if (content.blocks(); as blocks) {
      <div class="blocks" data-rail-blocks>
        <ng-container [ngTemplateOutlet]="blocks" />
      </div>
    } @else {
      <ui-card [padding]="24">
        <h2>{{ 'shell.rail.label' | transloco }}</h2>
        <p>{{ 'shell.rail.pending' | transloco }}</p>
      </ui-card>
    }
  `,
})
export class RailSlot {
  protected readonly content = inject(RailContent);
}
