/**
 * The SQL of the `setting` table of `spectant.db` (T43, ISC-18.3; see `db.ts`): one row per key with the value as the
 * caller encoded it. The schema, the decoding and the validation stay with the settings slice (`settings.ts`); this
 * file only reads every row and writes a batch of rows.
 */
import type { Db } from "./db.ts";

/** One stored row: the key and its raw (JSON-encoded) value. */
export type SettingRow = { key: string; value: string };

export type SettingRows = {
  /** Every row of the table, `schema_version` included. */
  all(): SettingRow[];
  /** Upserts each `[key, value]` in one immediate transaction; a failure leaves the table as it was. */
  write(entries: Array<[string, string]>): void;
};

/** The `setting` rows over an open, migrated `spectant.db` connection. The caller owns the connection. */
export function openSettingRows(db: Db): SettingRows {
  const selectAll = db.query<SettingRow, []>("SELECT key, value FROM setting");
  const upsert = db.query<null, [string, string]>(
    "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  const write = db.transaction((entries: Array<[string, string]>) => {
    for (const [key, value] of entries) upsert.run(key, value);
  });
  return {
    all: () => selectAll.all(),
    write: (entries) => {
      write.immediate(entries);
    },
  };
}
