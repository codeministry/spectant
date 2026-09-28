import { booleanAttribute, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input } from '@angular/core';
import { swallowClicksWhile } from './disabled';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md';
export type ButtonTone = 'warning' | 'danger';

// Literal class names so Tailwind's source scan emits the daisyUI rules. `secondary` is the neutral surface button
// (styled in button.css), not daisyUI's `btn-secondary`, which is the violet scoping accent.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: '',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};
export const SIZE_CLASS: Record<ButtonSize, string> = { sm: 'btn-sm', md: 'btn-md' };
const TONE_CLASS: Record<ButtonTone, string> = { warning: 'btn-warning', danger: 'btn-error' };

/**
 * A text button on a native `<button>` or `<a>` (attribute selector, so native semantics, focus and `href` stay).
 * 32 / 40 px visual, a 44 × 44 hit area under `pointer: coarse` (button.css), the global focus ring (primitives.css).
 */
@Component({
  // Attribute-style on purpose: a wrapper element would hide the native button from forms, links and the a11y tree.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[ui-button], a[ui-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './button.css',
  host: {
    '[class]': 'classes()',
    '[attr.data-variant]': 'variant()',
    '[attr.data-tone]': 'tone() ?? null',
    '[attr.type]': 'isButton ? type() : null',
    '[attr.aria-disabled]': "disabled() ? 'true' : null",
    // A static `disabled` attribute would reach the DOM next to the input and make the button unfocusable.
    '[attr.disabled]': 'null',
  },
  template: '<ng-content />',
})
export class UiButton {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly tone = input<ButtonTone>();
  readonly type = input<'button' | 'submit' | 'reset'>('button');
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly isButton = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName === 'BUTTON';

  protected readonly classes = computed(() => {
    const tone = this.tone();
    // A tone recolours the fill of primary, ghost and outline; on secondary it only tints the text (button.css).
    const toneClass = tone && this.variant() !== 'secondary' ? TONE_CLASS[tone] : '';
    return ['btn', 'ui-button', VARIANT_CLASS[this.variant()], SIZE_CLASS[this.size()], toneClass].filter(Boolean).join(' ');
  });

  constructor() {
    swallowClicksWhile(this.disabled);
  }
}
