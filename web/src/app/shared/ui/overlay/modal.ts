import { afterRenderEffect, DestroyRef, DOCUMENT, type ElementRef, inject, type ModelSignal, type Signal } from '@angular/core';

/** The event handlers a modal primitive binds on its host and its `<dialog>`. */
export interface ModalHandlers {
  /** Host `(keydown.escape)`. */
  readonly escape: (event: Event) => void;
  /** Host `(pointerdown)`. */
  readonly pointerDown: (event: Event) => void;
  /** Host `(click)`. */
  readonly click: (event: Event) => void;
  /** The dialog's `(close)`; `close` does not bubble, so it is bound on the element itself. */
  readonly closed: () => void;
}

/**
 * Drives a native `<dialog>` from an `open` model, shared by `ui-dialog` and `ui-sheet`. `showModal()` gives the top
 * layer, the inert page and the focus trap for free; what WebKit 17 lacks (`closedby`) is handled here, per
 * web/CLAUDE.md: Esc and a backdrop click set `open` to false, and the model is the one source of truth, so a
 * router-driven consumer (`/w/:ws/s/:id`) sees every dismissal through its `openChange`. Focus returns to the element
 * that had it when the dialog opened, also when the dialog is destroyed open (a route change).
 */
export function modalDialog(open: ModelSignal<boolean>, dialog: Signal<ElementRef<HTMLDialogElement>>): ModalHandlers {
  const doc = inject(DOCUMENT);
  let returnTo: HTMLElement | null = null;
  let pressedBackdrop = false;

  const isBackdrop = (event: Event): boolean => event.target === dialog().nativeElement;
  const restoreFocus = (): void => {
    const target = returnTo;
    returnTo = null;
    if (target?.isConnected) target.focus();
  };

  afterRenderEffect(() => {
    const element = dialog().nativeElement;
    const wanted = open();
    if (wanted === element.open) return;
    if (wanted) {
      returnTo = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
      element.showModal();
    } else {
      element.close();
    }
  });
  inject(DestroyRef).onDestroy(restoreFocus);

  return {
    escape: (event) => {
      if (!open()) return;
      // Prevented so the browser's own close request does not race the model; the effect above closes.
      event.preventDefault();
      event.stopPropagation();
      open.set(false);
    },
    // A click whose press started inside (a text selection dragged out) must not count as a backdrop click.
    pointerDown: (event) => {
      pressedBackdrop = isBackdrop(event);
    },
    click: (event) => {
      if (pressedBackdrop && isBackdrop(event)) open.set(false);
      pressedBackdrop = false;
    },
    closed: () => {
      open.set(false);
      restoreFocus();
    },
  };
}
