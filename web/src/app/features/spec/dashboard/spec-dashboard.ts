import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, type TemplateRef, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GateState } from '../../../../../../core/src/files';
import { RailContent } from '../../../layout/shell/rail-content';
import { OverlapLines } from '../../../layout/spec-head/overlap-lines';
import { UiIcon } from '../../../shared/icons/icon';
import { UiTimeLabel } from '../../../shared/time';
import { UiTerm } from '../../../shared/ui/term/term';
import type { IconName } from '../../../shared/icons/icons';
import { UiChip } from '../../../shared/ui/chip/chip';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiKpiTile } from '../../../shared/ui/kpi-tile/kpi-tile';
import { UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import type { Tone } from '../../../shared/ui/tone';
import { Brief } from '../../../shared/brief/brief';
import { AreaPlaceholder } from '../area-placeholder';
import { SpecRailGuide } from '../rail/spec-rail-guide';
import { GATE_NAMES, GATE_TONE } from './dashboard-model';
import { DashboardStore } from './dashboard.store';

export type { AreaTile } from './dashboard.store';

const GATE_ICON: Readonly<Record<GateState, IconName>> = {
  ok: 'check',
  fresh: 'check',
  stale: 'triangle-alert',
  warn: 'triangle-alert',
  missing: 'x',
  na: 'x',
};

/**
 * T53 · ISC-78 · ISC-72: the spec dashboard at `/w/:ws/s/:id`. It renders the spec payload the shell already loads
 * (`ShellData.spec`, `SpecPageModel`) as it is, or `AreaPlaceholder` while the spec route is unserved (a catch-all
 * 404). It shows the KPI band from `keyNumbers`, the idea card only where the spec has no goal sentence (spec 021,
 * ISC-250: the spec head carries that sentence, and the page never repeats it), the next step with its reasons and the stage track
 * beside one bar per lane in the model's (constitution) order, the spec's TL;DR, the five area tiles from `areas`, and
 * the Spec context (spec 024 T38, 018-B14): Waiting on you, Warnings and Gates. From 1120 px the Spec context is the
 * shell's 352 px rail (registered with `RailContent`, the board's seam) with the key line below it; under 1120 px it
 * is `#waiting`, the last block of the main column, so exactly one copy renders per width and the KPI "Waiting on you"
 * jumps to it on this page. No number is counted here (ISC-72); layouts follow design.md per tier through the shell's
 * container queries.
 *
 * Spec 020 (T19, ISC-239): below 1120 the next-step card is the guidance spot, the page's first block right under the
 * spec head: the eyebrow with the marker "Waits on you" when the spec itself waits, the catalogue sentence, the copy
 * chip, the stage track and the spec's further waiting entries as `ui-waits-block` (no limit, a chip on each row); it
 * carries `#waiting`, the KPI's target, and the Spec context's overlaps fold into a disclosure. From 1120 the rail is
 * the guidance spot and holds `#waiting`: the card moves under the KPI band, before the idea, without a chip of its own
 * (the head and the rail carry the command) and links "Waits on you: n" to the rail.
 */
@Component({
  selector: 'app-spec-dashboard',
  imports: [
    AreaPlaceholder,
    UiTerm,
    Brief,
    SpecRailGuide,
    NgTemplateOutlet,
    OverlapLines,
    RouterLink,
    TranslocoPipe,
    UiChip,
    GuidanceReasonPipe,
    UiCommandChip,
    UiDisclosure,
    UiWaitsBlock,
    UiEmptyState,
    UiIcon,
    UiKbd,
    UiKpiTile,
    UiMeter,
    UiRing,
    UiSectionHeader,
    UiSkeleton,
    UiStageTrack,
    UiTimeLabel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-dashboard.html',
  styleUrls: ['./spec-dashboard.css', './spec-dashboard-tiles.css', './spec-context.css'],
  providers: [DashboardStore],
  host: { 'data-page': 'spec-dashboard' },
})
export class SpecDashboard {
  protected readonly store = inject(DashboardStore);

  protected readonly gateNames = GATE_NAMES;

  private readonly contextTpl = viewChild<TemplateRef<unknown>>('context');

  readonly model = this.store.model;

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.store.wide() && this.store.view() === 'ok' ? (this.contextTpl() ?? null) : null)),
        bar: computed(() => null),
        badges: computed(() => null),
      },
      inject(DestroyRef),
    );
  }

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  /** The gate-row icon: passed checks, stale or warning alerts, absent crosses. */
  protected gateIcon(state: GateState): IconName {
    return GATE_ICON[state];
  }
}
