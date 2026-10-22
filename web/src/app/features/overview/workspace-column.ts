import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';
import { type RelativeUnit, relativeParts } from '../../shared/ui/relative-time/relative-time';
import { UiWsCover } from '../../shared/ui/ws-badge/ws-cover';
import { WS_ACCENT_TOKENS, wsAccent } from '../../shared/ui/ws-badge/ws-identity';
import type { OverviewColumn } from './overview-model';
import { TileKpis } from './tile-kpis';
import { TileList } from './tile-list';
import { WsIdentity } from './ws-identity';

/** How often "Updated n s ago" re-reads the clock (design.md: every 10 s). */
const TICK_MS = 10_000;
const INTL_UNIT: Readonly<Record<RelativeUnit, Intl.RelativeTimeFormatUnit>> = { s: 'second', min: 'minute', h: 'hour', d: 'day' };

/**
 * The edge colour of a tile: the accent its name hash picks, as the badge and the cover take it. The loading and
 * unreadable tiles of the page use it too, so a tile keeps its edge colour from loading to loaded.
 */
export function tileEdge(name: string): string {
  return WS_ACCENT_TOKENS[wsAccent(name)].mark;
}

/**
 * One workspace tile on `/` (spec 066 T12, ISC-516): one `ui-card` with the 3 px edge in the workspace's accent and no
 * glow, holding four fixed tracks in this order (`_tile.css`): the head (`WsIdentity`: badge, name, path tail and
 * "Updated n s ago"), the preview (`ui-ws-cover` in the `tile` shape, the screenshot or the neutral placeholder,
 * linking to `/w/:ws`), the list area (`TileList`: what is in work, then what waits, at most three rows) and the KPIs
 * (`TileKpis`). The track heights are tokens per shell tier, so every tile of a row is equally tall and its blocks
 * start on one line whatever the workspace holds. No part of the tile is a mock: name, path, logo (spec 016),
 * screenshot, lists and KPIs are core's data, and badge, cover and edge take the accent of the name hash, so the tile
 * carries no demo chip (ISC-149.1). Renders the model as it is.
 */
@Component({
  selector: 'app-workspace-column',
  imports: [RouterLink, TileKpis, TileList, TranslocoPipe, UiCard, UiWsCover, WsIdentity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ws-tile', 'data-ui': 'workspace-column', '[attr.data-ws]': 'column().slug' },
  templateUrl: './workspace-column.html',
  styleUrl: './workspace-column.css',
})
export class WorkspaceColumn {
  readonly column = input.required<OverviewColumn>();

  private readonly transloco = inject(TranslocoService);
  private readonly now = signal(Date.now());

  protected readonly edge = computed(() => tileEdge(this.column().name));
  protected readonly href = computed(() => ['/w', this.column().slug]);

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
