import { LocationStrategy } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { specLink, workspacePageById } from './areas';
import { type AreaEntry, type MenuKind, ShellMenus } from './shell-menus';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

/** Where a picker's anchor leads: a router link plus an optional fragment. */
interface PickTarget {
  readonly link: readonly string[];
  readonly fragment?: string;
}

const CLOSED: Record<MenuKind, boolean> = { workspace: false, page: false, spec: false, area: false, more: false, settings: false };

/**
 * A click the anchor itself should handle (new tab, new window, download, a non-primary button): the picker stays
 * shut and the browser follows the `href`.
 */
export const navigatesNatively = (event: MouseEvent): boolean =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;

/**
 * The header's navigation group (ISC-73): Workspace · Page · Spec · Area (spec 024 T80, ISC-150.2, principal
 * 2026-10-13). The host is a flex rail on the header's brand rail, one row on every width (spec 024 T76). The PAGE
 * select names the open workspace page (Specs on a spec page) and opens the workspace's pages; it stays in the row on
 * every width. The Area select is there only on a spec page and lists the six spec areas; below 1120 px it is an entry
 * of the overflow menu `⋯` (`areaEntry`, rendered by `ShellMenus`). The header's `⋯` and settings buttons open their
 * menus through `toggle` / `press` here, the one owner of the deferred menus.
 *
 * **Pickers.** Real anchors (`href` to the workspace, the open spec, or the workspace's spec list), so middle-click,
 * cmd/ctrl-click and "copy link" keep working; a plain click or Enter opens the picker instead (`ShellMenus`). They carry
 * `href` rather than `routerLink`, because `RouterLink` navigates on every plain click and ignores `preventDefault`.
 * Until the deferred menus have loaded, a plain click navigates too. For a workspace the server does not know the PAGE
 * select, and for a spec it does not list the Area select, is `aria-disabled` with its reason.
 *
 * **Pills (ISC-140.2).** Every segment carries a label (`[data-pill-label]`: Workspace, Page, Specs or Spec, Area) and its
 * value (`[data-pill-value]`), so no segment is a bare number; the picker segments have no leading icon, the label
 * carries their meaning. Outside a workspace (`/`, `/help`, `/settings`) the spec and area pills are not rendered
 * rather than showing `0`, and the workspace pill reads "All · n"; the page pill is absent there too.
 *
 * Collapse order (design.md § Viewport-übergreifend): below 1120 px the visible labels go (ISC-140.2 refined: the label
 * stays in the accessible name), then the wordmark (`ShellBrand`, below 640 px); the spec shows its id and short name,
 * the name ellipsizing; numbers and ids never shorten.
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
  /** A menu clicked before the deferred menus had loaded; it opens as soon as they arrive (spec 024: no lost click). */
  private pending: { readonly kind: MenuKind; readonly trigger: HTMLElement } | null = null;

  constructor() {
    effect(() => {
      const menus = this.menus();
      const pending = this.pending;
      if (menus === undefined || pending === null) return;
      this.pending = null;
      // After the menus' own first render, so their popovers and sheets exist when the queued click opens one.
      setTimeout(() => {
        if (pending.trigger.isConnected) menus.toggle(pending.kind, pending.trigger);
      });
    });
  }

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
  /** A spec route (`/w/:ws/s/:id/…`): only there is an Area select, enabled while the spec is listed. */
  protected readonly specRoute = computed(() => this.state.specId() !== null);
  /**
   * The workspace page the PAGE select names: Specs on a spec page, the board on a story page (`idea`, spec 008, no
   * menu page), else the route's page; null for a workspace the server does not know (`ShellState` is route-only and
   * calls any `/w/:ws` the Specs page), so the select stays disabled there.
   */
  protected readonly workspacePage = computed(() => {
    if (!this.inWorkspace() || this.data.workspaceMissing()) return null;
    const id = this.specRoute() ? 'specs' : (this.state.route().wsPage ?? 'specs');
    // Spec 026: the Features and Milestones routes left the menu; until T30 redirects them they read as Planning.
    return workspacePageById(id === 'idea' ? 'board' : id === 'features' || id === 'milestones' ? 'planning' : id);
  });
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'dashboard'}`);
  readonly expanded = computed(() => this.menus()?.expanded() ?? CLOSED);
  /** From 1120 px (the wide tier) the full prototype header: the area pill sits on the rail. */
  protected readonly wide = computed(() => this.state.tier() === 'wide');

  /** The overflow menu's area entry, the same two states as the wide select; null off a spec page. */
  protected readonly areaEntry = computed<AreaEntry | null>(() => {
    if (!this.specRoute()) return null;
    if (this.specOpen()) return { valueKey: this.areaKey(), ariaKey: 'shell.area.label', reasonKey: null };
    return { valueKey: 'shell.area.menu', ariaKey: 'shell.area.menu', reasonKey: 'shell.area.needsSpec' };
  });

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

  press(kind: MenuKind): void {
    this.menus()?.press(kind);
  }

  /** A trigger's click: a modified or non-primary click is left to the browser; a plain one toggles the menu. */
  toggle(event: MouseEvent, kind: MenuKind): void {
    const menus = this.menus();
    if (menus === undefined || navigatesNatively(event)) {
      // Until the menus have loaded, the settings button still leads somewhere: the settings page.
      if (menus === undefined && kind === 'settings') void this.router.navigate(['/settings']);
      // A button trigger (PAGE, area) has no href to fall back on: its menu opens once the menus arrive.
      else if (menus === undefined && !navigatesNatively(event) && event.currentTarget instanceof HTMLButtonElement) {
        event.preventDefault();
        this.pending = { kind, trigger: event.currentTarget };
      }
      return;
    }
    event.preventDefault();
    menus.toggle(kind, event.currentTarget as HTMLElement);
  }

  /** The URL `RouterLink` would put in `href`, base href included. */
  private href(target: PickTarget): string {
    const tree = this.router.createUrlTree([...target.link], { fragment: target.fragment });
    return this.locationStrategy.prepareExternalUrl(this.router.serializeUrl(tree));
  }
}
