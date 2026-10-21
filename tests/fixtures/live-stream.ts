// The page's side of the live update stream (spec 030, ISC-28; plan 030 § Interfaces), shared by the stream probes
// (`tests/live.test.ts`) and the board probe (`tests/board.test.ts -t live`, spec 032, ISC-34): the real CLI served on
// a loopback port with the given repositories registered, an SSE client over `fetch` that parses the frames, and the
// change-then-wait step every probe takes. One harness, so both probes measure the same path.
import { expect, spyOn } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../../server/src/contracts/assets.contract.ts";
import { run } from "../../server/src/cli/index.ts";
import { EVENTS_PATH, LIVE_EVENT, type LiveUpdate, isLiveUpdate } from "../../server/src/contracts/spec-routes.contract.ts";

/** The claim's bound: change on disk to frame at the client. */
export const LIVE_MS = 2_000;
/** Time for the watchers the first connection switches on to arm before the test changes a file. */
export const ARM_MS = 250;

function manifest(root: string): EmbeddedManifest {
  const index = join(root, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>");
  return { generatedAt: "2026-09-29T10:00:00.000Z", assets: [{ ...embeddedAssetFor("index.html"), file: index }], index };
}

/**
 * The served app (`spectant serve`) with `repos` registered in order, its data directory a fresh one under `root`: its
 * loopback URL, and `stop`, which waits for the exit.
 */
export async function serve(root: string, repos: readonly string[]): Promise<{ url: string; stop: () => Promise<void> }> {
  const env = { XDG_DATA_HOME: mkdtempSync(join(root, "xdg-")) };
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  try {
    for (const path of repos) expect(await run(["add", path], manifest(root), { env })).toBe(0);
    const done = run(["--port", "0", "--no-browser"], manifest(root), { env, signal: abort.signal });
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
export interface Frame {
  readonly event: string;
  readonly data: string;
  readonly at: number;
}

/** An open stream: the frames and `:` comment lines read so far, a wait for a frame, whether it is still open. */
export interface Stream {
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
export async function openStream(base: string): Promise<Stream> {
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

/**
 * Opens a stream on `base`, lets its watchers arm, makes `change`, and waits up to `LIVE_MS` for an update matching
 * `match`; `latency` runs from the change to the frame's arrival, infinite when none came.
 */
export async function changeAndWait(
  base: string,
  match: (update: LiveUpdate) => boolean,
  change: () => void,
): Promise<{ stream: Stream; update: LiveUpdate | null; latency: number }> {
  const stream = await openStream(base);
  await Bun.sleep(ARM_MS);
  const from = stream.frames.length;
  const changedAt = Date.now();
  change();
  const hit = await stream.next(match, LIVE_MS, from);
  return { stream, update: hit?.update ?? null, latency: hit === null ? Number.POSITIVE_INFINITY : hit.frame.at - changedAt };
}
