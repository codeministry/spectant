import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { ActivatedRoute, ParamMap } from '@angular/router';

/**
 * The route's query and fragment as signals, the snapshot's as their first value (spec 061): the filters and deep
 * links of the spec tabs live in the URL, and their stores read them through these. Call them in an injection context.
 */
export function routeQuery(route: ActivatedRoute): Signal<ParamMap> {
  return toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });
}

/** The route's fragment (`#claim-ISC-5`, `#t/<id>`, `#task-T4`), null without one. */
export function routeFragment(route: ActivatedRoute): Signal<string | null> {
  return toSignal(route.fragment, { initialValue: route.snapshot.fragment });
}
