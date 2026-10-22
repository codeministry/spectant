import type { Guidance, SpecWarning } from '../../../../../../core/src/files';
import { type WorkingEntry, workingOf } from '../../../core/model/working';

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
  /** Why that command is next: the stage table's phrase, shown verbatim by `ui-reason` (ISC-122.3). */
  readonly nextReason: string;
  readonly takeable: readonly string[];
  readonly warnings: readonly SpecWarning[];
  readonly fog: number;
}

export interface DashboardView {
  readonly kpis: {
    readonly warnings: number;
    readonly fog: number;
    /**
     * The archived specs (`DashboardKpis.archived`): no tile of its own, the spec list's head counts them (spec 021).
     * Optional here only because the warnings panel's `kpis` input reuses this shape; the model always carries it.
     */
    readonly archived?: number;
  };
  /** Active specs in action order. */
  readonly specs: readonly DashboardRowView[];
  /** The ids of the first rows with a next command, in row order. */
  readonly nextUp: readonly string[];
  /** The workspace guidance (spec 020, ISC-237); absent from a server without a clock. */
  readonly guidance?: Guidance;
  /**
   * The specs a session holds a claim of, for the block "In progress" (spec 064, ISC-460): not a field of core's
   * model but `workingOf(body)`, added by `dashboardViewOf`, so the list and the spec table's agent dot share one source.
   */
  readonly working: readonly WorkingEntry[];
}

/**
 * The body as a dashboard view with `working` from `workingOf(body)`, or null when it lacks the KPI block and the spec
 * rows every component reads. The body's own fields stay as served (no reshaped copy, see above), so a page that
 * reads more of the body may narrow the result to its own wider view.
 */
export function dashboardViewOf(body: unknown): DashboardView | null {
  if (typeof body !== 'object' || body === null) return null;
  const { kpis, specs } = body as { kpis?: unknown; specs?: unknown };
  if (typeof kpis !== 'object' || kpis === null || !Array.isArray(specs)) return null;
  return { ...(body as DashboardView), working: workingOf(body) };
}
