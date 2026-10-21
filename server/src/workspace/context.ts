/**
 * The workspace routes' context (spec 059): the options `dashboardApi` takes, resolved once into the one object every
 * handler of the workspace family receives (the list, the dashboard, the planning, library and write routes). Each
 * default and each seam a test injects is decided here and nowhere else: the registry, the LifeOS state directory, the
 * loaders, the services probe, the image store, the clocks and the abort and stale ages as the settings now stand.
 */
import type { LibraryCatalog } from "../../../core/src/files.ts";
import type { RepoFileCopy } from "../../../core/src/library.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { abortAge } from "../infra/abort-age.ts";
import type { Db } from "../infra/db/db.ts";
import type { Registry } from "../infra/db/registry.ts";
import type { LifeosDetection } from "../infra/lifeos.ts";
import { type DashboardLoad, type ServicesProbe, type StateClock, loadDashboard } from "./load.ts";
import { type WorkspaceReading, readWorkspaceInput } from "./reading.ts";
import { listServices } from "./services.ts";
import { type ImagesOf, noImages } from "./summary.ts";

/**
 * The document catalog of one workspace (spec 017), or why the workspace cannot be read. `copies` are the worktree
 * copies the catalog read its specs' own files from (`WorkspaceReading.copies`, spec 027, ISC-181), so the reader opens
 * the same file; server-internal, never part of a response (ISC-3), absent from a loader that names none. The library
 * slice loads it (`library/load.ts`); the type lives here, where the options name the loader a test injects.
 */
export type CatalogLoad =
  | { readable: true; catalog: LibraryCatalog; copies?: Readonly<Record<string, string>>; repoFiles?: Readonly<Record<string, RepoFileCopy>> }
  | { readable: false; error: UnreadableCode };

/** Reads one workspace into its dashboard model (`loadDashboard`'s signature). */
export type WorkspaceLoader = (root: string, probe: ServicesProbe | null, lifeosStateDir?: string | null, clock?: StateClock) => Promise<DashboardLoad>;

export type DashboardApiOptions = {
  registry: Pick<Registry, "list" | "get">;
  /**
   * The image URLs each list entry carries (spec 016 T7, the image store under the data folder); absent, every entry
   * lists `NO_IMAGES`.
   */
  imagesOf?: ImagesOf;
  /**
   * Reads one workspace; `loadDashboard` by default. Tests inject another loader. The dashboard route passes `clock`
   * (spec 040, ISC-224): `now` and the `runAbortMinutes` abort age the rows' and stories' item states are derived at.
   */
  loadWorkspace?: WorkspaceLoader;
  /**
   * Reads one workspace's files for the planning route; `readWorkspaceInput` by default, the same read `loadDashboard`
   * starts from. Whoever injects `loadWorkspace` injects this too, so both workspace routes answer from one source.
   */
  readWorkspace?: (root: string) => Promise<WorkspaceReading>;
  /**
   * Reads one workspace's document catalog for the library routes (spec 017 T15, T17, T18): `loadCatalog` by default
   * for the catalog (the dashboard's input, so the heads' stages agree), `loadCatalogDoc` for the reader and
   * `loadCatalogDocs` for the search, which need the documents alone (ISC-156.5). An injected loader answers all three:
   * the reader then finds its document in the injected catalog's `docs`.
   */
  loadCatalog?: (root: string, lifeosStateDir?: string | null) => Promise<CatalogLoad>;
  /** Probes the local listeners for the dashboard route; `listServices` (lsof) by default. */
  services?: ServicesProbe;
  /**
   * The LifeOS detection `GET /api/lifeos` answers from (`lifeos.ts`), so both routes see the same answer. Present:
   * both routes read its frontier locks beside the repository's activity log. Absent (the default): no LifeOS path
   * is read (ISC-37).
   */
  lifeos?: LifeosDetection;
  /**
   * Today as `YYYY-MM-DD`, the day the planning route's milestone states compare target dates with; the local date by
   * default (`localDate`). Tests pin it, as the planning goldens pin theirs.
   */
  today?: () => string;
  /**
   * The open `spectant.db` the board-query route reads and writes (`board_query`, T92). Absent: that route is
   * declined, so the server's JSON 404 applies; every other route here reads no database.
   */
  db?: Db;
  /**
   * The allocation's clock (its event's `ts`, `started`, `created`) and the dashboard's item-state clock (spec 040,
   * ISC-224); `new Date()` by default. Tests pin it.
   */
  now?: () => Date;
  /**
   * The age after which an open run reads `aborted` (spec 040): it stops locking a story's allocation (ISC-225), and
   * the dashboard's rows and stories read it so (ISC-224). The `runAbortMinutes` setting × 60 000, read per request.
   * Absent, core's default.
   */
  abortAfterMs?: () => number;
  /**
   * The age after which a claim lock or task run reads `aborted` in the dashboard's item states (spec 032, ISC-35): the
   * `staleMinutes` setting × 60 000, read per request. Absent, core's default.
   */
  staleAfterMs?: () => number;
};

/** The resolved options: every default applied, every seam in place, built once per `dashboardApi`. */
export type WorkspaceContext = {
  readonly registry: Pick<Registry, "list" | "get">;
  /** The open database of the board query and the favourites; absent, those routes are declined. */
  readonly db: Db | undefined;
  /** The LifeOS state directory whose frontier locks the reads add; null without LifeOS (ISC-37). */
  readonly stateDir: string | null;
  readonly load: WorkspaceLoader;
  readonly read: (root: string) => Promise<WorkspaceReading>;
  readonly services: ServicesProbe;
  readonly imagesOf: ImagesOf;
  /**
   * The injected catalog loader, which then answers the library's catalog, its documents and one document; absent, the
   * library slice's own loads apply (`library/load.ts` `catalogLoaders`).
   */
  readonly loadCatalog: DashboardApiOptions["loadCatalog"];
  readonly today: () => string;
  readonly clock: () => Date;
  /** This request's clock and the abort and stale ages as the settings now stand (spec 040, ISC-224; spec 032, ISC-35). */
  readonly stateClock: () => StateClock;
  /** The run lock's abort age for one write, as an optional input field (ISC-225). */
  readonly abortAge: () => { abortAfterMs?: number };
};

/** The local calendar date of `date` as `YYYY-MM-DD`: the day the user sees, not the UTC one. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const defaultServices: ServicesProbe = (repoRoot, labels) => listServices({ repoRoot, labels });

/** The options resolved into the workspace family's one context. */
export function workspaceContext(options: DashboardApiOptions): WorkspaceContext {
  const stateDir = options.lifeos?.stateDir ?? null;
  const clock = options.now ?? (() => new Date());
  return {
    registry: options.registry,
    db: options.db,
    stateDir,
    load: options.loadWorkspace ?? loadDashboard,
    read: options.readWorkspace ?? readWorkspaceInput,
    services: options.services ?? defaultServices,
    imagesOf: options.imagesOf ?? noImages,
    loadCatalog: options.loadCatalog,
    today: options.today ?? (() => localDate()),
    clock,
    stateClock: () => ({
      now: clock(),
      ...abortAge(options.abortAfterMs?.()),
      ...(options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs() }),
    }),
    abortAge: () => abortAge(options.abortAfterMs?.()),
  };
}
