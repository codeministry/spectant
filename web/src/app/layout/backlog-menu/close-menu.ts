import type { Signal, WritableSignal } from '@angular/core';
import type { UiPopover } from '../../shared/ui/overlay/popover';

/**
 * Closes a backlog menu (the priority and the reorder menu): through its popover at medium and wide, whose
 * `openChange` then clears `open`; at compact, where the sheet renders and no popover exists, by clearing `open` itself.
 */
export function closeMenu(popover: Signal<UiPopover | undefined>, open: WritableSignal<boolean>): void {
  const surface = popover();
  if (surface) surface.close();
  else open.set(false);
}
