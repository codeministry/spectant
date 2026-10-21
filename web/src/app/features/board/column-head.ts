import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BoardColumn } from '../../core/model/board-types';
import { UiIcon } from '../../shared/icons/icon';
import { UiGlyph } from '../../shared/ui/glyph/glyph';
import { UiTerm } from '../../shared/ui/term/term';
import { gateOf, STAGE_GLYPHS, waiting, yours } from './board-view';

/**
 * A column head of the workspace board (design 008 § board), on the `header.head` of a column or of the compact tier's
 * one column: stage glyph, label, the gate `<dfn>` on a fixed gate, the hourglass on a waiting stage (the open ring when
 * it waits on you), the full count, and the fold button.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the column's <header>, so the column keeps its head element
  selector: 'header[app-column-head]',
  imports: [TranslocoPipe, UiGlyph, UiIcon, UiTerm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './column-head.html',
  styleUrl: './column-head.css',
})
export class ColumnHead {
  readonly column = input.required<BoardColumn>();
  /** The stage's translated name. */
  readonly label = input.required<string>();
  /** The count morphs in after an accepted move. */
  readonly morph = input(false);
  /** The fold button was pressed. */
  readonly fold = output();

  protected readonly glyphs = STAGE_GLYPHS;
  protected readonly gateOf = gateOf;
  protected readonly yours = yours;
  protected readonly waiting = waiting;
}
