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
 * Routes (`NOTE_ROUTE_TABLE`), as the router's `NOTES_FAMILY` (spec 059, ISC-412): the table's five routes sit on three
 * paths, so the family's routes are those paths, `notes` (list, create), `note` (update, remove) and `noteCounts`, and
 * each handler takes the table's route by the method (`matchNoteRoute`). A path that is no notes route is declined, so
 * the chain goes on. Otherwise 403 from the loopback guard, 405 with `noteAllowFor`, 404 for an unknown workspace or
 * note id, 400 `{error}` from the contract's parsers before the database is touched, 201 on create, 204 on delete, and
 * the GETs carry `json()`'s strong ETag.
 */
import {
  type NoteRouteParams,
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
import { json, readJson } from "../infra/http/json.ts";
import { type RouteFamily, type RouteHandlers, createRouter } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";

export type NotesApiOptions = {
  store: NoteStore;
  /** Only `get` is used, for the slug; the workspace's directory is never read. */
  registry: Pick<Registry, "get">;
};

/** A notes path: the collection, one note, or the counts. */
export type NotesFamilyMatch =
  | { readonly route: "notes"; readonly params: NoteRouteParams["list"] }
  | { readonly route: "note"; readonly params: NoteRouteParams["update"] }
  | { readonly route: "noteCounts"; readonly params: NoteRouteParams["counts"] };

/** The path a notes route names, whatever the method: its `GET` route, else its `PUT` one. */
function matchNotesPath(pathname: string): NotesFamilyMatch | null {
  const read = matchNoteRoute(pathname, "GET");
  if (read?.route === "list") return { route: "notes", params: read.params };
  if (read?.route === "counts") return { route: "noteCounts", params: read.params };
  const item = matchNoteRoute(pathname, "PUT");
  return item?.route === "update" ? { route: "note", params: item.params } : null;
}

export const NOTES_FAMILY: RouteFamily<NotesFamilyMatch["route"], NotesFamilyMatch> = {
  name: "notes",
  routes: ["notes", "note", "noteCounts"],
  claims: (pathname) => matchNotesPath(pathname) !== null,
  match: matchNotesPath,
  allow: (_route, pathname) => noteAllowFor(pathname) ?? "",
  guard: "loopback",
  respond: json,
  unmatched: "decline",
};

const notFound = (req: Request): Response => json(req, 404, { error: "not-found" });

/** The notes routes' handlers; the router has checked the guard and the method. */
export function notesHandlers(options: NotesApiOptions): RouteHandlers<NotesFamilyMatch> {
  const { store, registry } = options;

  const answer = (req: Request, url: URL): Response | Promise<Response> | null => {
    // The method is one the path's `Allow` names, so the table has its route.
    const match = matchNoteRoute(url.pathname, req.method);
    if (match === null) return null;
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

  return { notes: answer, note: answer, noteCounts: answer } satisfies RouteHandlers<NotesFamilyMatch>;
}

/** The notes routes alone as an `ApiHandler`; `null` for every path that is no notes route. */
export function notesApi(options: NotesApiOptions): ApiHandler {
  return createRouter([NOTES_FAMILY], notesHandlers(options));
}
