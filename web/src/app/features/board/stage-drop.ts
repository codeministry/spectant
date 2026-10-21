import { Directive, inject, input } from '@angular/core';
import type { WorkflowStage } from '../../../../../core/src/files';
import { CARD_EDGE } from '../../shared/ui/stage-edge';
import { BoardDrag } from './board-drag';

/**
 * A stage's drop list on the board (T125; spec 061): a column, a stub or the compact column. It carries the stage
 * (`data-col`), the stage's edge colour (`--role`) and, while a card is lifted, the drop hint (`data-drop`); the CDK
 * drop list itself stays on the element in the page's template.
 */
@Directive({
  selector: '[appStageDrop]',
  host: {
    '[attr.data-drop]': 'drag.hint(stage())',
    '[attr.data-col]': 'stage()',
    '[style.--role]': 'edges[stage()]',
  },
})
export class StageDrop {
  readonly stage = input.required<WorkflowStage>({ alias: 'appStageDrop' });
  protected readonly drag = inject(BoardDrag);
  protected readonly edges = CARD_EDGE;
}
