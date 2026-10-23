/**
 * The dashboard model of one registered repository (T47, ISC-16): `loadDashboard` takes `readWorkspaceInput`'s
 * reading, adds the local services and calls `core/`'s `buildDashboard`; every item state comes from `core/`'s
 * `itemStates` at the request's clock (spec 040, ISC-224). Read-only, like every load of the workspace.
 */
import { buildDashboard, devServiceLabels, toLocalService } from "../../../core/src/dashboard.ts";
import type { DashboardInput, DashboardModel, ProbedService } from "../../../core/src/dashboard.ts";
import type { ItemStateInfo } from "../../../core/src/files.ts";
import { itemStates, withItemStates } from "../../../core/src/item-state.ts";
import { guidanceOf, withGuidance } from "../../../core/src/guidance.ts";
import { taskRunsOf } from "../../../core/src/live.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { abortAge } from "../infra/abort-age.ts";
import { type ReadingOptions, readWorkspaceInput } from "./reading.ts";

export type DashboardLoad = { readable: true; model: DashboardModel } | { readable: false; error: UnreadableCode };

/** The local listeners of one workspace, given its root and the constitution's port labels. */
export type ServicesProbe = (repoRoot: string, labels: ReadonlyMap<number, string>) => Promise<readonly ProbedService[]>;

/**
 * The clock every item state is derived at (spec 040, ISC-224): `now`, and the age after which an open run reads
 * `aborted` (the `runAbortMinutes` setting × 60 000, read per request by the caller; core's default when absent), and
 * the age after which a claim lock or task run reads `aborted` (spec 032, ISC-35: the `staleMinutes` setting × 60 000).
 */
export type StateClock = { readonly now: Date; readonly abortAfterMs?: number; readonly staleAfterMs?: number };

/**
 * Every item's state of a workspace reading (spec 040, T26, ISC-224): core's `itemStates` over the reading's input and
 * the model built from it, each spec's task runs as its live frame folds them (`taskRunsOf`), at `clock`. The server
 * decides no state itself; the dashboard, the spec page and the tasks route all take their items from here.
 */
export function workspaceItemStates(input: DashboardInput, model: DashboardModel, clock: StateClock): ItemStateInfo[] {
  return itemStates({
    workspace: input,
    dashboard: model,
    taskRuns: input.locks === undefined ? {} : taskRunsOf(input.specs, input.locks, clock.now),
    now: clock.now,
    ...abortAge(clock.abortAfterMs),
    ...(clock.staleAfterMs === undefined ? {} : { staleAfterMs: clock.staleAfterMs }),
  });
}

/**
 * The dashboard model of the workspace at `root`. With a `probe`, its listeners become the model's services, labelled
 * from the constitution's `dev_services:`; with `null` the services are empty (the workspace list needs counts only).
 * `lifeosStateDir` as for `readWorkspaceInput`. Each spec row and story carries its item state at `clock` (spec 040,
 * ISC-224, core's `withItemStates`); the request's time and core's abort age by default. The model carries the
 * workspace guidance (spec 020, ISC-237, core's `guidanceOf`) from the same items. `options` as for `readWorkspaceInput`:
 * the status board passes `{ archive: false }` and reads no file under `specs/archive/` (spec 073, ISC-614).
 */
export async function loadDashboard(
  root: string,
  probe: ServicesProbe | null,
  lifeosStateDir: string | null = null,
  clock: StateClock = { now: new Date() },
  options: ReadingOptions = {},
): Promise<DashboardLoad> {
  const reading = await readWorkspaceInput(root, lifeosStateDir, options);
  if (!reading.readable) return reading;
  const { input } = reading;
  const labels = input.constitution === null ? new Map<number, string>() : devServiceLabels(input.constitution);
  const probed = probe === null ? [] : await probe(root, labels).catch(() => []);
  // The stories of `specs/ideas/` ride beside the input (`reading.ideas`); the model lists them (spec 064, ISC-484).
  const model = buildDashboard({ ...input, ideas: reading.ideas, services: probed.map((s) => toLocalService(s, labels)) });
  const items = workspaceItemStates(input, model, clock);
  return { readable: true, model: withGuidance(withItemStates(model, items), guidanceOf({ workspace: input, dashboard: model, items })) };
}
