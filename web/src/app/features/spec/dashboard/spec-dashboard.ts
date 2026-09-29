import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { GateState, SpecPageModel, WaitingItem } from '../../../../../../core/src/files';
import { type AreaId, areaById, areaPath, specLink } from '../../../layout/shell/areas';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import type { IconName } from '../../../shared/icons/icons';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../../shared/ui/empty-state/empty-state';
import { UiKpiTile } from '../../../shared/ui/kpi-tile/kpi-tile';
import { type MeterSegment, UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { UiSectionHeader } from '../../../shared/ui/section-header/section-header';
import { UiSkeleton } from '../../../shared/ui/skeleton/skeleton';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import type { Tone } from '../../../shared/ui/tone';
import { AreaPlaceholder } from '../area-placeholder';
import { GATE_NAMES, GATE_TONE, quoteIdea, stageIndex, TRACK_STAGES } from './dashboard-model';

/** The five area tiles in menu order, each with its provisional `g` key (the sequences themselves arrive with T102). */
const TILE_AREAS: ReadonlyArray<{ readonly id: Exclude<AreaId, 'dashboard'>; readonly key: string }> = [
  { id: 'status', key: 's' },
  { id: 'live', key: 'l' },
  { id: 'data', key: 'd' },
  { id: 'docs', key: 'o' },
  { id: 'notes', key: 'n' },
];

export interface AreaTile {
  readonly id: Exclude<AreaId, 'dashboard'>;
  readonly icon: IconName;
  readonly link: string[];
  readonly hint: string;
  /** Two translated meta lines, their numbers read from `SpecPageModel.areas`. */
  readonly lines: readonly string[];
  /** A mono chip on the first line (the Live tile's session name), full text in `title`. */
  readonly mono?: string;
}

type TileLine = readonly [string, Readonly<Record<string, unknown>>];
const DOC_KEYS = ['plan', 'design', 'constitution'] as const;

/** The meta lines of each area tile as i18n keys: numbers straight from `model.areas`, never recounted (ISC-72). */
function tileLines(model: SpecPageModel, id: AreaTile['id'], t: (key: string) => string): readonly TileLine[] {
  const { areas } = model;
  switch (id) {
    case 'status':
      return [
        ['specDashboard.tiles.status.entries', { count: areas.status.timelineEntries }],
        ['specDashboard.tiles.status.warnings', { count: areas.status.warnings }],
      ];
    case 'live':
      return [
        areas.live.agentsWorking > 0
          ? ['specDashboard.tiles.live.working', { count: areas.live.agentsWorking }]
          : ['specDashboard.tiles.live.idle', {}],
        ['specDashboard.tiles.live.source', { source: areas.live.lockSource }],
      ];
    case 'data':
      return [
        ['specDashboard.tiles.data.claims', areas.data.claims],
        areas.data.tasks === null ? ['specDashboard.tiles.data.noTasks', {}] : ['specDashboard.tiles.data.tasks', areas.data.tasks],
      ];
    case 'docs':
      return [
        DOC_KEYS.some((doc) => areas.docs[doc])
          ? ['specDashboard.tiles.docs.present', { names: DOC_KEYS.filter((doc) => areas.docs[doc]).map((doc) => t(`specDashboard.docNames.${doc}`)).join(' · ') }]
          : ['specDashboard.tiles.docs.none', {}],
        ['specDashboard.tiles.docs.decisions', { count: areas.docs.decisions }],
      ];
    case 'notes':
      return [
        areas.notes.count === null ? ['specDashboard.tiles.notes.later', {}] : ['specDashboard.tiles.notes.count', { count: areas.notes.count }],
        ['specDashboard.tiles.notes.board', { count: areas.board.rounds }],
      ];
  }
}

/**
 * T53 · ISC-78 · ISC-72: the spec dashboard at `/w/:ws/s/:id`. It renders the spec payload the shell already loads
 * (`ShellData.spec`, `SpecPageModel`) as it is, or `AreaPlaceholder` while the spec route is unserved (a catch-all
 * 404). It shows the KPI band from `keyNumbers`, the idea quote, the next step with its
 * reasons and the stage track, Waiting on you, one bar per lane in the model's (constitution) order, the five area
 * tiles from `areas`, then warnings and gates. No number is counted here (ISC-72); layouts follow design.md per tier
 * through the shell's container queries.
 */
@Component({
  selector: 'app-spec-dashboard',
  imports: [
    AreaPlaceholder,
    RouterLink,
    TranslocoPipe,
    UiCommandChip,
    UiEmptyState,
    UiIcon,
    UiKpiTile,
    UiMeter,
    UiRing,
    UiSectionHeader,
    UiSkeleton,
    UiStageTrack,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-dashboard.html',
  styleUrl: './spec-dashboard.css',
  host: { 'data-page': 'spec-dashboard' },
})
export class SpecDashboard {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);
  private readonly transloco = inject(TranslocoService);

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly gateNames = GATE_NAMES;

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

  protected readonly quote = computed(() => {
    const text = this.model()?.ideaQuote;
    return text ? quoteIdea(text, this.lang()) : null;
  });

  /** At most three reasons (design.md § Next step). */
  protected readonly reasons = computed(() => this.model()?.next.reasons.slice(0, 3) ?? []);

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
        icon: area.icon,
        link: this.link(areaPath(area)),
        hint: `g ${key}`,
        lines: tileLines(model, id, t).map(([line, params]) => t(line, params)),
        ...(lock ? { mono: lock.session } : {}),
      };
    });
  });

  protected gateTone(state: GateState): Tone {
    return GATE_TONE[state];
  }

  protected waitingKey(item: WaitingItem): string {
    return `${item.kind}-${item.ref}`;
  }

  protected reload(): void {
    this.data.spec.reload();
  }
}
