import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { specLink, type TabId } from '../shell/areas';
import { type PageTab, TechTabCounts, techTabs } from '../shell/page-tabs';
import { ShellData } from '../shell/shell-data.service';
import { type TabBarPlacement, ShellState } from '../shell/shell-state.service';
import { TabBar, tabbedArea } from './tab-bar';

/** What the slot hands the bar: the tabs, the open one and the name of what they belong to. */
interface BarModel {
  readonly tabs: readonly PageTab[];
  readonly current: string | null;
  readonly labelKey: string;
}

/**
 * Where the tab bar may render (plan 002 § Client shell contract): the header's row 2 (`placement="header"`) and a
 * page under its head (`placement="main"`). A slot renders the bar only when the shell's tier puts it there
 * (compact → header, else main) and the route has tabs, so exactly one bar exists: an existing spec with a multi-tab
 * area (tabs from `SPEC_AREAS`) or the tech page (tabs from `TECH_TABS`, spec 023, ISC-134.1) unless it is the
 * not-found page (`ShellData.techMissing`, the page's own condition).
 */
@Component({
  selector: 'app-tab-bar-slot',
  imports: [TabBar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-placement]': 'placement()' },
  styles: `
    :host { display: block; min-inline-size: 0; }
  `,
  template: `
    @if (bar(); as bar) {
      <app-tab-bar [tabs]="bar.tabs" [current]="bar.current" [labelKey]="bar.labelKey" [placement]="placement()" />
    }
  `,
})
export class TabBarSlot {
  readonly placement = input.required<TabBarPlacement>();

  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly techCounts = inject(TechTabCounts);

  protected readonly bar = computed<BarModel | null>(() => {
    if (this.state.tabBarPlacement() !== this.placement() || this.state.notFound()) return null;
    const ws = this.state.ws();
    if (ws === null) return null;
    if (this.state.wsPage() === 'tech') {
      if (this.data.techMissing()) return null;
      return { tabs: techTabs(ws, this.techCounts.counts()), current: this.state.techTab(), labelKey: 'shell.pages.tech' };
    }
    return this.specBar(ws);
  });

  /** The current area's tabs from `SPEC_AREAS` with the counts the spec model carries, as before ISC-134.1. */
  private specBar(ws: string): BarModel | null {
    const id = this.state.specId();
    const area = tabbedArea(this.state);
    if (id === null || area === null || this.data.specMissing()) return null;
    const counts = this.specCounts();
    const tabs = area.tabs.map((tab): PageTab => {
      const count = counts.get(tab);
      const entry: PageTab = { id: tab, labelKey: `shell.tabs.${tab}`, link: specLink(ws, id, tab) };
      return count === undefined ? entry : { ...entry, count };
    });
    return { tabs, current: this.state.tab(), labelKey: `shell.areas.${area.id}` };
  }

  /** Counts from the spec model the shell already loaded (`areas.data`); Evidence has none there, so it shows none. */
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
