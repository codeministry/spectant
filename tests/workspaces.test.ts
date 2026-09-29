// ISC-13: `spectant add <repo>`, `spectant list` and `spectant remove <repo>` round-trip a workspace through the
// registry. The probe drives the CLI's `run()` (T44) against a temp data directory (through `XDG_DATA_HOME`, the same
// convention `paths.ts` follows) and temp repository directories; nothing touches the real `~/.spectant`.
//
// Two guards ride along: stdout never names the absolute temp path, only the path tail (ISC-3), and the registered
// repository is byte-identical before and after, `.git/` included (ISC-15).
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { EmbeddedManifest } from "../server/src/assets.contract.ts";
import { run } from "../server/src/cli.ts";

// The workspace commands never serve, so they never read the manifest.
const manifest: EmbeddedManifest = { generatedAt: "2026-09-29T00:00:00.000Z", index: "", assets: [] };

let root: string;
let env: Record<string, string>;
const out: string[] = [];
const err: string[] = [];
const restore: Array<() => void> = [];

function repo(...segments: string[]): string {
  const dir = join(root, ...segments);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, "specs", "001-thing"), { recursive: true });
  writeFileSync(join(dir, "specs", "001-thing", "spec.md"), "# thing\n");
  return dir;
}

/** A recursive hash over every relative path, mode and file content under `dir`, `.git/` included. */
function hashTree(dir: string): string {
  const hash = createHash("sha256");
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const stat = statSync(full);
      hash.update(`${relative(dir, full)}\0${stat.mode}\0${stat.mtimeMs}\0`);
      if (stat.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(dir);
  return hash.digest("hex");
}

function cli(...argv: string[]): Promise<number> {
  return run(argv, manifest, { env, cwd: root });
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "spectant-workspaces-")));
  env = { XDG_DATA_HOME: join(root, "data") };
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
  rmSync(root, { recursive: true, force: true });
});

describe("workspaces (CLI)", () => {
  test("add, list and remove round-trip a workspace", async () => {
    const one = repo("one", "alpha");
    const two = repo("two", "beta");
    const before = [hashTree(one), hashTree(two)];

    expect(await cli("list")).toBe(0);
    expect(out).toEqual([]);

    // One absolute path, one relative to the working directory.
    expect(await cli("add", one)).toBe(0);
    expect(await cli("add", join("two", "beta"))).toBe(0);
    expect(out).toEqual(["added alpha · alpha", "added beta · beta"]);

    out.length = 0;
    expect(await cli("list")).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^alpha\s+alpha$/);
    expect(out[1]).toMatch(/^beta\s+beta$/);

    out.length = 0;
    expect(await cli("remove", "alpha")).toBe(0); // by slug
    expect(await cli("remove", two)).toBe(0); // by path
    expect(out).toEqual(["removed alpha", "removed beta"]);

    out.length = 0;
    expect(await cli("list")).toBe(0);
    expect(out).toEqual([]);
    expect(err).toEqual([]);

    // ISC-15: registering and unregistering wrote nothing into either repository.
    expect([hashTree(one), hashTree(two)]).toEqual(before);
  });

  test("the same basename twice gets a deduplicated slug", async () => {
    expect(await cli("add", repo("one", "repo"))).toBe(0);
    expect(await cli("add", repo("two", "repo"))).toBe(0);
    expect(out).toEqual(["added repo · repo", "added repo-2 · repo"]);
  });

  test("a duplicate add exits 1 and names the existing slug", async () => {
    const dir = repo("one", "alpha");
    expect(await cli("add", dir)).toBe(0);
    expect(await cli("add", dir)).toBe(1);
    expect(err.join("\n")).toContain("already registered as alpha");
    out.length = 0;
    expect(await cli("list")).toBe(0);
    expect(out).toHaveLength(1);
  });

  test("adding a missing path or a file exits 1", async () => {
    writeFileSync(join(root, "file.txt"), "x");
    expect(await cli("add", join(root, "missing"))).toBe(1);
    expect(await cli("add", "file.txt")).toBe(1);
    expect(err).toHaveLength(2);
    expect(out).toEqual([]);
  });

  test("removing an unknown slug or path exits 1 with `not registered`", async () => {
    expect(await cli("remove", "nope")).toBe(1);
    expect(await cli("remove", join(root, "nowhere"))).toBe(1);
    expect(err).toHaveLength(2);
    for (const line of err) expect(line).toContain("not registered");
    expect(out).toEqual([]);
  });

  test("add and remove without an argument, or with two, are usage errors (exit 2)", async () => {
    expect(await cli("add")).toBe(2);
    expect(await cli("remove")).toBe(2);
    expect(await cli("add", "a", "b")).toBe(2);
    expect(await cli("list", "extra")).toBe(2);
    expect(out).toEqual([]);
  });

  test("stdout never contains the absolute temp path (ISC-3)", async () => {
    const one = repo("one", "alpha");
    await cli("add", one);
    await cli("add", one); // duplicate, on stderr
    await cli("list");
    await cli("remove", one);
    await cli("list");
    expect(out.length).toBeGreaterThan(0);
    for (const line of out) expect(line).not.toContain(root);
  });
});
