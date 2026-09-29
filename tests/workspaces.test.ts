// ISC-13: add, list and remove round-trip a workspace through the registry.
//
// For now this probe drives the registry API directly (T42). T44 wires `spectant add <repo>`, `spectant list` and
// `spectant remove <repo>` into `server/src/cli.ts` and switches this file to go through the CLI instead.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openRegistry } from "../server/src/registry.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-workspaces-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspaces", () => {
  test("add, list and remove round-trip a workspace", () => {
    const data = join(root, "data");
    const one = join(root, "one", "repo");
    const two = join(root, "two", "repo");
    mkdirSync(one, { recursive: true });
    mkdirSync(two, { recursive: true });

    const registry = openRegistry(data);
    try {
      expect(registry.list()).toEqual([]);

      registry.add(one);
      registry.add(two);
      expect(registry.list().map((w) => [w.slug, w.path])).toEqual([
        ["repo", realpathSync(one)],
        ["repo-2", realpathSync(two)],
      ]);

      expect(registry.remove("repo")).toBe(true);
      expect(registry.remove(two)).toBe(true);
      expect(registry.remove("repo")).toBe(false);
      expect(registry.list()).toEqual([]);
    } finally {
      registry.close();
    }
  });
});
