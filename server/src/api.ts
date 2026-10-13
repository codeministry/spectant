/**
 * The workspace routes (T47, ISC-16; plan 001 § Interfaces "HTTP"), read-only over the registry and the files of the
 * registered repositories:
 *
 * - `GET /api/workspaces` → `WorkspaceSummary[]` in registry order: `{slug, name, pathTail, readable, error?, counts}`.
 *   `counts` is the workspace's `DashboardKpis`, built without a services probe; `null` when unreadable.
 * - `GET /api/workspaces/:slug/dashboard` → the `DashboardModel` of `core/src/dashboard.ts`, unchanged, its `services`
 *   from the local-listener probe labelled with the constitution's `dev_services:`.
 *
 * Answers:
 * - 200 with the JSON body; `HEAD` gets the same headers without it.
 * - 304 when `If-None-Match` matches. Every JSON answer carries a strong `ETag`, the sha256 of the exact body, and
 *   `Cache-Control: no-cache`, so the web app's polling revalidates every time and transfers only a change.
 * - 404 `{error: "not-found"}` for an unknown slug.
 * - 409 with the workspace's own summary (`readable: false`, `error` one of `missing`, `not-a-directory`,
 *   `permission-denied`, `unreadable`, `counts: null`) for a registered workspace whose directory cannot be read: the
 *   workspace exists, its files do not answer. The same entry appears in the list, so the client shows one notice for
 *   both, and a 2xx dashboard answer is always a model.
 * - 403 `{error: "forbidden"}` for a non-loopback `Host` or a cross-site `Origin`, the guard of `settingsApi`.
 * - 405 `{error: "method-not-allowed"}` with `Allow: GET, HEAD` for any other method.
 * - any other `/api/workspaces…` path is `null`, so the server's JSON 404 applies.
 *
 * The planning route (spec 003 T19, ISC-103): `GET /api/workspaces/:ws/planning` → the `PlanningModel` of
 * `core/src/planning.ts`, `buildPlanning` over the master and every spec folder, active and archived, that
 * `readWorkspaceInput` reads. It is matched by the contract's `matchWorkspacePath` (`spec-routes.contract.ts` owns the
 * route) and answers with the same guard order and the same statuses as the dashboard route: 403, 405 with
 * `allowForWorkspace`, 404, 409 with the workspace's summary. The milestone states compare target dates with today's
 * local date (`options.today`), so a stub or golden built at a fixed day differs from a live answer in `state` alone.
 * It lives here rather than in its own handler because it shares this handler's registry, guard and 409 summary.
 * Spec 026 (T11, ISC-171): the same answer carries each milestone's feature assignment (`featureIds`, the no-milestone
 * group `unassignedFeatures`) and the relation index `relations` that `buildPlanning` derives (`core/src/relations.ts`);
 * the detail sidebar reads both from here, so there is no relations route and nothing new is read or written.
 *
 * The story route (spec 008 T88, ISC-124.2): `GET /api/workspaces/:ws/ideas/:slug` → `IdeaPage`, matched by the same
 * `matchWorkspacePath` with the same guard order. It reads the story folder alone (`readIdeaFiles`), never the whole
 * workspace: a story page needs no spec folder, lock source or git call. The slug must be one `readIdeas` lists, so a
 * path out of the folder, the index or a skipped file is a 404 before any file is opened by it; then one read of the
 * file's bytes gives the `IdeaRef` (`readIdeas` over the folder with that text), the page (`renderDocsMarkdown`, images
 * confined to the workspace as on a Docs tab) and `hash`, the raw sha256 hex of those bytes (`rawSha256`, the hash
 * `allocate` checks). The ETag is `json()`'s body hash, and the body carries `hash`, so any byte change revalidates.
 * 404 for an unknown story and for a workspace without stories; 409 with the summary when the folder cannot be read.
 *
 * The board query (spec 008 T92, ISC-129.1): `GET`/`HEAD`/`PUT /api/workspaces/:ws/board-query` → `BoardQuery`, matched
 * by the same `matchWorkspacePath`, answered from the `board_query` table alone (`options.db`), never a repository
 * file: GET `{query}` (`''` when none is stored), PUT validated by the contract's `isBoardQuery` (400 `invalid-body`
 * otherwise) and stored per workspace slug with the server clock. Guard order: 403, 405 with `allowForWorkspace`
 * (`GET, HEAD, PUT`), 404 for an unknown workspace, then the body. No 409: the workspace's files are not read.
 * Without `options.db` the route is declined, so the server's JSON 404 applies.
 *
 * The actor names (spec 008 T91, ISC-119.2): `actorsApi` serves `GET`/`HEAD`/`PUT /api/actors` (`ACTORS_PATH`), a
 * route of its own like `/api/settings`, under the same loopback guard. GET lists the `actor` table's rows as
 * `ActorMapping[]` ordered by id; an id without a row is never invented, so the web shows an unmapped id raw. PUT
 * replaces the whole mapping (`isActorMappings`, each id a person by core's `parseActor`; 400 `invalid-body`
 * otherwise), `updatedAt` from the server clock, and answers the list as stored.
 * The allocation route (spec 008 T87, ISC-130.2): `POST /api/workspaces/:ws/ideas/:slug/allocate` → `IdeaAllocated`,
 * the family's one write, matched by the same `matchWorkspacePath`: 403, then 405 with `Allow: POST` for any other
 * method, 404 unknown workspace, 409 with the summary when the folder cannot be read, otherwise `allocate-route.ts`
 * (400, 404 unknown story, 409 stale story, 422 refused, 200). The lock source is `options.lifeos`'s, as on the reads;
 * the clock is `options.now`.
 *
 * The tech page (spec 023, ISC-134.1): `GET`/`HEAD /api/workspaces/:ws/tech` → `TechModel`, matched by the same
 * `matchWorkspacePath` with the planning route's guard order and statuses. It reads the workspace as the planning route
 * does (`readWorkspaceInput`), then `specs/tech.md` (absent: `tech` undefined, so `pages: null`), and answers
 * core's `readTech` over that text and the active spec folders as it is. An image tech.md names counts as present only
 * when it is a regular file whose real path stays under the real `specs/` (existence only, never a read or a write).
 * Its asset route `techAsset` (T7, ISC-134.3), `GET`/`HEAD …/tech/asset?path=` relative to `specs/`, is the evidence
 * file route (`evidence.ts`) with the workspace's `specs/` as the root: the same once-decoded resolver, every file below
 * the real `specs/` reachable, images only. 200 with the bytes and the evidence headers (ETag, 304), 403 for `..`, a
 * second encoding, an absolute path, a symlink out or another media type, 404 for a missing file or workspace.
 *
 * Lock sources (T51, ISC-37): both routes read the repository's `.spectant/activity.jsonl`, and the LifeOS frontier
 * locks only when `options.lifeos` is present, so the counts in the list and the dashboard agree.
 *
 * No absolute path leaves this module (ISC-3): a workspace is its slug, its name and `pathTail`, the last path segment;
 * the unreadable codes replace OS messages, which would name the path.
 */
import type { Database } from "bun:sqlite";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseActor } from "../../core/src/actor.ts";
import { allocateAnswer } from "./allocate-route.ts";
import { type DashboardKpis, buildDashboard } from "../../core/src/dashboard.ts";
import { docsRenderOptions } from "../../core/src/evidence.ts";
import { repoFilePath, specFilePath } from "../../core/src/files.ts";
import { readIdeas } from "../../core/src/ideas.ts";
import { renderDocsMarkdown } from "../../core/src/markdown-docs.ts";
import { type PlanningSpecState, buildPlanning } from "../../core/src/planning.ts";
import { listSpecs } from "../../core/src/resolve.ts";
import { readTech } from "../../core/src/tech.ts";
import { getBoardQuery, listActors, replaceActors, setBoardQuery } from "./db.ts";
import { evidenceFileResponse } from "./evidence.ts";
import type { ApiHandler } from "./http.ts";
import { matchesIfNoneMatch } from "./http.ts";
import type { LifeosDetection } from "./lifeos.ts";
import type { Registry, Workspace } from "./registry.ts";
import { listServices } from "./services.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";
import {
  ACTORS_ALLOW,
  ACTORS_PATH,
  type ActorsResponse,
  type WorkspaceRouteResponses,
  allowForWorkspace,
  isActorMappings,
  isBoardQuery,
  matchWorkspacePath,
} from "./spec-routes.contract.ts";
import {
  type DashboardLoad,
  type ServicesProbe,
  type UnreadableCode,
  type WorkspaceReading,
  loadDashboard,
  readBytesIfExists,
  readIdeaFiles,
  readIfExists,
  readWorkspaceInput,
  unreadableCode,
  workspaceUnreadable,
} from "./workspace-loader.ts";
import { rawSha256 } from "./writes.ts";

/** The list route; a dashboard is `${WORKSPACES_PATH}/:slug/dashboard`. */
export const WORKSPACES_PATH = "/api/workspaces";

const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;
const ALLOW = "GET, HEAD";

/** One entry of `GET /api/workspaces`, and the body of a 409 dashboard answer. */
export type WorkspaceSummary = {
  slug: string;
  name: string;
  /** The last segment of the workspace path; the path itself never leaves the server. */
  pathTail: string;
  readable: boolean;
  /** Present only when `readable` is false. */
  error?: UnreadableCode;
  /** The workspace's key numbers; null when it cannot be read. */
  counts: DashboardKpis | null;
};

export type DashboardApiOptions = {
  registry: Pick<Registry, "list" | "get">;
  /** Reads one workspace; `loadDashboard` by default. Tests inject another loader. */
  loadWorkspace?: (root: string, probe: ServicesProbe | null, lifeosStateDir?: string | null) => Promise<DashboardLoad>;
  /**
   * Reads one workspace's files for the planning route; `readWorkspaceInput` by default, the same read `loadDashboard`
   * starts from. Whoever injects `loadWorkspace` injects this too, so both workspace routes answer from one source.
   */
  readWorkspace?: (root: string) => Promise<WorkspaceReading>;
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
  db?: Database;
  /** The allocation's clock (its event's `ts`, `started`, `created`); `new Date()` by default. Tests pin it. */
  now?: () => Date;
};

/** The local calendar date of `date` as `YYYY-MM-DD`: the day the user sees, not the UTC one. */
export function localDate(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The first handler that answers wins; `null` from all of them lets the server's JSON 404 apply. A handler declines
 * with a synchronous `null` (`ApiHandler` allows no `Promise<null>`), so a returned promise is always its answer and
 * the composition never waits on a handler that does not own the path.
 */
export function composeApi(...handlers: ApiHandler[]): ApiHandler {
  return (req, url) => {
    for (const handler of handlers) {
      const answer = handler(req, url);
      if (answer !== null) return answer;
    }
    return null;
  };
}

/** The last path segment, whatever the separator. */
function pathTail(path: string): string {
  return path.split(/[\\/]/).filter((segment) => segment !== "").pop() ?? "";
}

function strongEtag(body: string): string {
  return `"${new Bun.CryptoHasher("sha256").update(body).digest("base64url")}"`;
}

/** A JSON answer with its ETag; 304 for a matching `If-None-Match` on a 200, no body on `HEAD`. `lifeos.ts` shares it. */
export function json(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
    ETag: strongEtag(body),
    ...extra,
  };
  const read = req.method === "GET" || req.method === "HEAD";
  if (status === 200 && read && matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === "HEAD" ? null : body, { status, headers });
}

function summary(workspace: Workspace, load: DashboardLoad): WorkspaceSummary {
  const base = { slug: workspace.slug, name: workspace.name, pathTail: pathTail(workspace.path) };
  return load.readable
    ? { ...base, readable: true, counts: load.model.kpis }
    : { ...base, readable: false, error: load.error, counts: null };
}

/**
 * Each active spec's state for the board (spec 008, T83): the stage and its source from the dashboard rows of the very
 * reading the tree is built from, and the raw sha256 of spec.md's bytes, the hash `writes.ts` compares a transition
 * against (`rawSha256`), so a card's move fails only on a file changed since the board was read.
 */
function specStatesOf(root: string, reading: Extract<WorkspaceReading, { readable: true }>): PlanningSpecState[] {
  const dirs = new Map(listSpecs(root).filter((ref) => !ref.archived).map((ref) => [ref.slug, ref.dir]));
  return buildDashboard(reading.input).specs.map((row): PlanningSpecState => {
    const dir = dirs.get(row.slug);
    const bytes = dir === undefined ? null : readBytesIfExists(specFilePath(dir, "spec"));
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, ...(bytes === null ? {} : { hash: rawSha256(bytes) }) };
  });
}

/**
 * Whether an image tech.md names exists: a regular file whose real path stays under the real `specs/` of `root`, its
 * `src` taken as written and decoded once (as the browser would request it). Existence only, `realpath` and `stat`:
 * never a read, never a write. core already flags a `src` that leaves `specs/` lexically; this adds the symlink check.
 */
function specsAssetExists(root: string): (src: string) => boolean {
  let realSpecs: string | null | undefined;
  return (src) => {
    if (realSpecs === undefined) {
      try {
        realSpecs = realpathSync(join(root, "specs"));
      } catch {
        realSpecs = null;
      }
    }
    if (realSpecs === null) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(src);
    } catch {
      return false;
    }
    for (const candidate of new Set([src, decoded])) {
      try {
        const real = realpathSync(resolve(realSpecs, candidate));
        const rel = relative(realSpecs, real);
        const inside = rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
        if (inside && statSync(real).isFile()) return true;
      } catch {
        // Missing or unreadable: the other spelling, else missing.
      }
    }
    return false;
  };
}

const defaultServices: ServicesProbe = (repoRoot, labels) => listServices({ repoRoot, labels });

/**
 * `GET` / `HEAD` of the workspace list, the dashboard and the planning route as an `ApiHandler`; `null` for every other path. Nothing is cached: each
 * request reads the registry and the files again, so a `spectant add` or an edited spec shows on the next poll, and
 * the ETag keeps an unchanged answer to a 304.
 */
export function dashboardApi(options: DashboardApiOptions): ApiHandler {
  const { registry } = options;
  const load = options.loadWorkspace ?? loadDashboard;
  const read = options.readWorkspace ?? readWorkspaceInput;
  const services = options.services ?? defaultServices;
  const stateDir = options.lifeos?.stateDir ?? null;
  const today = options.today ?? (() => localDate());
  const clock = options.now ?? (() => new Date());

  const list = async (req: Request): Promise<Response> => {
    const workspaces = registry.list();
    const loads = await Promise.all(workspaces.map((w) => load(w.path, null, stateDir)));
    return json(req, 200, workspaces.map((w, i) => summary(w, loads[i] ?? { readable: false, error: "unreadable" })));
  };

  const dashboard = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await load(workspace.path, services, stateDir);
    if (!loaded.readable) return json(req, 409, summary(workspace, loaded));
    return json(req, 200, loaded.model);
  };

  // The board's stages come from the reading's own lock source (the repository's activity log); no LifeOS path is read.
  const planning = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const reading = await read(workspace.path);
    if (!reading.readable) return json(req, 409, summary(workspace, reading));
    const { master, specs, archived } = reading.input;
    const model: WorkspaceRouteResponses["planning"] = buildPlanning({
      master,
      specs,
      archived,
      ideas: reading.ideas,
      now: today(),
      workflow: reading.workflow,
      specStates: specStatesOf(workspace.path, reading),
    });
    return json(req, 200, model);
  };

  // The planning route's reading, then specs/tech.md; the model as readTech builds it, never reshaped (header).
  const tech = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const reading = await read(workspace.path);
    if (!reading.readable) return json(req, 409, summary(workspace, reading));
    try {
      const text = readIfExists(join(workspace.path, "specs", "tech.md"));
      const model: WorkspaceRouteResponses["tech"] = readTech({
        ...(text === null ? {} : { tech: text }),
        specs: reading.input.specs,
        assetExists: specsAssetExists(workspace.path),
      });
      return json(req, 200, model);
    } catch (error) {
      if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
      return json(req, 409, summary(workspace, { readable: false, error: unreadableCode(error) }));
    }
  };

  // One image below specs/, through the evidence file route's resolver and answer (header).
  const techAsset = (req: Request, slug: string, search: string): Promise<Response> | Response => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    return evidenceFileResponse(req, join(workspace.path, "specs"), search, {
      reach: "tree",
      serves: (mediaType) => mediaType.startsWith("image/"),
    });
  };

  // The story folder alone: no spec folder, lock source or git call feeds a story page (header).
  const idea = (req: Request, slug: string, story: string): Response => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const root = workspace.path;
    const unreadable = workspaceUnreadable(root);
    if (unreadable !== null) return json(req, 409, summary(workspace, { readable: false, error: unreadable }));
    try {
      const files = readIdeaFiles(root);
      // Only a slug `readIdeas` lists names a file: never a path built from the request alone.
      if (!readIdeas(files).ideas.some((ref) => ref.slug === story)) return json(req, 404, { error: "not-found" });
      const name = `${story}.md`;
      const path = join(repoFilePath(root, "idea"), name);
      const bytes = readBytesIfExists(path);
      if (bytes === null) return json(req, 404, { error: "not-found" });
      // One read: the ref, the page and the hash all describe these bytes, even if the file changed since the listing.
      const text = bytes.toString("utf8");
      const ref = readIdeas({ ...files, [name]: text }).ideas.find((r) => r.slug === story);
      if (ref === undefined) return json(req, 404, { error: "not-found" });
      // A story renders as a Docs tab that is not the Design tab: images confined to the workspace, no spec assets.
      const body: WorkspaceRouteResponses["idea"] = {
        idea: ref,
        page: renderDocsMarkdown(text, docsRenderOptions(root, path, "plan")),
        hash: rawSha256(bytes),
      };
      return json(req, 200, body);
    } catch (error) {
      if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
      return json(req, 409, summary(workspace, { readable: false, error: unreadableCode(error) }));
    }
  };

  // The database alone: no file of the workspace is read, so there is no 409 (header).
  const boardQuery = async (req: Request, slug: string, db: Database): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "PUT") {
      return json(req, 405, { error: "method-not-allowed" }, { Allow: allowForWorkspace("boardQuery") });
    }
    if (!registry.get(slug)) return json(req, 404, { error: "not-found" });
    if (req.method !== "PUT") {
      const body: WorkspaceRouteResponses["boardQuery"] = { query: getBoardQuery(db, slug)?.query ?? "" };
      return json(req, 200, body);
    }
    const body = await readJson(req);
    if (!isBoardQuery(body)) return json(req, 400, { error: "invalid-body" });
    setBoardQuery(db, slug, body.query, new Date().toISOString());
    const stored: WorkspaceRouteResponses["boardQuery"] = { query: body.query };
    return json(req, 200, stored);
  };

  // The one write of the family (T87): the route layer's 404 and 409 here, everything else in `allocate-route.ts`.
  const allocate = async (req: Request, slug: string, story: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const root = workspace.path;
    const unreadable = workspaceUnreadable(root);
    if (unreadable !== null) return json(req, 409, summary(workspace, { readable: false, error: unreadable }));
    try {
      const answer = await allocateAnswer({ root, slug: story, stateDir, now: clock(), text: await req.text() });
      return json(req, answer.status, answer.body);
    } catch (error) {
      if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
      return json(req, 409, summary(workspace, { readable: false, error: unreadableCode(error) }));
    }
  };

  return (req, url) => {
    const { pathname } = url;
    const match = DASHBOARD_PATH.exec(pathname);
    const workspaceRoute = matchWorkspacePath(pathname);
    if (pathname !== WORKSPACES_PATH && !match && !workspaceRoute) return null;
    const { db } = options;
    if (workspaceRoute?.route === "boardQuery" && db === undefined) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    if (workspaceRoute?.route === "boardQuery" && db !== undefined) return boardQuery(req, workspaceRoute.params.ws, db);
    if (workspaceRoute?.route === "allocate") {
      if (req.method !== "POST") return json(req, 405, { error: "method-not-allowed" }, { Allow: allowForWorkspace("allocate") });
      return allocate(req, workspaceRoute.params.ws, workspaceRoute.params.slug);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      const allow = workspaceRoute ? allowForWorkspace(workspaceRoute.route) : ALLOW;
      return json(req, 405, { error: "method-not-allowed" }, { Allow: allow });
    }
    if (workspaceRoute?.route === "idea") return idea(req, workspaceRoute.params.ws, workspaceRoute.params.slug);
    if (workspaceRoute?.route === "tech") return tech(req, workspaceRoute.params.ws);
    if (workspaceRoute?.route === "techAsset") return techAsset(req, workspaceRoute.params.ws, url.search);
    if (workspaceRoute) return planning(req, workspaceRoute.params.ws);
    if (!match) return list(req);
    let slug: string;
    try {
      slug = decodeURIComponent(match[1] ?? "");
    } catch {
      return json(req, 404, { error: "not-found" });
    }
    return dashboard(req, slug);
  };
}

/** The request's JSON body, or `undefined` when it is not JSON; the validators refuse `undefined`. */
async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

function actorList(db: Database): ActorsResponse {
  return listActors(db).map(({ id, displayName, gitIdentities }) => ({ id, displayName, gitIdentities }));
}

/**
 * `GET` / `HEAD` / `PUT /api/actors` as an `ApiHandler` over the `actor` table (T91, ISC-119.2; header); `null` for
 * any other path, so the server's JSON 404 applies. The answers carry ids, names and addresses only, never a path.
 */
export function actorsApi(db: Database): ApiHandler {
  const put = async (req: Request): Promise<Response> => {
    const body = await readJson(req);
    // Only a person has a row: an agent id, a legacy value or a repeated id refuses the whole list.
    if (!isActorMappings(body) || !body.every((actor) => parseActor(actor.id).kind === "person")) {
      return json(req, 400, { error: "invalid-body" });
    }
    const updatedAt = new Date().toISOString();
    replaceActors(db, body.map((actor) => ({ ...actor, updatedAt })));
    return json(req, 200, actorList(db));
  };

  return (req, url) => {
    if (url.pathname !== ACTORS_PATH) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    if (req.method === "GET" || req.method === "HEAD") return json(req, 200, actorList(db));
    if (req.method === "PUT") return put(req);
    return json(req, 405, { error: "method-not-allowed" }, { Allow: ACTORS_ALLOW });
  };
}
