// The agent board over the live stream (spec 032, ISC-34): a `claim` line the plugin's hook appends to
// `.spectant/activity.jsonl` reaches the board within 2 seconds. The board is the spec's Board tab, which reads the live
// frame (`specRoutes.live`, core's `buildLiveFrame`) and re-reads it on every frame of the stream of spec 030; so the
// probe opens that stream against the real CLI (`spectant serve`, the harness in `fixtures/live-stream.ts`), appends one
// claim line from outside as the hook would, waits for the stream's frame of the workspace and then reads the live
// frame, which must show the claimed task in flight under the hook's session. The latency runs from the append to the
// arrival of that frame state, never through a poll.
//
// The stale age (ISC-35): a claim without a release older than the `staleMinutes` setting shows `stale` on its card
// (and its item state reads `aborted`, spec 040); a younger one does not, and with no setting stored the 45-minute
// default applies. The setting goes through `PUT /api/settings`, as the settings page sets it, never into the database.
//
// The repository is a plain copy of `core/fixtures/harbor` in a temp directory; nothing else is written. Every git
// command the server runs here sees an empty global config and no system config, as in `tests/live.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CardState, LiveCard } from "../core/src/files.ts";
import { WORKSPACES_PATH, type WorkspaceSummary } from "../server/src/api.ts";
import { SETTINGS_PATH } from "../server/src/settings.ts";
import { type SpecRouteResponses, specRoutes } from "../server/src/spec-routes.contract.ts";
import { LIVE_MS, changeAndWait, serve } from "./fixtures/live-stream.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
/** Harbor's 002 has open tasks no lock holds. */
const SPEC_ID = "002";
/** Card states a lock cannot put in flight (live.ts layer 3), and the one it puts there. */
const NOT_TAKEABLE: ReadonlySet<CardState> = new Set<CardState>(["running", "done", "closed", "operatorDone", "absent"]);

let root: string;
let repo: string;
let url: string;
let slug: string;
let stopServer: (() => Promise<void>) | undefined;
const savedEnv: Record<string, string | undefined> = {};

type Live = SpecRouteResponses["live"];

async function readLive(): Promise<Live> {
  const path = specRoutes.live(slug, SPEC_ID);
  const res = await fetch(`${url}${path}`);
  expect({ path, status: res.status }).toEqual({ path, status: 200 });
  return (await res.json()) as Live;
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-board-")));
  const emptyConfig = join(root, "gitconfig");
  writeFileSync(emptyConfig, "");
  for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
    savedEnv[key] = process.env[key];
    Reflect.deleteProperty(process.env, key);
  }
  process.env.GIT_CONFIG_GLOBAL = emptyConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  repo = join(root, "plain", "harbor");
  mkdirSync(join(root, "plain"));
  cpSync(FIXTURE, repo, { recursive: true });
  const served = await serve(root, [repo]);
  url = served.url;
  stopServer = served.stop;
  const list = (await (await fetch(`${url}${WORKSPACES_PATH}`)).json()) as WorkspaceSummary[];
  expect(list.length).toBe(1);
  slug = list[0]?.slug ?? "";
}, 60_000);

afterAll(async () => {
  try {
    await stopServer?.();
  } finally {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ISC-34 live: a new claim line reaches the agent board within 2 s", () => {
  test("live claim: a claim line appended to .spectant/activity.jsonl arrives over the stream, and the board's live frame then shows the task in flight", async () => {
    const before = await readLive();
    const held = new Set(before.locks.map((lock) => lock.claim));
    const free: LiveCard | undefined = before.cards.find(
      (card) => !NOT_TAKEABLE.has(card.state) && card.lane !== "operator" && !held.has(card.claim),
    );
    expect(free).toBeDefined();
    const task = free?.task ?? "";
    const claim = free?.claim ?? "";
    const session = `a:claude:board-live/${task}`;
    const line = { ts: new Date().toISOString(), event: "claim", claim, task, session };

    let appendedAt = Number.POSITIVE_INFINITY;
    const { stream, update } = await changeAndWait(
      url,
      (u) => u.ws === slug,
      () => {
        appendedAt = Date.now();
        appendFileSync(join(repo, ".spectant", "activity.jsonl"), `${JSON.stringify(line)}\n`);
      },
    );
    try {
      // The stream's frame first: without it the board has no reason to re-read.
      expect(update).not.toBeNull();
      const after = await readLive();
      const latency = Date.now() - appendedAt;
      const card = after.cards.find((c) => c.task === task);
      expect({ task, state: card?.state, lock: card?.lock, stale: card?.stale }).toEqual({
        task,
        state: "running",
        lock: { source: "activity", session },
        stale: false,
      });
      expect(after.locks.some((lock) => lock.claim === claim && lock.session === session)).toBe(true);
      expect(latency).toBeLessThanOrEqual(LIVE_MS);
      console.info(`ISC-34 live: claim on the board ${latency} ms after the append`);
    } finally {
      await stream.close();
      // Released again, as the hook's release would, so the stale probe below finds the claim free.
      appendFileSync(join(repo, ".spectant", "activity.jsonl"), `${JSON.stringify({ ts: new Date().toISOString(), event: "release", claim, task, session })}\n`);
    }
  });
});

describe("ISC-35 stale: a claim without release older than the set age shows stale on the agent board", () => {
  const MINUTE = 60_000;

  async function putSettings(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${url}${SETTINGS_PATH}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  }

  /**
   * The card of `card.task` as the board reads it (in flight, stale or not), and its claim's item state in the one state
   * model of spec 040 (`claims` route, `ClaimView.itemState`), where a lock past the same age reads `aborted` (ISC-223).
   */
  async function cardOf(card: LiveCard): Promise<Record<string, unknown>> {
    const live = (await readLive()).cards.find((c) => c.task === card.task);
    const res = await fetch(`${url}${specRoutes.claims(slug, SPEC_ID)}`);
    expect(res.status).toBe(200);
    const claims = (await res.json()) as SpecRouteResponses["claims"];
    const claim = claims.claims.find((c) => c.id === card.claim);
    return { task: card.task, state: live?.state, stale: live?.stale, claimState: claim?.itemState?.state };
  }

  /** The expected card: running, `stale` as given, and its claim `aborted` when stale, else `running`. */
  const expected = (card: LiveCard, stale: boolean): Record<string, unknown> => ({
    task: card.task,
    state: "running",
    stale,
    claimState: stale ? "aborted" : "running",
  });

  test("stale claim: older than staleMinutes is stale, younger is not, and without a setting 45 minutes apply", async () => {
    // Two free cards on two open claims nobody holds (no lock, no unmet edge: a claim that waits stays `waiting` under a
    // lock), each claimed from outside as the hook would, at a back-dated `ts`.
    const before = await readLive();
    const held = new Set(before.locks.map((lock) => lock.claim));
    const views = (await (await fetch(`${url}${specRoutes.claims(slug, SPEC_ID)}`)).json()) as SpecRouteResponses["claims"];
    const open = new Set(views.claims.filter((c) => c.itemState?.state === "open").map((c) => c.id));
    const free: LiveCard[] = [];
    for (const card of before.cards) {
      if (NOT_TAKEABLE.has(card.state) || card.lane === "operator" || held.has(card.claim) || !open.has(card.claim)) continue;
      if (free.some((f) => f.claim === card.claim)) continue;
      free.push(card);
    }
    expect(free.length).toBeGreaterThanOrEqual(2);
    const [old, young] = free as [LiveCard, LiveCard];
    const now = Date.now();
    const lines = [
      { card: old, ageMinutes: 50 },
      { card: young, ageMinutes: 30 },
    ].map(({ card, ageMinutes }) => ({
      ts: new Date(now - ageMinutes * MINUTE).toISOString(),
      event: "claim",
      claim: card.claim,
      task: card.task,
      session: `a:claude:board-stale/${card.task}`,
    }));
    appendFileSync(join(repo, ".spectant", "activity.jsonl"), lines.map((l) => `${JSON.stringify(l)}\n`).join(""));

    try {
      // No setting stored: the 45-minute default. 50 minutes is stale, 30 is not.
      expect((await readLive()).staleAfterMs).toBe(45 * MINUTE);
      expect(await cardOf(old)).toEqual(expected(old, true));
      expect(await cardOf(young)).toEqual(expected(young, false));

      // 20 minutes: the 30-minute claim is now older than the set age, so it is stale too.
      expect(await putSettings({ staleMinutes: 20 })).toMatchObject({ status: 200, body: { staleMinutes: 20 } });
      expect((await readLive()).staleAfterMs).toBe(20 * MINUTE);
      expect(await cardOf(old)).toEqual(expected(old, true));
      expect(await cardOf(young)).toEqual(expected(young, true));

      // 60 minutes: both claims are younger than the set age, so neither is stale.
      expect(await putSettings({ staleMinutes: 60 })).toMatchObject({ status: 200, body: { staleMinutes: 60 } });
      expect((await readLive()).staleAfterMs).toBe(60 * MINUTE);
      expect(await cardOf(old)).toEqual(expected(old, false));
      expect(await cardOf(young)).toEqual(expected(young, false));
    } finally {
      await putSettings({ staleMinutes: 45 });
    }
  });
});
