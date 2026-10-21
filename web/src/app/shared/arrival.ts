import { afterRenderEffect, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

// Landing on the row the route's fragment names (spec 003): a DOM helper any page may use, so it imports nothing from
// `layout/` or `features/`.

/** The route's fragment (`F2`, `m-harbor-1-0`), the row a page lands on; null without one. Injection context only. */
export function fragmentTarget(): Signal<string | null> {
  const route = inject(ActivatedRoute);
  const fragment = toSignal(route.fragment, { initialValue: route.snapshot.fragment });
  return computed(() => fragment() ?? null);
}

/**
 * Scrolls to and focuses `article[id="<target>"]` inside `host` once it is rendered; a later target lands again, a
 * later render with the same one does not pull focus back. `deps` names what renders the rows, so a target that
 * arrives before its row lands when the row does. Injection context only (an `afterRenderEffect`).
 */
export function installArrival(host: HTMLElement, target: Signal<string | null>, deps: () => unknown): void {
  let arrivedAt: string | null = null;
  afterRenderEffect(() => {
    const id = target();
    deps();
    if (id === null || id === arrivedAt) return;
    const article = host.querySelector<HTMLElement>(`article[id="${CSS.escape(id)}"]`);
    if (!article) return;
    arrivedAt = id;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    (article as Partial<HTMLElement>).scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    article.focus({ preventScroll: true });
  });
}
