/**
 * The SQLite connection and its schema migrations (T42, T94). `spectant.db` lives in the data directory from
 * `paths.ts` (ISC-21) and holds the workspace registry, the settings and the developer's notes, never anything a
 * repository says: deleting it loses nothing a re-add cannot rebuild (ISC-7) except the notes, which live here and
 * nowhere else, never in a registered repository (ISC-94, ISC-15).
 *
 * The schema version is the `schema_version` row of the `setting` table. `migrate` walks it forward one step at a
 * time inside a single transaction.
 *
 * Migration 2 (spec 002, T94) is expand-only: it creates `note` and its index and changes no existing table. The row
 * is `NoteRow` in `notes.contract.ts`: a single `anchor_kind`/`anchor_spec`/`anchor_id` triple, so a row holds at most
 * one anchor, and a CHECK admits exactly the contract's three forms (none; a spec; a claim or task with its id).
 * `workspace` references `workspace(slug)` ON DELETE SET NULL: removing a workspace orphans its notes instead of
 * deleting them. Both statements say IF NOT EXISTS, so a re-run over a half-applied database adopts what is there.
 * No down migration runs. Reversing it by hand is `DROP INDEX note_workspace_anchor; DROP TABLE note;` plus
 * `schema_version` back to 1, which loses every note not exported first (plan 002 § Data Model, rollback).
 */
import { Database } from "bun:sqlite";
import { dbPath, ensureDataDir } from "./paths.ts";

/** The schema version this build writes. A database from a newer build is refused rather than downgraded. */
export const SCHEMA_VERSION = 2;

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
        case 1:
          db.run(`CREATE TABLE IF NOT EXISTS note (
            id          TEXT PRIMARY KEY,
            workspace   TEXT NULL REFERENCES workspace (slug) ON DELETE SET NULL,
            anchor_kind TEXT NULL CHECK (anchor_kind IN ('spec', 'claim', 'task')),
            anchor_spec TEXT NULL,
            anchor_id   TEXT NULL,
            title       TEXT NOT NULL DEFAULT '',
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            -- Null-safe on purpose: a CHECK that evaluates to NULL passes, so \`anchor_kind = 'spec'\` with a NULL kind
            -- would let a half anchor (no kind, a spec) through. \`IS\` and the leading \`IS NOT NULL\` never yield NULL.
            CHECK (
              (anchor_kind IS NULL AND anchor_spec IS NULL AND anchor_id IS NULL)
              OR (anchor_kind IS 'spec' AND anchor_spec IS NOT NULL AND anchor_id IS NULL)
              OR (anchor_kind IS NOT NULL AND anchor_kind IN ('claim', 'task') AND anchor_spec IS NOT NULL AND anchor_id IS NOT NULL)
            )
          )`);
          // The list filters and the Claims tab's per-anchor counts read by workspace, then spec, kind and id.
          db.run("CREATE INDEX IF NOT EXISTS note_workspace_anchor ON note (workspace, anchor_spec, anchor_kind, anchor_id)");
          break;
      }
      version++;
      db.run("INSERT INTO setting (key, value) VALUES ('schema_version', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [
        String(version),
      ]);
    }
  }).immediate();
}
