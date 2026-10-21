/**
 * The three writes on a spec as handlers of the spec routes' table (spec 059, ISC-412): `POST …/gate/reviewed`,
 * `POST …/tasks/:tid/check` and `POST …/transition`, composed with the spec reads by `specRoutesApi` (`spec/`).
 *
 * The router has answered the guard (403), the match and the method (405 `Allow: POST`); the workspace's prelude
 * (`onOpenedSpec`) the unknown workspace or spec (404) and the unreadable workspace (409). Then: the body through
 * `parseWriteBody` (400), and `writeGateReviewed` / `writeTaskCheck` (404 unknown task, 409 hash mismatch, 423 lock,
 * 200 written), the answers typed by `writes.contract.ts`. The stage move goes through `transitionAnswer` over
 * `writeTransition` and adds the 422 `transition-refused`.
 */
import type { SpecRouteMatch } from "../contracts/spec-routes.contract.ts";
import { parseWriteBody, writeActorOf } from "../contracts/writes.contract.ts";
import type { Registry } from "../infra/db/registry.ts";
import { json } from "../infra/http/json.ts";
import type { RouteHandlers } from "../infra/http/router.ts";
import { onOpenedSpec, viewerActorOf } from "../workspace/index.ts";
import { writeTaskCheck } from "./checkbox.ts";
import { writeGateReviewed } from "./gate.ts";
import { transitionAnswer } from "./routes.ts";

/** The spec routes' three writes. */
export type SpecWriteRoute = "gateReviewed" | "taskCheck" | "transition";

/** What the three writes share with the spec reads: the registry, the lock source, the clock and the abort age. */
export interface SpecWriteContext {
  readonly registry: Pick<Registry, "get">;
  /** The LifeOS state directory, null without LifeOS. */
  readonly stateDir: string | null;
  readonly clock: () => Date;
  /** The run lock's abort age for one write, as an optional input field. */
  readonly age: () => { abortAfterMs?: number };
}

/** One handler per write on a spec, each behind the workspace's prelude. */
export function specWriteHandlers(ctx: SpecWriteContext): RouteHandlers<Extract<SpecRouteMatch, { route: SpecWriteRoute }>> {
  const { registry, stateDir, clock, age } = ctx;
  return {
    gateReviewed: (req, _url, match) =>
      onOpenedSpec(registry, req, match.params, async ({ workspace }, { source, constitution }) => {
        const root = workspace.path;
        const parsed = parseWriteBody("gateReviewed", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const actor = writeActorOf(await viewerActorOf(root));
        const result = await writeGateReviewed({ root, ref: source, stateDir, now: clock(), body: parsed.body, constitution: await constitution(), actor, ...age() });
        return json(req, result.status, result.body);
      }),
    taskCheck: (req, _url, match) =>
      onOpenedSpec(registry, req, match.params, async ({ workspace }, { source, constitution }) => {
        const parsed = parseWriteBody("taskCheck", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const { tid } = match.params;
        const result = await writeTaskCheck({ root: workspace.path, ref: source, stateDir, now: clock(), tid, body: parsed.body, constitution: await constitution(), ...age() });
        return json(req, result.status, result.body);
      }),
    transition: (req, _url, match) =>
      onOpenedSpec(registry, req, match.params, async ({ workspace }, { source }) => {
        const result = await transitionAnswer({ root: workspace.path, ref: source, stateDir, now: clock(), text: await req.text(), ...age() });
        return json(req, result.status, result.body);
      }),
  } satisfies RouteHandlers<Extract<SpecRouteMatch, { route: SpecWriteRoute }>>;
}
