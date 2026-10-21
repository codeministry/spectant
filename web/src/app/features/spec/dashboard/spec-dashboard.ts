import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, type TemplateRef, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState, SpecPageModel } from '../../../../../../core/src/files';
import { type AreaId, areaById, areaPath, specLink } from '../../../layout/shell/areas';
import { RailContent } from '../../../layout/shell/rail-content';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { OverlapLines } from '../../../layout/spec-head/overlap-lines';
import { overlapLines, overlapsIn } from '../../../core/model/overlap';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiTimeLabel } from '../../../shared/time';
import { UiTerm } from '../../../shared/ui/term/term';
import type { IconName } from '../../../shared/icons/icons';
import { UiChip } from '../../../shared/ui/chip/chip';
import { guidanceEntryOf } from '../../../core/model/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiWaitsBlock } from '../../../shared/ui/guidance/waits-block';
import { UiDisclosure } from '../../../shared/ui/overlay/disclosure';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiKbd } from '../../../shared/ui/kbd/kbd';
import { UiKpiTile } from '../../../shared/ui/kpi-tile/kpi-tile';
import { type MeterSegment, UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import type { Tone } from '../../../shared/ui/tone';
import { Brief, type BriefModel } from '../../../shared/brief/brief';
import { AreaPlaceholder } from '../area-placeholder';
import { SpecRailGuide } from '../rail/spec-rail-guide';
import { stageIndex, TRACK_STAGES } from '../../../core/model/stage-track';
import { GATE_NAMES, GATE_TONE } from './dashboard-model';

/** The five area tiles in menu order, each with its provisional `g` key (the sequences themselves arrive with T102). */
const TILE_AREAS: ReadonlyArray<{ readonly id: Exclude<AreaId, 'dashboard'>; readonly key: string }> = [
  { id: 'status', key: 's' },
  { id: 'live', key: 'l' },
  { id: 'data', key: 'd' },
  { id: 'library', key: 'o' },
  { id: 'notes', key: 'n' },
];

export interface AreaTile {
  readonly id: Exclude<AreaId, 'dashboard'>;
  readonly link: string[];
  readonly hint: string;
  /** Two translated meta lines, their numbers read from `SpecPageModel.areas`. */
  readonly lines: readonly string[];
  /** A mono chip on the first line (the Live tile's session name), full text in `title`. */
  readonly mono?: string;
}

const GATE_ICON: Readonly<Record<GateState, IconName>> = {
  ok: 'check',
  fresh: 'check',
  stale: 'triangle-alert',
  warn: 'triangle-alert',
  missing: 'x',
  na: 'x',
};

type TileLine = readonly [string, Readonly<Record<string, unknown>>];
const DOC_KEYS = ['plan', 'design', 'constitution'] as const;

/** The meta lines of each area tile as i18n keys: numbers straight from `model.areas`, never recounted (ISC-72). */
function tileLines(model: SpecPageModel, id: AreaTile['id'], t: (key: string) => string): readonly TileLine[] {
  const { areas } = model;
  switch (id) {
    case 'status':
      return [
        [areas.status.timelineEntries === 1 ? 'specDashboard.tiles.status.entries.one' : 'specDashboard.tiles.status.entries.other', { count: areas.status.timelineEntries }],
        [areas.status.warnings === 1 ? 'specDashboard.tiles.status.warnings.one' : 'specDashboard.tiles.status.warnings.other', { count: areas.status.warnings }],
      ];
    case 'live':
      return [
        areas.live.agentsWorking > 0
          ? [areas.live.agentsWorking === 1 ? 'specDashboard.tiles.live.working.one' : 'specDashboard.tiles.live.working.other', { count: areas.live.agentsWorking }]
          : ['specDashboard.tiles.live.idle', {}],
        ['specDashboard.tiles.live.source', { source: areas.live.lockSource }],
      ];
    case 'data':
      return [
        ['specDashboard.tiles.data.claims', areas.data.claims],
        areas.data.tasks === null ? ['specDashboard.tiles.data.noTasks', {}] : ['specDashboard.tiles.data.tasks', areas.data.tasks],
      ];
    case 'library':
      return [
        DOC_KEYS.some((doc) => areas.docs[doc])
          ? ['specDashboard.tiles.library.present', { names: DOC_KEYS.filter((doc) => areas.docs[doc]).map((doc) => t(`specDashboard.docNames.${doc}`)).join(' · ') }]
          : ['specDashboard.tiles.library.none', {}],
        [areas.docs.decisions === 1 ? 'specDashboard.tiles.library.decisions.one' : 'specDashboard.tiles.library.decisions.other', { count: areas.docs.decisions }],
      ];
    case 'notes':
      return [
        areas.notes.count === null ? ['specDashboard.tiles.notes.later', {}] : [areas.notes.count === 1 ? 'specDashboard.tiles.notes.count.one' : 'specDashboard.tiles.notes.count.other', { count: areas.notes.count }],
        [areas.board.rounds === 1 ? 'specDashboard.tiles.notes.board.one' : 'specDashboard.tiles.notes.board.other', { count: areas.board.rounds }],
      ];
  }
}

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
  host: { 'data-page': 'spec-dashboard' },
})
export class SpecDashboard {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly gateNames = GATE_NAMES;

  /** From 1120 px the Spec context lives in the shell's rail; below it closes the main column. */
  protected readonly wide = computed(() => this.state.tier() === 'wide');
  private readonly contextTpl = viewChild<TemplateRef<unknown>>('context');

  /**
   * Spec 025 (T29, ISC-164.1): the overlaps of this spec, both sides of each pair (core puts the warning on the
   * waiting spec's dashboard row only). Beside the head from 1120 px they show as a short form with an anchor on the
   * head's line; below, the full line repeats here. The spec model's own overlap warning is left to this block.
   */
  protected readonly overlaps = computed(() => {
    const dashboard = this.data.dashboard.value();
    const id = this.model()?.head.id ?? this.state.specId() ?? '';
    return overlapLines(overlapsIn(dashboard?.kind === 'ok' ? dashboard.body : null), id);
  });
  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly contextWarnings = computed(() => (this.model()?.warnings ?? []).filter((warning) => warning.kind !== 'spec-overlap'));

  readonly model = computed<SpecPageModel | null>(() => {
    const result = this.data.spec.value();
    return result?.kind === 'ok' ? result.body : null;
  });

  /** `loading` only before the first answer; a reload keeps the page on screen. */
  protected readonly view = computed<'loading' | 'ok' | 'unserved' | 'error'>(() => {
    const result = this.data.spec.value();
    if (result === undefined) return this.data.spec.error() ? 'error' : 'loading';
    if (result.kind === 'ok') return 'ok';
    if (result.kind === 'not-found' && !result.served) return 'unserved';
    return 'error';
  });

  /** `/w/:ws/s/:id/<tab>` as a router link array, or its path string for `ui-kpi-tile`'s `href`. */
  protected link(tab = ''): string[] {
    return specLink(this.state.ws() ?? '', this.state.specId() ?? '', tab);
  }
  protected href(tab: string): string {
    return this.link(tab).join('/');
  }

  /** The ring's fill: the closed share of the claims, drawn only; its text is the fraction beside it. */
  protected readonly claimsRatio = computed(() => {
    const claims = this.model()?.keyNumbers.claims;
    return claims && claims.total > 0 ? (claims.closed / claims.total) * 100 : null;
  });

  /** One meter segment per gate, coloured by its state as the model reports it. */
  protected readonly gateSegments = computed<readonly MeterSegment[]>(() => {
    const gates = this.model()?.gates;
    return gates ? GATE_NAMES.map((name) => ({ key: name, count: 1, tone: GATE_TONE[gates[name].state] })) : [];
  });

  /** At most three reasons (design.md § Next step); shown only where the guidance names no entry for the spec. */
  protected readonly reasons = computed(() => this.model()?.next.reasons.slice(0, 3) ?? []);

  /**
   * Spec 020 (T19, ISC-239, ISC-237.1): the spec's own guidance entry, whose catalogue sentence stands in the next-step
   * card as it does on every other surface; null without guidance or without an open item (the reasons stay then).
   */
  protected readonly entry = computed(() => {
    const m = this.model();
    return guidanceEntryOf(m?.guidance, m?.head.id);
  });
  /** The spec's entries in "Waits on you", in core's order (ISC-237). */
  protected readonly waits = computed(() => this.model()?.guidance?.waits ?? []);
  /** Whether the spec itself waits on the principal: the marker beside the guide's eyebrow. */
  protected readonly selfWaits = computed(() => {
    const own = this.entry();
    return own !== null && this.waits().includes(own);
  });
  /** The spec's other waiting entries (claims, tasks, questions): the guide lists them under its own step. */
  protected readonly alsoWaiting = computed(() => {
    const own = this.entry();
    return this.waits().filter((entry) => entry !== own);
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

  protected readonly tiles = computed<readonly AreaTile[]>(() => {
    const model = this.model();
    if (model === null) return [];
    this.lang();
    const t = (key: string, params?: Readonly<Record<string, unknown>>): string => this.transloco.translate(key, params);
    return TILE_AREAS.map(({ id, key }) => {
      const area = areaById(id);
      const lock = id === 'live' ? model.areas.live.lock : null;
      return {
        id,
        link: this.link(areaPath(area)),
        hint: `g ${key}`,
        lines: tileLines(model, id, t).map(([line, params]) => t(line, params)),
        ...(lock ? { mono: lock.session } : {}),
      };
    });
  });

  /** The spec's slice of `specs/tldr.md` in the Brief's shape; null when no TL;DR item names this spec. */
  protected readonly brief = computed<BriefModel | null>(() => {
    const tldr = this.model()?.tldr;
    return tldr?.brief ? { markdown: tldr.brief, generated: tldr.generated, stale: tldr.stale } : null;
  });

  constructor() {
    inject(RailContent).register(
      {
        blocks: computed(() => (this.wide() && this.view() === 'ok' ? (this.contextTpl() ?? null) : null)),
        bar: computed(() => null),
        badges: computed(() => null),
      },
      inject(DestroyRef),
    );
  }

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  /** The prototype's gate-row icon: passed checks, stale or warning alerts, absent crosses. */
  protected gateIcon(state: GateState): IconName {
    return GATE_ICON[state];
  }

  protected reload(): void {
    this.data.spec.reload();
  }
}
