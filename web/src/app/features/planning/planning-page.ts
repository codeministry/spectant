import { afterRenderEffect, computed, inject, type Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { STAGE_RULES, type Stage } from '../../../../../core/src/stage';
import type { SpecRowView } from '../../layout/shell/shell-data.service';

// What the Features and Milestones pages (spec 003, ISC-103 / ISC-104) share. A feature-local helper, not a
// `shared/ui` primitive: it has exactly these two consumers.

/** Core's stages: every one is the `stage` of one row of the stage table, so none is written here. */
const STAGES: ReadonlySet<string> = new Set<string>(STAGE_RULES.map((rule) => rule.stage));
export const isStage = (value: string): value is Stage => STAGES.has(value);

/** The dashboard's stage per active spec: core leaves `holder.stage` null for whoever holds the rows to fill it in. */
export const stagesByRow = (rows: readonly SpecRowView[]): ReadonlyMap<string, Stage> =>
  new Map(rows.flatMap((row) => (isStage(row.stage) ? [[row.id, row.stage] as const] : [])));

/** The part of `ShellData` the pair reads; `ShellData` itself satisfies it. */
export interface PlanningPageData {
  readonly workspaceMissing: Signal<boolean>;
  readonly planningMissing: Signal<boolean>;
  readonly workspaceUnavailable: Signal<boolean>;
  readonly planningUnavailable: Signal<boolean>;
  readonly planning: { readonly value: Signal<unknown> };
  readonly planningModel: Signal<unknown>;
}

/**
 * `missing`: the workspace or the tree answered the contract's 404 (the not-found page). `unavailable`: either is
 * unreadable, or the tree answered with anything but the model (an error status): the shell's unavailable line.
 */
export function planningPageState(data: PlanningPageData): { missing: Signal<boolean>; unavailable: Signal<boolean> } {
  return {
    missing: computed(() => data.workspaceMissing() || data.planningMissing()),
    unavailable: computed(
      () =>
        data.workspaceUnavailable() ||
        data.planningUnavailable() ||
        (data.planning.value() !== undefined && data.planningModel() === null),
    ),
  };
}

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
