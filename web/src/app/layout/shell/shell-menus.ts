import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { SettingsService } from '../../core/settings.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { AreaMenu } from '../area-menu/area-menu';
import { specLink } from './areas';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/** The header's three menus: the two pickers and the area menu. */
export type MenuKind = 'workspace' | 'spec' | 'area';

/** One row of the workspace picker. */
interface WorkspaceEntry {
  readonly slug: string;
  readonly name: string;
  readonly readable: boolean;
  /** Active specs (`counts.specs`, core's `DashboardKpis`); null when the workspace cannot be read. */
  readonly specs: number | null;
  readonly current: boolean;
}

/** `counts.specs` read narrowly: `WorkspaceListEntry.counts` is untyped in web (api.service.ts). */
const specCountOf = (counts: unknown): number | null => {
  if (typeof counts !== 'object' || counts === null) return null;
  const specs = (counts as Readonly<Record<string, unknown>>)['specs'];
  return typeof specs === 'number' ? specs : null;
};

/**
 * The header's menus (ISC-73, ISC-76, ISC-97), loaded after first render (`@defer (on immediate)` in `ShellNav`) so the
 * overlay primitives and the list styles stay out of the initial bundle; until then a picker anchor simply navigates.
 *
 * - **Workspace picker**: "All workspaces", every workspace from `ShellData.workspaces()` as a link with its spec count
 *   (or "cannot be read"), the current one marked, and "Manage workspaces" → `/settings`.
 * - **Spec picker**: "All specs in …", then the workspace's specs (id, title, stage chip), the open one marked.
 * - Both are a `ui-popover` at medium and wide and a bottom `ui-sheet` at compact; focus lands on the current entry.
 * - **Area menu**: `app-area-menu` (`layout/area-menu/`, T37): a popover at medium and wide, a bottom sheet at compact.
 *
 * The host is taken out of the header grid (`position: absolute`); the panels live in the top layer.
 */
@Component({
  selector: 'app-shell-menus',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiIcon, UiChip, UiPopover, UiSheet, UiRovingItem, UiRovingList, AreaMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-menus.html',
  styleUrl: './shell-menus.css',
})
export class ShellMenus {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly settings = inject(SettingsService);

  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : this.data.workspaceName(ws);
  });

  protected readonly workspaceEntries = computed<readonly WorkspaceEntry[]>(() => {
    const ws = this.state.ws();
    return this.data.workspaceList().map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      readable: entry.readable,
      specs: entry.readable ? specCountOf(entry.counts) : null,
      current: entry.slug === ws,
    }));
  });

  /** Which picker's bottom sheet is open (compact only; the popovers keep their own state). */
  protected readonly sheet = signal<MenuKind | null>(null);
  private openAtPress: boolean | null = null;
  private readonly workspacePopover = viewChild<UiPopover>('workspacePopover');
  private readonly specPopover = viewChild<UiPopover>('specPopover');
  private readonly areaMenu = viewChild(AreaMenu);

  readonly expanded = computed<Record<MenuKind, boolean>>(() => ({
    workspace: this.sheet() === 'workspace' || (this.workspacePopover()?.open() ?? false),
    spec: this.sheet() === 'spec' || (this.specPopover()?.open() ?? false),
    area: this.areaMenu()?.expanded() ?? false,
  }));

  /**
   * A press on a trigger while its popover is open light-dismisses it before the click arrives; the state at press time
   * decides, so that click closes instead of reopening (as `UiPopoverTrigger` does).
   */
  press(kind: MenuKind): void {
    this.openAtPress = this.expanded()[kind];
  }

  /** Opens `kind`'s menu anchored to `trigger`, or closes it when it was open. */
  toggle(kind: MenuKind, trigger: HTMLElement): void {
    const wasOpen = this.openAtPress ?? this.expanded()[kind];
    this.openAtPress = null;
    if (wasOpen) {
      this.close(kind);
      return;
    }
    // WebKit does not focus a clicked link; the popover and the sheet return focus to whatever had it on open.
    trigger.focus();
    if (kind === 'area') this.areaMenu()?.show(trigger);
    else if (this.compact()) this.sheet.set(kind);
    else this.popover(kind)?.show(trigger);
  }

  protected close(kind: MenuKind): void {
    if (kind === 'area') {
      this.areaMenu()?.close();
      return;
    }
    if (this.sheet() === kind) this.sheet.set(null);
    this.popover(kind)?.close();
  }

  protected sheetOpenChange(kind: MenuKind, open: boolean): void {
    if (!open && this.sheet() === kind) this.sheet.set(null);
  }

  protected specEntryLink(id: string): string[] {
    return specLink(this.state.ws() ?? '', id);
  }

  private popover(kind: Exclude<MenuKind, 'area'>): UiPopover | undefined {
    return { workspace: this.workspacePopover, spec: this.specPopover }[kind]();
  }
}
