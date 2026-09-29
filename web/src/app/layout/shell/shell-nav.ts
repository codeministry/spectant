import { LocationStrategy, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { specLink } from './areas';
import { type MenuKind, ShellMenus } from './shell-menus';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/** Where a picker's anchor leads: a router link plus an optional fragment. */
interface PickTarget {
  readonly link: readonly string[];
  readonly fragment?: string;
}

const CLOSED: Record<MenuKind, boolean> = { workspace: false, spec: false, area: false };

/**
 * A click the anchor itself should handle (new tab, new window, download, a non-primary button): the picker stays
 * shut and the browser follows the `href`.
 */
export const navigatesNatively = (event: MouseEvent): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * The header's navigation group (ISC-73): workspace picker, spec picker and area-menu trigger. The host is
 * `display: contents`, so its children sit in the header grid's `pickers` and `area` areas.
 *
 * **Pickers.** Real anchors (`href` to the workspace, the open spec, or the workspace's spec list), so middle-click,
 * cmd/ctrl-click and "copy link" keep working; a plain click or Enter opens the picker instead (`ShellMenus`). They carry
 * `href` rather than `routerLink`, because `RouterLink` navigates on every plain click and ignores `preventDefault`.
 * Until the deferred menus have loaded, a plain click navigates too. The spec picker without a workspace and the area
 * trigger without a spec are `aria-disabled` with their reason.
 *
 * Collapse order (design.md § Viewport-übergreifend): after the wordmark (`ShellBrand`), the workspace name goes to its
 * icon, then the spec title to its id; the area trigger never collapses. At compact the pickers form one pill.
 */
@Component({
  selector: 'app-shell-nav',
  imports: [NgTemplateOutlet, TranslocoPipe, UiIcon, ShellMenus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell-nav.html',
  styleUrl: './shell-nav.css',
})
export class ShellNav {
  protected readonly state = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly router = inject(Router);
  private readonly locationStrategy = inject(LocationStrategy);
  // A string locator: a value reference to ShellMenus outside the @defer block would pull it into the initial chunk.
  private readonly menus = viewChild<ShellMenus>('menus');

  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : this.data.workspaceName(ws);
  });
  protected readonly workspaceCount = computed(() => this.data.workspaceList().length);
  protected readonly specCount = computed(() => this.data.specRows().length);
  protected readonly row = this.data.currentRow;
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'dashboard'}`);
  protected readonly expanded = computed(() => this.menus()?.expanded() ?? CLOSED);

  /** `/w/:ws`, or `/` (all workspaces) when none is open. */
  protected readonly workspaceHref = computed(() => {
    const ws = this.state.ws();
    return this.href({ link: ws === null ? ['/'] : ['/w', ws] });
  });

  /** The open spec's dashboard, else the workspace's spec list (`#specs`); null without a workspace. */
  protected readonly specHref = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    if (ws === null) return null;
    return this.href(id !== null && this.specOpen() ? { link: specLink(ws, id) } : { link: ['/w', ws], fragment: 'specs' });
  });

  protected press(kind: MenuKind): void {
    this.menus()?.press(kind);
  }

  /** A trigger's click: a modified or non-primary click is left to the browser; a plain one toggles the menu. */
  protected toggle(event: MouseEvent, kind: MenuKind): void {
    const menus = this.menus();
    if (menus === undefined || navigatesNatively(event)) return;
    event.preventDefault();
    menus.toggle(kind, event.currentTarget as HTMLElement);
  }

  /** The URL `RouterLink` would put in `href`, base href included. */
  private href(target: PickTarget): string {
    const tree = this.router.createUrlTree([...target.link], { fragment: target.fragment });
    return this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(tree));
  }
}
