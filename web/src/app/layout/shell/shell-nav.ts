import { LocationStrategy } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { specLink, workspacePageById } from './areas';
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
 * The header's navigation group (ISC-73): workspace picker, spec picker and area-menu trigger. The host is a
 * flex rail: on the brand rail from 1120 px, its own bordered rail in header row 2 below (spec 024 T34).
 *
 * **Pickers.** Real anchors (`href` to the workspace, the open spec, or the workspace's spec list), so middle-click,
 * cmd/ctrl-click and "copy link" keep working; a plain click or Enter opens the picker instead (`ShellMenus`). They carry
 * `href` rather than `routerLink`, because `RouterLink` navigates on every plain click and ignores `preventDefault`.
 * Until the deferred menus have loaded, a plain click navigates too. At workspace scope the area trigger names the
 * current page (design.md § Area menu); for a workspace the server does not know, or a spec it does not list, it is
 * `aria-disabled` with its reason.
 *
 * **Pills (ISC-140.2).** Every segment carries a label (`[data-pill-label]`: Workspace, Specs or Spec, Area) and its
 * value (`[data-pill-value]`), so no segment is a bare number; the picker segments have no leading icon, the label
 * carries their meaning. Outside a workspace (`/`, `/help`, `/settings`) the spec and area pills are not rendered
 * rather than showing `0`, and the workspace pill reads "All · n".
 *
 * Collapse order (design.md § Viewport-übergreifend): after the wordmark (`ShellBrand`), the spec title goes to its
 * id; numbers and ids never shorten, only names ellipsize. Labels sit inline before the value; compact stacks them
 * and drops the chevrons.
 */
@Component({
  selector: 'app-shell-nav',
  imports: [TranslocoPipe, UiIcon, ShellMenus],
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
  /** A workspace in the route: the spec and area pills render only then (ISC-140.2). */
  protected readonly inWorkspace = computed(() => this.state.ws() !== null);
  protected readonly row = this.data.currentRow;
  /**
   * The open spec's short name (prototype `.specs-select`: `002` + `web-console`, spec 024 T74): the folder slug without
   * its `NNN-` prefix, else the title for a row without a slug. The full title stays the pill's tooltip.
   */
  protected readonly specName = computed(() => {
    const row = this.row();
    if (row === null) return null;
    const short = row.slug?.replace(/^\d+-/, '') ?? '';
    return short === '' ? row.title : short;
  });
  protected readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());
  /**
   * The workspace page the area trigger names; null without one, with a spec open, or for a workspace the server does
   * not know (`ShellState` is route-only and calls any `/w/:ws` the Specs page), so the trigger stays disabled there.
   */
  protected readonly workspacePage = computed(() => {
    const id = this.state.route().wsPage;
    // A story page (`idea`) is no menu page: the trigger names the board it is reached from (spec 008). The tech page
    // is one (spec 023, T20): the trigger shows `book-open` and "Tech" there.
    if (id === null || this.specOpen() || this.data.workspaceMissing()) return null;
    return workspacePageById(id === 'idea' ? 'board' : id);
  });
  /** The disabled trigger's reason: an unknown workspace has no pages to switch, elsewhere a spec is what is missing. */
  protected readonly areaReason = computed(() =>
    this.state.ws() !== null && this.data.workspaceMissing() ? 'shell.area.needsWorkspace' : 'shell.area.needsSpec',
  );
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
