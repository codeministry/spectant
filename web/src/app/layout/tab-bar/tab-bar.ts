import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaById, type SpecArea, specLink, type TabId } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState, type TabBarPlacement } from '../shell/shell-state.service';

/** The current area when it has more than one tab (Notes has one, the dashboard none: no bar, design.md § Tab bar). */
export function tabbedArea(state: ShellState): SpecArea | null {
  const id = state.area();
  if (id === null) return null;
  const area = areaById(id);
  return area.tabs.length > 1 ? area : null;
}

/**
 * The tab bar (ISC-76): the current area's tabs from `SPEC_AREAS` as route links, `aria-current="page"` on the open
 * tab, one tab stop with roving focus. One component; `TabBarSlot` decides where it renders per tier and passes the
 * placement: in the header (compact) the strip scrolls on its own with a fade on the trailing edge; under the spec
 * head (medium, wide) the first tab's label shares the cards' left edge. Counts ride inside the tabs where the spec
 * model has them (Claims closed/total, Tasks landed/total); a count the model does not carry is left out.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [RouterLink, TranslocoPipe, UiRovingList, UiRovingItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-placement]': 'placement()' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    nav { display: flex; gap: 4px; block-size: 44px; overflow: auto hidden; scrollbar-width: none; }
    :host([data-placement='header']) nav { padding-inline-end: 24px; mask-image: linear-gradient(to right, var(--color-base-content) calc(100% - 24px), transparent); }
    :host([data-placement='main']) a:first-child { padding-inline-start: 0; }
    a { display: inline-flex; flex-shrink: 0; gap: 8px; align-items: center; min-block-size: 44px; padding-inline: 12px; border-block-end: 2px solid transparent; color: var(--muted-ink); font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; transition: color var(--motion-duration-instant) var(--motion-ease-standard); }
    a[aria-current='page'] { border-block-end-color: var(--color-primary); color: var(--color-base-content); }
    @media (hover: hover) { a:hover { color: var(--color-base-content); } }
    .count { color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; }
  `,
  template: `
    @if (area(); as area) {
      <nav uiRovingList [attr.aria-label]="'shell.tabBar' | transloco: { area: (areaKey() | transloco) }">
        @for (tab of tabs(); track tab.id) {
          <a
            uiRovingItem
            [routerLink]="tab.link"
            [attr.data-tab]="tab.id"
            [attr.aria-current]="tab.id === state.tab() ? 'page' : null"
            >{{ tab.key | transloco }}
            @if (tab.count; as count) {
              <span class="count" [attr.data-count]="tab.id">{{ count }}</span>
            }</a
          >
        }
      </nav>
    }
  `,
})
export class TabBar {
  readonly placement = input<TabBarPlacement>('main');

  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  protected readonly area = computed(() => tabbedArea(this.state));
  protected readonly areaKey = computed(() => `shell.areas.${this.area()?.id ?? 'dashboard'}`);
  protected readonly tabs = computed(() => {
    const area = this.area();
    const ws = this.state.ws();
    const id = this.state.specId();
    if (area === null || ws === null || id === null) return [];
    const counts = this.counts();
    return area.tabs.map((tab) => ({ id: tab, key: `shell.tabs.${tab}`, link: specLink(ws, id, tab), count: counts.get(tab) ?? null }));
  });

  /** Counts from the spec model the shell already loaded (`areas.data`); Evidence has none there, so it shows none. */
  private readonly counts = computed(() => {
    const counts = new Map<TabId, string>();
    const spec = this.data.spec.value();
    if (spec?.kind !== 'ok') return counts;
    const { claims, tasks } = spec.body.areas.data;
    counts.set('claims', `${String(claims.closed)}/${String(claims.total)}`);
    if (tasks !== null) counts.set('tasks', `${String(tasks.landed)}/${String(tasks.total)}`);
    return counts;
  });
}
