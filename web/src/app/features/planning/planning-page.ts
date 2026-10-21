import { afterRenderEffect, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { RelationRef } from '../../../../../core/src/relations';
import { SPEC_RULES, type Stage } from '../../../../../core/src/stage';
import type { SpecRowView } from '../../layout/shell/shell-data.service';

// What the Features and Milestones pages (spec 003, ISC-103 / ISC-104) share. A feature-local helper, not a
// `shared/ui` primitive: it has exactly these two consumers.

/** The graph's milestone choice in the address (`?m=<slug>`, `none` for the no-milestone lane; spec 026, kept by every lens switch). */
export const M_PARAM = 'm';
export const NO_MILESTONE = 'none';
const MILESTONE_PREFIX = 'milestone:';

/** A lane's `?m=` value: the milestone's slug, or `none` for the no-milestone lane. */
export const laneParam = (ref: RelationRef | null): string => (ref === null ? NO_MILESTONE : ref.slice(MILESTONE_PREFIX.length));

/** Core's spec stages: the `stage` of each spec row of the stage table (a story's `idea` is none), none written here. */
const STAGES: ReadonlySet<string> = new Set<string>(SPEC_RULES.map((rule) => rule.stage));
export const isStage = (value: string): value is Stage => STAGES.has(value);

/** The dashboard's stage per active spec: core leaves `holder.stage` null for whoever holds the rows to fill it in. */
export const stagesByRow = (rows: readonly SpecRowView[]): ReadonlyMap<string, Stage> =>
  new Map(rows.flatMap((row) => (isStage(row.stage) ? [[row.id, row.stage] as const] : [])));

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
