import { computed, inject, Injectable, linkedSignal, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, tap } from 'rxjs';
import { altTyped } from './keyboard-bindings';
import { SettingsService } from '../../core/settings.service';
import {
  type AreaId,
  isAreaId,
  isTabId,
  isWorkspacePageId,
  type ShellRouteData,
  switchSpecLink,
  type TabId,
  type WorkspacePageId,
} from './areas';
import { isPlanningLensId, type PlanningLensId } from './page-tabs';
import { DOCK_MIN, type Tier, tierFor } from './tier';

/** What the current route says, read once per navigation from the whole snapshot chain. */
export interface ShellRoute {
  readonly ws: string | null;
  readonly specId: string | null;
  readonly area: AreaId | null;
  /** The spec tab; null off a spec. */
  readonly tab: TabId | null;
  /** The planning page's lens on `/w/:ws/planning/<lens>` (`wsPage` `planning`, spec 026); null on every other route. */
  readonly lens: PlanningLensId | null;
  /** The workspace-scope page: route data `page` (the dashboard on `/w/:ws`, spec 058), else null (spec routes, not-found). */
  readonly wsPage: WorkspacePageId | null;
  /** The story's slug on `/w/:ws/ideas/:slug` (`wsPage` `idea`, spec 008); null on every other route. */
  readonly ideaSlug: string | null;
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
  // Spec 058: every workspace page names itself in its route data (the root `dashboard`, `/w/:ws/specs` `specs`); a
  // route that names none is no workspace page, never read as the spec list.
  const wsPage = isWorkspacePageId(data.page) ? data.page : null;
  const ideaSlug = wsPage === 'idea' ? (params['slug'] ?? null) : null;
  const planning = wsPage === 'planning';
  // `board` is a spec tab and a lens: on the planning page it is the lens only.
  const tab = !planning && isTabId(data.tab) ? data.tab : null;
  const lens = planning && isPlanningLensId(data.tab) ? data.tab : null;
  return { ws, specId, area, tab, lens, wsPage, ideaSlug, notFound };
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
 * The spec `[` (`delta` -1) or `]` (+1) opens from spec `id`, the one rule both key paths share (spec 052, ISC-331).
 * `order` is the dashboard's row order, `favorites` the ids of the workspace's favourite rows in that order. With
 * favourites, the step goes to the nearest favourite after (before) `id`'s place in `order`, so a spec without a star
 * steps too; without, to the neighbouring row. No wrap-around: undefined when nothing lies that way or `id` is not in
 * `order`.
 */
export function stepSpec(order: readonly string[], favorites: readonly string[], id: string, delta: -1 | 1): string | undefined {
  const index = order.indexOf(id);
  if (index < 0) return undefined;
  if (favorites.length === 0) return order[index + delta];
  const starred = new Set(favorites);
  for (let at = index + delta; at >= 0 && at < order.length; at += delta) {
    if (starred.has(order[at])) return order[at];
  }
  return undefined;
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

  /**
   * The shell container's inline size in px, set by `ShellComponent`'s ResizeObserver; the detail sidebar docks only
   * from `DOCK_MIN` on (spec 067). Until the first measurement it is `DOCK_MIN`, the wide default the tier had before.
   */
  readonly width = signal(DOCK_MIN);
  /** The tier of `width` through `tierFor`; writable so a test can pin a tier without a width. */
  readonly tier = linkedSignal<Tier>(() => tierFor(this.width()));
  /** Zen (ISC-75): the header tools, the spec head and the rail hide; `app-zen-footer` takes the head's place. */
  readonly zen = signal(false);
  /** The stored choice, `railCollapsed` in `/api/settings`, so it survives a reload (ISC-75). */
  readonly railCollapsed = computed(() => this.settings.settings().railCollapsed);
  /** The rail shows as its 48 px strip only at wide, where it is a column; medium stacks it as page content. */
  readonly railStrip = computed(() => this.tier() === 'wide' && this.railCollapsed());

  private readonly lastWorkspace = signal<string | null>(null);
  /**
   * The workspace of the last `/w/:ws` route (spec 008, T129): a global page such as `/help` has no `ws` of its own and
   * shows the workspace the user came from. Written on every `NavigationEnd`, so it holds even while nothing reads it.
   */
  readonly lastWs = this.lastWorkspace.asReadonly();

  private readonly navigated = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      tap(() => {
        const ws = readRoute(this.router.routerState.snapshot.root).ws;
        if (ws !== null) this.lastWorkspace.set(ws);
      }),
    ),
    { initialValue: null },
  );

  readonly route = computed<ShellRoute>(() => {
    this.navigated();
    return readRoute(this.router.routerState.snapshot.root);
  });
  readonly ws = computed(() => this.route().ws);
  readonly specId = computed(() => this.route().specId);
  readonly area = computed(() => this.route().area);
  /** The workspace page of the route (`dashboard`, `specs`, `board`, `planning`, `idea`, `library`), null on spec and global routes. */
  readonly wsPage = computed(() => this.route().wsPage);
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
   * shortcuts only), or the previous / next of the `favorites` when the workspace has any (`stepSpec`, spec 052).
   * Returns whether the key was handled.
   */
  handleKey(event: KeyboardEvent, order: readonly string[], favorites: readonly string[]): boolean {
    if (event.defaultPrevented || ((event.ctrlKey || event.metaKey || event.altKey) && !altTyped(event))) return false;
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
      const next = stepSpec(order, favorites, id, event.key === ']' ? 1 : -1);
      if (next === undefined) return false;
      event.preventDefault();
      // Spec 051 (ISC-291): the same switch rule as the header's spec select.
      void this.router.navigate(switchSpecLink(ws, next, this.tab()));
      return true;
    }
    return false;
  }
}
