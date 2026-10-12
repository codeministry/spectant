import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TechModel } from '../../../../../core/src/files';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiTerm } from '../../shared/ui/term/term';
import type { Tone } from '../../shared/ui/tone';
import { TYPE_GLYPHS, type TypeGlyphKind, UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { readSpecRows } from '../dashboard/spec-table/spec-table-model';

/** One spec as the Status tab shows it: the dashboard row's fields, the tasks it carries and the tech model's fog lines. */
export interface StatusRow {
  readonly id: string;
  readonly title: string;
  readonly type: TypeGlyphKind | null;
  readonly stage: string;
  readonly closed: number;
  readonly total: number;
  readonly tasks: { readonly landed: number; readonly total: number } | null;
  /** The `- fog:` lines of this spec in the tech model (lines, not specs; design.md § Inhalt und Modell). */
  readonly fog: number;
  /** Stage `done`: the KPI tile's "complete" (specs − building − scoping), so the summary and the divider agree. */
  readonly complete: boolean;
}

/** The summary's figures, exactly the dashboard's SPECS tile split (`kpis`); a phase with no spec is left out as there. */
export interface StatusSummary {
  readonly specs: number;
  readonly phases: ReadonlyArray<{ readonly phase: 'building' | 'scoping'; readonly count: number }>;
  readonly complete: number;
}

const STAGE_TONES: Readonly<Partial<Record<string, Tone>>> = {
  review: 'secondary',
  'code-review': 'secondary',
  build: 'primary',
  'close-pending': 'primary',
  blocked: 'error',
  close: 'success',
};

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** The rows in the dashboard model's order (the Specs list's "Stage order"); nothing is counted or derived here. */
export function statusRows(body: unknown, tech: TechModel): StatusRow[] {
  const fog = new Map(tech.specs.map((spec) => [spec.id, spec.fog.length]));
  const raw = new Map<string, Loose>();
  const list = isLoose(body) && Array.isArray(body['specs']) ? body['specs'] : [];
  for (const row of list) if (isLoose(row) && typeof row['id'] === 'string') raw.set(row['id'], row);
  return readSpecRows(body).map((row) => {
    const tasks = raw.get(row.id)?.['tasks'];
    return {
      id: row.id,
      title: row.title,
      type: row.type !== null && Object.hasOwn(TYPE_GLYPHS, row.type) ? (row.type as TypeGlyphKind) : null,
      stage: row.stage,
      closed: row.closed,
      total: row.total,
      tasks: isLoose(tasks) ? { landed: count(tasks['landed']), total: count(tasks['total']) } : null,
      fog: fog.get(row.id) ?? 0,
      complete: row.stage === 'done',
    };
  });
}

export function statusSummary(body: unknown): StatusSummary {
  const kpis = isLoose(body) && isLoose(body['kpis']) ? body['kpis'] : {};
  const specs = count(kpis['specs']);
  const building = count(kpis['building']);
  const scoping = count(kpis['scoping']);
  const phases = [
    { phase: 'building' as const, count: building },
    { phase: 'scoping' as const, count: scoping },
  ].filter((part) => part.count > 0);
  return { specs, phases, complete: Math.max(0, specs - building - scoping) };
}

/**
 * The tech page's Status tab (spec 023, T16, ISC-134.1; design.md § Status): the summary line with the SPECS tile's
 * split and the legend, then every spec in one `ui-card`: a real `<table>` at medium and wide (Type only at wide),
 * stacked 64 px rows at compact with the same fields. Open specs come in the dashboard model's order, then the divider
 * `Complete · n` and the complete specs, muted by ink and with a muted meter fill, never by `opacity`. Id and title
 * link to the spec page, named "Status of <id>"; the id copy in the table is a pointer convenience out of the tab order.
 */
@Component({
  selector: 'app-tech-status-tab',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiMeter, UiTerm, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tech-status-tab.css',
  templateUrl: './tech-status-tab.html',
  host: { '[attr.data-tier]': 'tier()' },
})
export class TechStatusTab {
  private readonly data = inject(ShellData);
  private readonly state = inject(ShellState);

  readonly model = input.required<TechModel>();

  protected readonly tier = this.state.tier;
  protected readonly ws = computed(() => this.state.ws() ?? '');

  private readonly body = computed(() => {
    const result = this.data.dashboard.hasValue() ? this.data.dashboard.value() : undefined;
    return result?.kind === 'ok' ? result.body : null;
  });
  private readonly rows = computed(() => statusRows(this.body(), this.model()));
  protected readonly open = computed(() => this.rows().filter((row) => !row.complete));
  protected readonly done = computed(() => this.rows().filter((row) => row.complete));
  protected readonly summary = computed(() => statusSummary(this.body()));
  /** Columns the divider spans: seven at wide, six without Type at medium. */
  protected readonly columns = computed(() => (this.tier() === 'wide' ? 7 : 6));

  protected stageTone(row: StatusRow): Tone {
    return row.complete ? 'neutral' : (STAGE_TONES[row.stage] ?? 'neutral');
  }
}
