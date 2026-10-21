// The golden-master harness of spec 059 (T1, ISC-403): the served app on a fixed fixture workspace, so every answer
// of the HTTP surface can be recorded once on the code before a refactor and compared byte for byte after it.
//
// The server starts through the real CLI path (`run(["--port", "0", "--no-browser"])`, as `tests/readonly.test.ts`
// and `tests/fixtures/live-stream.ts` do), not through an in-process `composeApi`, because the composition in
// `cli.ts` is part of what the recording guards. This file is the only one of the golden suite that imports
// `server/src/`, so a module move touches one import list.
//
// Determinism, so a recording equals a later run on any machine:
// - Two workspaces under fixed directory names (slugs and `pathTail` are basenames): `harbor`, the git repository of
//   `tests/fixtures/worktree-repo.ts` with its spec and builder worktrees (fixed identity and commit dates), and
//   `library`, a plain copy of `core/fixtures/library`. Every file, directory and `.git/` entry gets one fixed mtime.
// - The clock is frozen (`setSystemTime`), `TZ=UTC`, `HOME` and `GIT_CONFIG_GLOBAL` point at a temp config with a
//   fixed `user.email`, `SPECTANT_LIFEOS_STATE_DIR` is never passed, and the data directory is a fresh one.
// - What still varies is normalised, and nothing else: the port in a body or header, the `Date` header, note ids
//   (random UUIDs) and the dashboard's `services` (a live `lsof` probe). A body that contains a normalised value
//   carries `etag: "<normalised>"`, since a strong ETag hashes the original bytes. The header list drops what only
//   describes the transport (`date`, `content-length`, `connection`, `keep-alive`, `transfer-encoding`).
import { expect, setSystemTime, spyOn } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../../../server/src/contracts/assets.contract.ts";
import { run } from "../../../server/src/cli/index.ts";
import { WRITE_PATHS } from "../../../server/src/contracts/writes.contract.ts";
import { plantWorktreeRepo } from "../worktree-repo.ts";

/** The write-path constant the write recording pins (re-exported, so the suite imports `server/src/` only here). */
export { WRITE_PATHS };

/** The frozen server clock. */
export const GOLDEN_NOW = new Date("2026-03-20T12:00:00.000Z");
/** The mtime of every fixture file and directory, and of the file the events entry changes. */
export const GOLDEN_MTIME = new Date("2026-03-10T08:00:00.000Z");
/** The address git reports as the viewer's; the harness's actor mapping names it. */
export const GOLDEN_EMAIL = "harbor@example.org";
/** The one fixed asset of the embedded manifest beside `index.html`. */
export const GOLDEN_ASSET = "main-GOLDEN01.js";
/** Placeholder of a normalised ETag. */
export const NORMALISED = "<normalised>";

const LIBRARY = join(import.meta.dir, "..", "..", "..", "core", "fixtures", "library");
/** Headers that describe the transport, not the answer. */
const DROPPED_HEADERS = new Set(["date", "content-length", "connection", "keep-alive", "transfer-encoding"]);
/** The watchers the first stream switches on need this long to arm before a change (as `live-stream.ts`'s `ARM_MS`). */
const ARM_MS = 250;
const FRAME_MS = 5_000;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** One request of the golden list. `path` is the path and query, no origin. */
export interface GoldenRequest {
  readonly name: string;
  readonly method?: string;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
}

/** One recorded answer. `body` is text, or base64 when the bytes are no UTF-8. */
export interface GoldenEntry {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly encoding: "utf8" | "base64";
  readonly body: string;
}

/** The running app on the fixture workspaces. */
export interface GoldenServer {
  readonly url: string;
  readonly port: string;
  /** Absolute roots of the registered workspaces, by slug. */
  readonly repos: Readonly<{ harbor: string; library: string }>;
  /** Restores the clock and the environment, stops the server and removes every temp directory. */
  readonly stop: () => Promise<void>;
}

/** Sets every file's and directory's mtime under `dir` to `GOLDEN_MTIME`; symlinks are left alone. */
export function freezeMtimes(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) freezeMtimes(path);
    utimesSync(path, GOLDEN_MTIME, GOLDEN_MTIME);
  }
  utimesSync(dir, GOLDEN_MTIME, GOLDEN_MTIME);
}

function manifest(dir: string): EmbeddedManifest {
  mkdirSync(dir, { recursive: true });
  const index = join(dir, "index.html");
  writeFileSync(index, "<!doctype html><title>spectant</title>\n");
  const asset = join(dir, GOLDEN_ASSET);
  writeFileSync(asset, 'console.log("golden");\n');
  return {
    generatedAt: "2026-03-01T09:00:00.000Z",
    assets: [
      { ...embeddedAssetFor("index.html"), file: index },
      { ...embeddedAssetFor(GOLDEN_ASSET), file: asset },
    ],
    index,
  };
}

const ENV_KEYS = ["TZ", "HOME", "GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME"] as const;

/**
 * Moves the frozen clock to `GOLDEN_NOW + offsetMs`; `0` puts it back. For setup writes that must not share one
 * timestamp: two notes created in the same millisecond are ordered by their random ids.
 */
export function setGoldenClock(offsetMs: number): void {
  setSystemTime(new Date(GOLDEN_NOW.getTime() + offsetMs));
}

/** Plants the fixtures, freezes clock, zone and git identity, and serves the app with both workspaces registered. */
export async function startGolden(): Promise<GoldenServer> {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), "spectant-golden-")));
  const restore = (): void => {
    setSystemTime();
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(base, { recursive: true, force: true });
  };

  const home = join(base, "home");
  mkdirSync(home, { recursive: true });
  const gitconfig = join(home, ".gitconfig");
  writeFileSync(gitconfig, `[user]\n\tname = Harbor Master\n\temail = ${GOLDEN_EMAIL}\n`);
  process.env.TZ = "UTC";
  process.env.HOME = home;
  process.env.GIT_CONFIG_GLOBAL = gitconfig;
  process.env.XDG_CONFIG_HOME = join(home, ".config");

  const planted = await plantWorktreeRepo({ parent: base });
  const library = join(base, "library");
  cpSync(LIBRARY, library, { recursive: true });
  freezeMtimes(planted.base);
  freezeMtimes(library);
  setSystemTime(GOLDEN_NOW);

  const web = manifest(join(base, "web"));
  const env = { XDG_DATA_HOME: join(base, "xdg") };
  const lines: string[] = [];
  const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void lines.push(args.join(" ")));
  const abort = new AbortController();
  let done: Promise<number> | null = null;
  try {
    for (const path of [planted.root, library]) expect(await run(["add", path], web, { env })).toBe(0);
    done = run(["--port", "0", "--no-browser"], web, { env, signal: abort.signal });
    let url = "";
    for (let tries = 0; url === ""; tries++) {
      url = /^spectant · (http:\/\/127\.0\.0\.1:\d+)$/.exec(lines.find((l) => l.startsWith("spectant · ")) ?? "")?.[1] ?? "";
      if (tries > 1_000) throw new Error(`no URL line: ${lines.join(" | ")}`);
      if (url === "") await Bun.sleep(5);
    }
    const running = done;
    return {
      url,
      port: new URL(url).port,
      repos: { harbor: planted.root, library },
      stop: async () => {
        abort.abort();
        const code = await running;
        log.mockRestore();
        restore();
        expect(code).toBe(0);
      },
    };
  } catch (error) {
    abort.abort();
    if (done !== null) await done;
    log.mockRestore();
    restore();
    throw error;
  }
}

// ── normalisation ────────────────────────────────────────────────────────────────────────────────────────────────

/** Replaces each distinct note id by `<id:N>` in order of appearance; the same id gets the same number. */
function normaliseIds(text: string, ids: Map<string, string>): string {
  return text.replace(UUID, (id) => {
    const known = ids.get(id);
    if (known !== undefined) return known;
    const name = `<id:${ids.size + 1}>`;
    ids.set(id, name);
    return name;
  });
}

/** Empties every `services` array of a JSON value in place; true when the value has the key at all. */
function emptyServices(value: unknown): boolean {
  if (Array.isArray(value)) return value.map(emptyServices).some(Boolean);
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  let found = false;
  for (const [key, inner] of Object.entries(record)) {
    if (key === "services" && Array.isArray(inner)) {
      record[key] = [];
      found = true;
    } else if (emptyServices(inner)) found = true;
  }
  return found;
}

/**
 * The normalised text of one body: the port, note ids and, in a JSON body, `services`. `touched` is true when the
 * body holds any of them, whatever their value, so a recording and a later run drop the same ETags.
 */
export function normaliseText(text: string, port: string, ids: Map<string, string>, json: boolean): { text: string; touched: boolean } {
  let touched = false;
  let out = text;
  if (json && out.includes('"services"')) {
    try {
      const value: unknown = JSON.parse(out);
      if (emptyServices(value)) {
        out = JSON.stringify(value);
        touched = true;
      }
    } catch {
      // not JSON after all: left as it is
    }
  }
  const ported = out.replaceAll(`127.0.0.1:${port}`, "127.0.0.1:<port>").replaceAll(`localhost:${port}`, "localhost:<port>");
  if (ported !== out) touched = true;
  const named = normaliseIds(ported, ids);
  if (named !== ported) touched = true;
  return { text: named, touched };
}

function decodeBody(bytes: Uint8Array): { encoding: "utf8" | "base64"; text: string } {
  try {
    return { encoding: "utf8", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { encoding: "base64", text: Buffer.from(bytes).toString("base64") };
  }
}

function headersOf(res: Response, port: string): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = [...res.headers.keys()].map((k) => k.toLowerCase()).filter((k) => !DROPPED_HEADERS.has(k)).sort();
  for (const key of keys) out[key] = (res.headers.get(key) ?? "").replaceAll(`127.0.0.1:${port}`, "127.0.0.1:<port>");
  return out;
}

/**
 * What one recording run carries across its entries: the note-id numbering, and the paths whose GET body held a
 * normalised value, so the HEAD of the same path (no body to look at) drops its ETag too.
 */
export interface GoldenContext {
  readonly ids: Map<string, string>;
  readonly touched: Set<string>;
}

export function goldenContext(): GoldenContext {
  return { ids: new Map(), touched: new Set() };
}

/** One request against the server, recorded as an entry. A HEAD comes after the GET of its path. */
export async function callGolden(server: GoldenServer, req: GoldenRequest, context: GoldenContext): Promise<GoldenEntry> {
  const { ids, touched } = context;
  const method = req.method ?? "GET";
  const res = await fetch(`${server.url}${req.path}`, { method, headers: req.headers, body: req.body, redirect: "manual" });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const headers = headersOf(res, server.port);
  const decoded = decodeBody(bytes);
  let body = decoded.text;
  if (decoded.encoding === "utf8") {
    const normalised = normaliseText(body, server.port, ids, (headers["content-type"] ?? "").includes("json"));
    body = normalised.text;
    if (normalised.touched) touched.add(req.path);
  }
  if (touched.has(req.path) && headers.etag !== undefined) headers.etag = NORMALISED;
  return { name: req.name, method, path: normaliseIds(req.path, ids), status: res.status, headers, encoding: decoded.encoding, body };
}

/** A setup request (a database write the reads then show); throws unless it answers 2xx. Not recorded. */
export async function setupCall(server: GoldenServer, req: GoldenRequest): Promise<Response> {
  const method = req.method ?? "GET";
  const res = await fetch(`${server.url}${req.path}`, { method, headers: req.headers, body: req.body });
  if (res.status < 200 || res.status > 299) throw new Error(`setup ${req.name}: ${method} ${req.path} answered ${res.status}: ${await res.text()}`);
  return res;
}

/**
 * `GET /api/events`: opens the stream, lets the watchers arm, runs `change`, and records the first `update` frame
 * after it as the body (its data line, normalised like any JSON body: each view's `etag` becomes `NORMALISED` when its
 * body was), beside the stream's status and headers. The prelude before the change (`retry:`, `: connected`) is
 * recorded too, as `prelude` in the body's first line.
 */
export async function eventsGolden(server: GoldenServer, name: string, path: string, change: () => void, context: GoldenContext): Promise<GoldenEntry> {
  const { ids } = context;
  const abort = new AbortController();
  const res = await fetch(`${server.url}${path}`, { signal: abort.signal, headers: { Accept: "text/event-stream" } });
  const headers = headersOf(res, server.port);
  if (res.body === null) throw new Error("the stream answered without a body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const readUntil = async (done: () => boolean, ms: number): Promise<void> => {
    const deadline = performance.now() + ms;
    while (!done()) {
      const left = deadline - performance.now();
      if (left <= 0) throw new Error(`events: nothing matched within ${ms} ms: ${JSON.stringify(buffer.slice(0, 400))}`);
      const chunk: { done: boolean; value?: Uint8Array } | null = await Promise.race([reader.read(), Bun.sleep(left).then(() => null)]);
      if (chunk === null) continue;
      if (chunk.done) throw new Error(`events: the stream ended: ${JSON.stringify(buffer.slice(0, 400))}`);
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
  try {
    await readUntil(() => buffer.includes("\n\n"), FRAME_MS);
    const prelude = buffer.slice(0, buffer.indexOf("\n\n") + 2);
    await Bun.sleep(ARM_MS);
    buffer = buffer.slice(prelude.length);
    change();
    const frameOf = (): string | null => {
      for (const block of buffer.split("\n\n").slice(0, -1)) if (block.split("\n").includes("event: update")) return block;
      return null;
    };
    await readUntil(() => frameOf() !== null, FRAME_MS);
    const frame = frameOf() ?? "";
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    const update = JSON.parse(data) as { ws: string; views: Array<{ path: string; etag: string; body: unknown }> };
    for (const view of update.views) {
      const normalised = normaliseText(JSON.stringify(view.body), server.port, ids, true);
      if (normalised.touched) {
        view.etag = NORMALISED;
        view.body = JSON.parse(normalised.text);
      }
    }
    return { name, method: "GET", path, status: res.status, headers, encoding: "utf8", body: `${JSON.stringify({ prelude })}\n${JSON.stringify(update)}` };
  } finally {
    abort.abort();
    await reader.cancel().catch(() => undefined);
  }
}

/** Writes `bytes` to `file` and gives it the golden mtime, so the change is fixed in content and time. */
export function changeFile(file: string, text: string): void {
  writeFileSync(file, text);
  utimesSync(file, GOLDEN_MTIME, GOLDEN_MTIME);
}

// ── the recording file ───────────────────────────────────────────────────────────────────────────────────────────

/** The recording as it is stored: pretty JSON with a trailing newline (the read entries, or the write recording). */
export function writeGolden(file: string, recording: unknown): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify(recording, null, 2)}\n`);
}

/** The stored recording as parsed JSON, or null when the file is missing. */
export function readGoldenJson(file: string): unknown {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The stored read recording, or null when the file is missing. */
export function readGolden(file: string): GoldenEntry[] | null {
  return readGoldenJson(file) as GoldenEntry[] | null;
}
