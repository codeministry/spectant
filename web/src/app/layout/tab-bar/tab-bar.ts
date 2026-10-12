import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaById, type SpecArea } from '../shell/areas';
import type { PageTab } from '../shell/page-tabs';
import type { ShellState, TabBarPlacement } from '../shell/shell-state.service';

/** The current area when it has more than one tab (Notes has one, the dashboard none: no bar, design.md § Tab bar). */
export function tabbedArea(state: ShellState): SpecArea | null {
  const id = state.area();
  if (id === null) return null;
  const area = areaById(id);
  return area.tabs.length > 1 ? area : null;
}

/**
 * The tab bar (ISC-76, ISC-134.1): the tabs it is given as route links, `aria-current="page"` on the current one, one
 * tab stop with roving focus. One component for every page with tabs (DS-APP-27): `TabBarSlot` builds the list (the
 * spec page's from `SPEC_AREAS`, the tech page's from `TECH_TABS`) and decides where it renders per tier. In the
 * header (compact) the strip scrolls on its own with a fade on the trailing edge; under the page head (medium, wide)
 * the first tab's label shares the cards' left edge. A count rides inside its tab; a tab without one shows none.
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
    @if (tabs().length > 0) {
      <nav uiRovingList [attr.aria-label]="'shell.tabBar' | transloco: { area: (labelKey() | transloco) }">
        @for (tab of tabs(); track tab.id) {
          <a
            uiRovingItem
            [routerLink]="tab.link"
            [attr.data-tab]="tab.id"
            [attr.aria-current]="tab.id === current() ? 'page' : null"
            >{{ tab.labelKey | transloco }}
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
  readonly tabs = input.required<readonly PageTab[]>();
  /** The id of the open tab, `aria-current="page"`; null marks none. */
  readonly current = input<string | null>(null);
  /** Transloco key of the name of what the tabs belong to (an area, a page): the bar's accessible name. */
  readonly labelKey = input.required<string>();
  readonly placement = input<TabBarPlacement>('main');
}
