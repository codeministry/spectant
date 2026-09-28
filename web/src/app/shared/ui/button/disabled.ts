import { DestroyRef, ElementRef, inject, type Signal } from '@angular/core';

/**
 * Disabled means `aria-disabled`, never the native `disabled` attribute: the control stays focusable and announced,
 * so a keyboard user can still find it and learn why it is off. Activation is swallowed here instead. The listener
 * runs in the capture phase on the host itself, which fires before any bubble-phase `(click)` or `routerLink`
 * handler on the same element, and `preventDefault()` stops a link from navigating. Enter and Space dispatch a
 * click, so this one listener covers the keyboard too.
 */
export function swallowClicksWhile(disabled: Signal<boolean>): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const guard = (event: Event): void => {
    if (!disabled()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  host.addEventListener('click', guard, { capture: true });
  inject(DestroyRef).onDestroy(() => host.removeEventListener('click', guard, { capture: true }));
}
