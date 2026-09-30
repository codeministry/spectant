import type { SpecWarning } from '../../../../../../core/src/files';

/**
 * The fields of core's `DashboardModel` (`core/src/dashboard.ts`) that Next up, Warnings and the context rail read —
 * a structural subset, never a reshaped copy: the full model (and every golden fixture) is assignable to it.
 * Re-declared on purpose for the reason `DashboardBody` in `core/api.service.ts` gives: a type import of
 * `core/src/dashboard.ts` type-checks `core/src/gates.ts` (Node's `Buffer`, index-signature dot access) under the web
 * tsconfig, which rejects it. Replace with `import type { DashboardModel }` once core has a pure types module.
 */
export interface DashboardRowView {
  /** `NNN`. */
  readonly id: string;
  readonly title: string;
  /** The derived stage (`plan` … `done`); `stageIndex` places it on the track. */
  readonly stage: string;
  readonly nextCommand: string | null;
  readonly takeable: readonly string[];
  readonly warnings: readonly SpecWarning[];
  readonly fog: number;
}

export interface DashboardView {
  readonly kpis: { readonly warnings: number; readonly fog: number };
  /** Active specs in action order. */
  readonly specs: readonly DashboardRowView[];
  /** The ids of the first rows with a next command, in row order. */
  readonly nextUp: readonly string[];
}
