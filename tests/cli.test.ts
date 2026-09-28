import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDir, dbPath, ensureDataDir } from "../server/src/paths.ts";

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
