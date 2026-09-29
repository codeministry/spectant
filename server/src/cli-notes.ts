/**
 * The notes and schema commands of the `spectant` CLI (T98, ISC-53): `import-notes <file>`, `export-notes <file>` and
 * `db rollback <version> --yes`. `cli.ts` parses the command line and calls in here.
 *
 * The old notes page (the Spec skill's notes pad) kept its notes in the browser's localStorage under `spec-notes:v1`,
 * as `{v: 1, notes: OldNote[]}`. `import-notes` reads that value, or a bare array of notes, and maps each note onto
 * the contract (`notes.contract.ts`):
 *
 * | old field          | becomes                                                                                     |
 * |--------------------|---------------------------------------------------------------------------------------------|
 * | `id`               | the note id: kept when it is already a lowercase UUID, else a UUID derived from it (sha256), |
 * |                    | so a second run finds it and skips it (idempotent)                                          |
 * | `repo`             | `workspace`: the slug whose registered path is `repo` or the folder above a `repo` ending in |
 * |                    | `specs` (realpaths compared), or a slug equal to `repo`; anything else is an orphan (null)   |
 * | `spec` + `ref`     | `anchor`: an explicit valid `anchor` wins; else `spec` `NNN-slug` → `{spec: NNN}`, with      |
 * |                    | `ref` `ISC-n` → claim, `Tn` → task; no `NNN` spec → no anchor                                |
 * | `title`            | trimmed, cut to `NOTE_TITLE_MAX`                                                            |
 * | `body`             | as it is; a blank body is skipped (the contract never stores one)                           |
 * | `pinned`           | `pinned` (true only for `true`)                                                             |
 * | `created`/`updated`| ISO 8601 UTC; a missing one falls back to the other, then to now                            |
 * | `taken`, `handoff` | dropped: the app has no hand-off state                                                      |
 *
 * `export-notes` writes every note (orphans included) back in the same `{v: 1, notes}` shape, with `repo` as the
 * workspace slug (never a path, ISC-3), `spec` as `NNN`, `ref` as the claim or task id and the exact `anchor` beside
 * them, so importing the file into an empty data directory gives the same notes: a lossless round trip.
 *
 * `db rollback <version>` applies `db.ts`'s documented reversals down to `version`, newest first. Without `--yes` it
 * only says what would be lost and exits 1. Nothing here touches a registered repository (ISC-15).
 */
import type { Database } from "bun:sqlite";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute } from "node:path";
import { SCHEMA_VERSION, openDatabase, openDatabaseUnmigrated, rollback, schemaVersion } from "./db.ts";
import { NOTE_TITLE_MAX, type Note, type NoteAnchor, isNoteId, parseAnchor } from "./notes.contract.ts";
import { openNotes } from "./notes.ts";
import { openRegistry } from "./registry.ts";

/** One note as the old notes page stored it; `ref`, `anchor` and `pinned` are read when present. */
export interface OldNote {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly repo: string | null;
  readonly spec: string | null;
  readonly ref?: string | null;
  readonly anchor?: NoteAnchor | null;
  readonly pinned?: boolean;
  readonly taken?: boolean;
  readonly created: string;
  readonly updated: string;
}

/** The old page's localStorage value (`spec-notes:v1`), and what `export-notes` writes. */
export interface OldExport {
  readonly v: 1;
  readonly notes: readonly OldNote[];
}

/** A file that is not an export of the notes page. */
export class NotesFileError extends Error {}

type WorkspaceRef = { readonly slug: string; readonly path: string };
type Mapped = { readonly ok: true; readonly note: Note } | { readonly ok: false; readonly reason: string };

const SPEC_NUMBER = /^(\d{3})(?:-|$)/;
const CLAIM_REF = /^ISC-[\w.-]+$/; // single-core: allow — maps an old note's ref to an anchor kind, no spec file is parsed
const TASK_REF = /^T\d+$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The notes of an old export: `{v: 1, notes: [...]}` or a bare array. Throws `NotesFileError` on anything else. */
export function parseOldExport(text: string): unknown[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new NotesFileError(`not JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  if (Array.isArray(value)) return value;
  if (isRecord(value) && value.v === 1 && Array.isArray(value.notes)) return value.notes as unknown[];
  throw new NotesFileError("not an export of the notes page: expected {\"v\": 1, \"notes\": [...]} or an array of notes");
}

/** The id an old note is stored under: itself when it is a lowercase UUID, else a name-based UUID (version 5 layout). */
export function importedNoteId(oldId: string): string {
  const h = new Bun.CryptoHasher("sha256").update(`spectant-notes-import\0${oldId}`).digest("hex");
  if (isNoteId(oldId)) return oldId;
  const variant = (8 + (Number.parseInt(h.charAt(16), 16) % 4)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function workspaceFor(repo: unknown, workspaces: readonly WorkspaceRef[]): string | null {
  if (typeof repo !== "string" || repo === "") return null;
  const bySlug = workspaces.find((w) => w.slug === repo);
  if (bySlug !== undefined) return bySlug.slug;
  if (!isAbsolute(repo)) return null;
  const roots = basename(repo) === "specs" ? [repo, dirname(repo)] : [repo];
  const candidates = new Set(roots.flatMap((path) => [path, realpathOrSelf(path)]));
  return workspaces.find((w) => candidates.has(w.path) || candidates.has(realpathOrSelf(w.path)))?.slug ?? null;
}

function anchorFor(old: Record<string, unknown>): NoteAnchor | null {
  const explicit = parseAnchor(old.anchor);
  if (explicit.ok && explicit.value !== null) return explicit.value;
  const spec = typeof old.spec === "string" ? SPEC_NUMBER.exec(old.spec)?.[1] : undefined;
  if (spec === undefined) return null;
  const ref = typeof old.ref === "string" ? old.ref : "";
  const kind = CLAIM_REF.test(ref) ? "claim" : TASK_REF.test(ref) ? "task" : null;
  const anchor = parseAnchor(kind === null ? { kind: "spec", spec } : { kind, spec, id: ref });
  return anchor.ok ? anchor.value : { kind: "spec", spec };
}

function timestamp(value: unknown): string | undefined {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

/** One old note mapped onto the contract, or the reason it cannot be. */
export function mapOldNote(value: unknown, workspaces: readonly WorkspaceRef[], now: string): Mapped {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") return { ok: false, reason: "no id" };
  if (typeof value.body !== "string" || value.body.trim() === "") return { ok: false, reason: "empty body" };
  const created = timestamp(value.created) ?? timestamp(value.updated) ?? now;
  return {
    ok: true,
    note: {
      id: importedNoteId(value.id),
      workspace: workspaceFor(value.repo, workspaces),
      anchor: anchorFor(value),
      title: typeof value.title === "string" ? value.title.trim().slice(0, NOTE_TITLE_MAX).trim() : "",
      body: value.body,
      pinned: value.pinned === true,
      created,
      updated: timestamp(value.updated) ?? created,
    },
  };
}

export type ImportResult = { readonly imported: number; readonly skipped: number; readonly reasons: readonly string[] };

/** Imports `text` into `db` in one transaction; notes whose id is already stored are skipped. */
export function importNotes(db: Database, workspaces: readonly WorkspaceRef[], text: string, now = new Date().toISOString()): ImportResult {
  const notes = parseOldExport(text);
  const store = openNotes(db);
  return db.transaction(() => {
    let imported = 0;
    const reasons: string[] = [];
    let skipped = 0;
    notes.forEach((value, index) => {
      const mapped = mapOldNote(value, workspaces, now);
      if (!mapped.ok) {
        const id = isRecord(value) && typeof value.id === "string" ? value.id : `#${index + 1}`;
        reasons.push(`${id}: ${mapped.reason}`);
        skipped++;
      } else if (store.restore(mapped.note)) imported++;
      else skipped++; // imported before: same id
    });
    return { imported, skipped, reasons };
  })();
}

/** Every note in the old page's shape: `repo` is the workspace slug, never a path. */
export function exportNotes(db: Database): OldExport {
  const notes = openNotes(db)
    .all()
    .map(
      (note): OldNote => ({
        id: note.id,
        title: note.title,
        body: note.body,
        repo: note.workspace,
        spec: note.anchor?.spec ?? null,
        ref: note.anchor === null || note.anchor.kind === "spec" ? null : note.anchor.id,
        anchor: note.anchor,
        pinned: note.pinned,
        created: note.created,
        updated: note.updated,
      }),
    );
  return { v: 1, notes };
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** `spectant import-notes <file>`: prints `imported n, skipped m`, one stderr line per note that could not be mapped. */
export function importNotesCommand(dir: string, file: string, shown: string): number {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    console.error(`spectant: cannot read ${shown}: ${reason(error)}`);
    return 1;
  }
  const db = openDatabase(dir);
  const registry = openRegistry(dir);
  try {
    const result = importNotes(db, registry.list(), text);
    for (const line of result.reasons) console.error(`spectant: skipped ${line}`);
    console.log(`imported ${result.imported}, skipped ${result.skipped}`);
    return 0;
  } catch (error) {
    if (!(error instanceof NotesFileError)) throw error;
    console.error(`spectant: ${shown} is ${error.message}`);
    return 1;
  } finally {
    registry.close();
    db.close();
  }
}

/** `spectant export-notes <file>`: writes the file and prints `exported n`. */
export function exportNotesCommand(dir: string, file: string, shown: string): number {
  const db = openDatabase(dir);
  try {
    const data = exportNotes(db);
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`exported ${data.notes.length}`);
    return 0;
  } catch (error) {
    console.error(`spectant: cannot write ${shown}: ${reason(error)}`);
    return 1;
  } finally {
    db.close();
  }
}

/** What reversing each migration loses, for the refusal without `--yes`. */
function losses(db: Database, from: number, target: number): string[] {
  const count = (sql: string): number => db.query<{ n: number }, []>(sql).get()?.n ?? 0;
  const out: string[] = [];
  if (from >= 3 && target < 3) out.push(`drop the pinned column (${count("SELECT count(*) AS n FROM note WHERE pinned = 1")} pinned notes lose their pin)`);
  if (from >= 2 && target < 2) out.push(`drop the note table (${count("SELECT count(*) AS n FROM note")} notes; save them first with spectant export-notes <file>)`);
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
