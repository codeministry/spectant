// The live update stream (spec 030, ISC-28): a change to a watched file reaches an open page within 2 seconds without
// a reload. The page is played by an SSE client over `fetch` against the real CLI (`spectant serve`), with two
// repositories registered: a plain copy of `core/fixtures/harbor` and the git fixture of spec 027 with a spec worktree
// whose copy of `specs/002-web-console/` is tracked (`plantWorktreeRepo`). Every change is made from outside, by a
// plain file write as an editor or an agent would make it, never through the API.
//
// The frames follow plan 030 § Interfaces: `event: update` with a `LiveUpdate` as `data:`, whose views are byte for byte
// what a `GET` on their path answers (same ETag, same JSON), and a `:` comment line as heartbeat every 5 s, so the
// stream outlives Bun's idle timeout of 10 s. The stream has the loopback guard of every other route and carries no
// absolute path (ISC-3).
//
// Every git command the server runs here sees an empty global config and no system config (set on `process.env` for
// this file and restored after it), as in `tests/readonly.test.ts`.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACES_PATH, type WorkspaceSummary } from "../server/src/workspace/index.ts";
import { EVENTS_ALLOW, EVENTS_PATH, type LiveUpdate, SPEC_API_ROOT, specRoutes } from "../server/src/contracts/spec-routes.contract.ts";
import { LIVE_MS, changeAndWait as changeAndWaitAt, openStream, serve } from "./fixtures/live-stream.ts";
import { type PlantedWorktreeRepo, SPEC_FOLDER, SPEC_ID, SPEC_WORKTREE, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
/** The spec whose tasks.md the plain copy's cases tick: harbor's 002 has open boxes. */
const TICK_SPEC = { folder: "002-web-console", id: "002" } as const;
/** The task of harbor's 002 the step case appends a probe line for: T28 holds ISC-75 and already has run lines. */
const STEP_TASK = { task: "T28", claim: "ISC-75", session: "a:claude:live-step/T28" } as const;

let root: string;
let repo: string;
let planted: PlantedWorktreeRepo;
let url: string;
let slug: string;
let plantedSlug: string;
let stopServer: (() => Promise<void>) | undefined;
const savedEnv: Record<string, string | undefined> = {};

/** Opens a stream on the served app and waits for an update after `change` (`fixtures/live-stream.ts`). */
const changeAndWait = (match: (update: LiveUpdate) => boolean, change: () => void) => changeAndWaitAt(url, match, change);

const dashboardPath = (ws: string): string => `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`;
const paths = (update: LiveUpdate): string[] => update.views.map((view) => view.path);

/** Flips the first open box of `file` to done, as an agent ticking a task from outside would. */
function tickFirstOpenBox(file: string): void {
  const before = readFileSync(file, "utf8");
  const after = before.replace(/^- \[ \]/m, "- [x]"); // single-core: allow — simulates an outside agent editing raw file bytes
  expect(after).not.toBe(before);
  writeFileSync(file, after);
}

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-live-")));
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
  planted = await plantWorktreeRepo({ parent: root, trackedSpecs: true });

  const served = await serve(root, [repo, planted.root]);
  url = served.url;
  stopServer = served.stop;
  const list = (await (await fetch(`${url}${WORKSPACES_PATH}`)).json()) as WorkspaceSummary[];
  expect(list.length).toBe(2);
  [slug, plantedSlug] = list.map((w) => w.slug) as [string, string];
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

describe("ISC-28 live: a change to a watched file reaches an open page within 2 s, without a reload", () => {
  test("live tick: a task box flipped in tasks.md from outside arrives as an update with the dashboard and that spec", async () => {
    const specPath = specRoutes.spec(slug, TICK_SPEC.id);
    const { stream, update, latency } = await changeAndWait(
      (u) => u.ws === slug && paths(u).includes(specPath),
      () => tickFirstOpenBox(join(repo, "specs", TICK_SPEC.folder, "tasks.md")),
    );
    try {
      expect(update).not.toBeNull();
      expect(update?.ws).toBe(slug);
      for (const path of [dashboardPath(slug), specPath]) expect(paths(update ?? { ws: "", views: [] })).toContain(path);
      expect(latency).toBeLessThanOrEqual(LIVE_MS);
    } finally {
      await stream.close();
    }
  });

  test("live views: each view's etag and body are those of a fresh GET on its path", async () => {
    const specPath = specRoutes.spec(slug, TICK_SPEC.id);
    const { stream, update } = await changeAndWait(
      (u) => u.ws === slug && paths(u).includes(specPath),
      () => tickFirstOpenBox(join(repo, "specs", TICK_SPEC.folder, "tasks.md")),
    );
    try {
      expect(update).not.toBeNull();
      expect(update?.views.length ?? 0).toBeGreaterThan(0);
      for (const view of update?.views ?? []) {
        const res = await fetch(`${url}${view.path}`);
        expect({ path: view.path, status: res.status, etag: res.headers.get("etag") }).toEqual({ path: view.path, status: 200, etag: view.etag });
        expect(await res.json()).toEqual(view.body);
      }
    } finally {
      await stream.close();
    }
  });

  test("live step: a probe line appended to .spectant/activity.jsonl arrives as an update, and the spec's live and tasks routes then carry it", async () => {
    // spec 015, ISC-233: the stream reports the workspace whose activity log changed. The log is repository-wide, so
    // the frame names no spec (`specIds` empty); the open page refreshes on any update of its workspace and re-reads
    // its live and tasks routes, which must then carry the new step.
    const livePath = specRoutes.live(slug, TICK_SPEC.id);
    const tasksPath = specRoutes.tasks(slug, TICK_SPEC.id);
    type Steps = Record<string, Array<{ kind: string; ts: string; actor: string; result?: string }>>;
    const stepsAt = async (path: string): Promise<Steps> => {
      const res = await fetch(`${url}${path}`);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
      return ((await res.json()) as { steps: Steps }).steps;
    };
    const ts = new Date().toISOString();
    const line = { ts, event: "probe", claim: STEP_TASK.claim, task: STEP_TASK.task, session: STEP_TASK.session, result: "red" };
    const isOurs = (steps: Steps): boolean => (steps[STEP_TASK.task] ?? []).some((s) => s.ts === ts && s.actor === STEP_TASK.session);
    expect(isOurs(await stepsAt(livePath))).toBe(false);

    const { stream, update, latency } = await changeAndWait(
      (u) => u.ws === slug && paths(u).includes(dashboardPath(slug)),
      () => appendFileSync(join(repo, ".spectant", "activity.jsonl"), `${JSON.stringify(line)}\n`),
    );
    try {
      expect(update).not.toBeNull();
      expect(latency).toBeLessThanOrEqual(LIVE_MS);
      for (const path of [livePath, tasksPath]) {
        const last = (await stepsAt(path))[STEP_TASK.task]?.at(-1);
        expect({ path, last }).toEqual({ path, last: { kind: "probe", ts, actor: STEP_TASK.session, result: "red" } });
      }
    } finally {
      await stream.close();
    }
  });

  test("live rename: ISA.md replaced by write-to-temp and rename arrives as an update", async () => {
    const isa = join(repo, "ISA.md");
    const { stream, update, latency } = await changeAndWait(
      (u) => u.ws === slug && paths(u).includes(dashboardPath(slug)),
      () => {
        const temp = join(repo, ".ISA.md.live-tmp");
        writeFileSync(temp, `${readFileSync(isa, "utf8")}\n<!-- edited by an editor that saves atomically -->\n`);
        renameSync(temp, isa);
      },
    );
    try {
      expect(update).not.toBeNull();
      expect(latency).toBeLessThanOrEqual(LIVE_MS);
    } finally {
      await stream.close();
    }
  });

  test("live worktree: a change in a spec worktree's copy of the spec folder arrives as an update of that spec", async () => {
    const specPath = specRoutes.spec(plantedSlug, SPEC_ID);
    const { stream, update, latency } = await changeAndWait(
      (u) => u.ws === plantedSlug && paths(u).includes(specPath),
      () => tickFirstOpenBox(join(planted.root, SPEC_WORKTREE, "specs", SPEC_FOLDER, "tasks.md")),
    );
    try {
      expect(update).not.toBeNull();
      expect(update?.ws).toBe(plantedSlug);
      expect(latency).toBeLessThanOrEqual(LIVE_MS);
    } finally {
      await stream.close();
    }
  });

  test("live heartbeat: with no change the stream stays open past Bun's 10 s idle timeout, a comment line every 5 s", async () => {
    const stream = await openStream(url);
    try {
      const opened = Date.now();
      await Bun.sleep(11_500);
      expect(stream.open()).toBe(true);
      expect(stream.comments.length).toBeGreaterThanOrEqual(2);
      expect(stream.comments[0]?.at ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(opened + 6_000);
    } finally {
      await stream.close();
    }
  }, 20_000);

  test("live guard: a foreign Host or Origin is 403, any other method 405 with Allow: GET", async () => {
    const stream = await openStream(url);
    await stream.close();

    const rebound = await fetch(`${url}${EVENTS_PATH}`, { headers: { Host: "evil.example" } });
    expect(rebound.status).toBe(403);
    expect(await rebound.json()).toEqual({ error: "forbidden" });
    const foreign = await fetch(`${url}${EVENTS_PATH}`, { headers: { Origin: "https://evil.example" } });
    expect(foreign.status).toBe(403);
    await foreign.body?.cancel();
    const post = await fetch(`${url}${EVENTS_PATH}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe(EVENTS_ALLOW);
    await post.body?.cancel();
  });

  test("live paths: no frame carries an absolute path of a registered repository (ISC-3)", async () => {
    const { stream, update } = await changeAndWait(
      (u) => u.ws === slug,
      () => tickFirstOpenBox(join(repo, "specs", TICK_SPEC.folder, "tasks.md")),
    );
    try {
      expect(update).not.toBeNull();
      for (const absolute of [root, repo, planted.root]) expect(stream.raw()).not.toContain(absolute);
    } finally {
      await stream.close();
    }
  });
});
