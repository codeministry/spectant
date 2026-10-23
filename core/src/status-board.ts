// The status board (spec 071): the answer of `GET /api/status` that the status widget draws, built from one dashboard
// model per registered workspace. It lists the open specs only (stage not `done`; spec 073, ISC-613): never a
// closed row and never an archive entry, however recently it closed. They are grouped by workspace in the caller's
// order, which is the workspace picker's (ISC-593); its KPIs count exactly the listed specs (ISC-583), and each spec
// carries its item state for the running pulse (ISC-594) and the row's next command for the copy button (spec 072,
// ISC-599). No field names an absolute path: a workspace carries its slug and path tail only.
//
// Pure and browser-safe (type-only imports, no clock read): the server route and the web e2e stub both build their
// answer here, so the two cannot drift. It reads a dashboard model through `StatusModel`, the slice it uses, never
// through `dashboard.ts` or `archive.ts`: a type import of those type-checks their whole module graph, which fails the
// web tsconfigs (`noPropertyAccessFromIndexSignature`) that import the status contract.
import type { ItemState } from './files.ts';
import type { Progress } from './frontmatter.ts';
import type { Stage } from './stage.ts';

/** The fields of a `DashboardSpecRow` (`dashboard.ts`) the board reads. */
interface StatusRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly stage: Stage;
  readonly progress: Progress;
  readonly closedAt: string | null;
  readonly state?: { readonly state: ItemState };
  readonly nextCommand: string | null;
}

/** The fields of an `ArchivedSpec` (`archive.ts`) the slice names; the board lists none of them (ISC-613). */
interface StatusArchived {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly claims: Progress;
  readonly closedAt: string | null;
}

/**
 * The slice of a `DashboardModel` (`dashboard.ts`) the board reads; every dashboard model is one. `archive` stays in
 * the shape so the callers need not change, but the board never lists an entry of it (ISC-613).
 */
export interface StatusModel {
  readonly specs: readonly StatusRow[];
  readonly archive: readonly StatusArchived[];
}

/**
 * One registered workspace as the caller read it, in the workspace picker's order: its dashboard model when readable,
 * else the reason it is not (the server's unreadable code, e.g. `missing`).
 */
export type StatusInput =
  | { readonly slug: string; readonly pathTail: string; readonly readable: true; readonly model: StatusModel }
  | { readonly slug: string; readonly pathTail: string; readonly readable: false; readonly error: string };

/** One listed spec of a workspace (ISC-593): always an open one (ISC-613). */
export interface StatusSpec {
  /** `NNN`, as on the dashboard row or the archive entry. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  readonly title: string;
  /** The row's stage; never `done` (ISC-613). */
  readonly stage: Stage;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  /** ISO 8601 of the last transition to `done`; a listed spec is open, so this is null (ISC-613). */
  readonly closedAt: string | null;
  /** The row's item state (`running` drives the pulse, ISC-594); null without one. */
  readonly state: ItemState | null;
  /** Whether the spec comes from `specs/archive/`; always false, the board lists no archive entry (ISC-613). */
  readonly archived: boolean;
  /**
   * The row's next command in the plugin form, as the dashboard row shows it (e.g. `/spec implement 072`), taken from
   * the row and never recomputed; null for a row without one (ISC-599).
   */
  readonly nextCommand: string | null;
}

/** One registered workspace on the board; a readable workspace with nothing listed stays, with no specs. */
export interface StatusWorkspace {
  readonly slug: string;
  /** The last segment of the workspace's path, never the absolute path. */
  readonly pathTail: string;
  readonly readable: boolean;
  /** Why the workspace is unreadable; null when it is readable. */
  readonly error: string | null;
  /** The open rows in dashboard order. */
  readonly specs: readonly StatusSpec[];
}

/** The KPIs over exactly the listed specs (ISC-583); an unreadable workspace counts for nothing. */
export interface StatusKpis {
  /** Workspaces with at least one listed spec. */
  readonly repos: number;
  /** Listed specs, the widget head's "specs" (ISC-615); the board lists open specs only (ISC-613). */
  readonly listed: number;
  readonly claimsClosed: number;
  readonly claimsTotal: number;
}

/** The body of `GET /api/status`. */
export interface StatusResponse {
  readonly kpis: StatusKpis;
  readonly workspaces: readonly StatusWorkspace[];
}

const fromRow = (row: StatusRow): StatusSpec => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  stage: row.stage,
  claims: row.progress,
  closedAt: row.closedAt,
  state: row.state?.state ?? null,
  archived: false,
  nextCommand: row.nextCommand,
});

/** The listed specs of one model: its open rows (stage not `done`) in row order; no archive entry (ISC-613). */
const listedSpecs = (model: StatusModel): StatusSpec[] => model.specs.filter((r) => r.stage !== 'done').map(fromRow);

/**
 * The status board over the registered workspaces, in their given order. It takes no clock: it lists open specs only
 * (ISC-613), so no field depends on the time; the item states come in with the models, derived at the caller's clock.
 */
export function statusBoard(workspaces: readonly StatusInput[]): StatusResponse {
  const board = workspaces.map((w): StatusWorkspace =>
    w.readable
      ? { slug: w.slug, pathTail: w.pathTail, readable: true, error: null, specs: listedSpecs(w.model) }
      : { slug: w.slug, pathTail: w.pathTail, readable: false, error: w.error, specs: [] },
  );
  return { kpis: statusKpis(board), workspaces: board };
}

/**
 * The KPIs over exactly the given workspaces and the specs they carry (ISC-583, ISC-604): the board passes all of its
 * workspaces, the widget the ones its filter leaves with the rows it shows, so the figures always match the visible
 * rows. An unreadable workspace carries no specs and counts for nothing.
 */
export function statusKpis(workspaces: readonly StatusWorkspace[]): StatusKpis {
  const listed = workspaces.flatMap((w) => w.specs);
  return {
    repos: workspaces.filter((w) => w.specs.length > 0).length,
    listed: listed.length,
    claimsClosed: listed.reduce((n, s) => n + s.claims.closed, 0),
    claimsTotal: listed.reduce((n, s) => n + s.claims.total, 0),
  };
}
