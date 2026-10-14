import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, input, resource, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ApiClient } from '../../core/api.service';
import { DASHBOARD_GO_KEY } from '../../core/keyboard-bindings';
import { SettingsService } from '../../core/settings.service';
import { boardRowsOf, boardSummaryOf, buildBoard } from '../../features/board/board-model';
import { UiIcon } from '../../shared/icons/icon';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import {
  areaPath,
  SPEC_AREAS,
  type SpecArea,
  specLink,
  WORKSPACE_PAGES,
  type WorkspaceMenuPageId,
  workspaceLink,
  workspacePageById,
} from '../shell/areas';
import { planningCounts } from '../../features/planning/planning-counts';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The params of a workspace page's summary key (`shell.pages.summary.<id>`); null leaves the summary line out. */
type SummaryParams = Readonly<Record<string, string | number>> | null;

/** A summary line as drawn: its catalogue key (the page's `summaryKey`, or a stand-in while its source loads) and params. */
interface SummaryLine {
  readonly key: string;
  readonly params: Readonly<Record<string, string | number>>;
}

/** The Library's line while the catalog has not answered: a static line, so the menu row never stands without one. */
export const LIBRARY_SUMMARY_LOADING = 'shell.pages.summary.libraryLoading';

/** `Nov 30` for an ISO date, read as a calendar day (UTC), so no time zone moves it a day. */
const shortDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The area menu and the page menu (ISC-76, design.md § Area menu and tab bar): one anatomy, two scopes (`scope`). The
 * area menu opens from the header's `data-control="area"` select on a spec page, the page menu from the PAGE select
 * `data-control="page"` on every workspace route (spec 024 T80, ISC-150.2, principal 2026-10-13); both through
 * `ShellMenus`. A native `popover` (`ui-popover`) at medium and wide; a bottom sheet (`ui-sheet`:
 * 56 px rows, at most 75dvh, grab handle) at compact. The same `<nav>` in both, never `role="menu"`.
 *
 * **Two scopes (spec 003 T26; spec 024 T80).** At spec scope (`scope="spec"`, nav "Areas") it lists the six areas of
 * `SPEC_AREAS` in registry order: each entry
 * shows its area dot, its name, a one-line subline (the area's summary; at compact its tab list) and its `g`-key hint
 * (only on a fine pointer that can hover). An area whose views are not built (`built: false`) is an `aria-disabled`
 * entry without a link, its reason as visible text. At page scope (`scope="page"`, nav "Pages", a workspace the
 * server knows, spec open or not) it lists `WORKSPACE_PAGES` instead; on a spec page Specs is the current one: each entry a link to the page with its icon, its name and a summary from the dashboard
 * rows, its KPIs and the planning model; Library's counts the catalog's documents, outdated and missing ones (spec 017,
 * T41, ISC-157.1), the catalog read once per workspace on the menu's first open, a static line until it answers. Milestones is
 * absent, not disabled, while no spec carries a milestone (ISC-104). The pages show no `g`-key hint.
 *
 * **Prototype anatomy (spec 024, T57, ISC-150.1).** The prototype's `.area-pop`: a card with an eyebrow head naming the
 * scope (`Spec 002 · areas`, `<workspace> · pages`, `[data-menu-head]`), then the rows, the name bold over its meta line,
 * the current row on the raised tint; 44 px rows (56 in the compact sheet).
 *
 * Either way the current entry carries `aria-current="page"` and takes focus on open. Router-driven: entries are route
 * links and the current one comes from `ShellState`; the only local state is whether the compact sheet is open.
 */
@Component({
  selector: 'app-area-menu',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiIcon, UiKbd, UiPopover, UiSheet, UiRovingItem, UiRovingList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './area-menu.css',
  templateUrl: './area-menu.html',
})
export class AreaMenu {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly api = inject(ApiClient);
  private readonly settings = inject(SettingsService);
  private readonly transloco = inject(TranslocoService);
  private readonly injector = inject(Injector);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** Which list the menu holds: the open spec's areas, or the workspace's pages (the PAGE select, spec 024 T80). */
  readonly scope = input<'spec' | 'page'>('spec');

  protected readonly areas = SPEC_AREAS;
  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  /** The dashboard has no `goKey` of its own; `g h` reaches it, and the prototype's pop-area names it. */
  protected readonly dashboardKey = (id: string): string | null => (id === 'dashboard' ? DASHBOARD_GO_KEY : null);
  protected readonly currentArea = computed(() => this.state.area() ?? 'dashboard');
  private readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());

  /** The page menu lists the workspace's pages (`pages`). */
  protected readonly workspaceScope = computed(() => this.scope() === 'page');
  /** The nav's accessible name: "Areas" for the spec areas, "Pages" for the workspace pages. */
  protected readonly menuKey = computed(() => (this.workspaceScope() ? 'shell.area.pageMenu' : 'shell.area.menu'));
  /**
   * The registry in menu order, Milestones only while a spec carries one (ISC-104); none for a workspace the server
   * does not know (`workspaceMissing`), whose pages would all link into not-found.
   */
  protected readonly pages = computed(() =>
    this.state.ws() === null || this.data.workspaceMissing()
      ? []
      : WORKSPACE_PAGES.filter((page) => page.id !== 'milestones' || this.data.hasMilestones()),
  );
  /** The open workspace page; a story page counts as the board it is reached from, a spec page as Specs. */
  protected readonly currentPage = computed(() => {
    const id = this.state.specId() === null ? this.state.route().wsPage : null;
    // Spec 026: the Features and Milestones routes left the menu; until T30 redirects them they read as Planning.
    return id === 'idea' ? 'board' : id === 'features' || id === 'milestones' ? 'planning' : (id ?? 'specs');
  });

  /** The page menu has been opened once: only then does it read the catalog for Library's line. */
  private readonly opened = signal(false);

  /**
   * The open workspace's catalog for Library's summary (`GET …/:ws/library`): idle until the page menu first opens,
   * then read once per workspace (the resource keeps its value while the workspace stays the same, so a later open
   * sends nothing).
   */
  private readonly catalog = resource({
    params: () => {
      const ws = this.state.ws();
      return this.workspaceScope() && this.opened() && ws !== null ? ws : undefined;
    },
    loader: ({ params }) => this.api.library(params),
  });

  /** Each page's summary params, from what has loaded; a page whose source has not answered gets null. */
  private readonly summaryParams = computed<Record<WorkspaceMenuPageId, SummaryParams>>(() => ({
    specs:
      this.data.dashboard.value()?.kind === 'ok'
        ? { active: this.data.specRows().length, archived: this.data.archiveRows().length }
        : null,
    board: this.boardSummary(),
    planning: this.planningSummary(),
    features: this.featuresSummary(),
    milestones: this.milestonesSummary(),
    library: this.librarySummary(),
  }));

  /**
   * Each page's summary line; null leaves it out. Library always has one: its counts once the catalog answered, the
   * static line before (and for any answer but `ok`).
   */
  protected readonly summaries = computed<Record<WorkspaceMenuPageId, SummaryLine | null>>(() => {
    const params = this.summaryParams();
    const line = (id: WorkspaceMenuPageId): SummaryLine | null => {
      const values = params[id];
      return values === null ? null : { key: workspacePageById(id).summaryKey, params: values };
    };
    return {
      specs: line('specs'),
      board: line('board'),
      planning: line('planning'),
      // Spec 026: Features and Milestones left the menu for Planning; their ids stay in the type for the old routes.
      features: null,
      milestones: null,
      library: line('library') ?? { key: LIBRARY_SUMMARY_LOADING, params: {} },
    };
  });

  /** The eyebrow head's key and params: the open spec's areas, else the workspace's pages. */
  protected readonly head = computed(() => {
    const ws = this.state.ws() ?? '';
    return this.workspaceScope()
      ? { key: 'shell.area.head.workspace', params: { workspace: this.data.workspaceName(ws) } }
      : { key: 'shell.area.head.spec', params: { spec: this.state.specId() ?? '' } };
  });

  protected readonly sheetOpen = signal(false);
  private readonly popover = viewChild<UiPopover>('popover');

  readonly expanded = computed(() => this.sheetOpen() || (this.popover()?.open() ?? false));

  /** Opens the menu: the popover anchored to `trigger` at medium and wide, the bottom sheet at compact. */
  show(trigger: HTMLElement): void {
    this.opened.set(true);
    if (this.compact()) {
      this.sheetOpen.set(true);
      return;
    }
    const popover = this.popover();
    if (popover) {
      popover.show(trigger);
      return;
    }
    // A click that arrives right after the deferred menus mounted, before this menu's first render (spec 024): the
    // popover opens once it exists instead of the click being lost.
    afterNextRender(() => this.popover()?.show(trigger), { injector: this.injector });
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

  /** `/w/:ws` or `/w/:ws/<page>`; rendered only at workspace scope, where the workspace is set. */
  protected pageLink(page: WorkspaceMenuPageId): string[] {
    return workspaceLink(this.state.ws() ?? '', page);
  }

  /**
   * Board (spec 008, T116): its columns, its cards and those waiting on you, counted by the board's own model
   * (`buildBoard`, unfiltered) so the line and the page agree; null until the planning tree and the dashboard rows,
   * which carry the stages and next commands of the specs, have both answered.
   */
  private boardSummary(): SummaryParams {
    const planning = this.data.planningModel();
    const dashboard = this.data.dashboard.value();
    if (planning === null || dashboard?.kind !== 'ok') return null;
    return { ...boardSummaryOf(buildBoard({ planning, rows: boardRowsOf(dashboard.body) })) };
  }

  /** Planning (spec 026): the milestones some spec names and the features, as the page head counts them. */
  private planningSummary(): SummaryParams {
    const model = this.data.planningModel();
    if (model === null) return null;
    const counts = planningCounts(model);
    return { milestones: counts.milestones, features: counts.features };
  }

  /** Features: the feature count and the master's recount of closed and total claims (ISC-100.2). */
  private featuresSummary(): SummaryParams {
    const model = this.data.planningModel();
    if (!model?.recount) return null;
    return { count: model.features.length, closed: model.recount.closed, total: model.recount.total };
  }

  /** Library (spec 017, T41, ISC-157.1): the catalog's documents, the outdated and the missing ones; null until it answers. */
  private librarySummary(): SummaryParams {
    const result = this.catalog.hasValue() ? this.catalog.value() : undefined;
    if (result?.kind !== 'ok') return null;
    return { docs: result.body.docs.length, stale: result.body.stale, missing: result.body.missing };
  }

  /**
   * Milestones: the entries some spec names, and the next one, the earliest not yet complete (the model sorts by
   * target, undated last), by its target date, else its name. Without an open milestone the key has no word for
   * "next", so the line is left out.
   */
  private milestonesSummary(): SummaryParams {
    const named = (this.data.planningModel()?.milestones ?? []).filter((entry) => entry.specs.length > 0);
    const next = named.find((entry) => entry.state !== 'complete');
    if (next === undefined) return null;
    return { count: named.length, next: next.target === null ? next.name : shortDate(next.target, this.lang()) };
  }
}
