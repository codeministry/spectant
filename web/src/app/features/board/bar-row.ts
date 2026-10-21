import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { BoardColumn } from '../../core/model/board-types';
import { UiIcon } from '../../shared/icons/icon';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { STAGE_GLYPHS } from './board-view';

/**
 * The compact sticky bar's row (T124, ISC-129.2; spec 061): ◂ · stage · ▸. The arrows pick the previous or next column,
 * the middle button goes back to the column switch; the count morphs in after an accepted move.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the bar's row <div>, so the sticky bar keeps its element
  selector: 'div[app-bar-row]',
  imports: [TranslocoPipe, UiIcon, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bar-row.html',
  styleUrl: './bar-row.css',
})
export class BarRow {
  /** The one column shown. */
  readonly column = input.required<BoardColumn>();
  readonly prev = input<WorkflowStage | null>(null);
  readonly next = input<WorkflowStage | null>(null);
  /** The count morphs in after an accepted move. */
  readonly morph = input(false);
  /** An arrow picked the column of this stage. */
  readonly pick = output<WorkflowStage | null>();
  /** The middle button: back to the column switch. */
  readonly back = output();

  protected readonly glyphs = STAGE_GLYPHS;
}
