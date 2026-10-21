import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiRovingItem, UiRovingList } from '../../shared/ui/roving-list.directive';
import { areaById, type SpecArea } from '../shell/areas';
import type { PageTab } from '../shell/page-tabs';
import type { ShellState } from '../shell/shell-state.service';

/**
 * The current area when it has more than one tab, or one tab and `singleTabBar` (the Library, spec 017); Notes has one,
 * the dashboard none: no bar (design.md § Tab bar).
 */
export function tabbedArea(state: ShellState): SpecArea | null {
  const id = state.area();
  if (id === null) return null;
  const area = areaById(id);
  return area.tabs.length > 1 || (area.singleTabBar === true && area.tabs.length === 1) ? area : null;
}

/**
 * The tab bar (ISC-76, ISC-134.1) in its `tab-bar` anatomy (spec 024, ISC-149, design.md § Across
 * viewports): the area eyebrow on the left (11/700, .08em, uppercase, a hairline after it), then the tabs as route
 * links, 44 px high with 12 px padding, 500 in the muted ink, the current one in the text colour on a 2 px cyan
 * underline and `aria-current="page"`, one tab stop with roving focus. A count rides inside its tab as a
 * `small` badge (mono 11 on the raised ground); a tab with `sep` opens a new group behind a `tab-sep`. The strip
 * scrolls sideways in itself, never the page. One component for every page with tabs (DS-APP-27): `TabBarSlot` builds
 * the list and is the sticky bar under the header.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [RouterLink, TranslocoPipe, UiIcon, UiRovingList, UiRovingItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './tab-bar.css',
  templateUrl: './tab-bar.html',
})
export class TabBar {
  readonly tabs = input.required<readonly PageTab[]>();
  /** The id of the open tab, `aria-current="page"`; null marks none. */
  readonly current = input<string | null>(null);
  /** Transloco key of the name of what the tabs belong to (an area, a page): the eyebrow and the bar's accessible name. */
  readonly labelKey = input.required<string>();
}
