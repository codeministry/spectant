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
 * Spec 025 (T32, ISC-170.1): it also carries the spec edges `resolveEdges` resolves against the reading's merge state
 * (`specEdges`, absent without any), from which the Diagram lens draws its `spec-edge` arrows.
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
 * The library catalog (spec 017 T15, ISC-156): `GET`/`HEAD /api/workspaces/:ws/library` → `LibraryCatalog`, matched by
 * the same `matchWorkspacePath` with the planning route's guard order and statuses (403, 405 with `allowForWorkspace`,
 * 404 unknown workspace, 409 with the summary when the folder cannot be read). It answers core's `readCatalog` through
 * `loadCatalog` (`workspace-loader.ts`) as it is: metadata only (path, type, spec, title, modified, state), never a
 * document's content and never an absolute path, since every catalog path is relative to `specs/`. Nothing is cached;
 * the ETag is `json()`'s body hash and each entry carries its mtime, so any change to a document is a new tag. The
 * catalog is read over the dashboard's own input (`readWorkspaceInput`, LifeOS locks under `options.lifeos`), so a
 * group head's stage equals the dashboard row's, a fresh code-reviewed mark included.
 *
 * The reader and the search (spec 017 T17, T18, ISC-156.2, ISC-156.3), with the same guard order and statuses, read the
 * catalog's documents alone (`loadCatalogDocs`, no git call). A document is one the catalog lists as Markdown and not
 * `missing`; its file is reached only by its listed path, through core's `resolveEvidencePath` with `specs/` as the
 * root (`reach: 'tree'`), so a request never names a file and a symlink out of `specs/` is never read. A spec's own file
 * read from its worktree copy (spec 027, ISC-181) is reached the same way below that copy's folder (`catalogSourceOf`).
 * - `libraryDoc`, `GET …/library/doc?path=` (the raw query value, decoded once): the document rendered as its Docs tab
 *   renders it, `renderDocsMarkdown` with `docsRenderOptions` (the constitution's and the Design tab's own options by
 *   type, else a plain page), so relative images confined to the workspace and `.design/` assets resolve as on a Docs
 *   tab. 404 for any path the catalog does not list as such a document, never a read of the path.
 * - `librarySearch`, `GET …/library/search?q=`: the trimmed query, case-insensitive, over each document's rendered page
 *   as plain text, else its title; hits in catalog order, the snippet 40 characters before the first match and 60
 *   after with an ellipsis where cut, or the title for a title-only match. A blank `q` is `{query: '', hits: []}`,
 *   never 400. The plain texts are cached in memory per workspace by catalog path, size and mtime; a search keeps only
 *   the entries of the catalog it read.
 * - `libraryAsset`, `GET …/library/asset?path=`: one image below `specs/`, the evidence file route (`evidence.ts`) with
 *   the workspace's `specs/` as the root: the same once-decoded resolver, every file below the real `specs/` reachable,
 *   images only. 200 with the bytes and the evidence headers (ETag, 304), 403 for `..`, a second encoding, an absolute
 *   path, a symlink out or another media type, 404 for a missing file or workspace.
 * The tech page's routes (`…/tech`, `…/tech/asset`) went with spec 017 T51: the library replaces them (ISC-157.1),
 * and a request to either is the unmatched API path's 404.
 *
 * Lock sources (T51, ISC-37): both routes read the repository's `.spectant/activity.jsonl`, and the LifeOS frontier
 * locks only when `options.lifeos` is present, so the counts in the list and the dashboard agree.
 *
 * No absolute path leaves this module (ISC-3): a workspace is its slug, its name and `pathTail`, the last path segment;
 * the unreadable codes replace OS messages, which would name the path.
 */
import type { Database } from "bun:sqlite";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseActor } from "../../core/src/actor.ts";
import { allocateAnswer } from "./allocate-route.ts";
import { type DashboardKpis, buildDashboard } from "../../core/src/dashboard.ts";
import { docsRenderOptions, resolveEvidencePath } from "../../core/src/evidence.ts";
import { catalogSourceOf } from "../../core/src/library.ts";
import { type DocName, type DocsPage, type LibraryDoc, repoFilePath, specFilePath } from "../../core/src/files.ts";
import { readIdeas } from "../../core/src/ideas.ts";
import { renderDocsMarkdown } from "../../core/src/markdown-docs.ts";
import { type PlanningSpecState, buildPlanning } from "../../core/src/planning.ts";
import { listSpecs } from "../../core/src/resolve.ts";
import { resolveEdges } from "../../core/src/spec-edges.ts";
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
  type LibrarySearchHit,
  type WorkspaceRouteResponses,
  allowForWorkspace,
  evidencePathQuery,
  isActorMappings,
  isBoardQuery,
  matchWorkspacePath,
} from "./spec-routes.contract.ts";
import {
  type CatalogLoad,
  type DashboardLoad,
  type ServicesProbe,
  type UnreadableCode,
  type WorkspaceReading,
  loadCatalog,
  loadCatalogDocs,
  loadDashboard,
  readBytesIfExists,
  readIdeaFiles,
  readWorkspaceInput,
  unreadableCode,
  workspaceUnreadable,
} from "./workspace-loader.ts";
import { rawSha256 } from "./writes.ts";

/** The list route; a dashboard is `${WORKSPACES_PATH}/:slug/dashboard`. */
export const WORKSPACES_PATH = "/api/workspaces";

const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;
const ALLOW = "GET, HEAD";

/** Characters of plain text a search snippet keeps before and after the match (spec 017, as the e2e stub cuts it). */
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 60;

const ENTITY: Readonly<Record<string, string>> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * A rendered page as plain text: tags dropped, the five entities the renderer writes decoded, whitespace collapsed.
 * The renderer escapes every text and emits only its own tags, so this is its exact text, never a parse of the file.
 */
function plainTextOf(page: DocsPage): string {
  return page.html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITY[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The plain text around a match at `at`: 40 characters before it and 60 after, an ellipsis where the text is cut. */
function snippetAt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** A catalog document the reader and the search read: Markdown, and a file that exists (not `missing`). */
const isReadableDoc = (doc: LibraryDoc): boolean => doc.media === "markdown" && doc.state !== "missing";

/** The Docs tab a catalog document renders as: the constitution's and the Design tab's own options, else a plain page. */
const docNameOf = (type: LibraryDoc["type"]): DocName => (type === "constitution" ? "constitution" : type === "design" ? "design" : "plan");

/** A catalog path (decoded, `/`-separated) as the raw query value core's resolver decodes once. */
const rawPathOf = (path: string): string => path.split("/").map(encodeURIComponent).join("/");

/** One document's search text with the file version it was taken from; a changed size or mtime renders it again. */
type SearchText = { readonly mtimeMs: number; readonly size: number; readonly text: string };

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
  /**
   * Reads one workspace's document catalog for the library routes (spec 017 T15, T17, T18): `loadCatalog` by default
   * for the catalog (the dashboard's input, so the heads' stages agree), `loadCatalogDocs` for the reader and the
   * search, which need the documents alone. An injected loader answers all three.
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
    // `waits`: the row's, so the board card shows the same `waits on NNN` as the row (spec 025, ISC-163).
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, waits: row.waits, ...(bytes === null ? {} : { hash: rawSha256(bytes) }) };
  });
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
  const catalogOf = options.loadCatalog ?? loadCatalog;
  const docsOf = options.loadCatalog ?? loadCatalogDocs;
  // The search text of each Markdown document, by workspace root and catalog path; each search keeps only what it saw.
  const searchTexts = new Map<string, Map<string, SearchText>>();
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
    const { master, specs, archived, constitution } = reading.input;
    const model: WorkspaceRouteResponses["planning"] = buildPlanning({
      master,
      specs,
      archived,
      ideas: reading.ideas,
      now: today(),
      workflow: reading.workflow,
      specStates: specStatesOf(workspace.path, reading),
      // The Diagram lens's arrows (spec 025, ISC-170.1): the edges as the dashboard resolves them.
      specEdges: resolveEdges({ specs, archived, constitution }, reading.mergeState).edges,
    });
    return json(req, 200, model);
  };

  // The catalog as core's readCatalog builds it, metadata only, never reshaped (header).
  const library = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await catalogOf(workspace.path, stateDir);
    if (!loaded.readable) return json(req, 409, summary(workspace, loaded));
    const body: WorkspaceRouteResponses["library"] = loaded.catalog;
    return json(req, 200, body);
  };

  /**
   * The catalog's readable Markdown document at the decoded `path`, and its real file through core's confinement
   * (`resolveEvidencePath` with `specs/` as the root, `reach: 'tree'`): null for a path the catalog does not list as
   * one, or whose real path leaves `specs/` (a symlink out). Only a listed path is ever resolved, so a request alone
   * never names a file. A spec's own file comes from its worktree copy when `copies` names one (core's
   * `catalogSourceOf`, spec 027, ISC-181), confined to that copy's folder the same way.
   */
  const catalogFile = async (
    root: string,
    docs: readonly LibraryDoc[],
    path: string,
    copies: Readonly<Record<string, string>> | undefined,
  ): Promise<{ doc: LibraryDoc; absolute: string; logical: string } | null> => {
    const doc = docs.find((d) => d.path === path && isReadableDoc(d));
    if (doc === undefined) return null;
    const specs = join(root, "specs");
    const source = catalogSourceOf(root, doc, copies);
    const hit = await resolveEvidencePath(source.dir, rawPathOf(source.rel), "tree");
    // The logical path (not the real one) feeds the render options, whose confinement is lexical under `root`; it stays
    // the main checkout's, where a copy's relative images resolve (`artifacts/` and `.design/` are never read from a copy).
    return hit.ok ? { doc, absolute: hit.absolute, logical: join(specs, ...doc.path.split("/")) } : null;
  };

  /** A catalog document rendered as its Docs tab renders it: `renderDocsMarkdown` with `docsRenderOptions`. */
  const renderCatalogDoc = (root: string, file: { doc: LibraryDoc; logical: string }, source: string): DocsPage =>
    renderDocsMarkdown(source, docsRenderOptions(root, file.logical, docNameOf(file.doc.type)));

  // One Markdown document of the catalog as a Docs page; 404 for anything the catalog does not list as one (header).
  const libraryDoc = async (req: Request, slug: string, search: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await docsOf(workspace.path, stateDir);
    if (!loaded.readable) return json(req, 409, summary(workspace, loaded));
    let path: string;
    try {
      path = decodeURIComponent(evidencePathQuery(search));
    } catch {
      return json(req, 404, { error: "not-found" });
    }
    const file = await catalogFile(workspace.path, loaded.catalog.docs, path, loaded.copies);
    if (file === null) return json(req, 404, { error: "not-found" });
    let source: string;
    try {
      source = readFileSync(file.absolute, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      if (typeof code !== "string") throw error;
      if (code === "ENOENT") return json(req, 404, { error: "not-found" }); // gone since the catalog was read
      return json(req, 409, summary(workspace, { readable: false, error: unreadableCode(error) }));
    }
    const body: WorkspaceRouteResponses["libraryDoc"] = renderCatalogDoc(workspace.path, file, source);
    return json(req, 200, body);
  };

  /**
   * The search text of one catalog document: its rendered page as plain text, from the cache while the file's size and
   * mtime are unchanged, else rendered again. Null when the file cannot be resolved or read; the title still matches.
   */
  const searchTextOf = async (
    root: string,
    docs: readonly LibraryDoc[],
    doc: LibraryDoc,
    copies: Readonly<Record<string, string>> | undefined,
    previous: ReadonlyMap<string, SearchText>,
    seen: Map<string, SearchText>,
  ): Promise<string | null> => {
    const file = await catalogFile(root, docs, doc.path, copies);
    if (file === null) return null;
    try {
      const stat = statSync(file.absolute);
      const cached = previous.get(doc.path);
      const entry =
        cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size
          ? cached
          : { mtimeMs: stat.mtimeMs, size: stat.size, text: plainTextOf(renderCatalogDoc(root, file, readFileSync(file.absolute, "utf8"))) };
      seen.set(doc.path, entry);
      return entry.text;
    } catch (error) {
      if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
      return null;
    }
  };

  // Title and full text of the catalog's Markdown documents, case-insensitive, hits in catalog order (header).
  const librarySearch = async (req: Request, slug: string, q: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const loaded = await docsOf(workspace.path, stateDir);
    if (!loaded.readable) return json(req, 409, summary(workspace, loaded));
    const query = q.trim();
    if (query === "") {
      const empty: WorkspaceRouteResponses["librarySearch"] = { query: "", hits: [] };
      return json(req, 200, empty);
    }
    const root = workspace.path;
    const needle = query.toLowerCase();
    const previous = searchTexts.get(root) ?? new Map<string, SearchText>();
    const seen = new Map<string, SearchText>();
    const hits: LibrarySearchHit[] = [];
    for (const doc of loaded.catalog.docs) {
      if (!isReadableDoc(doc)) continue;
      const text = await searchTextOf(root, loaded.catalog.docs, doc, loaded.copies, previous, seen);
      const at = text === null ? -1 : text.toLowerCase().indexOf(needle);
      if (text !== null && at !== -1) hits.push({ path: doc.path, snippet: snippetAt(text, at, needle.length) });
      else if (doc.title.toLowerCase().includes(needle)) hits.push({ path: doc.path, snippet: doc.title });
    }
    // Only the documents of this catalog stay cached: a removed or renamed document leaves the cache with it.
    searchTexts.set(root, seen);
    const body: WorkspaceRouteResponses["librarySearch"] = { query, hits };
    return json(req, 200, body);
  };

  // One image below specs/, through the evidence file route's resolver and answer (header).
  const libraryAsset = (req: Request, slug: string, search: string): Promise<Response> | Response => {
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
    if (workspaceRoute?.route === "library") return library(req, workspaceRoute.params.ws);
    if (workspaceRoute?.route === "libraryDoc") return libraryDoc(req, workspaceRoute.params.ws, url.search);
    if (workspaceRoute?.route === "librarySearch") return librarySearch(req, workspaceRoute.params.ws, url.searchParams.get("q") ?? "");
    if (workspaceRoute?.route === "libraryAsset") return libraryAsset(req, workspaceRoute.params.ws, url.search);
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
