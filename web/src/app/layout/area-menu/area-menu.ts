import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsService } from '../../core/settings.service';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaPath, SPEC_AREAS, type SpecArea, specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * The area menu (ISC-76, design.md § Area menu and tab bar): the six areas of `SPEC_AREAS` in registry order, opened
 * from the header's `data-control="area"` trigger (`ShellNav`, through `ShellMenus`). A native `popover`
 * (`ui-popover`) at medium and wide; a bottom sheet (`ui-sheet`: 56 px rows, at most 75dvh, grab handle) at compact.
 * The same `<nav>` in both, never `role="menu"`.
 *
 * Each entry shows its area dot, its name, a one-line subline (the area's summary; at compact its tab list) and its
 * `g`-key hint (only on a fine pointer that can hover; T102 binds the keys). The current area carries
 * `aria-current="page"` and takes focus on open. An area whose views are not built (`built: false`) is an
 * `aria-disabled` entry without a link, its reason as visible text. Router-driven: entries are route links and the
 * current area comes from `ShellState`; the only local state is whether the compact sheet is open.
 */
@Component({
  selector: 'app-area-menu',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiKbd, UiPopover, UiSheet, UiRovingItem, UiRovingList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './area-menu.css',
  templateUrl: './area-menu.html',
})
export class AreaMenu {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly settings = inject(SettingsService);

  protected readonly areas = SPEC_AREAS;
  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly currentArea = computed(() => this.state.area() ?? 'dashboard');
  private readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());

  protected readonly sheetOpen = signal(false);
  private readonly popover = viewChild<UiPopover>('popover');

  readonly expanded = computed(() => this.sheetOpen() || (this.popover()?.open() ?? false));

  /** Opens the menu: the popover anchored to `trigger` at medium and wide, the bottom sheet at compact. */
  show(trigger: HTMLElement): void {
    if (this.compact()) this.sheetOpen.set(true);
    else this.popover()?.show(trigger);
  }

  close(): void {
    this.sheetOpen.set(false);
    this.popover()?.close();
  }

  /** `/w/:ws/s/:id/<first tab>` for an area of the open spec (the dashboard is the spec itself); null without one. */
  protected areaLink(area: SpecArea): string[] | null {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null || !this.specOpen() ? null : specLink(ws, id, areaPath(area));
  }
}
