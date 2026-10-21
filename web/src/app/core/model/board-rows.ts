import type { ActorRef, ItemStateInfo, Priority, SpecType, SpecWait, StageSource, Worktree } from '../../../../../core/src/files';
import type { Stage } from '../../../../../core/src/stage';

/**
 * The fields of a dashboard row (`DashboardSpecRow`, `core/src/dashboard.ts`) the board reads, re-declared structurally
 * for the reason `dashboard-view.ts` gives: a served row is assignable to it.
 */
export interface BoardRow {
  readonly id: string;
  /** The folder name `NNN-slug`, the key it shares with the planning holder. */
  readonly slug: string;
  readonly title: string;
  readonly type: SpecType | null;
  readonly priority: Priority;
  readonly stage: Stage;
  readonly stageSource: StageSource;
  readonly nextCommand: string | null;
  /** The one phrase of the row (`reasonOf` in core). */
  readonly nextReason: string;
  readonly assignee: ActorRef | null;
  /** The spec's worktree with its chip's facts (spec 027, ISC-175); null or absent without one, and then no chip. */
  readonly worktree?: Worktree | null;
  /** The row's warnings; only `worktree-branch-mismatch` is read here, for the chip's warning tone (ISC-174.1). */
  readonly warnings?: ReadonlyArray<{ readonly kind: string }>;
  /** What the spec waits on (spec 025, ISC-163); null or absent when no open spec edge holds its open work. */
  readonly waits?: SpecWait | null;
  /** The spec's item state (spec 040, ISC-224); absent when the server read it without a clock. */
  readonly state?: ItemStateInfo | null;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/**
 * The active rows of a served dashboard body (`DashboardModel.specs`, untyped in web, see `DashboardBody`) as
 * `BoardRow`s: a served row is assignable to it, so the rows are passed through as they are, never reshaped. Only a
 * row without its `id` and `slug` strings is left out; anything but a body with a `specs` array reads as no rows.
 */
export function boardRowsOf(body: unknown): readonly BoardRow[] {
  const specs = isRecord(body) ? body['specs'] : null;
  if (!Array.isArray(specs)) return [];
  return specs.filter((row): row is BoardRow => isRecord(row) && typeof row['id'] === 'string' && typeof row['slug'] === 'string');
}
