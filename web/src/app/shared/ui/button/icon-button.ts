import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { SIZE_CLASS, type ButtonSize } from './button';
import { swallowClicksWhile } from './disabled';

/**
 * A square icon-only button, 32 / 40 px. `label` is required and must be a translated string: it is the accessible
 * name (`aria-label`) and the pointer tooltip (`title`), since the icon alone names nothing.
 */
@Component({
  // Attribute-style on purpose, as `ui-button`: the native button keeps its semantics and focus.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[ui-icon-button]',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './button.css',
  host: {
    '[class]': 'classes()',
    'data-variant': 'ghost',
    '[attr.type]': 'type()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.aria-disabled]': "disabled() ? 'true' : null",
    '[attr.disabled]': 'null',
  },
  template: '<ui-icon [name]="icon()" [size]="16" />',
})
export class UiIconButton {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly classes = computed(() => `btn btn-ghost btn-square ui-icon-button ${SIZE_CLASS[this.size()]}`);

  constructor() {
    swallowClicksWhile(this.disabled);
  }
}
