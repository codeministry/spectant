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
 * The shell header (ISC-73): one `<header>`, 64 px sticky, one row at medium and wide, two rows at compact (48 + 44;
 * row 2 is the area trigger, the tab-bar slot and zen). Every control carries `data-control` so later tasks replace it
 * in place. The parts own their styles: `ShellBrand` (living ring, wordmark), `ShellNav` (pickers, area trigger, and the
 * deferred `ShellMenus`), `ShellLive` (the indicator). This component keeps the grid, the palette trigger (opens
 * `app-command-palette` through `KeyboardService.paletteOpen`, spec 001 T66), zen (T38) and settings (T40/T41: help moves into its sheet).
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

  /** The Live area of the open spec (its first tab), or null: without a spec the indicator is a plain status. */
  protected readonly liveLink = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null || this.data.specMissing() ? null : specLink(ws, id, areaPath(areaById('live')));
  });
}
