/**
 * The spec routes' handlers (T45, ISC-71; spec 059, ISC-412): every path under `/api/workspaces/:ws/specs`, the seven
 * reads (`reads.ts`) answered here and the three writes on a spec by the `writes/` slice, composed over the spec
 * family (`family.ts`) by the router.
 *
 * Per request: the loopback guard (403), the match (an unknown tab is the family's 404), the method (405 with
 * `Allow: allowFor(route)`), then the workspace's prelude (`onSpec`): the workspace by slug (404 unknown, 409
 * `Unavailable` when its directory cannot be read, the dashboard's body), the spec by `resolveWorkspaceSpec` (core's
 * `resolveSpec`, then the specs only a spec worktree carries, spec 039 ISC-208.1; the id `NNN`, the folder name or the
 * bare slug; no match or an ambiguous one is a 404, never another spec). The spec page answers before the spec's read
 * source is opened; every other route after it (`onOpenedSpec`), where a folder without `spec.md` is no spec (404).
 */
import type { SpecRouteMatch } from "../contracts/spec-routes.contract.ts";
import type { Registry } from "../infra/db/registry.ts";
import { type RouteHandlers, createRouter } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";
import { onOpenedSpec, onSpec } from "../workspace/index.ts";
import { specWriteHandlers } from "../writes/index.ts";
import { SPEC_FAMILY } from "./family.ts";
import { type OpenedReadMatch, type SpecReads, type SpecRoutesOptions, specReads } from "./reads.ts";

/** The seven reads of the spec routes. */
export type SpecReadMatch = OpenedReadMatch | Extract<SpecRouteMatch, { route: "spec" }>;

/** One handler per read on a spec, each behind the workspace's prelude. */
export function specReadHandlers(registry: Pick<Registry, "get">, reads: SpecReads): RouteHandlers<SpecReadMatch> {
  const opened = (req: Request, url: URL, match: OpenedReadMatch): Response | Promise<Response> =>
    onOpenedSpec(registry, req, match.params, (spec, files) => reads.read(req, url, match, spec.workspace, spec.ref, files));
  return {
    spec: (req, _url, match) => onSpec(registry, req, match.params, (spec) => reads.specPage(req, spec.workspace.path, spec.ref)),
    timeline: opened,
    claims: opened,
    tasks: opened,
    evidenceFile: opened,
    frames: opened,
    live: opened,
  } satisfies RouteHandlers<SpecReadMatch>;
}

export function specRoutesApi(options: SpecRoutesOptions): ApiHandler {
  const { registry } = options;
  const reads = specReads(options);
  const { stateDir, clock, age } = reads;
  return createRouter([SPEC_FAMILY], { ...specReadHandlers(registry, reads), ...specWriteHandlers({ registry, stateDir, clock, age }) });
}
