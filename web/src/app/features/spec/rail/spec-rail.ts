import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState } from '../../../../../../core/src/files';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import type { Tone } from '../../../shared/ui/tone';
import { GATE_NAMES, GATE_TONE } from '../dashboard/dashboard-model';
import { activeLang, claimsRatio, specModel, stageTrack } from '../spec-view';
import { SpecRailGuide } from './spec-rail-guide';

/**
 * The spec rail (spec 024: the spec-detail context rail, Where it stands and the key line). Spec 020 (T20,
 * ISC-239) makes it the guidance spot of every tab it serves from 1120 px: on top `app-spec-rail-guide` (Next step and
 * the spec's own Waits on you, shared with the spec dashboard's rail). Below them Where it stands (stage track, ring,
 * first takeable claim, warnings, gate rows) and `[ ] previous / next spec · Esc`. `SpecPage` registers it with `RailContent` from 1120 px for every tab of the
 * Status, Data and Notes areas, so the rail is the same on each; the spec dashboard and the live board register their
 * own rail over it. It renders the spec payload the shell already loads (`ShellData.spec`) as it is; the first
 * takeable claim and whether it still loads come from the page's `SpecStore` as inputs; nothing is counted here (ISC-72).
 */
@Component({
  selector: 'app-spec-rail',
  imports: [SpecRailGuide, TranslocoPipe, UiChip, UiIcon, UiKbd, UiRing, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-rail.html',
  // While the take chip's claims load the rail says it is busy, so a reader (and a screenshot) waits for the settled rail.
  host: { '[attr.aria-busy]': 'busy() || null' },
  styleUrl: './spec-rail.css',
})
export class SpecRail {
  private readonly transloco = inject(TranslocoService);

  /** The first takeable claim, the rail's `take` chip (e.g. "takeable ISC-334"); null hides the chip. */
  readonly takeable = input<string | null>(null);
  /** Whether the claims behind the take chip still load. */
  readonly busy = input(false);

  protected readonly gateNames = GATE_NAMES;

  readonly model = specModel(inject(ShellData));

  protected readonly claimsRatio = claimsRatio(this.model);

  private readonly track = stageTrack(this.transloco, activeLang(this.transloco), this.model);
  protected readonly stageLabels = this.track.labels;
  protected readonly stageCurrent = this.track.current;
  protected readonly stageAria = this.track.aria;

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  /** The rail's gate-row icon: passed checks, stale or warning alerts, absent crosses. */
  protected railGateIcon(state: GateState): 'check' | 'triangle-alert' | 'x' {
    if (state === 'ok' || state === 'fresh') return 'check';
    return state === 'stale' || state === 'warn' ? 'triangle-alert' : 'x';
  }
}
