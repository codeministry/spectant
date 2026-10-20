import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type Params, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiCard } from '../../../shared/ui/card/card';
import { UiKpiTile } from '../../../shared/ui/kpi-tile/kpi-tile';
import { type MeterSegment, UiMeter } from '../../../shared/ui/meter/meter';
import { UiRing } from '../../../shared/ui/ring/ring';
import { PHASE_TONE } from '../../../shared/ui/phase-tone';
import { toneMark } from '../../../shared/ui/tone';
import { FOG } from '../spec-table/spec-table-model';

interface Fraction {
  readonly closed: number;
  readonly total: number;
}

type StageGroup = 'building' | 'scoping' | 'complete';

/**
 * The fields of `DashboardModel` (`core/src/dashboard.ts`, `kpis: DashboardKpis`) the band reads, declared
 * structurally: that module cannot be type-imported under the web tsconfig yet (see `DashboardBody` in
 * `core/api.service.ts`), and the real model, the fixtures' golden JSON included, satisfies this shape as it is.
 * Every reference a tile shows is a field of the model (spec 021, ISC-245, ISC-255); an optional one the core has not
 * derived renders as a dash, never as a number computed here.
 */
export interface KpiBandModel {
  readonly kpis: {
    readonly specs: number;
    readonly stageGroups?: Readonly<Record<StageGroup, number>>;
    readonly master: Fraction | null;
    /** The master's open claims, served (`masterOpen`); the band never subtracts. */
    readonly masterOpen?: number | null;
    /** The master's whole percent closed, served (`masterPercent`): the ring's value; the band never divides. */
    readonly masterPercent?: number | null;
    readonly claims: Fraction;
    readonly takeable: number;
    readonly openClaims?: number;
    readonly warnings: number;
    readonly specsWithWarnings?: number;
    readonly fog: number;
    readonly specsWithFog?: number;
  };
}

/** The sections of `/w/:ws` the tiles land on; the dashboard page gives its section headings these ids. */
export const KPI_TARGETS = { specs: 'specs', warnings: 'warnings' } as const;

/** The Takeable tile's query state: the list sorted by next step, takeable specs only (design.md § Routes and state). */
export const TAKEABLE_QUERY: Params = { sort: 'next', takeable: 1 };

/** The Open fog tile's query state: the list on its fog chip, the specs with open fog only. */
export const FOG_QUERY: Params = { phase: FOG };

interface PhaseSegment extends MeterSegment {
  readonly phase: StageGroup;
  readonly mark: string;
}

const PHASE_ORDER: readonly StageGroup[] = ['building', 'scoping', 'complete'];

/** The band's tiles, as their `data-kpi` names them (and the Pulse card's figures their `data-stat`). */
export type KpiTile = 'master' | 'claims' | 'specs' | 'takeable' | 'warnings' | 'fog';

/** Which tile shows a KPI leaf: the first segment of the refresh diff's dotted path (`claims.closed` → claims). */
const TILE_OF: Readonly<Record<string, KpiTile>> = {
  master: 'master',
  claims: 'claims',
  specs: 'specs',
  stageGroups: 'specs',
  takeable: 'takeable',
  openClaims: 'takeable',
  warnings: 'warnings',
  specsWithWarnings: 'warnings',
  fog: 'fog',
  specsWithFog: 'fog',
};

/** The tile a changed KPI path (`RefreshService.changedKpis`) belongs to; null for a leaf no tile shows. */
export function kpiTileOf(path: string): KpiTile | null {
  return TILE_OF[path.split('.')[0] ?? ''] ?? null;
}

/**
 * The dashboard's KPI band (T61, ported in T87 from the prototype's `app.js` kpiBand and `styles.css` kpi-band /
 * Pulse; six tiles since spec 021, ISC-245): Master claims with its ring (112 px, 88 at wide), Spec claims with a lime
 * meter, Specs (complete of all, with the stage-group split; its legend below wide only), Takeable now (of the open claims), Warnings and Open
 * fog (each with the specs it sits in). Every tile shows its number with a reference, a fraction or "of N", and a
 * statement line that says in words which direction is good; the archived count lives in the spec list's head. Every
 * tile is a `ui-card` with the prototype's explicit edge and glow (hero glow only). The shell's tier (`data-tier`)
 * places them: wide one row with a wider master tile, medium three columns by two rows, compact the Pulse card (the
 * master row and the spec-claims meter over a 2 × 2 grid). Both forms live in the DOM and the tier shows one. Tiles
 * with a destination are links on `/w/:ws`: a fragment for a section, query state for a filter. Renders the model as
 * it is; derives no number: the open count and the ring percent are served fields too (ISC-255).
 */
@Component({
  selector: 'app-kpi-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiCard, UiKpiTile, UiRing, UiMeter, RouterLink, TranslocoPipe],
  host: { '[attr.data-tier]': 'tier()', '[attr.lang]': 'lang()' },
  templateUrl: './kpi-band.html',
  styleUrl: './kpi-band.css',
})
export class KpiBand {
  readonly model = input.required<KpiBandModel>();
  /** The workspace slug; every tile link targets `/w/:ws`. */
  readonly ws = input.required<string>();
  /** The KPI paths the last refresh changed (`RefreshService.changedKpis`): their tiles get the fading tint. */
  readonly changed = input<ReadonlySet<string>>(new Set());

  private readonly transloco = inject(TranslocoService);
  /** The interface language on the host, so the statement lines hyphenate in it (`hyphens: auto`). */
  protected readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  protected readonly tier = inject(ShellState).tier;
  /**
   * The wide one-row band (spec 021, P3 heights): the master tile drops to the default tile's 16 px padding with an
   * 88 px ring (40 px number, kpi-band.css), so the band stays one short row; medium keeps the 112 px hero.
   */
  protected readonly wide = computed(() => this.tier() === 'wide');

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
  protected readonly fogQuery = FOG_QUERY;
  protected readonly href = computed(() => `/w/${encodeURIComponent(this.ws())}`);
  protected readonly kpis = computed(() => this.model().kpis);

  /** Specs by stage group for the split meter and its legend, as the model counts them; an empty group is left out. */
  protected readonly phases = computed<readonly PhaseSegment[]>(() => {
    const groups = this.kpis().stageGroups;
    if (groups === undefined) return [];
    return PHASE_ORDER.filter((phase) => groups[phase] > 0).map((phase) => ({
      key: phase,
      phase,
      count: groups[phase],
      tone: PHASE_TONE[phase],
      mark: toneMark(PHASE_TONE[phase]),
    }));
  });

  /** The catalogue key of "in n of N specs" in the plural form the total `total` takes. */
  protected inSpecsKey(total: number): string {
    return total === 1 ? 'kpi.inSpecs.one' : 'kpi.inSpecs.other';
  }
}
