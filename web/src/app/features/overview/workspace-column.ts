import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiEmptyState } from '../../shared/ui/empty-state/empty-state';
import type { MeterSegment } from '../../shared/ui/meter/meter';
import { UiMeter } from '../../shared/ui/meter/meter';
import { type RelativeUnit, relativeParts } from '../../shared/ui/relative-time/relative-time';
import { UiRing } from '../../shared/ui/ring/ring';
import { PHASE_TONES } from '../dashboard/spec-table/spec-table-model';
import { monogram, type OverviewColumn } from './overview-model';

/** How often "Updated n s ago" re-reads the clock (design.md: every 10 s). */
const TICK_MS = 10_000;
const INTL_UNIT: Readonly<Record<RelativeUnit, Intl.RelativeTimeFormatUnit>> = { s: 'second', min: 'minute', h: 'hour', d: 'day' };

/**
 * One workspace on `/` (T65, prototype `app.js` `wsColumn`, tiles.md § index.html): the ws-head (monogram badge, name,
 * path tail, "Updated n s ago"), the 2 × 2 kpi-strip (master ring + fraction, spec claims with the lime meter, specs
 * with the building / scoping split, warnings + open fog with the orange edge above 0), Next up (up to three rows with
 * the command chip and the cyan left border), the 40 px dense spec list and "Open <name> →". A workspace without
 * specs shows the no-specs empty state instead of the three lists. Renders the model as it is; no cover image.
 */
@Component({
  selector: 'app-workspace-column',
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiEmptyState, UiIcon, UiMeter, UiRing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ui': 'workspace-column', '[attr.data-ws]': 'column().slug' },
  templateUrl: './workspace-column.html',
  styleUrl: './workspace-column.css',
})
export class WorkspaceColumn {
  readonly column = input.required<OverviewColumn>();

  private readonly transloco = inject(TranslocoService);
  private readonly now = signal(Date.now());

  protected readonly phaseTones = PHASE_TONES;
  protected readonly badge = computed(() => monogram(this.column().name));
  protected readonly kpis = computed(() => this.column().kpis);
  protected readonly href = computed(() => ['/w', this.column().slug]);

  /** Whole percent of master claims closed, floored as the KPI band does; null without a master. */
  protected readonly masterPercent = computed(() => {
    const master = this.kpis().master;
    return master === null || master.total === 0 ? null : Math.floor((master.closed / master.total) * 100);
  });

  /** Building then scoping, as the prototype's split meter; a phase with no spec is left out. */
  protected readonly split = computed<readonly MeterSegment[]>(() => {
    const { building, scoping } = this.kpis();
    const parts: MeterSegment[] = [
      { key: 'building', count: building, tone: 'primary' },
      { key: 'scoping', count: scoping, tone: 'secondary' },
    ];
    return parts.filter((part) => part.count > 0);
  });

  /** "12 seconds ago" in the active language, from the time the dashboard answered. */
  protected readonly ago = computed(() => {
    const { value, unit } = relativeParts(this.column().loadedAt, this.now());
    return new Intl.RelativeTimeFormat(this.transloco.getActiveLang(), { numeric: 'always', style: 'short' }).format(
      -value,
      INTL_UNIT[unit],
    );
  });

  constructor() {
    const timer = setInterval(() => {
      this.now.set(Date.now());
    }, TICK_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
    });
  }
}
