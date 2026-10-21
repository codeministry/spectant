import { inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';

/** The value of the query param `name` in the router's current address; null when the address carries none. */
export const readQueryParam = (router: Router, name: string): string | null =>
  router.routerState.snapshot.root.queryParamMap.get(name);

/**
 * The query param `name` as a signal: read once now and again after every completed navigation. Call it in an
 * injection context (a field initializer of a service or component), like `toSignal`.
 */
export function queryParamSignal(name: string): Signal<string | null> {
  const router = inject(Router);
  return toSignal(
    router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => readQueryParam(router, name)),
    ),
    { initialValue: readQueryParam(router, name) },
  );
}
