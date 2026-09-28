import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type EmbeddedManifest, embeddedAssetFor } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";
import { dataDir, dbPath, ensureDataDir } from "../server/src/paths.ts";
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

  test("--version and -v print `spectant <VERSION>` and return 0", async () => {
    expect(await run(["--version"], manifest)).toBe(0);
    expect(await run(["-v"], manifest)).toBe(0);
    expect(out).toEqual([`spectant ${VERSION}`, `spectant ${VERSION}`]);
    expect(err).toEqual([]);
  });

  test("--help prints usage on stdout and returns 0", async () => {
    expect(await run(["--help"], manifest)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Usage: spectant");
    expect(text).toContain("serve");
    expect(text).toContain("--port");
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

  test("a busy port surfaces as a one-line error and returns 1", async () => {
    const blocker = Bun.serve({ hostname: "127.0.0.1", port: 0, reusePort: false, fetch: () => new Response("") });
    const port = blocker.port ?? 0;
    try {
      expect(port).toBeGreaterThan(0);
      expect(await run(["serve", "--port", String(port)], manifest)).toBe(1);
      expect(err).toHaveLength(1);
      expect(err[0]).toContain(`127.0.0.1:${port}`);
      expect(out).toEqual([]);
    } finally {
      await blocker.stop(true);
    }
  });
});
