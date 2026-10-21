import { computed, type Signal } from '@angular/core';

/** The part of `ShellData` the Features and Milestones pages and the board read; `ShellData` itself satisfies it. */
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
