import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { SIZE_CLASS, type ButtonSize } from './button';
import { swallowClicksWhile } from './disabled';

/**
 * A square icon-only button: `size="md"` (default) is the bordered one, 40 px with a 1 px `--line` border
 * on `--card`; `size="sm"` is the quiet one, 32 px without chrome, muted, with an 8 % hover tint (button.css). `label` is required and must be a translated string: it is the accessible
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
    '[attr.data-variant]': 'variant()',
    '[attr.type]': 'type()',
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
    '[attr.aria-disabled]': "disabled() ? 'true' : null",
    '[attr.disabled]': 'null',
  },
  templateUrl: './icon-button.html',
})
export class UiIconButton {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly size = input<ButtonSize>('md');
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });

  /** md is the bordered card button (the `secondary` rules in button.css), sm the quiet ghost. */
  protected readonly variant = computed(() => (this.size() === 'sm' ? 'ghost' : 'secondary'));
  protected readonly classes = computed(
    () => `btn btn-square ui-icon-button ${this.size() === 'sm' ? 'btn-ghost ' : ''}${SIZE_CLASS[this.size()]}`,
  );

  constructor() {
    swallowClicksWhile(this.disabled);
  }
}
