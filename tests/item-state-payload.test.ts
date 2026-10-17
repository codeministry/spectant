// The item state in every payload (spec 040, T26-T28, ISC-224): each surface reads an item's state from the API, so
// the dashboard (spec rows and stories), the spec page head, the claims, the tasks and the live frame each carry it.
// beacon is served at the `state` golden's clock (core/tests/helpers/state-model.ts `STATE_NOW`) with its activity
// reading and the default abort age, so every item a payload carries equals core's `itemStates` item of that golden;
// the server derives no state itself. A second case proves the abort age is the setting's, read per request.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DashboardModel } from "../core/src/dashboard.ts";
import type { ClaimViewModel, ItemStateInfo, LiveFrame, SpecPageModel, TasksTab } from "../core/src/files.ts";
import { DEFAULT_ABORT_AFTER_MS } from "../core/src/item-state.ts";
import { WORKSPACES_PATH, dashboardApi } from "../server/src/api.ts";
import { LIFEOS_ABSENT } from "../server/src/lifeos.ts";
import { type Registry, openRegistry } from "../server/src/registry.ts";
import { specRoutes } from "../server/src/spec-routes.contract.ts";
import { specRoutesApi } from "../server/src/spec-routes.ts";

const FIXTURES = join(import.meta.dir, "..", "core", "fixtures");
const BEACON = join(FIXTURES, "beacon");
const SLUG = "beacon";
const HOST = { Host: "127.0.0.1:7717" };
/** The `state` golden's clock (`STATE_NOW`, the live family's). */
const NOW = new Date("2026-03-08T15:00:00Z");

/** beacon's items as core derives them at `NOW` with its activity reading and the default abort age. */
const ITEMS = JSON.parse(readFileSync(join(FIXTURES, "beacon.state.golden.json"), "utf8")) as ItemStateInfo[];
const itemOf = (kind: ItemStateInfo["kind"], id: string, spec?: string): ItemStateInfo | undefined =>
  ITEMS.find((i) => i.kind === kind && i.id === id && (spec === undefined || i.spec === spec));

let dir: string;
const registries: Registry[] = [];

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "spectant-state-payload-")));
});

afterAll(() => {
  for (const registry of registries.splice(0)) registry.close();
  rmSync(dir, { recursive: true, force: true });
});

/** beacon registered and served by the workspace and the spec routes at `NOW`, with the abort age `abortAfterMs`. */
function serve(abortAfterMs: number): (path: string) => Promise<unknown> {
  const registry = openRegistry(mkdtempSync(join(dir, "data-")));
  registries.push(registry);
  registry.add(BEACON);
  const options = { registry, lifeos: LIFEOS_ABSENT, now: () => NOW, abortAfterMs: () => abortAfterMs };
  const specs = specRoutesApi(options);
  const workspace = dashboardApi({ ...options, services: () => Promise.resolve([]) });
  return async (path) => {
    const req = new Request(`http://127.0.0.1:7717${path}`, { headers: HOST });
    const url = new URL(req.url);
    const res = (await (specs(req, url) ?? workspace(req, url)));
    if (res === null) throw new Error(`no route answers ${path}`);
    expect({ path, status: res.status }).toEqual({ path, status: 200 });
    return res.json();
  };
}

describe("state payload (spec 040, ISC-224)", () => {
  test("dashboard rows, stories, spec page head, claims, tasks and live cards carry core's item state", async () => {
    const get = serve(DEFAULT_ABORT_AFTER_MS);
    const model = (await get(`${WORKSPACES_PATH}/${SLUG}/dashboard`)) as DashboardModel;
    expect(model.specs.length).toBeGreaterThan(0);
    expect(model.specs.map((row) => [row.id, row.state])).toEqual(model.specs.map((row) => [row.id, itemOf("spec", row.id)]));
    expect(model.ideas.list.map((idea) => [idea.slug, idea.state])).toEqual(model.ideas.list.map((idea) => [idea.slug, itemOf("idea", idea.slug)]));

    const seen = new Set<string>();
    for (const row of model.specs) {
      const page = (await get(specRoutes.spec(SLUG, row.id))) as SpecPageModel;
      expect({ spec: row.id, state: page.head.state }).toEqual({ spec: row.id, state: itemOf("spec", row.id) });

      const claims = (await get(specRoutes.claims(SLUG, row.id))) as ClaimViewModel;
      for (const c of claims.claims) expect({ claim: c.id, item: c.itemState }).toEqual({ claim: c.id, item: itemOf("claim", c.id, row.id) });

      const tab = (await get(specRoutes.tasks(SLUG, row.id))) as TasksTab | null;
      for (const t of tab?.tasks ?? []) expect({ task: t.id, item: t.itemState }).toEqual({ task: t.id, item: itemOf("task", t.id, row.id) });

      const live = (await get(specRoutes.live(SLUG, row.id))) as LiveFrame;
      for (const card of live.cards) expect({ card: card.task, item: card.itemState }).toEqual({ card: card.task, item: itemOf("task", card.task, row.id) });

      for (const item of [page.head.state, ...claims.claims.map((c) => c.itemState), ...(tab?.tasks ?? []).map((t) => t.itemState)]) if (item !== undefined) seen.add(item.state);
    }
    // Not vacuous: beacon's payloads show more than one state, a run among them.
    expect(seen.size).toBeGreaterThan(1);
    expect(ITEMS.some((i) => i.kind === "spec" && (i.state === "running" || i.state === "aborted"))).toBe(true);
  });

  test("the abort age is the setting's, read per request: a one-minute age turns every open run aborted", async () => {
    const get = serve(60_000);
    const model = (await get(`${WORKSPACES_PATH}/${SLUG}/dashboard`)) as DashboardModel;
    const runs = model.specs.map((row) => row.state).filter((s) => s?.run?.source === "run");
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.map((s) => s?.state)).toEqual(runs.map(() => "aborted"));
  });
});
