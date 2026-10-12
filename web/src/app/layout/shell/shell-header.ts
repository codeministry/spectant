import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { KeyboardService } from '../../core/keyboard.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { TabBarSlot } from '../tab-bar/tab-bar-slot';
import { areaById, areaPath, specLink } from './areas';
import { ShellBrand } from './shell-brand';
import { ShellData } from './shell-data.service';
import { ShellLive } from './shell-live';
import { ShellNav } from './shell-nav';
import { ShellState } from './shell-state.service';

/**
 * The shell header (ISC-73, spec 024 T34): one `<header>`. From 1120 px one 64 px row, the prototype header unchanged:
 * the brand rail (logo, wordmark, Workspace · Spec · Area rail-selects), the palette (a field, or the 40 px icon on spec
 * pages below 1560 px), then status group, zen, the assistant dot, settings and help. Below 1120 px two rows (design.md
 * § Viewport-übergreifend): row 1 (64, sticky) the logo rail, palette, status, dot, settings, help; row 2 (48, scrolls
 * away under row 1) the rail-selects and zen; at compact the tab-bar slot is a third row until T35 moves it. Every
 * control carries `data-control` so later tasks replace it in place; the tools spec 024 adds (refresh, interval,
 * assistant, help) carry `data-tool`, keeping the `data-control` set of ISC-140.2. The parts own their styles: `ShellBrand`,
 * `ShellNav` (rail-selects and the deferred `ShellMenus`), `ShellLive` (the status group).
 */
@Component({
  selector: 'app-shell-header',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, UiIcon, UiButton, UiIconButton, UiKbd, TabBarSlot, ShellBrand, ShellNav, ShellLive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
  host: { '[attr.data-zen]': "state.zen() ? '' : null" },
})
export class ShellHeader {
  protected readonly state = inject(ShellState);
  protected readonly keyboard = inject(KeyboardService);
  private readonly data = inject(ShellData);

  /** A spec page: the palette stays the 40 px icon there below 1560 px, as the prototype does with an area select. */
  protected readonly specPage = computed(() => this.state.specId() !== null && !this.data.specMissing());

  /** The Live area of the open spec (its first tab), or null: without a spec the indicator is a plain status. */
  protected readonly liveLink = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null || this.data.specMissing() ? null : specLink(ws, id, areaPath(areaById('live')));
  });
}
