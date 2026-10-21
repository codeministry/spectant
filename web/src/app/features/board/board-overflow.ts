import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import type { HiddenColumn } from './board-model';

/**
 * Medium (spec 019, ISC-141.1), on the board card's `p.overflow`: the columns with cards right of the scroller box,
 * each a jump to its column, and a chevron to the first of them.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the board card's <p>, so the overflow line keeps its element
  selector: 'p[app-board-overflow]',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './board-overflow.html',
  styleUrl: './board-overflow.css',
})
export class BoardOverflow {
  readonly columns = input.required<readonly HiddenColumn[]>();
  /** An entry or the chevron was pressed: the stage whose column scrolls into view. */
  readonly show = output<WorkflowStage>();
}
