import { computed, contentChildren, Directive, ElementRef, inject, input, linkedSignal, output } from '@angular/core';

/** What `activeChange` carries: the new position and the item's element. */
export interface RovingActive {
  readonly index: number;
  readonly element: HTMLElement;
}

/** Keys that move by one; `singleKey` ones only while single-key shortcuts are on (ISC-61, design.md § Keyboard). */
const STEP: Partial<Record<string, { readonly by: number; readonly singleKey: boolean }>> = {
  ArrowDown: { by: 1, singleKey: false },
  ArrowUp: { by: -1, singleKey: false },
  j: { by: 1, singleKey: true },
  k: { by: -1, singleKey: true },
};

/** Typing targets: a key pressed here is text, never navigation. */
const TYPING = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * One item of a `uiRovingList`: carries the roving `tabindex` (0 on the active item, -1 elsewhere) and makes itself
 * the active item when it receives focus (click, Tab back into the list). Put it on the focusable element itself, in
 * the same template as the list, so the list's content query sees it.
 */
@Directive({
  selector: '[uiRovingItem]',
  host: { '[tabIndex]': 'tabIndex()', '(focus)': 'list.activate(this)' },
})
export class UiRovingItem {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly list = inject(UiRovingList);
  protected readonly tabIndex = computed(() => (this.list.activeItem() === this ? 0 : -1));
}

/**
 * Keyboard navigation for a vertical list (spec list, workspace list): ↓ / ↑ and j / k move one item, Home / End jump
 * to the ends, no wrap-around; one tab stop via roving `tabindex`. Keys typed into an input, textarea, select or
 * contenteditable, and keys held with Ctrl, Meta or Alt, are left alone. Enter is not handled here: the row owns
 * "open" (ISC-61.1).
 *
 * Items are found with a `contentChildren` signal query, so rows added or removed by `@for` are picked up without a
 * MutationObserver or a re-scan; the active item is tracked by identity, so it stays active when rows around it come
 * and go, and when it disappears itself the selection keeps its position, clamped to the new end.
 */
@Directive({
  selector: '[uiRovingList]',
  host: { '(keydown)': 'onKeydown($event)' },
})
export class UiRovingList {
  /** The app's "single-key shortcuts" setting; off disables j / k (the keyboard service drives it, T67). */
  readonly singleKeys = input(true);
  readonly activeChange = output<RovingActive>();

  readonly items = contentChildren(UiRovingItem, { descendants: true });

  private readonly activeIndex = linkedSignal<readonly UiRovingItem[], number>({
    source: this.items,
    computation: (items, previous) => {
      if (!previous) return 0;
      const kept = items.indexOf(previous.source[previous.value]);
      return kept >= 0 ? kept : Math.max(0, Math.min(previous.value, items.length - 1));
    },
  });

  /** The item holding the tab stop, `undefined` for an empty list. */
  readonly activeItem = computed<UiRovingItem | undefined>(() => this.items()[this.activeIndex()]);

  /** Makes `item` the active one; emits `activeChange` only when the active item actually changes. */
  activate(item: UiRovingItem): void {
    const index = this.items().indexOf(item);
    if (index < 0 || item === this.activeItem()) return;
    this.activeIndex.set(index);
    this.activeChange.emit({ index, element: item.element });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof Element && event.target.closest(TYPING)) return;
    const count = this.items().length;
    if (count === 0) return;

    const step = STEP[event.key];
    let next: number;
    if (step && (!step.singleKey || this.singleKeys())) {
      next = Math.max(0, Math.min(count - 1, this.activeIndex() + step.by));
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = count - 1;
    } else {
      return;
    }

    event.preventDefault();
    const item = this.items()[next];
    this.activate(item);
    item.element.focus();
  }
}
