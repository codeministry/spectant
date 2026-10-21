import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { specModel } from '../../../layout/shell/spec-model';
import { specGuide } from '../../../layout/spec-head/spec-guide';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';

/**
 * The rail's guidance spot from 1120 px (spec 020, T20, ISC-239; design.md § Spec-Seite): "Next step" with the spec's
 * catalogue sentence (`guidanceReason`), its copy chip and the marker "Waits on you" when the spec itself waits on you;
 * then the spec's other waiting entries as `ui-waits-block` (scope `spec`: `ISC-n` / `Tn` instead of the spec number,
 * limit 5, a chip on every row, "+n more" to the spec dashboard's `#waiting`), with no `operator` checkbox: the rail
 * leads, the Tasks tab ticks. One markup for every rail of the spec page: the spec rail (`app-spec-rail`) and the spec
 * dashboard's own rail (its Spec context) both open with it. The host is `display: contents`, so its blocks are items
 * of the rail's grid. It renders the spec payload the shell already loads (`ShellData.spec`) as it is.
 */
@Component({
  selector: 'app-spec-rail-guide',
  imports: [GuidanceReasonPipe, TranslocoPipe, UiChip, UiCommandChip, UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './spec-rail-guide.css',
  templateUrl: './spec-rail-guide.html',
})
export class SpecRailGuide {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  private readonly model = specModel(this.data);

  /** The guidance spot: the spec's own entry as the next step and the rest of its `waits` (`specGuide`). */
  protected readonly guide = computed(() => {
    const model = this.model();
    return model === null ? null : specGuide(model.guidance, model);
  });

  protected readonly ws = computed(() => this.state.ws() ?? '');
  /** The open spec's id: the rail guide's chip says whose next step it copies (spec 057, ISC-354). */
  protected readonly specId = computed(() => this.model()?.head.id ?? this.state.specId() ?? '');
  /** "+n more" leads to the spec dashboard, whose `#waiting` lists every waiting entry of the spec. */
  protected readonly dashboardLink = computed(() => specLink(this.ws(), this.model()?.head.id ?? this.state.specId() ?? '').join('/'));
}
