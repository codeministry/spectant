/**
 * The workspace registry (T42, ISC-13): which repositories Spectant shows, under which slug, in which overview order.
 * It lives in the `workspace` table of `spectant.db` (see `db.ts`) and is the only thing besides settings the database
 * holds (ISC-7).
 *
 * Read-only towards the repository (ISC-15): registering resolves the path with `realpath` and checks it is a
 * directory; nothing here opens, creates or locks a file inside it, and nothing shells out to git.
 *
 * `Workspace.path` is the absolute, realpath-resolved directory and is server-internal. It must never reach the API or
 * the browser (ISC-3): the API layer (T47) maps a `Workspace` to its own model with `pathTail`, the last path segment,
 * and drops `path`.
 *
 * Slugs are the path's basename, deduplicated with `-2`, `-3`, … against the slugs already registered, so a slug is
 * unique and stays stable for as long as the workspace is registered. `position` is the overview order; a new
 * workspace is appended at the end.
 */
import type { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { openDatabase } from "./db.ts";

export type Workspace = {
  slug: string;
  /** Absolute and realpath-resolved. Server-internal only: never returned over the API (ISC-3). */
  path: string;
  name: string;
  /** ISO 8601 timestamp of the registration. */
  addedAt: string;
  position: number;
};

export type RegistryErrorCode = "not-a-directory" | "duplicate-path";

/** A refused registration. `code` is stable for callers (the CLI maps it to a message and an exit code). */
export class RegistryError extends Error {
  constructor(
    readonly code: RegistryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

export type Registry = {
  /** Registers an existing directory. Throws `RegistryError` for a missing path, a non-directory or a duplicate. */
  add(path: string): Workspace;
  /** Every workspace in overview (position) order. */
  list(): Workspace[];
  get(slug: string): Workspace | undefined;
  /** Unregisters by slug, or else by path. Returns false when nothing matched. Never touches the repository. */
  remove(ref: string): boolean;
  close(): void;
};

type Row = { slug: string; path: string; name: string; added_at: string; position: number };

const COLUMNS = "slug, path, name, added_at, position";

function toWorkspace(row: Row): Workspace {
  return { slug: row.slug, path: row.path, name: row.name, addedAt: row.added_at, position: row.position };
}

function resolveDirectory(path: string): string {
  let real: string;
  try {
    real = realpathSync(resolve(path));
  } catch {
    throw new RegistryError("not-a-directory", `${path} does not exist`);
  }
  if (!statSync(real).isDirectory()) throw new RegistryError("not-a-directory", `${path} is not a directory`);
  return real;
}

/** The stored path a remove reference could mean: its realpath when it still exists, else the plain absolute path. */
function candidatePaths(ref: string): string[] {
  const absolute = resolve(ref);
  try {
    return [...new Set([realpathSync(absolute), absolute])];
  } catch {
    return [absolute];
  }
}

/** Opens the registry in `dataDir`, creating the directory and `spectant.db` on first use. */
export function openRegistry(dataDir: string): Registry {
  const db: Database = openDatabase(dataDir);

  const byPath = db.query<Row, [string]>(`SELECT ${COLUMNS} FROM workspace WHERE path = ?`);
  const bySlug = db.query<Row, [string]>(`SELECT ${COLUMNS} FROM workspace WHERE slug = ?`);
  const all = db.query<Row, []>(`SELECT ${COLUMNS} FROM workspace ORDER BY position, added_at`);
  const nextPosition = db.query<{ next: number }, []>("SELECT COALESCE(MAX(position) + 1, 0) AS next FROM workspace");
  const insert = db.query<null, [string, string, string, string, number]>(
    `INSERT INTO workspace (${COLUMNS}) VALUES (?, ?, ?, ?, ?)`,
  );
  const deleteSlug = db.query<null, [string]>("DELETE FROM workspace WHERE slug = ?");
  const deletePath = db.query<null, [string]>("DELETE FROM workspace WHERE path = ?");

  const freeSlug = (base: string): string => {
    if (!bySlug.get(base)) return base;
    for (let n = 2; ; n++) {
      const slug = `${base}-${n}`;
      if (!bySlug.get(slug)) return slug;
    }
  };

  // Immediate transactions: slug choice and position are read and written under one lock, so two CLI processes
  // adding at the same time cannot pick the same slug.
  const add = db.transaction((path: string): Workspace => {
    const real = resolveDirectory(path);
    if (byPath.get(real)) throw new RegistryError("duplicate-path", `${path} is already registered`);
    const name = basename(real);
    const row: Row = {
      slug: freeSlug(name),
      path: real,
      name,
      added_at: new Date().toISOString(),
      position: nextPosition.get()?.next ?? 0,
    };
    insert.run(row.slug, row.path, row.name, row.added_at, row.position);
    return toWorkspace(row);
  });

  const remove = db.transaction((ref: string): boolean => {
    if (deleteSlug.run(ref).changes > 0) return true;
    return candidatePaths(ref).some((path) => deletePath.run(path).changes > 0);
  });

  return {
    add: (path) => add.immediate(path),
    list: () => all.all().map(toWorkspace),
    get: (slug) => {
      const row = bySlug.get(slug);
      return row ? toWorkspace(row) : undefined;
    },
    remove: (ref) => remove.immediate(ref),
    close: () => db.close(),
  };
}
