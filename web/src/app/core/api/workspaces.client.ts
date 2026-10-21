import { ACTIVITY_HASH_HEADER, SPEC_API_ROOT } from '../../../../../server/src/contracts/spec-routes.contract';
import type { WorkspaceSummaryAdded } from '../../../../../server/src/contracts/workspace-admin.contract';
import type { ApiResult, HttpCore } from './http-core';

/**
 * One entry of `GET /api/workspaces`: the browser-side copy of `WorkspaceSummary` in `server/src/api.ts`. Duplicated
 * on purpose, as `Settings` is: that module imports the server's HTTP layer and `bun:sqlite`, which must not reach the
 * browser bundle. `counts` is core's `DashboardKpis`; typed `unknown` until the dashboard types move to a browser-safe
 * module (see `DashboardBody`).
 */
export interface WorkspaceListEntry extends Partial<WorkspaceSummaryAdded> {
  readonly slug: string;
  readonly name: string;
  readonly pathTail: string;
  readonly readable: boolean;
  readonly error?: string;
  readonly counts: unknown;
}

/**
 * The dashboard body, `DashboardModel` of `core/src/dashboard.ts`. Not imported yet: a type import type-checks that
 * module's whole value graph under the web tsconfig, and `core/src/gates.ts` uses Node's `Buffer` and index-signature
 * dot access, which `tsconfig.app.json` rejects. Needs `DashboardModel` in a pure types module in core (core lane).
 * `PlanningBody` is the counter-example: its graph is web-clean, so it is typed.
 */
export type DashboardBody = unknown;

/** Relative on purpose: the app talks only to the loopback server that served it, on whatever port (ISC-2). */
export const WORKSPACES_URL = SPEC_API_ROOT;
export const dashboardUrl = (ws: string): string => `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`;

/** The workspace list and each workspace's dashboard, with the activity hash the dashboard read carries. */
export class WorkspacesClient {
  private readonly activityHashes = new Map<string, string | null>();

  constructor(private readonly core: HttpCore) {}

  workspaces(): Promise<ApiResult<readonly WorkspaceListEntry[]>> {
    return this.core.get(WORKSPACES_URL);
  }

  dashboard(ws: string): Promise<ApiResult<DashboardBody>> {
    const url = dashboardUrl(ws);
    return this.core.get(url, (headers) => this.activityHashes.set(url, headers.get(ACTIVITY_HASH_HEADER)), true);
  }

  /**
   * Spec 040 (T61, ISC-226): the raw `.spectant/activity.jsonl` hash `X-Spectant-Activity-Hash` carried on the last
   * `GET …/dashboard` (200 or 304), the hash `releaseRun()` sends; null before the dashboard was read or without it.
   */
  activityHash(ws: string): string | null {
    return this.activityHashes.get(dashboardUrl(ws)) ?? null;
  }
}
