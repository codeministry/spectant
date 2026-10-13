import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';
import type { MeterSegment } from '../../shared/ui/meter/meter';
import { UiMeter } from '../../shared/ui/meter/meter';
import { type RelativeUnit, relativeParts } from '../../shared/ui/relative-time/relative-time';
import { UiRing } from '../../shared/ui/ring/ring';
import type { OverviewColumn } from './overview-model';
import { WsIdentity } from './ws-identity';

/** How often "Updated n s ago" re-reads the clock (design.md: every 10 s). */
const TICK_MS = 10_000;
const INTL_UNIT: Readonly<Record<RelativeUnit, Intl.RelativeTimeFormatUnit>> = { s: 'second', min: 'minute', h: 'hour', d: 'day' };

/**
 * One workspace on `/` (T65, prototype `app.js` `wsColumn`, tiles.md § index.html): the identity block (`WsIdentity`,
 * spec 024 T54: cover, then the ws-head with badge, name, path tail and "Updated n s ago"; cover and name link to
 * `/w/:ws`) and the 2 × 2 kpi-strip (master ring + fraction, spec claims with the lime meter, specs with the
 * building / scoping split, warnings + open fog with the orange edge above 0). Spec 024 T79, a deliberate deviation
 * (design.md § Übersicht, principal 2026-10-13): no Next up, no spec list and no open link here; those live on the
 * workspace dashboard the column leads to. Renders the model as it is.
 */
@Component({
  selector: 'app-workspace-column',
  imports: [TranslocoPipe, UiCard, UiMeter, UiRing, WsIdentity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-ui': 'workspace-column', '[attr.data-ws]': 'column().slug' },
  templateUrl: './workspace-column.html',
  styleUrl: './workspace-column.css',
})
export class WorkspaceColumn {
  readonly column = input.required<OverviewColumn>();

  private readonly transloco = inject(TranslocoService);
  private readonly now = signal(Date.now());

  protected readonly kpis = computed(() => this.column().kpis);

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
