import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { DEFAULT_PORT, PORT_ATTEMPTS } from "../server/src/http.ts";
import { openBrowser } from "../server/src/open-browser.ts";
import { dataDir, dbPath, ensureDataDir } from "../server/src/paths.ts";
import { DEFAULT_SETTINGS } from "../server/src/settings.ts";
import { VERSION } from "../server/src/version.ts";

describe("data dir", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("uses $XDG_DATA_HOME/spectant when XDG_DATA_HOME is set", () => {
    expect(dataDir({ XDG_DATA_HOME: "/tmp/x" }, "/tmp/h")).toBe("/tmp/x/spectant");
    expect(dbPath(dataDir({ XDG_DATA_HOME: "/tmp/x" }, "/tmp/h"))).toBe("/tmp/x/spectant/spectant.db");
  });

  test("falls back to ~/.spectant when XDG_DATA_HOME is unset or empty", () => {
    expect(dataDir({}, "/tmp/h")).toBe("/tmp/h/.spectant");
    expect(dataDir({ XDG_DATA_HOME: "" }, "/tmp/h")).toBe("/tmp/h/.spectant");
  });

  test("ensureDataDir creates the directory with mode 0700", () => {
    const root = mkdtempSync(join(tmpdir(), "spectant-data-dir-"));
    made.push(root);
    const dir = join(root, "nested", "spectant");
    expect(ensureDataDir(dir)).toBe(dir);
    expect(ensureDataDir(dir)).toBe(dir); // idempotent: mkdir -p semantics
    const stat = statSync(dir);
    expect(stat.isDirectory()).toBe(true);
    // POSIX permission bits are not readable on Windows; the app targets macOS and Linux.
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o700);
  });
});

// The minimal CLI (T11, ISC-8). `--version`, `--help`, unknown commands and the busy-port path resolve at once; the
// happy serve path keeps running and is proven against the compiled binary by `tests/binary.test.ts` (T12).
describe("run", () => {
  const out: string[] = [];
  const err: string[] = [];
  const restore: Array<() => void> = [];
  let dir: string;
  let manifest: EmbeddedManifest;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "spectant-cli-"));
    const index = join(dir, "index.html");
    writeFileSync(index, "<!doctype html><title>spectant</title>");
    manifest = {
      generatedAt: "2026-09-28T10:00:00.000Z",
      index,
      assets: [{ ...embeddedAssetFor("index.html"), file: index }],
    };
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    out.length = 0;
    err.length = 0;
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
    restore.push(
      () => log.mockRestore(),
      () => error.mockRestore(),
    );
  });
  afterEach(() => {
    for (const undo of restore.splice(0)) undo();
  });

  test("VERSION falls back to the root package.json version under bun run", async () => {
    const pkg = (await Bun.file(join(import.meta.dir, "..", "package.json")).json()) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  test("--version, -v and -V print `spectant <VERSION>` and return 0", async () => {
    expect(await run(["--version"], manifest)).toBe(0);
    expect(await run(["-v"], manifest)).toBe(0);
    expect(await run(["-V"], manifest)).toBe(0);
    expect(out).toEqual([`spectant ${VERSION}`, `spectant ${VERSION}`, `spectant ${VERSION}`]);
    expect(err).toEqual([]);
  });

  test("--version wins over --no-browser in either order", async () => {
    expect(await run(["--no-browser", "--version"], manifest)).toBe(0);
    expect(await run(["-V", "--no-browser"], manifest)).toBe(0);
    expect(out).toEqual([`spectant ${VERSION}`, `spectant ${VERSION}`]);
    expect(err).toEqual([]);
  });

  test("--help prints usage on stdout and returns 0", async () => {
    expect(await run(["--help"], manifest)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Usage: spectant");
    expect(text).toContain("serve");
    expect(text).toContain("--port");
    expect(text).toContain("--no-browser");
    expect(text).toContain("-V");
    expect(err).toEqual([]);
  });

  test("an unknown command prints usage on stderr and returns 2", async () => {
    expect(await run(["frobnicate"], manifest)).toBe(2);
    const text = err.join("\n");
    expect(text).toContain("unknown command");
    expect(text).toContain("Usage: spectant");
    expect(out).toEqual([]);
  });

  test("a missing or malformed --port value returns 2", async () => {
    expect(await run(["--port"], manifest)).toBe(2);
    expect(await run(["serve", "--port", "http"], manifest)).toBe(2);
    expect(await run(["--port=70000"], manifest)).toBe(2);
    expect(err.filter((line) => line.includes("--port"))).toHaveLength(3);
    expect(out).toEqual([]);
  });

  test("--no-browser and --strict-port are accepted, not usage errors", async () => {
    const env = { XDG_DATA_HOME: join(dir, "data") };
    const blocker = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } });
    try {
      // The busy port with --strict-port makes serve return 1 at once; a rejected flag would have returned 2.
      expect(await run(["--no-browser", "--strict-port", "--port", String(blocker.port)], manifest, { env })).toBe(1);
      expect(await run(["serve", "--port", String(blocker.port), "--strict-port", "--no-browser"], manifest, { env })).toBe(1);
      expect(err).toHaveLength(2);
      expect(err.join("\n")).not.toContain("unknown option");
      expect(out).toEqual([]);
    } finally {
      blocker.stop(true);
    }
  });

  test("a busy port with --strict-port surfaces as a one-line error and returns 1", async () => {
    const env = { XDG_DATA_HOME: join(dir, "data") };
    const blocker = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } });
    try {
      expect(blocker.port).toBeGreaterThan(0);
      expect(await run(["serve", "--strict-port", "--port", String(blocker.port)], manifest, { env })).toBe(1);
      expect(err).toHaveLength(1);
      expect(err[0]).toContain(`127.0.0.1:${blocker.port}`);
      expect(out).toEqual([]);
    } finally {
      blocker.stop(true);
    }
  });

  test("--strict-port only applies to serve", async () => {
    expect(await run(["list", "--strict-port"], manifest)).toBe(2);
    expect(err.join("\n")).toContain("--strict-port only applies to serve");
  });
});

/** The first port from `from` upward that a loopback listener can bind right now, as the CLI's fall-forward sees it. */
function firstFreePort(from: number): number {
  for (let port = from; port < from + PORT_ATTEMPTS; port++) {
    try {
      Bun.listen({ hostname: "127.0.0.1", port, socket: { data: () => undefined } }).stop(true);
      return port;
    } catch {
      // busy: try the next one
    }
  }
  throw new Error(`no free port in ${from}..${from + PORT_ATTEMPTS - 1}`);
}

// Start-up (T50, ISC-20): the port with its fall-forward, the one printed URL line, the browser open unless
// `--no-browser`, and the settings API on the CLI-started server. The browser runner is always injected: no test ever
// opens a real browser. The data directory is a temp dir, so the operator's own `~/.spectant` is never touched.
describe("start", () => {
  const out: string[] = [];
  const err: string[] = [];
  const restore: Array<() => void> = [];
  const stops: AbortController[] = [];
  let dir: string;
  let manifest: EmbeddedManifest;
  let env: Record<string, string>;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "spectant-start-"));
    const index = join(dir, "index.html");
    writeFileSync(index, "<!doctype html><title>spectant</title>");
    manifest = {
      generatedAt: "2026-09-29T10:00:00.000Z",
      index,
      assets: [{ ...embeddedAssetFor("index.html"), file: index }],
    };
    env = { XDG_DATA_HOME: join(dir, "data") };
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    out.length = 0;
    err.length = 0;
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => void out.push(args.join(" ")));
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
    restore.push(
      () => log.mockRestore(),
      () => error.mockRestore(),
    );
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop.abort();
    for (const undo of restore.splice(0)) undo();
  });

  const URL_LINE = /^spectant · (http:\/\/127\.0\.0\.1:(\d+))$/;

  /** Starts `run(argv)` with a recording browser runner; resolves once the URL line is printed. */
  async function start(argv: string[]) {
    const calls: string[][] = [];
    const browserRunner = (command: string[]) => {
      calls.push(command);
      return Promise.resolve(0);
    };
    const stop = new AbortController();
    stops.push(stop);
    const done = run(argv, manifest, { env, signal: stop.signal, browserRunner });
    const deadline = Date.now() + 5_000;
    const state = { settled: false };
    void done.then(() => (state.settled = true));
    while (!out.some((line) => URL_LINE.test(line))) {
      if (state.settled) throw new Error(`run exited before listening: ${err.join(" | ")}`);
      if (Date.now() > deadline) throw new Error(`no URL line; stdout: ${out.join(" | ")}`);
      await Bun.sleep(5);
    }
    const match = URL_LINE.exec(out.find((line) => URL_LINE.test(line)) ?? "");
    return {
      url: match?.[1] ?? "",
      port: Number(match?.[2]),
      calls,
      stop: async () => {
        stop.abort();
        return done;
      },
    };
  }

  test("start: without arguments it listens on 7717, or the first free port above it, and prints one URL line", async () => {
    expect(DEFAULT_PORT).toBe(7717);
    const expected = firstFreePort(DEFAULT_PORT);
    const server = await start(["--no-browser"]);
    expect(server.port).toBe(expected);
    expect(out).toEqual([`spectant · http://127.0.0.1:${expected}`]);
    expect((await fetch(`${server.url}/`)).status).toBe(200);
    expect(await server.stop()).toBe(0);
    expect(err).toEqual([]);
  });

  test("start: a busy preferred port falls forward to the next free port, and the URL names that port", async () => {
    const blocker = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => undefined } });
    try {
      const busy = blocker.port;
      const server = await start(["--port", String(busy), "--no-browser"]);
      expect(server.port).toBeGreaterThan(busy);
      expect(server.port).toBeLessThan(busy + PORT_ATTEMPTS);
      expect(out).toEqual([`spectant · http://127.0.0.1:${server.port}`]);
      expect((await fetch(`${server.url}/`)).status).toBe(200);
      expect(await server.stop()).toBe(0);
    } finally {
      blocker.stop(true);
    }
  });

  test("start: --no-browser never calls the browser runner", async () => {
    const server = await start(["--port", "0", "--no-browser"]);
    await Bun.sleep(20);
    expect(server.calls).toEqual([]);
    expect(await server.stop()).toBe(0);
  });

  test("start: without --no-browser the browser runner is called once with the printed URL", async () => {
    const server = await start(["--port", "0"]);
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    expect(server.calls).toEqual([[opener, server.url]]);
    expect(await server.stop()).toBe(0);
    expect(server.calls).toHaveLength(1);
  });

  test("start: the CLI-started server answers GET /api/settings with JSON", async () => {
    const server = await start(["--port", "0", "--no-browser"]);
    const res = await fetch(`${server.url}/api/settings`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(DEFAULT_SETTINGS);
    expect(await server.stop()).toBe(0);
  });
});

describe("openBrowser", () => {
  const err: string[] = [];
  let undo: () => void = () => undefined;
  beforeEach(() => {
    err.length = 0;
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => void err.push(args.join(" ")));
    undo = () => error.mockRestore();
  });
  afterEach(() => undo());

  test("runs `open` on darwin and `xdg-open` on linux", async () => {
    const calls: string[][] = [];
    const run = (command: string[]) => (calls.push(command), Promise.resolve(0));
    await openBrowser("http://127.0.0.1:7717", { platform: "darwin", run });
    await openBrowser("http://127.0.0.1:7718", { platform: "linux", run });
    expect(calls).toEqual([
      ["open", "http://127.0.0.1:7717"],
      ["xdg-open", "http://127.0.0.1:7718"],
    ]);
    expect(err).toEqual([]);
  });

  test("a failing or missing opener is logged to stderr and never throws", async () => {
    await openBrowser("http://127.0.0.1:7717", { platform: "linux", run: () => Promise.resolve(3) });
    await openBrowser("http://127.0.0.1:7717", { platform: "linux", run: () => Promise.reject(new Error("ENOENT")) });
    await openBrowser("http://127.0.0.1:7717", { platform: "win32", run: () => Promise.resolve(0) });
    expect(err).toHaveLength(3);
    for (const line of err) expect(line).toContain("http://127.0.0.1:7717");
  });
});
