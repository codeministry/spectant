import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaById, type SpecArea } from '../shell/areas';
import type { PageTab } from '../shell/page-tabs';
import type { ShellState } from '../shell/shell-state.service';

/** The current area when it has more than one tab (Notes has one, the dashboard none: no bar, design.md § Tab bar). */
export function tabbedArea(state: ShellState): SpecArea | null {
  const id = state.area();
  if (id === null) return null;
  const area = areaById(id);
  return area.tabs.length > 1 ? area : null;
}

/**
 * The tab bar (ISC-76, ISC-134.1) in the prototype's `tab-bar` anatomy (spec 024, ISC-149, design.md § Viewport-
 * übergreifend): the area eyebrow on the left (11/700, .08em, uppercase, a hairline after it), then the tabs as route
 * links, 44 px high with 12 px padding, 500 in the muted ink, the current one in the text colour on a 2 px cyan
 * underline and `aria-current="page"`, one tab stop with roving focus. A count rides inside its tab as the prototype's
 * `small` badge (mono 11 on the raised ground); a tab with `sep` opens a new group behind a `tab-sep`. The strip
 * scrolls sideways in itself, never the page. One component for every page with tabs (DS-APP-27): `TabBarSlot` builds
 * the list and is the sticky bar under the header.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [RouterLink, TranslocoPipe, UiRovingList, UiRovingItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; min-inline-size: 0; }
    nav { display: flex; align-items: center; min-inline-size: 0; }
    .area-eyebrow { flex: none; padding-block: 0; padding-inline: 0 12px; border-inline-end: 1px solid var(--line); color: var(--muted-ink); font-size: 11px; font-weight: 700; letter-spacing: 0.08em; line-height: 16px; text-transform: uppercase; }
    .tabs-in { display: flex; flex: 1; gap: 2px; align-items: center; min-inline-size: 0; padding-inline: 4px; overflow: auto hidden; scrollbar-width: none; }
    .tab-sep { flex: none; inline-size: 1px; block-size: 20px; margin-inline: 8px; background: var(--line); }
    a { display: inline-flex; flex-shrink: 0; gap: 6px; align-items: center; box-sizing: border-box; block-size: 44px; padding-inline: 12px; border-block-end: 2px solid transparent; color: var(--muted-ink); font-size: 14px; font-weight: 500; line-height: 20px; text-decoration: none; white-space: nowrap; transition: color var(--motion-duration-instant) var(--motion-ease-standard); }
    a[aria-current='page'] { border-block-end-color: var(--color-primary); color: var(--color-base-content); }
    @media (hover: hover) { a:hover { color: var(--color-base-content); } }
    a.muted-tab { opacity: 0.55; }
    .count { padding-block: 3px; padding-inline: 6px; border-radius: 4px; background: var(--color-base-300); color: var(--muted-ink); font-family: var(--font-mono); font-size: 11px; font-weight: 500; font-variant-numeric: tabular-nums; line-height: 1; }
  `,
  template: `
    @if (tabs().length > 0) {
      <nav data-ui="tab-bar" [attr.aria-label]="'shell.tabBar' | transloco: { area: (labelKey() | transloco) }">
        <span class="area-eyebrow" data-area-eyebrow aria-hidden="true">{{ labelKey() | transloco }}</span>
        <div class="tabs-in" uiRovingList>
          @for (tab of tabs(); track tab.id) {
            @if (tab.sep && !$first) {
              <span class="tab-sep" aria-hidden="true"></span>
            }
            <a
              uiRovingItem
              [routerLink]="tab.link"
              [attr.data-tab]="tab.id"
              [class.muted-tab]="tab.muted"
              [attr.data-muted]="tab.muted ? '' : null"
              [attr.aria-current]="tab.id === current() ? 'page' : null"
              >{{ tab.labelKey | transloco }}
              @if (tab.count; as count) {
                <small class="count" [attr.data-count]="tab.id">{{ count }}</small>
              }</a
            >
          }
        </div>
      </nav>
    }
  `,
})
export class TabBar {
  readonly tabs = input.required<readonly PageTab[]>();
  /** The id of the open tab, `aria-current="page"`; null marks none. */
  readonly current = input<string | null>(null);
  /** Transloco key of the name of what the tabs belong to (an area, a page): the eyebrow and the bar's accessible name. */
  readonly labelKey = input.required<string>();
}
