// Schema migrations (T94, ISC-94, ISC-7, ISC-21): a fresh data directory migrates to schema_version 3 with the `note`
// table, its workspace+anchor index and its `pinned` column; a version-1 database moves to 3 without touching its settings or registry
// rows; running `migrate` again is a no-op; the schema itself holds a note to at most one anchor and orphans a note
// when its workspace is removed. Every test runs against a fresh temp data directory, never the real `~/.spectant`.
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCHEMA_VERSION, migrate, openDatabase, openDatabaseUnmigrated, rollback, schemaVersion } from "../server/src/db.ts";
import { dbPath } from "../server/src/paths.ts";

let root: string;
let data: string;
const open: Database[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "spectant-db-"));
  data = join(root, "data");
});

afterEach(() => {
  for (const db of open.splice(0)) db.close();
  rmSync(root, { recursive: true, force: true });
});

function track(db: Database): Database {
  open.push(db);
  return db;
}

function version(db: Database): string | undefined {
  return db.query<{ value: string }, []>("SELECT value FROM setting WHERE key = 'schema_version'").get()?.value;
}

function schemaObjects(db: Database): string[] {
  return db
    .query<{ name: string }, []>("SELECT type || ':' || name AS name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
}

/** A database exactly as a build at schema version 1 left it: migration 1's tables, a workspace, settings. */
function versionOneDatabase(): Database {
  mkdirSync(data, { recursive: true });
  const db = track(new Database(dbPath(data), { create: true, strict: true }));
  db.run(`CREATE TABLE workspace (
    slug     TEXT PRIMARY KEY,
    path     TEXT NOT NULL UNIQUE,
    name     TEXT NOT NULL,
    added_at TEXT NOT NULL,
    position INTEGER NOT NULL
  )`);
  db.run("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  db.run("INSERT INTO setting (key, value) VALUES ('schema_version', '1'), ('theme', '\"dark\"'), ('refreshSeconds', '60')");
  db.run("INSERT INTO workspace VALUES ('alpha', '/tmp/alpha', 'alpha', '2026-09-01T00:00:00.000Z', 0)");
  return db;
}

function insertNote(db: Database, id: string, workspace: string | null, kind: string | null, spec: string | null, anchorId: string | null): void {
  db.run(
    "INSERT INTO note (id, workspace, anchor_kind, anchor_spec, anchor_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '', 'text', '2026-09-29T00:00:00.000Z', '2026-09-29T00:00:00.000Z')",
    [id, workspace, kind, spec, anchorId],
  );
}

describe("migration 2", () => {
  test("a fresh data directory migrates to schema_version 3 with the note table, its index and the pinned column", () => {
    expect(SCHEMA_VERSION).toBe(3);
    const db = track(openDatabase(data));
    expect(version(db)).toBe("3");
    expect(schemaObjects(db)).toEqual(["index:note_workspace_anchor", "table:note", "table:setting", "table:workspace"]);
    const columns = db.query<{ name: string }, []>("SELECT name FROM pragma_table_info('note') ORDER BY cid").all();
    expect(columns.map((c) => c.name)).toEqual(["id", "workspace", "anchor_kind", "anchor_spec", "anchor_id", "title", "body", "created_at", "updated_at", "pinned"]);
    const indexed = db.query<{ name: string }, []>("SELECT name FROM pragma_index_info('note_workspace_anchor') ORDER BY seqno").all();
    expect(indexed.map((c) => c.name)).toEqual(["workspace", "anchor_spec", "anchor_kind", "anchor_id"]);
  });

  test("a version-1 database moves to 3 without touching its settings or registry rows", () => {
    const old = versionOneDatabase();
    const settingsBefore = old.query("SELECT key, value FROM setting WHERE key <> 'schema_version' ORDER BY key").all();
    const workspacesBefore = old.query("SELECT * FROM workspace").all();
    old.close();
    open.splice(0);

    const db = track(openDatabase(data));
    expect(version(db)).toBe("3");
    expect(db.query("SELECT key, value FROM setting WHERE key <> 'schema_version' ORDER BY key").all()).toEqual(settingsBefore);
    expect(db.query("SELECT * FROM workspace").all()).toEqual(workspacesBefore);
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM note").get()?.n).toBe(0);
  });

  test("running migrate twice is a no-op: same version, same schema, same rows", () => {
    const db = track(openDatabase(data));
    insertNote(db, "n1", null, null, null, null);
    const before = { schema: db.query("SELECT sql FROM sqlite_master ORDER BY name").all(), notes: db.query("SELECT * FROM note").all() };
    migrate(db);
    migrate(db);
    expect(version(db)).toBe("3");
    expect({ schema: db.query("SELECT sql FROM sqlite_master ORDER BY name").all(), notes: db.query("SELECT * FROM note").all() }).toEqual(before);
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM setting WHERE key = 'schema_version'").get()?.n).toBe(1);
  });

  test("a half-applied migration 2 (note table present, index missing, version still 1) is adopted with its rows", () => {
    const first = track(openDatabase(data));
    insertNote(first, "kept", null, "spec", "002", null);
    first.run("DROP INDEX note_workspace_anchor");
    first.run("UPDATE setting SET value = '1' WHERE key = 'schema_version'");
    first.close();
    open.splice(0);
    const db = track(openDatabase(data));
    expect(version(db)).toBe("3");
    expect(schemaObjects(db)).toContain("index:note_workspace_anchor");
    expect(db.query("SELECT id, anchor_spec FROM note").all()).toEqual([{ id: "kept", anchor_spec: "002" }]);
  });

  test("a database from a newer build is refused, not downgraded", () => {
    const old = versionOneDatabase();
    old.run("UPDATE setting SET value = '4' WHERE key = 'schema_version'");
    old.close();
    open.splice(0);
    expect(() => openDatabase(data)).toThrow(/schema version 4/);
  });
});

describe("the note table holds a note to at most one anchor", () => {
  test("no anchor and one anchor of each kind are stored", () => {
    const db = track(openDatabase(data));
    db.run("INSERT INTO workspace VALUES ('alpha', '/tmp/alpha', 'alpha', '2026-09-01T00:00:00.000Z', 0)");
    insertNote(db, "n0", "alpha", null, null, null);
    insertNote(db, "n1", "alpha", "spec", "002", null);
    insertNote(db, "n2", "alpha", "claim", "002", "ISC-94");
    insertNote(db, "n3", "alpha", "task", "002", "T95");
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM note WHERE workspace = 'alpha'").get()?.n).toBe(4);
  });

  test("a half anchor, a spec anchor with an id, or an unknown kind is refused by the schema", () => {
    const db = track(openDatabase(data));
    expect(() => insertNote(db, "a", null, "spec", "002", "ISC-94")).toThrow(/CHECK/);
    expect(() => insertNote(db, "b", null, "claim", "002", null)).toThrow(/CHECK/);
    expect(() => insertNote(db, "c", null, null, "002", null)).toThrow(/CHECK/);
    expect(() => insertNote(db, "d", null, "file", "002", "x")).toThrow(/CHECK/);
    expect(() => insertNote(db, "e", "nobody", null, null, null)).toThrow(/FOREIGN KEY/);
  });

  test("removing a workspace orphans its notes instead of deleting them", () => {
    const db = track(openDatabase(data));
    db.run("INSERT INTO workspace VALUES ('alpha', '/tmp/alpha', 'alpha', '2026-09-01T00:00:00.000Z', 0)");
    insertNote(db, "n1", "alpha", "claim", "002", "ISC-94");
    db.run("DELETE FROM workspace WHERE slug = 'alpha'");
    expect(db.query("SELECT id, workspace, anchor_id FROM note").all()).toEqual([{ id: "n1", workspace: null, anchor_id: "ISC-94" }]);
  });
});

// Migration 3 (T97, ISC-52): `pinned` is a 0/1 column, default 0, added without touching a row. The reversals (T98,
// `spectant db rollback`) walk back one migration at a time, newest first.
const columnsOf = (db: Database): string[] =>
  db
    .query<{ name: string }, []>("SELECT name FROM pragma_table_info('note') ORDER BY cid")
    .all()
    .map((c) => c.name);

describe("migration 3", () => {
  test("a version-2 database gains pinned = 0 on every note, the rows otherwise unchanged", () => {
    const first = track(openDatabase(data));
    insertNote(first, "n1", null, "claim", "002", "ISC-52");
    rollback(first, 2);
    expect(version(first)).toBe("2");
    expect(columnsOf(first)).not.toContain("pinned");
    const before = first.query<Record<string, unknown>, []>("SELECT * FROM note").all();
    first.close();
    open.splice(0);
    const db = track(openDatabase(data));
    expect(version(db)).toBe("3");
    expect(db.query("SELECT * FROM note").all()).toEqual(before.map((row) => ({ ...row, pinned: 0 })));
  });

  test("a half-applied migration 3 (pinned present, version still 2) is adopted", () => {
    const first = track(openDatabase(data));
    first.run("UPDATE setting SET value = '2' WHERE key = 'schema_version'");
    first.close();
    open.splice(0);
    const db = track(openDatabase(data));
    expect(version(db)).toBe("3");
    expect(columnsOf(db).filter((c) => c === "pinned")).toEqual(["pinned"]);
  });

  test("pinned admits only 0 and 1", () => {
    const db = track(openDatabase(data));
    insertNote(db, "n1", null, null, null, null);
    expect(() => db.run("UPDATE note SET pinned = 2 WHERE id = 'n1'")).toThrow(/CHECK/);
    db.run("UPDATE note SET pinned = 1 WHERE id = 'n1'");
    expect(db.query("SELECT pinned FROM note").all()).toEqual([{ pinned: 1 }]);
  });
});

describe("rollback", () => {
  test("rollback to 2 drops pinned, to 1 drops the note table and its index, each moving schema_version", () => {
    const db = track(openDatabase(data));
    insertNote(db, "n1", null, null, null, null);
    expect(rollback(db, 2)).toEqual({ from: 3, to: 2 });
    expect(schemaVersion(db)).toBe(2);
    expect(columnsOf(db)).toEqual(["id", "workspace", "anchor_kind", "anchor_spec", "anchor_id", "title", "body", "created_at", "updated_at"]);
    expect(rollback(db, 1)).toEqual({ from: 2, to: 1 });
    expect(version(db)).toBe("1");
    expect(schemaObjects(db)).toEqual(["table:setting", "table:workspace"]);
    expect(rollback(db, 1)).toEqual({ from: 1, to: 1 });
  });

  test("rollback from 3 straight to 1 reverses both migrations; the next open migrates forward again", () => {
    const db = track(openDatabase(data));
    expect(rollback(db, 1)).toEqual({ from: 3, to: 1 });
    db.close();
    open.splice(0);
    const raw = track(openDatabaseUnmigrated(data));
    expect(schemaVersion(raw)).toBe(1);
    raw.close();
    open.splice(0);
    expect(version(track(openDatabase(data)))).toBe("3");
  });

  test("a target outside 1 to SCHEMA_VERSION - 1 is refused and nothing changes", () => {
    const db = track(openDatabase(data));
    for (const target of [0, 3, 4, -1, 1.5]) expect(() => rollback(db, target)).toThrow(/rollback target/);
    expect(version(db)).toBe("3");
  });
});
