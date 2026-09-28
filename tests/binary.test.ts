/**
 * Binary smoke (T12, ISC-8.1): the compiled host binary, copied alone into an empty directory, serves the embedded
 * app. Nothing beside the binary exists at run time, so every byte it serves must come from inside it.
 *
 * Run it with `bun run test:binary`, which builds the host target first (`bun scripts/build.ts --host-only`) and
 * sets `SPECTANT_TEST_BINARY=1`. Without that variable the suite is skipped: the lane probe `bun test tests/` and
 * `verify:quick` must stay green on a checkout that has no `dist/` yet. With it, a missing binary is a failure.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ENABLED = process.env.SPECTANT_TEST_BINARY === "1";
const ROOT = resolve(import.meta.dir, "..");
const LOOPBACK = "127.0.0.1";
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 5_000;
const FETCH_TIMEOUT_MS = 5_000;
const LISTENING = /spectant listening on http:\/\/127\.0\.0\.1:(\d+)/;

/** `dist/spectant-<os>-<arch>` for this machine, as `scripts/build.ts` names it; `undefined` off the release matrix. */
function hostBinaryName(): string | undefined {
  const os = process.platform === "darwin" || process.platform === "linux" ? process.platform : undefined;
  const arch = process.arch === "arm64" || process.arch === "x64" ? process.arch : undefined;
  return os && arch ? `spectant-${os}-${arch}` : undefined;
}

function timeout(ms: number, what: string): { promise: Promise<never>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** Drains a stream into a growing string, so a chatty child never blocks on a full pipe. */
function collect(stream: ReadableStream<Uint8Array>, sink: { text: string }): Promise<void> {
  return (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) sink.text += decoder.decode(chunk, { stream: true });
  })();
}

describe.skipIf(!ENABLED)("compiled host binary from an empty directory (ISC-8.1)", () => {
  const made: string[] = [];
  const stdout = { text: "" };
  const stderr = { text: "" };
  let proc: ReturnType<typeof Bun.spawn> | undefined;
  let base = "";
  let port = 0;

  const get = (path: string) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

  beforeAll(async () => {
    const name = hostBinaryName();
    if (name === undefined) throw new Error(`no release binary for this host (${process.platform}-${process.arch})`);
    const source = join(ROOT, "dist", name);
    if (!existsSync(source)) {
      throw new Error(
        `missing binary dist/${name}: build the host target first with \`bun scripts/build.ts --host-only\`, ` +
          "or run `bun run test:binary`, which does both",
      );
    }

    const runDir = mkdtempSync(join(tmpdir(), "spectant-binary-run-"));
    const homeDir = mkdtempSync(join(tmpdir(), "spectant-binary-home-"));
    made.push(runDir, homeDir);
    const binary = join(runDir, name);
    copyFileSync(source, binary);
    chmodSync(binary, 0o755);
    // The whole point: the binary is the only thing in its directory.
    expect(readdirSync(runDir)).toEqual([name]);

    // TODO(T50): `--no-browser` does not exist yet and `cli.ts` rejects it as an unknown option. Once T50 adds it
    // (with the browser open on start), this spawn MUST pass `--no-browser` too, or every run opens a browser tab.
    const child = Bun.spawn([binary, "--port", "0"], {
      cwd: runDir,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: homeDir, XDG_DATA_HOME: join(homeDir, "data") },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc = child;
    const drained = Promise.all([collect(child.stdout, stdout), collect(child.stderr, stderr)]);

    const settled = new AbortController();
    const listening = (async () => {
      while (!settled.signal.aborted && !LISTENING.test(stdout.text)) await Bun.sleep(25);
      return Number(LISTENING.exec(stdout.text)?.[1]);
    })();
    const exitedEarly = child.exited.then(async (code) => {
      await drained;
      throw new Error(
        `binary exited with code ${code} before listening\nstdout: ${stdout.text.trim()}\nstderr: ${stderr.text.trim()}`,
      );
    });
    // The same promise rejects again when SIGTERM ends the run below; only the race above may act on it.
    exitedEarly.catch(() => undefined);
    const deadline = timeout(START_TIMEOUT_MS, "waiting for the listening line");
    try {
      port = await Promise.race([listening, exitedEarly, deadline.promise]);
    } finally {
      settled.abort();
      deadline.cancel();
    }
    expect(port).toBeGreaterThan(0);
    base = `http://${LOOPBACK}:${port}`;
  }, START_TIMEOUT_MS + 5_000);

  afterAll(() => {
    if (proc?.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  let indexBody = "";

  test("GET / serves the embedded index.html", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toStartWith("text/html");
    indexBody = await res.text();
    expect(indexBody).toContain("<app-root");
  });

  test("the hashed main-*.js named by index.html is served as immutable JavaScript", async () => {
    const main = /src="\/?(main-[A-Za-z0-9]{8}\.js)"/.exec(indexBody)?.[1];
    if (main === undefined) throw new Error(`index.html names no hashed main-*.js:\n${indexBody}`);
    const res = await get(`/${main}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toStartWith("text/javascript");
    expect(res.headers.get("cache-control") ?? "").toContain("immutable");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  test("a deep link /w/x falls back to index.html", async () => {
    const res = await get("/w/x");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toStartWith("text/html");
    expect(await res.text()).toBe(indexBody);
  });

  test("a path that is neither an asset nor a SPA route is 404", async () => {
    const res = await get("/nope.txt");
    expect(res.status).toBe(404);
  });

  // `lsof` is optional on Linux; without it the loopback bind stays covered by `tests/http.test.ts`.
  test.skipIf(Bun.which("lsof") === null)("listens on loopback only", () => {
    const result = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdout: "pipe", stderr: "pipe" });
    const listing = result.stdout.toString();
    expect(listing).toContain(`${LOOPBACK}:${port}`);
    expect(listing).not.toContain(`*:${port}`);
  });

  test("SIGTERM stops it with exit code 0 within 5 s", async () => {
    if (!proc) throw new Error("binary was never started");
    proc.kill("SIGTERM");
    const deadline = timeout(STOP_TIMEOUT_MS, "waiting for exit after SIGTERM");
    try {
      expect(await Promise.race([proc.exited, deadline.promise])).toBe(0);
    } finally {
      deadline.cancel();
    }
    expect(proc.signalCode).toBeNull();
  }, STOP_TIMEOUT_MS + 5_000);
});
