// Placeholder for `/w/:ws/board` (T115); T121 builds the board itself.
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';

/** The workspace board (spec 008, ISC-129): "Board" at workspace scope, never the spec's "Round board". */
@Component({
  selector: 'app-board-page',
  imports: [TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'board' },
  styles: `
    :host { display: block; }
    h1 { margin: 0; font-family: var(--font-display); font-size: 24px; font-weight: 600; line-height: 32px; }
  `,
  template: `
    <ui-card [padding]="24">
      <h1 id="board" tabindex="-1">{{ 'board.workspace.title' | transloco }}</h1>
    </ui-card>
  `,
})
export class BoardPage {}
