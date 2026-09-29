import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { LockSourceService } from '../../core/lock-source.service';
import { SettingsService } from '../../core/settings.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiButton } from '../../shared/ui/button/button';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { TabBarSlot } from '../tab-bar/tab-bar-slot';
import { areaById, areaPath, SPEC_AREAS, type SpecArea, specLink } from './areas';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/** Where the spec picker leads: a router link plus an optional fragment. */
interface PickTarget {
  readonly link: readonly string[];
  readonly fragment?: string;
}

/**
 * The shell header (ISC-73): one `<header>`, 64 px sticky, one row at medium and wide, two rows at compact (row 2 is
 * the area menu, the tab-bar slot and zen). Every control carries `data-control` so T36 (pickers, palette field,
 * live indicator), T37 (area menu), T38 (zen) and T40/T41 (settings) replace it in place.
 *
 * Every control that can lead somewhere today is a real link (middle-click, copy link, focus ring): the workspace
 * picker to its workspace (or all workspaces), the spec picker to the open spec's dashboard (or the workspace's spec
 * list, `#specs`), the live indicator to the Live area while a spec is open, settings to `/settings`. The area menu is
 * a `ui-popover` of the six areas in `SPEC_AREAS` order; unbuilt areas are disabled entries with their reason
 * (ISC-76's mark). The spec picker without a workspace, the area menu without a spec and the palette (T39) are
 * `aria-disabled` with their reason.
 */
@Component({
  selector: 'app-shell-header',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    RouterLinkActive,
    TranslocoPipe,
    UiIcon,
    UiButton,
    UiIconButton,
    UiKbd,
    UiPopover,
    UiPopoverTrigger,
    UiRovingItem,
    UiRovingList,
    TabBarSlot,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-header.html',
  styleUrl: './shell-header.css',
  host: { '[attr.data-zen]': "state.zen() ? '' : null" },
})
export class ShellHeader {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly lockSource = inject(LockSourceService);
  private readonly settings = inject(SettingsService);

  protected readonly areas = SPEC_AREAS;
  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : this.data.workspaceName(ws);
  });
  protected readonly workspaceCount = computed(() => this.data.workspaceList().length);
  protected readonly specCount = computed(() => this.data.specRows().length);
  protected readonly row = this.data.currentRow;
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'dashboard'}`);
  protected readonly source = this.lockSource.source;
  protected readonly liveKey = computed(() => `shell.live.source.${this.lockSource.source()}`);
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);

  /** `/w/:ws`, or `/` (all workspaces) when none is open. */
  protected readonly workspaceLink = computed(() => {
    const ws = this.state.ws();
    return ws === null ? ['/'] : ['/w', ws];
  });

  /** The open spec's dashboard, else the workspace's spec list (`#specs`); null without a workspace. */
  protected readonly specTarget = computed<PickTarget | null>(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    if (ws === null) return null;
    if (id !== null && this.specOpen()) return { link: specLink(ws, id) };
    return { link: ['/w', ws], fragment: 'specs' };
  });

  /** The Live area of the open spec (its first tab), or null: without a spec the indicator is a plain status. */
  protected readonly liveLink = computed(() => this.areaLink(areaById('live')));

  /** `/w/:ws/s/:id/<first tab>` for an area of the open spec (the dashboard is the spec itself); null without one. */
  protected areaLink(area: SpecArea): string[] | null {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null || !this.specOpen() ? null : specLink(ws, id, areaPath(area));
  }
}
