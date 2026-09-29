/**
 * The notes store and its routes (T95, ISC-94, ISC-95; plan 002 § Interfaces "HTTP", § Data Model), typed by
 * `notes.contract.ts` (T94).
 *
 * A note is a `note` row of `spectant.db` (`db.ts`, migration 2) and nothing else: no code path here opens, resolves or
 * writes a path inside a registered repository, and no answer carries a path (ISC-15, ISC-3). The registry is asked
 * for a slug only, never for its directory.
 *
 * Store:
 * - `create` inserts a `NewNote` with `id = crypto.randomUUID()` and `created = updated = now`.
 * - `update` replaces the draft whole (anchor, title, body) and moves `updated`; id, workspace and created stay.
 * - `list` answers a `NotesQuery`, newest `updated` first. Orphans (`workspace IS NULL`, left by ON DELETE SET NULL when
 *   the registry removes their workspace) are listed under any registered workspace with `?orphans=1`.
 * - `update` and `remove` reach a note of the path's workspace or an orphan, so an orphan can still be edited and
 *   deleted from the Notes area; a note of another workspace is 404.
 * - `counts` groups one workspace's notes of one spec by `(anchor_kind, anchor_id)`.
 *
 * Routes (`NOTE_ROUTE_TABLE`): a path that is no notes route is `null`, so the chain goes on. Otherwise 403 from the
 * loopback guard, 405 with `noteAllowFor`, 404 for an unknown workspace or note id, 400 `{error}` from the contract's
 * parsers before the database is touched, 201 on create, 204 on delete, and the GETs carry `json()`'s strong ETag.
 */
import type { Database } from "bun:sqlite";
import { json } from "./api.ts";
import type { ApiHandler } from "./http.ts";
import {
  type NewNote,
  type Note,
  type NoteCounts,
  type NoteDraft,
  type NoteRow,
  type NotesQuery,
  anchorColumns,
  isNoteId,
  matchNoteRoute,
  noteAllowFor,
  noteFromRow,
  parseNewNote,
  parseNoteCountsQuery,
  parseNoteDraft,
  parseNotesQuery,
} from "./notes.contract.ts";
import type { Registry } from "./registry.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";

export type NoteStore = {
  create(note: NewNote): Note;
  /** The note with its draft replaced; undefined when no note of `workspace` (or orphan) has this id. */
  update(workspace: string, id: string, draft: NoteDraft): Note | undefined;
  /** False when no note of `workspace` (or orphan) has this id. */
  remove(workspace: string, id: string): boolean;
  list(workspace: string, query: NotesQuery): Note[];
  counts(workspace: string, spec: string): NoteCounts;
};

export type NoteStoreOptions = {
  /** The clock behind `created` and `updated`; `new Date()` by default. Tests step it. */
  now?: () => Date;
};

const COLUMNS = "id, workspace, anchor_kind, anchor_spec, anchor_id, title, body, created_at, updated_at";
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
export function openNotes(db: Database, options: NoteStoreOptions = {}): NoteStore {
  const now = (): string => (options.now?.() ?? new Date()).toISOString();
  const insert = db.query<null, Record<string, string | null>>(
    `INSERT INTO note (${COLUMNS}) VALUES ($id, $workspace, $anchor_kind, $anchor_spec, $anchor_id, $title, $body, $created_at, $updated_at)`,
  );
  const replace = db.query<NoteRow, Record<string, string | null>>(
    `UPDATE note SET anchor_kind = $anchor_kind, anchor_spec = $anchor_spec, anchor_id = $anchor_id, title = $title, body = $body,
       updated_at = $updated_at WHERE ${REACHABLE} RETURNING ${COLUMNS}`,
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
      };
      insert.run({ ...row });
      return noteFromRow(row);
    },
    update(workspace, id, draft) {
      const row = replace.get({ id, workspace, ...anchorColumns(draft.anchor), title: draft.title, body: draft.body, updated_at: now() });
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
  };
}

export type NotesApiOptions = {
  store: NoteStore;
  /** Only `get` is used, for the slug; the workspace's directory is never read. */
  registry: Pick<Registry, "get">;
};

const notFound = (req: Request): Response => json(req, 404, { error: "not-found" });

async function readBody(req: Request): Promise<unknown> {
  try {
    return (await req.json());
  } catch {
    return undefined; // the contract's parsers answer `invalid-body` for it
  }
}

/** The notes routes as an `ApiHandler`; `null` for every path that is no notes route. */
export function notesApi(options: NotesApiOptions): ApiHandler {
  const { store, registry } = options;

  return (req, url) => {
    const allow = noteAllowFor(url.pathname);
    if (allow === null) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    const match = matchNoteRoute(url.pathname, req.method);
    if (match === null) return json(req, 405, { error: "method-not-allowed" }, { Allow: allow });
    const { ws } = match.params;
    if (registry.get(ws) === undefined) return notFound(req);

    switch (match.route) {
      case "list": {
        const query = parseNotesQuery(url.searchParams);
        return query.ok ? json(req, 200, store.list(ws, query.value)) : json(req, 400, { error: query.error });
      }
      case "counts": {
        const query = parseNoteCountsQuery(url.searchParams);
        return query.ok ? json(req, 200, store.counts(ws, query.value.spec)) : json(req, 400, { error: query.error });
      }
      case "create":
        return readBody(req).then((body) => {
          const note = parseNewNote(ws, body);
          return note.ok ? json(req, 201, store.create(note.value)) : json(req, 400, { error: note.error });
        });
      case "update": {
        const { id } = match.params;
        return readBody(req).then((body) => {
          const draft = parseNoteDraft(body);
          if (!draft.ok) return json(req, 400, { error: draft.error });
          const note = isNoteId(id) ? store.update(ws, id, draft.value) : undefined;
          return note === undefined ? notFound(req) : json(req, 200, note);
        });
      }
      case "remove": {
        const { id } = match.params;
        if (!isNoteId(id) || !store.remove(ws, id)) return notFound(req);
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }
    }
  };
}
