/**
 * The notes store over the `note` table of `spectant.db` (T95, ISC-94; plan 002 § Data Model), mapped to and from the
 * contract's `NoteRow` with `anchorColumns` and `noteFromRow` (`note-routes.contract.ts`). No code path here opens,
 * resolves or writes a path inside a registered repository (ISC-15, ISC-3).
 *
 * - `create` inserts a `NewNote` with `id = crypto.randomUUID()` and `created = updated = now`.
 * - `update` replaces the draft whole (anchor, title, body) and moves `updated`; id, workspace and created stay. A draft
 *   without `pinned` keeps the stored pin (migration 3, T97).
 * - `restore` inserts a whole `Note` as it is (id and times included) unless its id is taken: `import-notes` (T98).
 * - `all` lists every note, orphans included, oldest `created` first: `export-notes` (T98).
 * - `list` answers a `NotesQuery`, newest `updated` first. Orphans (`workspace IS NULL`, left by ON DELETE SET NULL when
 *   the registry removes their workspace) are listed under any registered workspace with `?orphans=1`.
 * - `update` and `remove` reach a note of the path's workspace or an orphan, so an orphan can still be edited and
 *   deleted from the Notes area; a note of another workspace is 404.
 * - `counts` groups one workspace's notes of one spec by `(anchor_kind, anchor_id)`.
 *
 * Beside the store: `inTransaction` (the import's one transaction) and `rollbackLossCount` (the rows `db rollback`
 * would lose, for its refusal), so `cli-notes.ts` runs no SQL itself.
 */
import {
  type NewNote,
  type Note,
  type NoteCounts,
  type NoteDraft,
  type NoteRow,
  type NotesQuery,
  anchorColumns,
  noteFromRow,
} from "../../contracts/note-routes.contract.ts";
import type { Db } from "./db.ts";

export type NoteStore = {
  create(note: NewNote): Note;
  /** The note with its draft replaced; undefined when no note of `workspace` (or orphan) has this id. */
  update(workspace: string, id: string, draft: NoteDraft): Note | undefined;
  /** False when no note of `workspace` (or orphan) has this id. */
  remove(workspace: string, id: string): boolean;
  list(workspace: string, query: NotesQuery): Note[];
  counts(workspace: string, spec: string): NoteCounts;
  /** Inserts `note` as it is; false (and nothing written) when a note with its id exists. */
  restore(note: Note): boolean;
  /** Every note, orphans included, oldest `created` first. */
  all(): Note[];
};

export type NoteStoreOptions = {
  /** The clock behind `created` and `updated`; `new Date()` by default. Tests step it. */
  now?: () => Date;
};

const COLUMNS = "id, workspace, anchor_kind, anchor_spec, anchor_id, title, body, created_at, updated_at, pinned";
const ORDER = "ORDER BY updated_at DESC, created_at DESC, id";
/** The notes an update or remove may reach from a workspace path: its own and the orphans. */
const REACHABLE = "id = $id AND (workspace = $workspace OR workspace IS NULL)";

type Filter = { where: string; params: Record<string, string> };

function filterOf(workspace: string, query: NotesQuery): Filter {
  if (query.orphans) return { where: "workspace IS NULL", params: {} };
  const own = "workspace = $workspace";
  if (query.unanchored) return { where: `${own} AND anchor_kind IS NULL`, params: { workspace } };
  if (query.spec === undefined) return { where: own, params: { workspace } };
  const spec = { workspace, spec: query.spec };
  if (query.claim !== undefined) return { where: `${own} AND anchor_spec = $spec AND anchor_kind = 'claim' AND anchor_id = $id`, params: { ...spec, id: query.claim } };
  if (query.task !== undefined) return { where: `${own} AND anchor_spec = $spec AND anchor_kind = 'task' AND anchor_id = $id`, params: { ...spec, id: query.task } };
  return { where: `${own} AND anchor_spec = $spec`, params: spec };
}

/** Notes over an open, migrated `spectant.db` connection (foreign keys on). The caller owns the connection. */
export function openNotes(db: Db, options: NoteStoreOptions = {}): NoteStore {
  const now = (): string => (options.now?.() ?? new Date()).toISOString();
  const values = "$id, $workspace, $anchor_kind, $anchor_spec, $anchor_id, $title, $body, $created_at, $updated_at, $pinned";
  const insert = db.query<null, Record<string, string | number | null>>(`INSERT INTO note (${COLUMNS}) VALUES (${values})`);
  const insertNew = db.query<null, Record<string, string | number | null>>(`INSERT INTO note (${COLUMNS}) VALUES (${values}) ON CONFLICT (id) DO NOTHING`);
  const replace = db.query<NoteRow, Record<string, string | number | null>>(
    `UPDATE note SET anchor_kind = $anchor_kind, anchor_spec = $anchor_spec, anchor_id = $anchor_id, title = $title, body = $body,
       pinned = coalesce($pinned, pinned), updated_at = $updated_at WHERE ${REACHABLE} RETURNING ${COLUMNS}`,
  );
  const drop = db.query<null, Record<string, string>>(`DELETE FROM note WHERE ${REACHABLE}`);
  const grouped = db.query<{ anchor_kind: string; anchor_id: string | null; n: number }, Record<string, string>>(
    "SELECT anchor_kind, anchor_id, count(*) AS n FROM note WHERE workspace = $workspace AND anchor_spec = $spec GROUP BY anchor_kind, anchor_id",
  );

  return {
    create(note) {
      const stamp = now();
      const row: NoteRow = {
        id: crypto.randomUUID(),
        workspace: note.workspace,
        ...anchorColumns(note.anchor),
        title: note.title,
        body: note.body,
        created_at: stamp,
        updated_at: stamp,
        pinned: note.pinned === true ? 1 : 0,
      };
      insert.run({ ...row });
      return noteFromRow(row);
    },
    update(workspace, id, draft) {
      const pinned = draft.pinned === undefined ? null : Number(draft.pinned);
      const row = replace.get({ id, workspace, ...anchorColumns(draft.anchor), title: draft.title, body: draft.body, pinned, updated_at: now() });
      return row === null ? undefined : noteFromRow(row);
    },
    remove(workspace, id) {
      return drop.run({ id, workspace }).changes > 0;
    },
    list(workspace, query) {
      const { where, params } = filterOf(workspace, query);
      return db.query<NoteRow, Record<string, string>>(`SELECT ${COLUMNS} FROM note WHERE ${where} ${ORDER}`).all(params).map(noteFromRow);
    },
    counts(workspace, spec) {
      const claims: Record<string, number> = {};
      const tasks: Record<string, number> = {};
      let total = 0;
      let onSpec = 0;
      for (const { anchor_kind: kind, anchor_id: id, n } of grouped.all({ workspace, spec })) {
        total += n;
        if (kind === "spec") onSpec += n;
        else if (id !== null) (kind === "claim" ? claims : tasks)[id] = n;
      }
      return { spec, total, onSpec, claims, tasks };
    },
    restore(note) {
      const { id, workspace, title, body, created, updated } = note;
      const row = { id, workspace, ...anchorColumns(note.anchor), title, body, created_at: created, updated_at: updated, pinned: Number(note.pinned) };
      return insertNew.run(row).changes > 0;
    },
    all() {
      return db.query<NoteRow, []>(`SELECT ${COLUMNS} FROM note ORDER BY created_at, id`).all().map(noteFromRow);
    },
  };
}

/** Runs `body` in one (deferred) transaction of `db` and returns its result; a throw rolls it back. */
export function inTransaction<T>(db: Db, body: () => T): T {
  return db.transaction(body)();
}

/** What `db rollback` would drop, counted for its refusal: a table, or the pinned notes of the `pinned` column. */
export type RollbackLoss = "board_query" | "actor" | "pinned" | "note";

const LOSS_COUNTS: Readonly<Record<RollbackLoss, string>> = {
  board_query: "SELECT count(*) AS n FROM board_query",
  actor: "SELECT count(*) AS n FROM actor",
  pinned: "SELECT count(*) AS n FROM note WHERE pinned = 1",
  note: "SELECT count(*) AS n FROM note",
};

/** The number of rows `loss` stands for; run only while the schema still holds its table or column. */
export function rollbackLossCount(db: Db, loss: RollbackLoss): number {
  return db.query<{ n: number }, []>(LOSS_COUNTS[loss]).get()?.n ?? 0;
}
