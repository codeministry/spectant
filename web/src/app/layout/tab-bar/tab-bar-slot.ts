import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ShellData } from '../shell/shell-data.service';
import { type TabBarPlacement, ShellState } from '../shell/shell-state.service';
import { TabBar, tabbedArea } from './tab-bar';

/**
 * Where the tab bar may render (plan 002 § Client shell contract): the header's row 2 (`placement="header"`) and the
 * spec page under its head (`placement="main"`). A slot renders the bar only when the shell's tier puts it there
 * (compact → header, else main) and an existing spec with a multi-tab area is open, so exactly one bar exists.
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
    @if (show()) {
      <app-tab-bar />
    }
  `,
})
export class TabBarSlot {
  readonly placement = input.required<TabBarPlacement>();

  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  protected readonly show = computed(
    () =>
      this.state.tabBarPlacement() === this.placement() &&
      this.state.specId() !== null &&
      !this.state.notFound() &&
      !this.data.specMissing() &&
      tabbedArea(this.state) !== null,
  );
}
