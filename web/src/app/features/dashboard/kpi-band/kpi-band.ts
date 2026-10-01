import { ChangeDetectionStrategy, Component, computed, input, linkedSignal } from '@angular/core';
import { type Params, RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../../shared/ui/card/card';
import { UiKpiTile } from '../../../shared/ui/kpi-tile/kpi-tile';
import { type MeterSegment, UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { type Tone, toneMark } from '../../../shared/ui/tone';

interface Fraction {
  readonly closed: number;
  readonly total: number;
}

/**
 * The fields of `DashboardModel` (`core/src/dashboard.ts`, `kpis: DashboardKpis`) the band reads, declared
 * structurally: that module cannot be type-imported under the web tsconfig yet (see `DashboardBody` in
 * `core/api.service.ts`), and the real model, the fixtures' golden JSON included, satisfies this shape as it is.
 */
export interface KpiBandModel {
  readonly kpis: {
    readonly specs: number;
    readonly building: number;
    readonly scoping: number;
    readonly master: Fraction | null;
    readonly claims: Fraction;
    readonly takeable: number;
    readonly warnings: number;
    readonly fog: number;
    readonly attention: number;
    readonly archived: number;
  };
}

/** The sections of `/w/:ws` the tiles land on; the dashboard page gives its section headings these ids. */
export const KPI_TARGETS = { specs: 'specs', warnings: 'warnings', archive: 'archive' } as const;

/** The Takeable tile's query state: the list sorted by next step, takeable specs only (design.md § Routes and state). */
export const TAKEABLE_QUERY: Params = { sort: 'next', takeable: 1 };

interface PhaseSegment extends MeterSegment {
  readonly phase: 'building' | 'scoping' | 'complete';
  readonly mark: string;
}

const PHASE_TONE: Record<PhaseSegment['phase'], Tone> = { building: 'primary', scoping: 'secondary', complete: 'accent' };

/** The band's tiles, as their `data-kpi` names them (and the Pulse card's figures their `data-stat`). */
export type KpiTile = 'master' | 'claims' | 'specs' | 'takeable' | 'attention' | 'archive';

/** Which tile shows a KPI leaf: the first segment of the refresh diff's dotted path (`claims.closed` → claims). */
const TILE_OF: Readonly<Record<string, KpiTile>> = {
  master: 'master',
  claims: 'claims',
  specs: 'specs',
  building: 'specs',
  scoping: 'specs',
  takeable: 'takeable',
  warnings: 'attention',
  fog: 'attention',
  attention: 'attention',
  archived: 'archive',
};

/** The tile a changed KPI path (`RefreshService.changedKpis`) belongs to; null for a leaf no tile shows. */
export function kpiTileOf(path: string): KpiTile | null {
  return TILE_OF[path.split('.')[0] ?? ''] ?? null;
}

/**
 * The dashboard's KPI band (T61, ported in T87 from the prototype's `app.js` kpiBand and `styles.css` kpi-band /
 * Pulse): the "Master claims" hero with its 112 px ring, Spec claims with a lime meter, Specs with the phase split and
 * its legend, Takeable now, Attention (warnings + open fog, two columns wide at wide) and Archive, every tile a
 * `ui-card` with the prototype's explicit edge and glow (hero glow only; lime, cyan, cyan, orange, violet). Below the
 * medium threshold the band gives way to the Pulse card: a 72 px ring with the master fraction, the spec-claims meter
 * and a Specs / Takeable / Attention row. Both live in the DOM and `@container kpi` shows one, so the first paint is
 * right at any width. Tiles with a destination are links on `/w/:ws`: a fragment for a section, query state for a
 * filter. Renders the model as it is; derives nothing but display arithmetic (percent, open, done count).
 */
@Component({
  selector: 'app-kpi-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiKpiTile, UiRing, UiMeter, RouterLink, TranslocoPipe],
  templateUrl: './kpi-band.html',
  styleUrl: './kpi-band.css',
})
export class KpiBand {
  readonly model = input.required<KpiBandModel>();
  /** The workspace slug; every tile link targets `/w/:ws`. */
  readonly ws = input.required<string>();
  /** The KPI paths the last refresh changed (`RefreshService.changedKpis`): their tiles get the fading tint. */
  readonly changed = input<ReadonlySet<string>>(new Set());

  /**
   * `a` / `b`, flipped by every refresh that changed a value: the two tint rules name two keyframes, so the fade
   * restarts on a tile whose value changes on two refreshes in a row. A quiet refresh keeps the letter.
   */
  private readonly pass = linkedSignal<ReadonlySet<string>, 'a' | 'b'>({
    source: this.changed,
    computation: (changed, previous) => {
      const last = previous?.value ?? 'b';
      return changed.size === 0 ? last : last === 'a' ? 'b' : 'a';
    },
  });
  private readonly tinted = computed(() => new Set([...this.changed()].map(kpiTileOf)));
  /** The `data-tint` of a tile: the current pass when the last refresh changed one of its values, else none. */
  protected readonly tint = computed(() => {
    const tinted = this.tinted();
    const pass = this.pass();
    return (tile: KpiTile): 'a' | 'b' | null => (tinted.has(tile) ? pass : null);
  });

  protected readonly targets = KPI_TARGETS;
  protected readonly takeableQuery = TAKEABLE_QUERY;
  protected readonly href = computed(() => `/w/${encodeURIComponent(this.ws())}`);
  protected readonly kpis = computed(() => this.model().kpis);

  /** Whole percent closed, floored so 100 means every master claim is closed; null without a master or claims. */
  protected readonly masterPercent = computed(() => {
    const master = this.kpis().master;
    return master === null || master.total === 0 ? null : Math.floor((master.closed / master.total) * 100);
  });
  protected readonly masterOpen = computed(() => {
    const master = this.kpis().master;
    return master === null ? 0 : Math.max(0, master.total - master.closed);
  });

  /** Specs by phase for the split meter and its legend; a phase with no spec is left out of both. */
  protected readonly phases = computed<readonly PhaseSegment[]>(() => {
    const { specs, building, scoping } = this.kpis();
    const counts = { building, scoping, complete: Math.max(0, specs - building - scoping) };
    return (Object.keys(counts) as Array<PhaseSegment['phase']>)
      .filter((phase) => counts[phase] > 0)
      .map((phase) => ({ key: phase, phase, count: counts[phase], tone: PHASE_TONE[phase], mark: toneMark(PHASE_TONE[phase]) }));
  });
}
