/**
 * The SQLite connection and its schema migrations (T42). `spectant.db` lives in the data directory from `paths.ts`
 * (ISC-21) and holds only the workspace registry and the settings, never anything a repository says: deleting it loses
 * nothing a re-add cannot rebuild (ISC-7).
 *
 * The schema version is the `schema_version` row of the `setting` table. `migrate` walks it forward one step at a
 * time inside a single transaction; spec 002 adds `case 1` for migration 2.
 */
import { Database } from "bun:sqlite";
import { dbPath, ensureDataDir } from "./paths.ts";

/** The schema version this build writes. A database from a newer build is refused rather than downgraded. */
export const SCHEMA_VERSION = 1;

/** Opens (creating on first use) `spectant.db` in `dir`, in WAL mode with foreign keys on, migrated to the latest schema. */
export function openDatabase(dir: string): Database {
  const db = new Database(dbPath(ensureDataDir(dir)), { create: true, strict: true });
  try {
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000"); // a second CLI process waits for the lock instead of failing at once
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function currentVersion(db: Database): number {
  const table = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'setting'").get();
  if (!table) return 0;
  const row = db.query<{ value: string }, []>("SELECT value FROM setting WHERE key = 'schema_version'").get();
  return row ? Number(row.value) : 0;
}

/** Brings the schema up to `SCHEMA_VERSION`, one version per step, all in one immediate transaction. */
export function migrate(db: Database): void {
  db.transaction(() => {
    let version = currentVersion(db);
    if (!Number.isInteger(version) || version > SCHEMA_VERSION) {
      throw new Error(`spectant.db has schema version ${String(version)}; this build knows up to ${SCHEMA_VERSION}`);
    }
    while (version < SCHEMA_VERSION) {
      switch (version) {
        case 0:
          db.run(`CREATE TABLE workspace (
            slug     TEXT PRIMARY KEY,
            path     TEXT NOT NULL UNIQUE,
            name     TEXT NOT NULL,
            added_at TEXT NOT NULL,
            position INTEGER NOT NULL
          )`);
          db.run("CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
          break;
        // case 1: spec 002 adds migration 2 here.
      }
      version++;
      db.run("INSERT INTO setting (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        String(version),
      ]);
    }
  }).immediate();
}
