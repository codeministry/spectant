import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaById, type SpecArea, specLink } from '../shell/areas';
import { ShellState } from '../shell/shell-state.service';

/** The current area when it has more than one tab (Notes has one, the dashboard none: no bar, design.md § Tab bar). */
export function tabbedArea(state: ShellState): SpecArea | null {
  const id = state.area();
  if (id === null) return null;
  const area = areaById(id);
  return area.tabs.length > 1 ? area : null;
}

/**
 * The tab bar (ISC-76): the current area's tabs from `SPEC_AREAS` as route links, `aria-current="page"` on the open
 * tab, one tab stop with roving focus. One component; `TabBarSlot` decides where it renders per tier. T37 adds counts.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [RouterLink, TranslocoPipe, UiRovingList, UiRovingItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    nav { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
    a { display: inline-flex; flex-shrink: 0; align-items: center; min-block-size: 44px; padding-inline: 12px; border-block-end: 2px solid transparent; color: var(--muted-ink); font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap; transition: color var(--motion-duration-instant) var(--motion-ease-standard); }
    a[aria-current='page'] { border-block-end-color: var(--color-primary); color: var(--color-base-content); }
    @media (hover: hover) { a:hover { color: var(--color-base-content); } }
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
            >{{ tab.key | transloco }}</a
          >
        }
      </nav>
    }
  `,
})
export class TabBar {
  protected readonly state = inject(ShellState);
  protected readonly area = computed(() => tabbedArea(this.state));
  protected readonly areaKey = computed(() => `shell.areas.${this.area()?.id ?? 'dashboard'}`);
  protected readonly tabs = computed(() => {
    const area = this.area();
    const ws = this.state.ws();
    const id = this.state.specId();
    if (area === null || ws === null || id === null) return [];
    return area.tabs.map((tab) => ({ id: tab, key: `shell.tabs.${tab}`, link: specLink(ws, id, tab) }));
  });
}
