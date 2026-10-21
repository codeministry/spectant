/**
 * The notes routes (T95, ISC-94, ISC-95; plan 002 § Interfaces "HTTP", § Data Model), typed by
 * `contracts/notes.contract.ts` (T94).
 *
 * A note is a `note` row of `spectant.db` (`infra/db/db.ts`, migration 2) and nothing else: no code path here opens,
 * resolves or writes a path inside a registered repository, and no answer carries a path (ISC-15, ISC-3). The registry
 * is asked for a slug only, never for its directory.
 *
 * Store: `openNotes` in `infra/db/notes-store.ts` (its SQL and the `NoteRow` mapping), re-exported by `index.ts`.
 *
 * Routes (`NOTE_ROUTE_TABLE`): a path that is no notes route is `null`, so the chain goes on. Otherwise 403 from the
 * loopback guard, 405 with `noteAllowFor`, 404 for an unknown workspace or note id, 400 `{error}` from the contract's
 * parsers before the database is touched, 201 on create, 204 on delete, and the GETs carry `json()`'s strong ETag.
 */
import {
  isNoteId,
  matchNoteRoute,
  noteAllowFor,
  parseNewNote,
  parseNoteCountsQuery,
  parseNoteDraft,
  parseNotesQuery,
} from "../contracts/note-routes.contract.ts";
import type { NoteStore } from "../infra/db/notes-store.ts";
import type { Registry } from "../infra/db/registry.ts";
import { loopbackRefusal, methodNotAllowed } from "../infra/http/guard.ts";
import { json, readJson } from "../infra/http/json.ts";
import type { ApiHandler } from "../infra/http/server.ts";

export type NotesApiOptions = {
  store: NoteStore;
  /** Only `get` is used, for the slug; the workspace's directory is never read. */
  registry: Pick<Registry, "get">;
};

const notFound = (req: Request): Response => json(req, 404, { error: "not-found" });

/** The notes routes as an `ApiHandler`; `null` for every path that is no notes route. */
export function notesApi(options: NotesApiOptions): ApiHandler {
  const { store, registry } = options;

  return (req, url) => {
    const allow = noteAllowFor(url.pathname);
    if (allow === null) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    const match = matchNoteRoute(url.pathname, req.method);
    if (match === null) return methodNotAllowed(req, allow);
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
        return readJson(req).then((body) => {
          const note = parseNewNote(ws, body);
          return note.ok ? json(req, 201, store.create(note.value)) : json(req, 400, { error: note.error });
        });
      case "update": {
        const { id } = match.params;
        return readJson(req).then((body) => {
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
