/**
 * The spec routes' handler (T45, ISC-71): it owns every path under `/api/workspaces/:ws/specs`, answers the reads
 * (`reads.ts`) and dispatches the three writes on a spec.
 *
 * Per request: the loopback guard (403), the method (405 with `Allow: allowFor(route)`), the workspace by slug (404
 * unknown, 409 `Unavailable` when its directory cannot be read, the dashboard's body), the spec by
 * `resolveWorkspaceSpec` (core's `resolveSpec`, then the specs only a spec worktree carries, spec 039 ISC-208.1; the id
 * `NNN`, the folder name or the bare slug; no match or an ambiguous one is a 404, never another spec), and a folder
 * without `spec.md` is no spec (404).
 *
 * The two writes (`POST …/gate/reviewed`, `POST …/tasks/:tid/check`): the body through `parseWriteBody` (400), then
 * `gate-route.ts` / `checkbox-route.ts` over `writes.ts` (404 unknown task, 409 hash mismatch, 423 lock, 200 written),
 * the answers typed by `writes.contract.ts`. The stage move (`POST …/transition`, T83) goes through `transition-route.ts`
 * over `writeTransition` and adds the 422 `transition-refused`.
 */
import { writeTaskCheck } from "../checkbox-route.ts";
import { writeGateReviewed } from "../gate-route.ts";
import { transitionAnswer } from "../transition-route.ts";
import type { Workspace } from "../infra/db/registry.ts";
import { loopbackRefusal, methodNotAllowed } from "../infra/http/guard.ts";
import { json } from "../infra/http/json.ts";
import type { ApiHandler } from "../infra/http/server.ts";
import { SPEC_API_ROOT, type SpecRouteMatch, allowFor, matchSpecPath, matchSpecRoute } from "../contracts/spec-routes.contract.ts";
import { parseWriteBody, writeActorOf } from "../contracts/writes.contract.ts";
import { openSpec, unreadableCode, unavailable, viewerActorOf } from "../workspace/index.ts";
import { NOT_FOUND, type SpecRoutesOptions, WorkspaceUnreadable, specReads } from "./reads.ts";

/** Any path under `/api/workspaces/:ws/specs`: the spec routes own it, so an unknown tab is their 404, not the server's. */
const SPECS_SUBTREE = new RegExp(`^${SPEC_API_ROOT}/[^/]+/specs(?:/.*)?$`);

/** A file system failure (it carries an errno code), as opposed to a defect, which must surface as a 500. */
const isFsError = (error: unknown): boolean => typeof (error as NodeJS.ErrnoException | null)?.code === "string";

export function specRoutesApi(options: SpecRoutesOptions): ApiHandler {
  const { registry } = options;
  const reads = specReads(options);
  const { stateDir, clock, age } = reads;

  async function answer(req: Request, url: URL, match: SpecRouteMatch, workspace: Workspace): Promise<Response> {
    const root = workspace.path;
    // The shared prelude (`openSpec`): the workspace readable, the spec resolved, then its read source and constitution.
    const opening = await openSpec(root, match.params.id);
    if (opening.kind === "unreadable") throw new WorkspaceUnreadable(opening.code);
    if (opening.kind === "not-found") return json(req, 404, NOT_FOUND);
    const { ref } = opening;
    if (match.route === "spec") return reads.specPage(req, root, ref);

    const opened = await opening.open();
    if (opened === null) return json(req, 404, NOT_FOUND);
    const { source, constitution } = opened;

    switch (match.route) {
      case "gateReviewed": {
        const parsed = parseWriteBody("gateReviewed", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const actor = writeActorOf(await viewerActorOf(root));
        const result = await writeGateReviewed({ root, ref: source, stateDir, now: clock(), body: parsed.body, constitution: await constitution(), actor, ...age() });
        return json(req, result.status, result.body);
      }
      case "taskCheck": {
        const parsed = parseWriteBody("taskCheck", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const { tid } = match.params;
        const result = await writeTaskCheck({ root, ref: source, stateDir, now: clock(), tid, body: parsed.body, constitution: await constitution(), ...age() });
        return json(req, result.status, result.body);
      }
      case "transition": {
        const result = await transitionAnswer({ root, ref: source, stateDir, now: clock(), text: await req.text(), ...age() });
        return json(req, result.status, result.body);
      }
      default:
        return reads.read(req, url, match, workspace, ref, opened);
    }
  }

  return (req, url) => {
    const { pathname } = url;
    if (!SPECS_SUBTREE.test(pathname)) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    const path = matchSpecPath(pathname);
    if (path === null) return json(req, 404, NOT_FOUND);
    const match = matchSpecRoute(pathname, req.method);
    if (match === null) return methodNotAllowed(req, allowFor(path.route));
    const workspace = registry.get(match.params.ws);
    if (!workspace) return json(req, 404, NOT_FOUND);
    return answer(req, url, match, workspace).catch((error: unknown) => {
      if (error instanceof WorkspaceUnreadable) return json(req, 409, unavailable(workspace, error.code));
      if (isFsError(error)) return json(req, 409, unavailable(workspace, unreadableCode(error)));
      throw error;
    });
  };
}
