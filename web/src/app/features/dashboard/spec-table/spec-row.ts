import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { stageIndex } from '../../spec/dashboard/dashboard-model';
import { PHASE_TONES, type SpecTableRow } from './spec-table-model';

/** i18n key for the agent dot's name; the English fallback stands until the key lands in both catalogues. */
const AGENT_KEY = 'specs.agentWorking';

/**
 * One spec as a row of the Specs panel, ported from the prototype's `spec-row` (styles.css 380-397, app.js specRow):
 * `40px | title + one-line description | agent dot + mini five-segment stage track + phase chip | meter + a/b`. It
 * renders the cells only; the link and the roving tab stop are the list's (`spec-table`), so the row nests no
 * interactive element.
 *
 * Forms: `normal` reads the `specs` container the list declares, one 48-64 px line from 760 px and two lines below
 * it (id and title, then track and meter); `dense` is the overview column's single 48 px line without description,
 * agent dot and phase chip.
 */
@Component({
  selector: 'app-spec-row',
  imports: [TranslocoPipe, UiChip, UiMeter, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-row.html',
  styleUrl: './spec-row.css',
  host: { '[attr.data-density]': 'density()' },
})
export class SpecRow {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly row = input.required<SpecTableRow>();
  /** The five stage labels, translated once by the list. */
  readonly stageLabels = input.required<readonly string[]>();
  readonly density = input<'normal' | 'dense'>('normal');

  protected readonly stageCurrent = computed(() => stageIndex(this.row().stage));
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: labels[index] ?? '' });
  });
  protected readonly phaseTone = computed(() => PHASE_TONES[this.row().phase ?? ''] ?? 'neutral');
  protected readonly agentLabel = computed(() => {
    this.lang();
    const session = this.row().agent ?? '';
    return this.transloco.translate(AGENT_KEY, { session });
  });
}
