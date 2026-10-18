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
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { WORKSPACES_PATH, type WorkspaceSummary } from "../server/src/api.ts";
import { run } from "../server/src/cli.ts";
import {
  EVENTS_ALLOW,
  EVENTS_PATH,
  LIVE_EVENT,
  type LiveUpdate,
  SPEC_API_ROOT,
  isLiveUpdate,
  specRoutes,
} from "../server/src/spec-routes.contract.ts";
import { type PlantedWorktreeRepo, SPEC_FOLDER, SPEC_ID, SPEC_WORKTREE, plantWorktreeRepo } from "./fixtures/worktree-repo.ts";

const FIXTURE = join(import.meta.dir, "..", "core", "fixtures", "harbor");
/** The claim's bound: change on disk to frame at the client. */
const LIVE_MS = 2_000;
/** Time for the watchers the first connection switches on to arm before the test changes a file. */
const ARM_MS = 250;
/** The spec whose tasks.md the plain copy's cases tick: harbor's 002 has open boxes. */
const TICK_SPEC = { folder: "002-web-console", id: "002" } as const;

let root: string;
let repo: string;
let planted: PlantedWorktreeRepo;
let url: string;
let slug: string;
let plantedSlug: string;
let stopServer: (() => Promise<void>) | undefined;
const savedEnv: Record<string, string | undefined> = {};

function manifest(): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

/** The served app (`spectant serve`) with `repos` registered in order: its loopback URL, and `stop`, which waits for the exit. */
async function serve(repos: readonly string[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  try {
    for (const path of repos) expect(await run(["add", path], manifest(), { env })).toBe(0);
    const done = run(["--port", "0", "--no-browser"], manifest(), { env, signal: abort.signal });
    const deadline = Date.now() + 5_000;
    let found = "";
    while (found === "") {
      found = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
      if (Date.now() > deadline) throw new Error(`no URL line: ${lines.join(" | ")}`);
      if (found === "") await Bun.sleep(5);
    }
    return {
      url: found,
      stop: async () => {
        abort.abort();
        const code = await done;
        log.mockRestore();
        expect(code).toBe(0);
      },
    };
  } catch (error) {
    abort.abort();
    log.mockRestore();
    throw error;
  }
}

/** One dispatched SSE frame: its `event:` name (`message` without one), its joined `data:` lines, when it arrived. */
interface Frame {
  readonly event: string;
  readonly data: string;
  readonly at: number;
}

/** An open stream: the frames and `:` comment lines read so far, a wait for a frame, whether it is still open. */
interface Stream {
  readonly frames: Frame[];
  readonly comments: Array<{ readonly text: string; readonly at: number }>;
  /** Every raw byte read, decoded; for the absolute-path check. */
  readonly raw: () => string;
  readonly open: () => boolean;
  /** The first `LIVE_EVENT` frame from index `from` on whose update satisfies `match`, or null after `ms`. */
  readonly next: (match: (update: LiveUpdate) => boolean, ms: number, from?: number) => Promise<{ frame: Frame; update: LiveUpdate } | null>;
  readonly close: () => Promise<void>;
}

/** The page's side of the stream: `GET EVENTS_PATH`, read with a reader, parsed into frames (plan 030 § Interfaces). */
async function openStream(base: string): Promise<Stream> {
  const abort = new AbortController();
  const res = await fetch(`${base}${EVENTS_PATH}`, { signal: abort.signal, headers: { Accept: "text/event-stream" } });
  if (res.status !== 200) await res.body?.cancel();
  expect({ path: EVENTS_PATH, status: res.status }).toEqual({ path: EVENTS_PATH, status: 200 });
  expect(res.headers.get("content-type") ?? "").toStartWith("text/event-stream");
  expect(res.headers.get("cache-control") ?? "").toContain("no-cache");
  if (res.body === null) throw new Error("the stream answered without a body");

  const frames: Frame[] = [];
  const comments: Array<{ text: string; at: number }> = [];
  let raw = "";
  let open = true;
  /** Wakes a pending `next` when a chunk arrived or the stream ended. */
  const waiter: { wake: (() => void) | null } = { wake: null };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  const pump = (async (): Promise<void> => {
    let buffer = "";
    let event = "";
    let data: string[] = [];
    try {
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        raw += text;
        buffer += text;
        let cut = buffer.search(/\r?\n/);
        while (cut !== -1) {
          const line = buffer.slice(0, cut);
          buffer = buffer.slice(buffer[cut] === "\r" ? cut + 2 : cut + 1);
          if (line === "") {
            if (data.length > 0 || event !== "") frames.push({ event: event === "" ? "message" : event, data: data.join("\n"), at: Date.now() });
            event = "";
            data = [];
          } else if (line.startsWith(":")) {
            comments.push({ text: line.slice(1).trim(), at: Date.now() });
          } else {
            const colon = line.indexOf(":");
            const field = colon === -1 ? line : line.slice(0, colon);
            const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
            if (field === "event") event = value;
            else if (field === "data") data.push(value);
          }
          cut = buffer.search(/\r?\n/);
        }
        waiter.wake?.();
      }
    } catch {
      // aborted by close(): the stream ends here
    } finally {
      open = false;
      waiter.wake?.();
    }
  })();

  const next: Stream["next"] = async (match, ms, from = 0) => {
    const deadline = Date.now() + ms;
    for (;;) {
      for (const frame of frames.slice(from)) {
        if (frame.event !== LIVE_EVENT) continue;
        const update: unknown = JSON.parse(frame.data);
        expect(isLiveUpdate(update)).toBe(true);
        if (isLiveUpdate(update) && match(update)) return { frame, update };
      }
      const left = deadline - Date.now();
      if (left <= 0 || !open) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        waiter.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      waiter.wake = null;
    }
  };

  return {
    frames,
    comments,
    raw: () => raw,
    open: () => open,
    next,
    close: async () => {
      abort.abort();
      await pump;
    },
  };
}

const dashboardPath = (ws: string): string => `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`;
const paths = (update: LiveUpdate): string[] => update.views.map((view) => view.path);

/** Flips the first open box of `file` to done, as an agent ticking a task from outside would. */
function tickFirstOpenBox(file: string): void {
  const before = readFileSync(file, "utf8");
  const after = before.replace(/^- \[ \]/m, "- [x]");
  expect(after).not.toBe(before);
  writeFileSync(file, after);
}

/** Opens a stream, lets its watchers arm, makes `change`, and waits up to `LIVE_MS` for an update matching `match`. */
async function changeAndWait(
  match: (update: LiveUpdate) => boolean,
  change: () => void,
): Promise<{ stream: Stream; update: LiveUpdate | null; latency: number }> {
  const stream = await openStream(url);
  await Bun.sleep(ARM_MS);
  const from = stream.frames.length;
  const changedAt = Date.now();
  change();
  const hit = await stream.next(match, LIVE_MS, from);
  return { stream, update: hit?.update ?? null, latency: hit === null ? Number.POSITIVE_INFINITY : hit.frame.at - changedAt };
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

  const served = await serve([repo, planted.root]);
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
