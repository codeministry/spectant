import { ChangeDetectionStrategy, Component, computed, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState, SpecPageModel } from '../../../../../../core/src/files';
import { ApiClient } from '../../../core/api.service';
import { specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { specGuide } from '../../../layout/spec-head/spec-guide';
import { UiIcon } from '../../../shared/icons/icon';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import type { Tone } from '../../../shared/ui/tone';
import { GATE_NAMES, GATE_TONE, stageIndex, TRACK_STAGES } from '../dashboard/dashboard-model';
import { openClaims } from '../status/status-model';

/**
 * The spec rail (spec 024, the prototype's spec-detail `context-rail`: `whereCard` and the key line). Spec 020 (T20,
 * ISC-239) makes it the guidance spot of every tab it serves from 1120 px: on top "Next step" with the spec's catalogue
 * sentence (`guidanceReason`), its copy chip and the marker "Waits on you" when the spec itself waits on you; then the
 * spec's other waiting entries as `ui-waits-block` (scope `spec`: `ISC-n` / `Tn` instead of the spec number, limit 5, a
 * chip on every row, "+n more" to the spec dashboard's `#waiting`), with no `operator` checkbox: the rail leads, the
 * Tasks tab ticks. Below them Where it stands (stage track, ring, first takeable claim, warnings, gate rows) and
 * `[ ] previous / next spec · Esc`. `SpecPage` registers it with `RailContent` from 1120 px for every tab of the
 * Status, Data and Notes areas, so the rail is the same on each; the spec dashboard and the live board register their
 * own rail over it. It renders the spec payload the shell already loads (`ShellData.spec`) as it is and reads the first
 * takeable claim from the Claims route; nothing is counted here (ISC-72).
 */
@Component({
  selector: 'app-spec-rail',
  imports: [GuidanceReasonPipe, TranslocoPipe, UiChip, UiCommandChip, UiIcon, UiKbd, UiRing, UiStageTrack, UiWaitsBlock],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-rail.html',
  // While the take chip's claims load the rail says it is busy, so a reader (and a screenshot) waits for the settled rail.
  host: { '[attr.aria-busy]': "claims.isLoading() || null" },
  styleUrl: './spec-rail.css',
})
export class SpecRail {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly gateNames = GATE_NAMES;

  readonly model = computed<SpecPageModel | null>(() => {
    const result = this.data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });

  /** The guidance spot: the spec's own entry as the next step and the rest of its `waits` (`specGuide`). */
  protected readonly guide = computed(() => {
    const model = this.model();
    return model === null ? null : specGuide(model.guidance, model);
  });

  protected readonly ws = computed(() => this.state.ws() ?? '');
  /** "+n more" leads to the spec dashboard, whose `#waiting` lists every waiting entry of the spec. */
  protected readonly dashboardLink = computed(() => specLink(this.ws(), this.model()?.head.id ?? this.state.specId() ?? '').join('/'));

  private readonly params = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? undefined : { ws, id };
  });

  /** The open claims, for the `take` chip (core's `ClaimViewModel`). */
  protected readonly claims = resource({ params: () => this.params(), loader: ({ params }) => this.api.claims(params.ws, params.id) });

  /** The first takeable claim, the rail's `take` chip (prototype: "takeable ISC-334"). */
  protected readonly firstTakeable = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? (openClaims(result.body.claims).find((claim) => claim.state === 'takeable')?.id ?? null) : null;
  });

  /** The ring's fill; decorative, the "n/m claims closed" text beside it carries the value. */
  protected readonly claimsRatio = computed(() => {
    const claims = this.model()?.keyNumbers.claims;
    return claims && claims.total > 0 ? (claims.closed / claims.total) * 100 : null;
  });

  protected readonly stageLabels = computed(() => {
    this.lang();
    return TRACK_STAGES.map((stage) => this.transloco.translate(`stages.${stage}`));
  });
  protected readonly stageCurrent = computed(() => stageIndex(this.model()?.head.stage ?? ''));
  protected readonly stageAria = computed(() => {
    const labels = this.stageLabels();
    const index = Math.min(this.stageCurrent(), labels.length - 1);
    return this.transloco.translate('stages.position', { index: index + 1, total: labels.length, stage: labels[index] ?? '' });
  });

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  /** The rail's gate-row icon: passed checks, stale or warning alerts, absent crosses. */
  protected railGateIcon(state: GateState): 'check' | 'triangle-alert' | 'x' {
    if (state === 'ok' || state === 'fresh') return 'check';
    return state === 'stale' || state === 'warn' ? 'triangle-alert' : 'x';
  }
}
