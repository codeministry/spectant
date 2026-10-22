/**
 * The app's own preferences in `spectant.db` beside the settings: the actor names (`actor`, migration 4), the board
 * query per workspace (`board_query`, migration 5), the favourite specs (`spec_favorite`, migration 6) and the favourite
 * ideas (`idea_favorite`, migration 7). The tables
 * and their migrations are `db.ts`'s; this file holds their SQL, so a slice calls these accessors and runs no SQL itself.
 */
import type { Db } from "./db.ts";

// ── the actor table (migration 4, T89, ISC-119.2) ────────────────────────────────────────────────────────────────────

/** One person: the `u:` id, the name the app shows, the addresses seen for it, the time of the last upsert (ISO 8601). */
export interface ActorRow {
  readonly id: string;
  readonly displayName: string;
  readonly gitIdentities: readonly string[];
  readonly updatedAt: string;
}

interface ActorRecord {
  id: string;
  display_name: string;
  git_identities: string;
  updated_at: string;
}

const actorOf = (r: ActorRecord): ActorRow => ({
  id: r.id,
  displayName: r.display_name,
  gitIdentities: JSON.parse(r.git_identities) as string[], // the schema's CHECK holds it to a JSON array
  updatedAt: r.updated_at,
});

const ACTOR_COLUMNS = "id, display_name, git_identities, updated_at";

/** Inserts the actor, or replaces every field of the row with its id. */
export function upsertActor(db: Db, actor: ActorRow): void {
  db.run(
    `INSERT INTO actor (${ACTOR_COLUMNS}) VALUES (?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, git_identities = excluded.git_identities, updated_at = excluded.updated_at`,
    [actor.id, actor.displayName, JSON.stringify(actor.gitIdentities), actor.updatedAt],
  );
}

/** The actor with `id`, or null. */
export function getActor(db: Db, id: string): ActorRow | null {
  const row = db.query<ActorRecord, [string]>(`SELECT ${ACTOR_COLUMNS} FROM actor WHERE id = ?`).get(id);
  return row ? actorOf(row) : null;
}

/** Every actor, ordered by id. */
export function listActors(db: Db): ActorRow[] {
  return db.query<ActorRecord, []>(`SELECT ${ACTOR_COLUMNS} FROM actor ORDER BY id`).all().map(actorOf);
}

/**
 * Replaces the whole table with `actors` in one immediate transaction (`PUT /api/actors`, T91): a row whose id is
 * not among them is deleted, every other one upserted. A failure leaves the table as it was.
 */
export function replaceActors(db: Db, actors: readonly ActorRow[]): void {
  db.transaction(() => {
    db.run("DELETE FROM actor");
    for (const actor of actors) upsertActor(db, actor);
  }).immediate();
}

// ── the board_query table (migration 5, T90, ISC-129.1) ──────────────────────────────────────────────────────────────

/** A workspace's remembered board query: the slug, the query string as the board sent it, the time it was set (ISO 8601). */
export interface BoardQueryRow {
  readonly ws: string;
  readonly query: string;
  readonly updatedAt: string;
}

/** The board query remembered for workspace `ws`, or null when none was set. */
export function getBoardQuery(db: Db, ws: string): BoardQueryRow | null {
  const row = db
    .query<{ ws: string; query: string; updated_at: string }, [string]>("SELECT ws, query, updated_at FROM board_query WHERE ws = ?")
    .get(ws);
  return row ? { ws: row.ws, query: row.query, updatedAt: row.updated_at } : null;
}

/** Remembers `query` for workspace `ws`, replacing the row it had. */
export function setBoardQuery(db: Db, ws: string, query: string, updatedAt: string): void {
  db.run(
    `INSERT INTO board_query (ws, query, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (ws) DO UPDATE SET query = excluded.query, updated_at = excluded.updated_at`,
    [ws, query, updatedAt],
  );
}

// ── the spec_favorite table (migration 6, spec 052 T2, ISC-296) ──────────────────────────────────────────────────────

/** The favourite specs of workspace `ws`: their folder names, sorted, each once. */
export function listFavorites(db: Db, ws: string): string[] {
  return db
    .query<{ spec: string }, [string]>("SELECT spec FROM spec_favorite WHERE ws = ? ORDER BY spec")
    .all(ws)
    .map((row) => row.spec);
}

/** Marks `spec` a favourite of workspace `ws`; a second set keeps the row and its first `createdAt` (idempotent). */
export function addFavorite(db: Db, ws: string, spec: string, createdAt: string): void {
  db.run("INSERT INTO spec_favorite (ws, spec, created_at) VALUES (?, ?, ?) ON CONFLICT (ws, spec) DO NOTHING", [ws, spec, createdAt]);
}

/**
 * Deletes every favourite of workspace `ws` whose spec is not in `open`, the folder names of its open specs as the
 * server's workspace scan found them (spec 057 T1, ISC-352), and returns how many rows went. Only the scan calls it,
 * never a GET handler (ISC-353).
 */
export function pruneFavorites(db: Db, ws: string, open: readonly string[]): number {
  const keep = new Set(open);
  const gone = listFavorites(db, ws).filter((spec) => !keep.has(spec));
  if (gone.length === 0) return 0;
  db.transaction(() => {
    for (const spec of gone) removeFavorite(db, ws, spec);
  })();
  return gone.length;
}

/** Unsets `spec` as a favourite of workspace `ws`; one never set is no error (idempotent). */
export function removeFavorite(db: Db, ws: string, spec: string): void {
  db.run("DELETE FROM spec_favorite WHERE ws = ? AND spec = ?", [ws, spec]);
}

// ── the idea_favorite table (migration 7, spec 064 T50, ISC-494) ─────────────────────────────────────────────────────

/** The favourite stories of workspace `ws`: their slugs (`specs/ideas/<slug>.md` without `.md`), sorted, each once. */
export function listIdeaFavorites(db: Db, ws: string): string[] {
  return db
    .query<{ slug: string }, [string]>("SELECT slug FROM idea_favorite WHERE ws = ? ORDER BY slug")
    .all(ws)
    .map((row) => row.slug);
}

/** Marks story `slug` a favourite of workspace `ws`; a second set keeps the row and its first `createdAt` (idempotent). */
export function addIdeaFavorite(db: Db, ws: string, slug: string, createdAt: string): void {
  db.run("INSERT INTO idea_favorite (ws, slug, created_at) VALUES (?, ?, ?) ON CONFLICT (ws, slug) DO NOTHING", [ws, slug, createdAt]);
}

/** Unsets story `slug` as a favourite of workspace `ws`; one never set is no error (idempotent). */
export function removeIdeaFavorite(db: Db, ws: string, slug: string): void {
  db.run("DELETE FROM idea_favorite WHERE ws = ? AND slug = ?", [ws, slug]);
}

/**
 * Settles the idea favourites of workspace `ws` whose story is gone (spec 064 T52, ISC-496), in one transaction: each
 * slug with a `spec` (the folder `NNN-<slug>` of the open spec it became) stars that spec with the idea's `createdAt`,
 * a spec already starred keeping its row; every slug's idea row is deleted. Only the workspace scan calls it, never a
 * GET handler (ISC-353).
 */
export function settleIdeaFavorites(db: Db, ws: string, gone: ReadonlyArray<{ readonly slug: string; readonly spec: string | null }>): void {
  if (gone.length === 0) return;
  db.transaction(() => {
    for (const { slug, spec } of gone) {
      if (spec !== null) {
        db.run(
          `INSERT INTO spec_favorite (ws, spec, created_at) SELECT ws, ?, created_at FROM idea_favorite WHERE ws = ? AND slug = ?
           ON CONFLICT (ws, spec) DO NOTHING`,
          [spec, ws, slug],
        );
      }
      removeIdeaFavorite(db, ws, slug);
    }
  })();
}
