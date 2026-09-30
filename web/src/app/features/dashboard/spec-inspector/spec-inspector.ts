import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecWarning } from '../../../../../../core/src/files';
import { specLink, type TabId } from '../../../layout/shell/areas';
import { UiIcon } from '../../../shared/icons/icon';
import { UiButton } from '../../../shared/ui/button/button';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { stageIndex, TRACK_STAGES } from '../../spec/dashboard/dashboard-model';
import { PHASE_TONES, type SpecTableRow } from '../spec-table/spec-table-model';

/** The spec page's tabs the inspector links to, in the prototype's order ("Explore spec"). */
export const EXPLORE_TABS: readonly TabId[] = ['status', 'timeline', 'claims', 'tasks', 'plan', 'design', 'decisions', 'evidence', 'notes'];

/** Where the inspector sits: the context rail at wide, a sheet below it. */
export type InspectorForm = 'rail' | 'sheet';

/**
 * The spec preview (T69, ISC-61.1; design.md § Desktop Soll "Inspector mode", the prototype's `inspector()` in app.js
 * with styles.css § spec-inspector): Back with its Esc hint, id and title with the description, phase / type / stage
 * chips, the labelled stage track, the claims meter, the next command, takeable claims, the spec's warnings, the
 * "Explore spec" links into the spec page, open fog, and `[` `]` previous / next. The Open button leads to the spec
 * page `/w/:ws/s/:id`.
 *
 * It renders the row it is given and asks for nothing but `back`: the page owns `?spec=<id>`, and previous / next are
 * links that rewrite that query param.
 */
@Component({
  selector: 'app-spec-inspector',
  imports: [RouterLink, TranslocoPipe, UiButton, UiChip, UiCommandChip, UiIcon, UiKbd, UiMeter, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-inspector.html',
  styleUrl: './spec-inspector.css',
  host: { '[attr.data-spec]': 'row().id', '[attr.data-form]': 'form()' },
})
export class SpecInspector {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly ws = input.required<string>();
  readonly row = input.required<SpecTableRow>();
  /** This spec's warnings as the dashboard model carries them. */
  readonly warnings = input<readonly SpecWarning[]>([]);
  /** The neighbours in the Specs panel's current order; null at either end. */
  readonly prev = input<string | null>(null);
  readonly next = input<string | null>(null);
  readonly form = input<InspectorForm>('rail');
  /** Back: the page clears `?spec` and returns focus to the row. */
  readonly back = output();

  protected readonly exploreTabs = EXPLORE_TABS;
  protected readonly headingId = 'spec-inspector-title';
  protected readonly specPage = computed(() => specLink(this.ws(), this.row().id));
  protected readonly phaseTone = computed(() => PHASE_TONES[this.row().phase ?? ''] ?? 'neutral');
  protected readonly stageCurrent = computed(() => stageIndex(this.row().stage));
  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: labels[index] ?? '' });
  });
  protected readonly percent = computed(() => {
    const { closed, total } = this.row();
    return total > 0 ? Math.round((closed / total) * 100) : 0;
  });

  protected tabLink(tab: TabId): string[] {
    return specLink(this.ws(), this.row().id, tab);
  }
}
