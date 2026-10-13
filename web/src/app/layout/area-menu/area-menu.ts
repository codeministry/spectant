import { NgTemplateOutlet } from '@angular/common';
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, input, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DASHBOARD_GO_KEY } from '../../core/keyboard-bindings';
import { SettingsService } from '../../core/settings.service';
import { boardRowsOf, boardSummaryOf, buildBoard } from '../../features/board/board-model';
import { UiIcon } from '../../shared/icons/icon';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaPath, SPEC_AREAS, type SpecArea, specLink, WORKSPACE_PAGES, type WorkspaceMenuPageId, workspaceLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The params of a workspace page's summary key (`shell.pages.summary.<id>`); null leaves the summary line out. */
type SummaryParams = Readonly<Record<string, string | number>> | null;

type Loose = Readonly<Record<string, unknown>>;
const isLoose = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

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
 * rows, its KPIs and the planning model; Library's counts the mock's documents and says so (spec 024, T57). Milestones is
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
    return id === 'idea' ? 'board' : (id ?? 'specs');
  });

  /** Each page's summary params, from what has loaded; a page whose source has not answered gets null. */
  protected readonly summaries = computed<Record<WorkspaceMenuPageId, SummaryParams>>(() => ({
    specs:
      this.data.dashboard.value()?.kind === 'ok'
        ? { active: this.data.specRows().length, archived: this.data.archiveRows().length }
        : null,
    board: this.boardSummary(),
    features: this.featuresSummary(),
    milestones: this.milestonesSummary(),
    tech: this.techSummary(),
    // The catalog is read on the library page only (spec 017, T27); the menu has no source for its count yet.
    library: null,
  }));

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

  /** Features: the feature count and the master's recount of closed and total claims (ISC-100.2). */
  private featuresSummary(): SummaryParams {
    const model = this.data.planningModel();
    if (!model?.recount) return null;
    return { count: model.features.length, closed: model.recount.closed, total: model.recount.total };
  }

  /**
   * Tech (spec 023, T20): the workspace's spec count and its open fog lines, both as the dashboard's KPIs carry them
   * (`kpis.specs`, the SPECS tile; `kpis.fog`, the open-fog half of ATTENTION: lines over the master and the active
   * specs, not specs with fog). Null until the dashboard answers with both.
   */
  private techSummary(): SummaryParams {
    const result = this.data.dashboard.value();
    if (result?.kind !== 'ok' || !isLoose(result.body)) return null;
    const kpis = result.body['kpis'];
    if (!isLoose(kpis)) return null;
    const specs = count(kpis['specs']);
    const fog = count(kpis['fog']);
    return specs === null || fog === null ? null : { specs, fog };
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
