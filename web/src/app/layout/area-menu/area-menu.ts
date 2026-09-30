import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { SettingsService } from '../../core/settings.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiPopover } from '../../shared/ui/overlay/popover';
import { UiSheet } from '../../shared/ui/overlay/sheet';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaPath, SPEC_AREAS, type SpecArea, specLink, WORKSPACE_PAGES, type WorkspacePageId, workspaceLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** The params of a workspace page's summary key (`shell.pages.summary.<id>`); null leaves the summary line out. */
type SummaryParams = Readonly<Record<string, string | number>> | null;

/** `Nov 30` for an ISO date, read as a calendar day (UTC), so no time zone moves it a day. */
const shortDate = (iso: string, locale: string): string =>
  new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/**
 * The area menu (ISC-76, design.md § Area menu and tab bar), opened from the header's `data-control="area"` trigger
 * (`ShellNav`, through `ShellMenus`). A native `popover` (`ui-popover`) at medium and wide; a bottom sheet (`ui-sheet`:
 * 56 px rows, at most 75dvh, grab handle) at compact. The same `<nav>` in both, never `role="menu"`.
 *
 * **Scope-aware (spec 003, T26).** At spec scope it lists the six areas of `SPEC_AREAS` in registry order: each entry
 * shows its area dot, its name, a one-line subline (the area's summary; at compact its tab list) and its `g`-key hint
 * (only on a fine pointer that can hover). An area whose views are not built (`built: false`) is an `aria-disabled`
 * entry without a link, its reason as visible text. At workspace scope (a workspace open, no spec) it lists
 * `WORKSPACE_PAGES` instead: each entry a link to the page with its icon, its name and a summary from the dashboard
 * rows and the planning model. Milestones is absent, not disabled, while no spec carries a milestone (ISC-104). The
 * pages show no `g`-key hint while `g f` / `g m` are a proposal nothing binds.
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
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly areas = SPEC_AREAS;
  protected readonly compact = computed(() => this.state.tier() === 'compact');
  protected readonly singleKeys = computed(() => this.settings.settings().singleKeyShortcuts);
  protected readonly currentArea = computed(() => this.state.area() ?? 'dashboard');
  private readonly specOpen = computed(() => this.state.specId() !== null && !this.data.specMissing());

  /**
   * A workspace is open and no spec: the menu lists the workspace's pages instead of the spec areas. Not for a
   * workspace the server does not know (`workspaceMissing`): its pages would all link into not-found.
   */
  protected readonly workspaceScope = computed(
    () => this.state.ws() !== null && this.state.specId() === null && !this.data.workspaceMissing(),
  );
  /** The registry in menu order, Milestones only while a spec carries one (ISC-104). */
  protected readonly pages = computed(() => WORKSPACE_PAGES.filter((page) => page.id !== 'milestones' || this.data.hasMilestones()));
  protected readonly currentPage = computed(() => this.state.route().wsPage);

  /** Each page's summary params, from what has loaded; a page whose source has not answered gets null. */
  protected readonly summaries = computed<Record<WorkspacePageId, SummaryParams>>(() => ({
    specs:
      this.data.dashboard.value()?.kind === 'ok'
        ? { active: this.data.specRows().length, archived: this.data.archiveRows().length }
        : null,
    features: this.featuresSummary(),
    milestones: this.milestonesSummary(),
  }));

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

  /** `/w/:ws` or `/w/:ws/<page>`; rendered only at workspace scope, where the workspace is set. */
  protected pageLink(page: WorkspacePageId): string[] {
    return workspaceLink(this.state.ws() ?? '', page);
  }

  /** Features: the feature count and the master's recount of closed and total claims (ISC-100.2). */
  private featuresSummary(): SummaryParams {
    const model = this.data.planningModel();
    if (!model?.recount) return null;
    return { count: model.features.length, closed: model.recount.closed, total: model.recount.total };
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
