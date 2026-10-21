/**
 * The schema command of the `spectant` CLI (T98, ISC-53): `db rollback <version> --yes`. `cli.ts` parses the command
 * line and calls in here. `import-notes` and `export-notes` live in the `notes/` slice, re-exported here until the
 * `cli/` slice takes this file over.
 *
 * `db rollback <version>` applies `infra/db/db.ts`'s documented reversals down to `version`, newest first. Without
 * `--yes` it only says what would be lost and exits 1. Nothing here touches a registered repository (ISC-15).
 */
import { type Db, SCHEMA_VERSION, openDatabaseUnmigrated, rollback, schemaVersion } from "./infra/db/db.ts";
import { type RollbackLoss, rollbackLossCount } from "./infra/db/notes-store.ts";

export * from "./notes/index.ts";

/** What reversing each migration loses, for the refusal without `--yes`. */
function losses(db: Db, from: number, target: number): string[] {
  const count = (loss: RollbackLoss): number => rollbackLossCount(db, loss);
  const out: string[] = [];
  if (from >= 5 && target < 5) out.push(`drop the board_query table (${count("board_query")} workspaces lose their remembered board query)`);
  if (from >= 4 && target < 4) out.push(`drop the actor table (${count("actor")} actors lose their display name)`);
  if (from >= 3 && target < 3) out.push(`drop the pinned column (${count("pinned")} pinned notes lose their pin)`);
  if (from >= 2 && target < 2) out.push(`drop the note table (${count("note")} notes; save them first with spectant export-notes <file>)`);
  return out;
}

/** `spectant db rollback <target> [--yes]`; `target` is already checked to lie in 1 to `SCHEMA_VERSION - 1`. */
export function rollbackCommand(dir: string, target: number, yes: boolean): number {
  const db = openDatabaseUnmigrated(dir);
  try {
    const from = schemaVersion(db);
    if (from > SCHEMA_VERSION) {
      console.error(`spectant: spectant.db has schema version ${from}; this build knows up to ${SCHEMA_VERSION}`);
      return 1;
    }
    if (from <= target) {
      console.log(`schema version ${from}, nothing to roll back`);
      return 0;
    }
    if (!yes) {
      console.error(`spectant: db rollback ${target} would ${losses(db, from, target).join(" and ")}; run it again with --yes`);
      return 1;
    }
    const done = rollback(db, target);
    console.log(`schema version ${done.from} → ${done.to}`);
    return 0;
  } finally {
    db.close();
  }
}
