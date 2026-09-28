import { booleanAttribute, ChangeDetectionStrategy, Component, input, ViewEncapsulation } from '@angular/core';

/**
 * Groups `ui-button` / `ui-icon-button` children. Joined by default (shared border, only the outer corners round);
 * `gap` lays them out 8 px apart instead. `label` (translated) names the group for assistive tech.
 */
@Component({
  selector: 'ui-button-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // The rules style projected children, which emulated encapsulation cannot reach; every selector starts at
  // `ui-button-group`, so nothing leaks.
  encapsulation: ViewEncapsulation.None,
  styleUrl: './button-group.css',
  host: {
    role: 'group',
    '[attr.aria-label]': 'label() ?? null',
    '[attr.data-layout]': "gap() ? 'gap' : 'joined'",
  },
  template: '<ng-content />',
})
export class UiButtonGroup {
  readonly label = input<string>();
  readonly gap = input(false, { transform: booleanAttribute });
}
