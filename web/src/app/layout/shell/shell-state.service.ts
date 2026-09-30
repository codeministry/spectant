import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { SettingsService } from '../../core/settings.service';
import {
  type AreaId,
  isAreaId,
  isTabId,
  isWorkspacePageId,
  type ShellRouteData,
  specLink,
  type TabId,
  type WorkspacePageId,
} from './areas';
import type { Tier } from './tier';

/** Where the tab bar renders: header row 2 at compact, under the spec head at medium and wide (plan 002, T35). */
export type TabBarPlacement = 'header' | 'main';

/** What the current route says, read once per navigation from the whole snapshot chain. */
export interface ShellRoute {
  readonly ws: string | null;
  readonly specId: string | null;
  readonly area: AreaId | null;
  readonly tab: TabId | null;
  /** The workspace-scope page: route data `page`, else the spec list on `/w/:ws`, else null (spec routes, not-found). */
  readonly wsPage: WorkspacePageId | null;
  readonly notFound: boolean;
}

/** Typing targets: a key pressed here is text, never a shortcut (as `UiRovingList`). */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

function readRoute(root: ActivatedRouteSnapshot): ShellRoute {
  const params: Record<string, string | undefined> = {};
  let data: ShellRouteData = {};
  for (let node: ActivatedRouteSnapshot | null = root; node; node = node.firstChild) {
    Object.assign(params, node.params);
    data = { ...data, ...(node.data as ShellRouteData) };
  }
  const ws = params['ws'] ?? null;
  const specId = ws === null ? null : (params['id'] ?? null);
  const area = isAreaId(data.area) ? data.area : specId === null ? null : 'dashboard';
  const notFound = data.notFound === true;
  const wsPage = isWorkspacePageId(data.page) ? data.page : ws !== null && specId === null && !notFound ? 'specs' : null;
  return { ws, specId, area, tab: isTabId(data.tab) ? data.tab : null, wsPage, notFound };
}

/** An open `<dialog>` or popover owns Esc (the overlay primitives close it); the shell leaves the key alone then. */
function overlayOpen(): boolean {
  try {
    return document.querySelector('dialog[open], [popover]:popover-open') !== null;
  } catch {
    return document.querySelector('dialog[open]') !== null;
  }
}

/**
 * The shell's state (plan 002 § Client shell contract): the container tier the shell measures, zen and the rail
 * toggle, where the tab bar goes, and the current workspace / spec / area / tab from the router. Router-driven: the
 * route is re-read on every `NavigationEnd`, never held elsewhere, so reload and back land on the same screen.
 */
@Injectable({ providedIn: 'root' })
export class ShellState {
  private readonly router = inject(Router);
  private readonly settings = inject(SettingsService);

  /** Set by `ShellComponent`'s ResizeObserver through `tierFor`. */
  readonly tier = signal<Tier>('wide');
  /** Zen (ISC-75): the header tools, the spec head and the rail hide; `app-zen-footer` takes the head's place. */
  readonly zen = signal(false);
  /** The stored choice, `railCollapsed` in `/api/settings`, so it survives a reload (ISC-75). */
  readonly railCollapsed = computed(() => this.settings.settings().railCollapsed);
  /** The rail shows as its 48 px strip only at wide, where it is a column; medium stacks it as page content. */
  readonly railStrip = computed(() => this.tier() === 'wide' && this.railCollapsed());
  readonly tabBarPlacement = computed<TabBarPlacement>(() => (this.tier() === 'compact' ? 'header' : 'main'));

  private readonly navigated = toSignal(this.router.events.pipe(filter((event) => event instanceof NavigationEnd)), {
    initialValue: null,
  });

  readonly route = computed<ShellRoute>(() => {
    this.navigated();
    return readRoute(this.router.routerState.snapshot.root);
  });
  readonly ws = computed(() => this.route().ws);
  readonly specId = computed(() => this.route().specId);
  readonly area = computed(() => this.route().area);
  readonly tab = computed(() => this.route().tab);
  readonly notFound = computed(() => this.route().notFound);

  toggleZen(): void {
    this.zen.update((zen) => !zen);
  }

  /** Collapses or expands the rail and stores the choice; a refused PUT rolls it back (`SettingsService.update`). */
  toggleRail(): void {
    void this.settings.update({ railCollapsed: !this.railCollapsed() });
  }

  /**
   * The shell's keys until T102's `KeyboardService` takes over (no `g` sequences here): Esc leaves a spec for its
   * workspace, `[` / `]` open the previous / next spec in the dashboard's row `order` on the same tab (single-key
   * shortcuts only). Returns whether the key was handled.
   */
  handleKey(event: KeyboardEvent, order: readonly string[]): boolean {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.target instanceof Element && event.target.closest(TYPING)) return false;
    const ws = this.ws();
    const id = this.specId();
    if (ws === null || id === null) return false;

    if (event.key === 'Escape') {
      if (overlayOpen()) return false;
      event.preventDefault();
      void this.router.navigate(['/w', ws]);
      return true;
    }
    if ((event.key === '[' || event.key === ']') && this.settings.settings().singleKeyShortcuts) {
      const index = order.indexOf(id);
      const next = index < 0 ? undefined : order[index + (event.key === ']' ? 1 : -1)];
      if (next === undefined) return false;
      event.preventDefault();
      void this.router.navigate(specLink(ws, next, this.tab() ?? ''));
      return true;
    }
    return false;
  }
}
