// The SQLite workspace registry (T42, ISC-13, ISC-15, ISC-7). Every test runs against a fresh temp data directory and
// temp repository directories; nothing touches the real `~/.spectant`.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION } from "../server/src/db.ts";
import { dbPath } from "../server/src/paths.ts";
import { openRegistry, type Registry, RegistryError } from "../server/src/registry.ts";

let root: string;
let data: string;
let registry: Registry | undefined;

function repo(...segments: string[]): string {
  const dir = join(root, "repos", ...segments);
  mkdirSync(join(dir, ".git"), { recursive: true });
  writeFileSync(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  mkdirSync(join(dir, "specs"), { recursive: true });
  writeFileSync(join(dir, "specs", "README.md"), "# specs\n");
  return dir;
}

function open(): Registry {
  registry?.close();
  registry = openRegistry(data);
  return registry;
}

/** Every entry below `dir`, `.git/` included, with its size, mtime and content hash. */
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, rel: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, entry.name);
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const stat = statSync(full);
      if (entry.isDirectory()) {
        out.push(`d ${path} ${stat.mtimeMs}`);
        walk(full, path);
      } else {
        const hash = createHash("sha256").update(readFileSync(full)).digest("hex");
        out.push(`f ${path} ${stat.size} ${stat.mtimeMs} ${hash}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-registry-"));
  data = join(root, "data", "spectant");
});

afterEach(() => {
  registry?.close();
  registry = undefined;
  rmSync(root, { recursive: true, force: true });
});

describe("registry", () => {
  test("add, list, get and remove round-trip a workspace", () => {
    const dir = repo("alpha");
    const reg = open();
    const added = reg.add(dir);
    expect(added.slug).toBe("alpha");
    expect(added.name).toBe("alpha");
    expect(added.path).toBe(realpathSync(dir));
    expect(added.position).toBe(0);
    expect(Number.isNaN(Date.parse(added.addedAt))).toBe(false);

    expect(reg.list()).toEqual([added]);
    expect(reg.get("alpha")).toEqual(added);

    expect(reg.remove("alpha")).toBe(true);
    expect(reg.list()).toEqual([]);
    expect(reg.get("alpha")).toBeUndefined();
  });

  test("the registry survives closing and reopening the database", () => {
    const dir = repo("alpha");
    const added = open().add(dir);
    expect(open().list()).toEqual([added]);
  });

  test("remove accepts a path as well as a slug", () => {
    const dir = repo("alpha");
    const reg = open();
    reg.add(dir);
    expect(reg.remove(dir)).toBe(true);
    expect(reg.list()).toEqual([]);
  });

  test("a path that differs only by a trailing slash or a symlink resolves to the same workspace", () => {
    const dir = repo("alpha");
    const link = join(root, "link-to-alpha");
    symlinkSync(dir, link);
    const reg = open();
    const added = reg.add(`${link}/`);
    expect(added.path).toBe(realpathSync(dir));
    expect(added.slug).toBe("alpha");
    expect(() => reg.add(dir)).toThrow(RegistryError);
    expect(reg.remove(link)).toBe(true);
  });

  test("slugs are the basename, deduplicated with -2, -3", () => {
    const reg = open();
    expect(reg.add(repo("a", "repo")).slug).toBe("repo");
    expect(reg.add(repo("b", "repo")).slug).toBe("repo-2");
    expect(reg.add(repo("c", "repo")).slug).toBe("repo-3");
    // A repository literally named like a suffixed slug still gets a free slug.
    expect(reg.add(repo("d", "repo-2")).slug).toBe("repo-2-2");
    expect(reg.list().map((w) => w.slug)).toEqual(["repo", "repo-2", "repo-3", "repo-2-2"]);
  });

  test("a duplicate path is refused with a typed error", () => {
    const dir = repo("alpha");
    const reg = open();
    reg.add(dir);
    let caught: unknown;
    try {
      reg.add(dir);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RegistryError);
    expect((caught as RegistryError).code).toBe("duplicate-path");
    expect(reg.list()).toHaveLength(1);
  });

  test("a missing path or a file is refused as not a directory", () => {
    const reg = open();
    const file = join(root, "plain.txt");
    writeFileSync(file, "x");
    for (const bad of [join(root, "does-not-exist"), file]) {
      let caught: unknown;
      try {
        reg.add(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(RegistryError);
      expect((caught as RegistryError).code).toBe("not-a-directory");
    }
    expect(reg.list()).toEqual([]);
  });

  test("removing an unknown slug or path returns false", () => {
    const reg = open();
    reg.add(repo("alpha"));
    expect(reg.remove("beta")).toBe(false);
    expect(reg.remove(join(root, "nowhere"))).toBe(false);
    expect(reg.list()).toHaveLength(1);
  });

  test("list is in position order and new workspaces append at the end", () => {
    const reg = open();
    reg.add(repo("charlie"));
    reg.add(repo("alpha"));
    reg.add(repo("bravo"));
    expect(reg.list().map((w) => w.slug)).toEqual(["charlie", "alpha", "bravo"]);
    reg.remove("alpha");
    const delta = reg.add(repo("delta"));
    expect(reg.list().map((w) => w.slug)).toEqual(["charlie", "bravo", "delta"]);
    expect(delta.position).toBeGreaterThan(reg.get("bravo")?.position ?? Infinity);
  });

  test("the first open sets schema_version to the latest (3, spec 002's notes and their pin), WAL mode and foreign keys", () => {
    open().close();
    registry = undefined;
    expect(SCHEMA_VERSION).toBe(3);
    const db = new Database(dbPath(data), { readonly: true });
    try {
      const row = db.query<{ value: string }, []>("SELECT value FROM setting WHERE key = 'schema_version'").get();
      expect(row?.value).toBe("3");
      const mode = db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get();
      expect(mode?.journal_mode).toBe("wal");
    } finally {
      db.close();
    }
    // Reopening an existing database leaves the version alone and keeps the tables.
    const reg = open();
    expect(reg.list()).toEqual([]);
    const fk = new Database(dbPath(data), { readonly: true });
    try {
      expect(fk.query<{ value: string }, []>("SELECT value FROM setting WHERE key = 'schema_version'").all()).toEqual([
        { value: "3" },
      ]);
    } finally {
      fk.close();
    }
  });

  test("the data directory is created on first open and holds only spectant.db and its WAL files", () => {
    const reg = open();
    reg.add(repo("alpha"));
    const entries = readdirSync(data).filter((name) => !/^spectant\.db(-wal|-shm)?$/.test(name));
    expect(entries).toEqual([]);
    expect(statSync(dbPath(data)).isFile()).toBe(true);
  });

  test("add, list, get and remove leave the repository byte-identical, .git/ included (ISC-15)", () => {
    const dir = repo("alpha");
    const before = snapshot(dir);
    const reg = open();
    const added = reg.add(dir);
    reg.list();
    reg.get(added.slug);
    reg.remove(added.slug);
    reg.add(dir);
    reg.remove(dir);
    expect(snapshot(dir)).toEqual(before);
  });
});
