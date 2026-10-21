/** The notes slice (spec 002): the notes routes, the store re-exported from `infra/db/`, `import-notes`/`export-notes`. */
export { type NoteStore, type NoteStoreOptions, openNotes } from "../infra/db/notes-store.ts";
export { NOTES_FAMILY, type NotesApiOptions, type NotesFamilyMatch, notesApi, notesHandlers } from "./routes.ts";
export {
  type ImportResult,
  NotesFileError,
  type OldExport,
  type OldNote,
  exportNotes,
  exportNotesCommand,
  importNotes,
  importNotesCommand,
  importedNoteId,
  mapOldNote,
  parseOldExport,
} from "./import-export.ts";
