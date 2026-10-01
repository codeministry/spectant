import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, viewChildren } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
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
  imports: [TranslocoPipe, UiChip, UiClamp, UiMeter, UiStageTrack],
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
  /** Title and description show in full (the list's "more…" toggle, ISC-111). */
  readonly descriptionExpanded = input(false);
  /** Whether the title needs more than its line or the description more than its two, so the list offers "more…" outside the row link. */
  readonly descriptionOverflow = output<boolean>();

  private readonly clamps = viewChildren(UiClamp);

  constructor() {
    let last = false;
    effect(() => {
      const overflows = this.clamps().some((clamp) => clamp.overflows());
      if (overflows !== last) this.descriptionOverflow.emit((last = overflows));
    });
  }

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
