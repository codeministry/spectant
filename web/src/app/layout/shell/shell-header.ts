import { ChangeDetectionStrategy, Component, computed, DOCUMENT, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { KeyboardService } from './keyboard.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { AssistantPanel } from '../assistant/assistant-panel';
import { AssistantDot } from '../assistant/assistant.service';
import { Mascot } from '../assistant/mascot';
import { areaById, areaPath, specLink } from './areas';
import { FavoritesSelect } from './favorites-select/favorites-select';
import { ShellBrand } from './shell-brand';
import { ShellData } from './shell-data.service';
import { ShellLive } from './shell-live';
import { ShellNav } from './shell-nav';
import { ShellState } from './shell-state.service';

/**
 * The shell header (ISC-73, spec 024 T34, T76): one `<header>`, one 64 px row on every width (principal 2026-10-13,
 * design.md § Across viewports), every element in it 40 px tall (44 px at `pointer: coarse`).
 *
 * From 1120 px (the wide tier) the full header: the brand rail (logo, wordmark, Workspace · Page · Spec ·
 * Area rail-selects with their labels; spec 024 T80), the favourites star (`FavoritesSelect`, spec 069, on every width
 * directly left of the palette), the palette (a field, or the 40 px icon on spec pages below 1560 px), then status
 * group, zen, the assistant dot (`AssistantPanel`, T53), settings (the settings popover, T40) and help. Below 1120 px the row is shortened: the
 * logo rail (ring only below 640 px) with the Workspace, Page and Spec selects without visible labels, the palette icon, the
 * status group and the overflow menu `⋯` with Area, Zen, Assistant, Settings and Help (`ShellMenus`). The bottom
 * hairline shows only once the page has scrolled (`.scrolled`).
 *
 * Every control carries `data-control` (in the overflow menu its entry does) so later tasks replace it in place; the
 * tools spec 024 adds (refresh, assistant, help, more) carry `data-tool`, keeping the `data-control` set of
 * ISC-140.2. The parts own their styles: `ShellBrand`, `ShellNav` (rail-selects and the deferred `ShellMenus`),
 * `ShellLive` (the status group).
 */
@Component({
  selector: 'app-shell-header',
  imports: [TranslocoPipe, UiIcon, UiIconButton, UiKbd, ShellBrand, ShellNav, FavoritesSelect, ShellLive, Mascot, AssistantPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
  host: {
    '[attr.data-zen]': "state.zen() ? '' : null",
    '(window:scroll)': 'onScroll()',
  },
})
export class ShellHeader {
  protected readonly state = inject(ShellState);
  protected readonly keyboard = inject(KeyboardService);
  /** The assistant dot (T53): the trigger toggles its mocked panel, which renders after the header while open. */
  protected readonly assistant = inject(AssistantDot);
  private readonly data = inject(ShellData);
  private readonly view = inject(DOCUMENT).defaultView;

  /** From 1120 px the full header; below it the shortened row with the overflow menu. */
  protected readonly wide = computed(() => this.state.tier() === 'wide');

  /** The page has scrolled: the header's bottom hairline shows (`.scrolled`). */
  protected readonly scrolled = signal((this.view?.scrollY ?? 0) > 0);

  /** A spec page: the palette stays the 40 px icon there below 1560 px. */
  protected readonly specPage = computed(() => this.state.specId() !== null && !this.data.specMissing());

  /** The Live area of the open spec (its first tab), or null: without a spec the indicator is a plain status. */
  protected readonly liveLink = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null || this.data.specMissing() ? null : specLink(ws, id, areaPath(areaById('live')));
  });

  protected onScroll(): void {
    this.scrolled.set((this.view?.scrollY ?? 0) > 0);
  }
}
