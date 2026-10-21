import { effect, inject, untracked } from '@angular/core';
import { RefreshService } from '../../layout/shell/refresh.service';

/**
 * Runs `reload` on every live refresh (timer, "Refresh now", `r`) after the first read, keyed on
 * `RefreshService.refreshes()`, the count, never on the clock. The library's catalog and the reader's open document
 * re-read in place this way: a resource's reload keeps the last value, and the routes answer 304 to the
 * `If-None-Match` `ApiClient` sends. Call it in an injection context (a store's constructor).
 */
export function reloadOnRefresh(reload: () => void): void {
  const refresher = inject(RefreshService);
  let seen = refresher.refreshes();
  effect(() => {
    const count = refresher.refreshes();
    if (count === seen) return;
    seen = count;
    untracked(reload);
  });
}
