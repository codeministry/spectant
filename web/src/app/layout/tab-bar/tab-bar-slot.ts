import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { specLink, type TabId } from '../shell/areas';
import { LibraryTabCount, type PageTab, planningTabs } from '../shell/page-tabs';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { TabBar, tabbedArea } from './tab-bar';

/** What the slot hands the bar: the tabs, the open one and the name of what they belong to. */
interface BarModel {
  readonly tabs: readonly PageTab[];
  readonly current: string | null;
  readonly labelKey: string;
}

/**
 * The prototype `tab-bar` band (spec 024, ISC-149, design.md § Across viewports): a page puts the slot directly
 * under its head (the spec page) and the slot sticks at top 64 on every width, under the one header row
 * from 1120 px and under header row 1 below, once row 2 has scrolled away. It carries the page glass, the hairline
 * across and the bar, and renders only when the route has tabs: an existing spec with a tabbed area (tabs from
 * `SPEC_AREAS`). Empty, it takes no room. The band keeps to the column (the
 * prototype bleeds it 4 px each side; here that would scroll the compact page sideways), so the eyebrow starts flush.
 */
@Component({
  selector: 'app-tab-bar-slot',
  imports: [TabBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: sticky;
      inset-block-start: 64px;
      z-index: 5;
      display: block;
      min-inline-size: 0;
      margin-block-end: 24px;
      border-block-end: 1px solid var(--line);
      background: var(--page-glass);
      /* stylelint-disable-next-line property-no-vendor-prefix -- WebKit 17 (cmux) needs the prefix, web/CLAUDE.md */
      -webkit-backdrop-filter: blur(10px);
      backdrop-filter: blur(10px);
    }
    :host(:empty) { display: none; }
  `,
  template: `
    @if (bar(); as bar) {
      <app-tab-bar [tabs]="bar.tabs" [current]="bar.current" [labelKey]="bar.labelKey" />
    }
  `,
})
export class TabBarSlot {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly libraryCount = inject(LibraryTabCount);

  protected readonly bar = computed<BarModel | null>(() => {
    if (this.state.notFound()) return null;
    const ws = this.state.ws();
    if (ws === null) return null;
    // Spec 026 (ISC-167): the planning page's lenses Tree, Matrix and Graph, unless it is the not-found page.
    if (this.state.wsPage() === 'planning') {
      if (this.data.workspaceMissing() || this.data.planningMissing()) return null;
      return { tabs: planningTabs(ws), current: this.state.route().lens, labelKey: 'shell.pages.planning' };
    }
    return this.specBar(ws);
  });

  /** The current area's tabs from `SPEC_AREAS` with the counts the spec model carries, as before ISC-134.1. */
  private specBar(ws: string): BarModel | null {
    const id = this.state.specId();
    const area = tabbedArea(this.state);
    if (id === null || area === null || this.data.specMissing()) return null;
    const counts = this.specCounts();
    const library = this.libraryCount.countFor(ws, id);
    const tabs = area.tabs.map((tab): PageTab => {
      const count = tab === 'library' ? (library ?? undefined) : counts.get(tab);
      const entry: PageTab = { id: tab, labelKey: `shell.tabs.${tab}`, link: specLink(ws, id, tab) };
      return count === undefined ? entry : { ...entry, count };
    });
    return { tabs, current: this.state.tab(), labelKey: `shell.areas.${area.id}` };
  }

  /**
   * Counts from the spec model the shell already loaded (`areas.data`); the Library's Documents count comes from the
   * library page (`LibraryTabCount`, spec 017), which holds the catalog.
   */
  private readonly specCounts = computed(() => {
    const counts = new Map<TabId, string>();
    const spec = this.data.spec.value();
    if (spec?.kind !== 'ok') return counts;
    const { claims, tasks } = spec.body.areas.data;
    counts.set('claims', `${String(claims.closed)}/${String(claims.total)}`);
    if (tasks !== null) counts.set('tasks', `${String(tasks.landed)}/${String(tasks.total)}`);
    return counts;
  });
}
