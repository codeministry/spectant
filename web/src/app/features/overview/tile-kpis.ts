import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, inject, input, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { MeterSegment } from '../../shared/ui/meter/meter';
import { UiMeter } from '../../shared/ui/meter/meter';
import type { StripKpis } from './overview-model';

/** The two arrangements of the block; the stylesheet's container query on the tile picks one. */
export type TileKpiLayout = 'row' | 'grid';

/**
 * The kpi block of a workspace tile on `/` (spec 066 T11, design.md "Kennzahlen"): master, spec claims, specs and
 * warnings without cards, each an eyebrow, a tabular value and a 4 px bar (master a bar instead of the ring; specs the
 * building / scoping split; warnings in warn ink with "· n fog" and a warning bar above 0). The tile declares
 * `container: ws-tile / inline-size`; from 420 px the four cells stand in one row, below that 2 × 2 with hairlines.
 * The block height is the tile's `--tile-kpi` token. A container query cannot set an attribute, so the stylesheet
 * also sets `--tile-kpi-layout` and a ResizeObserver on the host mirrors it into `data-layout`, the hook the probes
 * read. Renders the model as it is.
 */
@Component({
  selector: 'app-tile-kpis',
  imports: [TranslocoPipe, UiMeter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-layout]': 'layout()' },
  templateUrl: './tile-kpis.html',
  styleUrl: './tile-kpis.css',
})
export class TileKpis {
  readonly kpis = input.required<StripKpis>();

  protected readonly layout = signal<TileKpiLayout>('grid');

  /** Building then scoping, as a split bar; a phase with no spec is left out, and none leaves the bare track. */
  protected readonly split = computed<readonly MeterSegment[] | undefined>(() => {
    const { building, scoping } = this.kpis();
    const parts: readonly MeterSegment[] = [
      { key: 'building', count: building, tone: 'primary' },
      { key: 'scoping', count: scoping, tone: 'secondary' },
    ];
    const shown = parts.filter((part) => part.count > 0);
    return shown.length > 0 ? shown : undefined;
  });

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const value = getComputedStyle(host).getPropertyValue('--tile-kpi-layout').trim();
      this.layout.set(value === 'row' ? 'row' : 'grid');
    });
    observer.observe(host);
    inject(DestroyRef).onDestroy(() => {
      observer.disconnect();
    });
  }
}
