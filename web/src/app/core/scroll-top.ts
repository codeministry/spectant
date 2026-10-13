import { ViewportScroller } from '@angular/common';
import { DestroyRef, inject } from '@angular/core';
import { Router, Scroll } from '@angular/router';

/** The path of a router URL without its query and fragment: `/w/harbor?spec=007#specs` → `/w/harbor`. */
export const pathOf = (url: string): string => url.split(/[?#]/u, 1)[0] ?? url;

/**
 * Spec 024: a new page opens at its top. The router's own `scrollPositionRestoration: 'top'` would also jump on a query
 * change such as the dashboard's `?spec=` preview, so this scrolls only when the path changes, on a forward navigation
 * without an anchor; anchors stay with the router's `anchorScrolling` and back/forward keep the browser's position.
 */
export function startScrollTop(): void {
  const router = inject(Router);
  const scroller = inject(ViewportScroller);
  let previous: string | null = null;
  const subscription = router.events.subscribe((event) => {
    if (!(event instanceof Scroll)) return;
    const path = pathOf(router.url);
    const changed = previous !== null && previous !== path;
    previous = path;
    if (changed && event.position === null && event.anchor === null) scroller.scrollToPosition([0, 0]);
  });
  inject(DestroyRef).onDestroy(() => {
    subscription.unsubscribe();
  });
}
