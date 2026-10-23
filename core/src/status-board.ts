// The status board (spec 071): the answer of `GET /api/status` that the status widget draws, built from one dashboard
// model per registered workspace. It lists the open specs (stage not `done`) and those closed at most 24 hours before
// the caller's clock, archived ones included (ISC-584), grouped by workspace in the caller's order, which is the
// workspace picker's (ISC-593); its KPIs count exactly the listed specs (ISC-583), and each spec carries its item state
// for the running pulse (ISC-594) and the row's next command for the copy button (spec 072, ISC-599). No field names an
// absolute path: a workspace carries its slug and path tail only.
//
// Pure and browser-safe (type-only imports, no clock read): the server route and the web e2e stub both build their
// answer here, so the two cannot drift. It reads a dashboard model through `StatusModel`, the slice it uses, never
// through `dashboard.ts` or `archive.ts`: a type import of those type-checks their whole module graph, which fails the
// web tsconfigs (`noPropertyAccessFromIndexSignature`) that import the status contract.
import type { ItemState } from './files.ts';
import type { Progress } from './frontmatter.ts';
import type { Stage } from './stage.ts';

/** How long a closed spec stays on the board: 24 hours after its `closedAt`, inclusive (ISC-584). */
export const STATUS_CLOSED_WINDOW_MS = 24 * 60 * 60 * 1000;

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

/** The fields of an `ArchivedSpec` (`archive.ts`) the board reads. */
interface StatusArchived {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly claims: Progress;
  readonly closedAt: string | null;
}

/** The slice of a `DashboardModel` (`dashboard.ts`) the board reads; every dashboard model is one. */
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

/** One listed spec of a workspace (ISC-593). */
export interface StatusSpec {
  /** `NNN`, as on the dashboard row or the archive entry. */
  readonly id: string;
  /** `NNN-slug`. */
  readonly slug: string;
  readonly title: string;
  /** The row's stage; `done` for an archived spec. */
  readonly stage: Stage;
  /** Live claims, closed over total. */
  readonly claims: Progress;
  /** ISO 8601 of the last transition to `done`; null for an open spec. */
  readonly closedAt: string | null;
  /** The row's item state (`running` drives the pulse, ISC-594); `done` for an archived spec; null without one. */
  readonly state: ItemState | null;
  /** Whether the spec comes from `specs/archive/`. */
  readonly archived: boolean;
  /**
   * The row's next command in the plugin form, as the dashboard row shows it (e.g. `/spec implement 072`), taken from
   * the row and never recomputed; null for a row without one and for an archived spec (ISC-599).
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
  /** Active rows in dashboard order, then the recently closed archived specs in archive order. */
  readonly specs: readonly StatusSpec[];
}

/** The KPIs over exactly the listed specs (ISC-583); an unreadable workspace counts for nothing. */
export interface StatusKpis {
  /** Workspaces with at least one listed spec. */
  readonly repos: number;
  /** Listed specs at stage `done`. */
  readonly closed: number;
  /** Listed specs. */
  readonly listed: number;
  readonly claimsClosed: number;
  readonly claimsTotal: number;
}

/** The body of `GET /api/status`. */
export interface StatusResponse {
  readonly kpis: StatusKpis;
  readonly workspaces: readonly StatusWorkspace[];
}

/** Whether `closedAt` lies at most the window before `now`; an unparsable or missing time is never recent. */
function closedRecently(closedAt: string | null, now: number): boolean {
  if (closedAt === null) return false;
  const at = Date.parse(closedAt);
  return !Number.isNaN(at) && now - at <= STATUS_CLOSED_WINDOW_MS;
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

const fromArchive = (entry: StatusArchived): StatusSpec => ({
  id: entry.id,
  slug: entry.slug,
  title: entry.title,
  stage: 'done',
  claims: entry.claims,
  closedAt: entry.closedAt,
  state: 'done',
  archived: true,
  nextCommand: null,
});

/** The listed specs of one model: open rows and recently closed rows in row order, then recently closed archived specs. */
function listedSpecs(model: StatusModel, now: number): StatusSpec[] {
  const active = model.specs.filter((r) => r.stage !== 'done' || closedRecently(r.closedAt, now)).map(fromRow);
  const archived = model.archive.filter((a) => closedRecently(a.closedAt, now)).map(fromArchive);
  return [...active, ...archived];
}

/** The status board over the registered workspaces, in their given order, at the caller's clock `now`. */
export function statusBoard(workspaces: readonly StatusInput[], now: Date): StatusResponse {
  const at = now.getTime();
  const board = workspaces.map((w): StatusWorkspace =>
    w.readable
      ? { slug: w.slug, pathTail: w.pathTail, readable: true, error: null, specs: listedSpecs(w.model, at) }
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
    closed: listed.filter((s) => s.stage === 'done').length,
    listed: listed.length,
    claimsClosed: listed.reduce((n, s) => n + s.claims.closed, 0),
    claimsTotal: listed.reduce((n, s) => n + s.claims.total, 0),
  };
}
