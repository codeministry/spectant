// The spec routes contract (T44, ISC-78): builders and matcher agree, the table holds every route once, the 200 body
// types accept the golden snapshots the stub will serve, the error spelling is one convention across the API, and the
// module stays importable by the browser bundle.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { listEvidence } from "../core/src/evidence.ts";
import type {
  CardState,
  ClaimGlyphState,
  ClaimKind,
  ClaimView,
  ClaimViewCounts,
  ClaimViewModel,
  DocsPage,
  EvidenceFile,
  EvidenceListing,
  Frame,
  FrameCard,
  FrameKind,
  GateView,
  KeyNumbers,
  SpecHead,
  SpecNextStep,
  SpecPageModel,
  TaskRow,
  TaskStatus,
  TasksTab,
  TimelineEntry,
  TimelineKind,
} from "../core/src/files.ts";
import { DOC_FILES } from "../core/src/files.ts";
import { REVIEWED_FILES, hashForGate } from "../core/src/gates.ts";
import { docsFor } from "../core/src/markdown-docs.ts";
import type { DashboardIdea, DashboardIdeas, DashboardModel } from "../core/src/dashboard.ts";
import type { PlanningModel } from "../core/src/planning.ts";
import type { EventLine, IdeaRef, TechModel, TransitionPlan, WorkflowStage } from "../core/src/files.ts";
import { WORKSPACES_PATH, type WorkspaceSummary, dashboardApi } from "../server/src/api.ts";
import type { ActorRow } from "../server/src/db.ts";
import {
  ACTORS_ALLOW,
  ACTORS_PATH,
  ACTORS_STATUSES,
  type ActorMapping,
  type ActorsError,
  type ActorsRequest,
  type ActorsResponse,
  type AllocateRefused,
  type AllocateRequest,
  BOARD_QUERY_MAX,
  type BoardQuery,
  type Conflict,
  type IdeaAllocated,
  type IdeaPage,
  type InvalidBody,
  type Locked,
  REFUSAL_ERRORS,
  SPEC_HASH_HEADER,
  TASKS_HASH_HEADER,
  type TransitionRefused,
  type TransitionRequest,
  type TransitionWritten,
  isActorMapping,
  isActorMappings,
  isAllocateRequest,
  isBoardQuery,
  isTransitionRequest,
  API_ERRORS,
  DOC_NAMES,
  type Forbidden,
  GOLDEN_FAMILY,
  JSON_ANSWER,
  type MethodNotAllowed,
  type NotFound,
  SPEC_API_ROOT,
  SPEC_ROUTE_TABLE,
  type SpecRouteError,
  type SpecRouteName,
  type SpecRouteResponses,
  type Unavailable,
  type UnreadableCode,
  WORKSPACE_ROUTE_TABLE,
  type WorkspaceRouteError,
  type WorkspaceRouteName,
  type WorkspaceRouteRequests,
  type WorkspaceRouteResponses,
  allowFor,
  allowForWorkspace,
  evidenceFileHeaders,
  evidencePathQuery,
  formatReviewedHashes,
  isGateReviewedRequest,
  isTaskCheckRequest,
  isUnavailable,
  matchSpecPath,
  matchSpecRoute,
  matchWorkspacePath,
  parseReviewedHashes,
  specRoutes,
  workspaceRoutes,
  REVIEWED_HASH_FILES,
} from "../server/src/spec-routes.contract.ts";
import type { UnreadableCode as LoaderUnreadableCode } from "../server/src/workspace-loader.ts";

const ROOT = resolve(import.meta.dir, "..");
const FIXTURES = join(ROOT, "core", "fixtures");
const CONTRACT = join(ROOT, "server", "src", "spec-routes.contract.ts");

// ─── type-level helpers ──────────────────────────────────────────────────────────────────────────────────────────

/** True exactly when A and B are the same type (the usual deferred-conditional idiom). */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the idiom needs a free T on each side
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type OptionalKeys<T> = { [K in keyof T]-?: Pick<T, K> extends Required<Pick<T, K>> ? never : K }[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;
/** Exactly the keys of `T`, each marked required or optional as `T` declares it; the compiler rejects any other list. */
type KeySpec<T> = Record<RequiredKeys<T>, "req"> & Record<OptionalKeys<T>, "opt">;

const keysOf = <T>(spec: KeySpec<T>): Record<string, "req" | "opt"> => spec;

/** Problems of one JSON value against a key spec: an unknown key, or a required key missing. */
function shapeProblems(label: string, value: unknown, spec: Record<string, "req" | "opt">): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${label}: not an object`];
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !(key in spec)).map((key) => `${label}: unknown key ${key}`);
  const missing = Object.entries(spec)
    .filter(([key, need]) => need === "req" && !(key in record))
    .map(([key]) => `${label}: missing ${key}`);
  return [...unknown, ...missing];
}

// Compile-time pins: a drift here fails `tsc --noEmit` (check:static) before any test runs.
const unreadablePinned: Equal<UnreadableCode, LoaderUnreadableCode> = true;
const unavailableIsSummary = (body: Unavailable): WorkspaceSummary => body;
const responsesCoverRoutes: Equal<keyof SpecRouteResponses, SpecRouteName> = true;

test("compile-time pins: UnreadableCode is the loader's, Unavailable is a WorkspaceSummary, every route has a 200 type", () => {
  expect([unreadablePinned, responsesCoverRoutes, typeof unavailableIsSummary]).toEqual([true, true, "function"]);
});

// ─── builders and matcher ────────────────────────────────────────────────────────────────────────────────────────

/** Awkward refs: a space, a slash, a percent sign, a literal `%41`, non-ASCII. */
const WS = ["harbor", "my repo", "a/b", "100%", "x%41", "häfen"];
const IDS = ["002", "002-web-console", "web-console", "a b/c%"];

const built: Record<SpecRouteName, (ws: string, id: string) => string> = {
  spec: specRoutes.spec,
  timeline: specRoutes.timeline,
  claims: specRoutes.claims,
  tasks: specRoutes.tasks,
  evidence: specRoutes.evidence,
  evidenceFile: (ws, id) => specRoutes.evidenceFile(ws, id, "artifacts/T12 model.md"),
  docs: (ws, id) => specRoutes.docs(ws, id, "decisions"),
  frames: specRoutes.frames,
  live: specRoutes.live,
  gateReviewed: specRoutes.gateReviewed,
  taskCheck: (ws, id) => specRoutes.taskCheck(ws, id, "T12"),
  transition: specRoutes.transition,
};

function methodOf(route: SpecRouteName): string {
  return SPEC_ROUTE_TABLE.find((entry) => entry.route === route)?.method ?? "";
}

describe("builders and matcher", () => {
  test("every builder round-trips through matchSpecRoute, params decoded exactly once", () => {
    for (const route of Object.keys(built) as SpecRouteName[]) {
      for (const ws of WS) {
        for (const id of IDS) {
          const url = new URL(built[route](ws, id), "http://127.0.0.1:7717");
          const match = matchSpecRoute(url.pathname, methodOf(route));
          expect({ route, ws, id, got: match?.route }).toEqual({ route, ws, id, got: route });
          expect(match?.params.ws).toBe(ws);
          expect(match?.params.id).toBe(id);
          if (match?.route === "docs") expect(match.params.name).toBe("decisions");
          if (match?.route === "taskCheck") expect(match.params.tid).toBe("T12");
        }
      }
    }
  });

  test("the paths are the plan's", () => {
    expect(SPEC_API_ROOT).toBe(WORKSPACES_PATH);
    expect(specRoutes.spec("harbor", "002")).toBe("/api/workspaces/harbor/specs/002");
    expect(specRoutes.timeline("harbor", "002")).toBe("/api/workspaces/harbor/specs/002/timeline");
    expect(specRoutes.docs("harbor", "002", "plan")).toBe("/api/workspaces/harbor/specs/002/docs/plan");
    expect(specRoutes.gateReviewed("harbor", "002")).toBe("/api/workspaces/harbor/specs/002/gate/reviewed");
    expect(specRoutes.taskCheck("harbor", "002", "T7")).toBe("/api/workspaces/harbor/specs/002/tasks/T7/check");
    expect(specRoutes.evidenceFile("harbor", "002", "artifacts/a b.md")).toBe(
      "/api/workspaces/harbor/specs/002/evidence/file?path=artifacts%2Fa%20b.md",
    );
  });

  test("a percent-encoded param decodes once, a malformed one is no match", () => {
    expect(matchSpecPath("/api/workspaces/a%2541/specs/002")?.params).toEqual({ ws: "a%41", id: "002" });
    expect(matchSpecPath("/api/workspaces/harbor/specs/%30%30%32/claims")?.params).toEqual({ ws: "harbor", id: "002" });
    expect(matchSpecPath("/api/workspaces/harbor/specs/%E0%A4%A/claims")).toBeNull();
  });

  test("unknown paths, empty segments and unknown doc names are null", () => {
    for (const path of [
      "/api/workspaces",
      "/api/workspaces/harbor",
      "/api/workspaces/harbor/dashboard",
      "/api/workspaces/harbor/specs",
      "/api/workspaces/harbor/specs/",
      "/api/workspaces/harbor/specs/002/",
      "/api/workspaces//specs/002",
      "/api/workspaces/harbor/specs/002/unknown",
      "/api/workspaces/harbor/specs/002/docs",
      "/api/workspaces/harbor/specs/002/docs/spec",
      "/api/workspaces/harbor/specs/002/docs/context",
      "/api/workspaces/harbor/specs/002/evidence/file/x",
      "/api/workspaces/harbor/specs/002/tasks/T1",
      "/api/workspaces/harbor/specs/002/gate",
      "/api/workspaces/harbor/specs/002/gate/code-reviewed",
      "/api/workspacesx/harbor/specs/002",
      "/api/lifeos",
    ]) {
      expect({ path, match: matchSpecPath(path) }).toEqual({ path, match: null });
    }
  });

  test("methods: GET routes answer GET and HEAD, the writes POST only; the path still matches for a 405", () => {
    const read = specRoutes.claims("harbor", "002");
    const write = specRoutes.gateReviewed("harbor", "002");
    expect(matchSpecRoute(read, "GET")?.route).toBe("claims");
    expect(matchSpecRoute(read, "HEAD")?.route).toBe("claims");
    expect(matchSpecRoute(read, "POST")).toBeNull();
    expect(matchSpecRoute(write, "POST")?.route).toBe("gateReviewed");
    expect(matchSpecRoute(write, "GET")).toBeNull();
    expect(matchSpecPath(write)?.route).toBe("gateReviewed");
    expect(allowFor("claims")).toBe("GET, HEAD");
    expect(allowFor("taskCheck")).toBe("POST");
  });

  test("the docs names are the Docs tabs of core: DOC_FILES and docsFor", () => {
    expect(DOC_NAMES.map(String).sort()).toEqual(Object.keys(DOC_FILES).sort());
    expect(DOC_NAMES.map(String).sort()).toEqual(Object.keys(docsFor("feature")).sort());
    for (const name of DOC_NAMES) expect(matchSpecPath(specRoutes.docs("w", "001", name))?.route).toBe("docs");
  });

  test("the table lists every builder exactly once, with a pattern its builder matches", () => {
    const routes = SPEC_ROUTE_TABLE.map((entry): string => entry.route);
    expect(routes.length).toBe(new Set(routes).size);
    expect([...routes].sort()).toEqual(Object.keys(specRoutes).sort());
    for (const entry of SPEC_ROUTE_TABLE) {
      expect(entry.pattern.startsWith(`${SPEC_API_ROOT}/:ws/specs/:id`)).toBe(true);
      expect(entry.statuses).toEqual([...entry.statuses].sort((a, b) => a - b));
      expect(entry.statuses).toContain(200);
      expect(entry.statuses).toContain(404);
      if (entry.method === "POST") for (const status of [400, 409, 423]) expect(entry.statuses).toContain(status);
    }
  });

  test("the transition is registered (T83): POST only, the refusable write's statuses, no longer a pending path", () => {
    const entry = SPEC_ROUTE_TABLE.find((e) => e.route === "transition");
    expect(entry).toEqual({
      route: "transition",
      method: "POST",
      pattern: `${SPEC_API_ROOT}/:ws/specs/:id/transition`,
      statuses: [200, 400, 403, 404, 405, 409, 422, 423],
      response: "TransitionWritten",
    });
    expect(allowFor("transition")).toBe("POST");
    expect(matchSpecRoute(specRoutes.transition("harbor", "002"), "GET")).toBeNull();
  });

  test("the evidence path travels raw and core decodes it once", () => {
    for (const path of ["artifacts/T12-dashboard-model.md", ".evidence/a b+c%41.log", "artifacts/ü/ö.png"]) {
      const url = new URL(specRoutes.evidenceFile("harbor", "002", path), "http://127.0.0.1");
      const raw = evidencePathQuery(url.search);
      expect(decodeURIComponent(raw)).toBe(path);
    }
    expect(evidencePathQuery("?x=1&path=artifacts%252e%252e")).toBe("artifacts%252e%252e");
    expect(evidencePathQuery("?x=1")).toBe("");
    expect(evidencePathQuery("")).toBe("");
  });
});

// ─── workspace routes (spec 003) ─────────────────────────────────────────────────────────────────────────────────

// Compile-time pins: the planning answer is core's PlanningModel, never a re-typed copy, the story answer reuses core's
// IdeaRef and DocsPage, and every workspace route has a 200 type and the read error union. Every one but `idea` has a
// golden family; the story family arrives with the e2e stub's story route (spec 008 T119).
const planningIsCore: Equal<WorkspaceRouteResponses["planning"], PlanningModel> = true;
const ideaIsCore: Equal<WorkspaceRouteResponses["idea"], IdeaPage> = true;
const ideaPartsAreCore: Equal<[IdeaPage["idea"], IdeaPage["page"]], [IdeaRef, DocsPage]> = true;
const workspaceResponsesCoverRoutes: Equal<keyof WorkspaceRouteResponses, WorkspaceRouteName> = true;
const workspaceErrors: Equal<WorkspaceRouteError,NotFound | Forbidden | MethodNotAllowed | Unavailable> = true;
// The board query (T92) reads the database alone: no 409, and its PUT adds 400.
const boardQueryErrors: Equal<WorkspaceRouteError<"boardQuery">, NotFound | Forbidden | MethodNotAllowed | InvalidBody> = true;
const boardQueryBodies: Equal<[WorkspaceRouteResponses["boardQuery"], WorkspaceRouteRequests["boardQuery"]], [BoardQuery, BoardQuery]> = true;
const workspaceFamilies: Equal<Extract<keyof typeof GOLDEN_FAMILY, WorkspaceRouteName>, Exclude<WorkspaceRouteName, "idea" | "boardQuery" | "allocate" | "tech" | "techAsset">> = true;
// The allocation (T87) is the family's one write: the read errors plus its write answers.
const allocateErrors: Equal<
  WorkspaceRouteError<"allocate">,
  NotFound | Forbidden | MethodNotAllowed | Unavailable | InvalidBody | Conflict<{ readonly idea: string }> | AllocateRefused | Locked
> = true;
const allocateIsCore: Equal<WorkspaceRouteResponses["allocate"], IdeaAllocated> = true;
// The tech page (spec 023, ISC-134.1): core's TechModel as it is; its asset answers bytes like the evidence file.
const techIsCore: Equal<[WorkspaceRouteResponses["tech"], WorkspaceRouteResponses["techAsset"]], [TechModel, Blob]> = true;
const techErrors: Equal<[WorkspaceRouteError<"tech">, WorkspaceRouteError<"techAsset">], [WorkspaceRouteError, WorkspaceRouteError]> = true;

/** One call per workspace builder, with a story slug where the route takes one. */
const WORKSPACE_ARGS: Record<WorkspaceRouteName, (ws: string) => string> = {
  planning: (ws) => workspaceRoutes.planning(ws),
  idea: (ws) => workspaceRoutes.idea(ws, "console-audit-log"),
  boardQuery: (ws) => workspaceRoutes.boardQuery(ws),
  allocate: (ws) => workspaceRoutes.allocate(ws, "console-audit-log"),
  tech: (ws) => workspaceRoutes.tech(ws),
  techAsset: (ws) => workspaceRoutes.techAsset(ws, ".tech/architecture.png"),
};

describe("workspace routes (spec 003, 008): planning and the story page beside the spec routes", () => {
  test("compile-time pins: PlanningModel and IdeaPage's parts are core's, every route has a 200 type and an error union", () => {
    expect([planningIsCore, ideaIsCore, ideaPartsAreCore, workspaceResponsesCoverRoutes, workspaceErrors, boardQueryErrors, boardQueryBodies, workspaceFamilies, allocateErrors, allocateIsCore, techIsCore, techErrors]).toEqual([
      true, true, true, true, true, true, true, true, true, true, true, true,
    ]);
  });

  test("the paths are the plans': /api/workspaces/:ws/planning and /api/workspaces/:ws/ideas/:slug, each segment encoded once", () => {
    expect(workspaceRoutes.planning("harbor")).toBe("/api/workspaces/harbor/planning");
    expect(workspaceRoutes.planning("my repo")).toBe("/api/workspaces/my%20repo/planning");
    expect(workspaceRoutes.planning("a/b")).toBe("/api/workspaces/a%2Fb/planning");
    expect(workspaceRoutes.idea("harbor", "tide-tables")).toBe("/api/workspaces/harbor/ideas/tide-tables");
    expect(workspaceRoutes.idea("my repo", "a/b")).toBe("/api/workspaces/my%20repo/ideas/a%2Fb");
    expect(workspaceRoutes.boardQuery("häfen")).toBe("/api/workspaces/h%C3%A4fen/board-query");
    expect(workspaceRoutes.allocate("my repo", "a/b")).toBe("/api/workspaces/my%20repo/ideas/a%2Fb/allocate");
    expect(workspaceRoutes.tech("harbor")).toBe("/api/workspaces/harbor/tech");
    expect(workspaceRoutes.tech("my repo")).toBe("/api/workspaces/my%20repo/tech");
    expect(workspaceRoutes.techAsset("harbor", ".tech/a b.png")).toBe("/api/workspaces/harbor/tech/asset?path=.tech%2Fa%20b.png");
  });

  test("every builder round-trips through matchWorkspacePath, each param decoded exactly once", () => {
    for (const ws of WS) {
      const url = new URL(workspaceRoutes.planning(ws), "http://127.0.0.1:7717");
      expect({ ws, match: matchWorkspacePath(url.pathname) }).toEqual({ ws, match: { route: "planning", params: { ws } } });
      for (const slug of WS) {
        const story = new URL(workspaceRoutes.idea(ws, slug), "http://127.0.0.1:7717");
        expect({ ws, slug, match: matchWorkspacePath(story.pathname) }).toEqual({ ws, slug, match: { route: "idea", params: { ws, slug } } });
        const allocate = new URL(workspaceRoutes.allocate(ws, slug), "http://127.0.0.1:7717");
        expect({ ws, slug, match: matchWorkspacePath(allocate.pathname) }).toEqual({ ws, slug, match: { route: "allocate", params: { ws, slug } } });
      }
      const board = new URL(workspaceRoutes.boardQuery(ws), "http://127.0.0.1:7717");
      expect({ ws, match: matchWorkspacePath(board.pathname) }).toEqual({ ws, match: { route: "boardQuery", params: { ws } } });
      const tech = new URL(workspaceRoutes.tech(ws), "http://127.0.0.1:7717");
      expect({ ws, match: matchWorkspacePath(tech.pathname) }).toEqual({ ws, match: { route: "tech", params: { ws } } });
      for (const path of [".tech/architecture.png", "a b+c%41.svg", "ü/ö.png"]) {
        const asset = new URL(workspaceRoutes.techAsset(ws, path), "http://127.0.0.1:7717");
        expect({ ws, path, match: matchWorkspacePath(asset.pathname) }).toEqual({ ws, path, match: { route: "techAsset", params: { ws } } });
        expect(decodeURIComponent(evidencePathQuery(asset.search))).toBe(path);
      }
    }
    expect(matchWorkspacePath("/api/workspaces/a%2541/planning")?.params).toEqual({ ws: "a%41" });
    expect(matchWorkspacePath("/api/workspaces/%E0%A4%A/planning")).toBeNull();
    expect(matchWorkspacePath("/api/workspaces/harbor/ideas/x%2541")?.params).toEqual({ ws: "harbor", slug: "x%41" });
    expect(matchWorkspacePath("/api/workspaces/harbor/ideas/%E0%A4%A")).toBeNull();
  });

  test("anything else is null: extra or missing segments, the dashboard route, every spec route", () => {
    for (const path of [
      "/api/workspaces",
      "/api/workspaces/harbor",
      "/api/workspaces//planning",
      "/api/workspaces/harbor/planning/",
      "/api/workspaces/harbor/planning/extra",
      "/api/workspaces/harbor/ideas",
      "/api/workspaces/harbor/ideas/",
      "/api/workspaces//board-query",
      "/api/workspaces/harbor/board-query/",
      "/api/workspaces/harbor/ideas/x/allocate/",
      "/api/workspaces/harbor/ideas/x/allocate/more",
      "/api/workspaces/harbor/ideas//allocate",
      "/api/workspaces//tech",
      "/api/workspaces/harbor/tech/",
      "/api/workspaces/harbor/tech/asset/",
      "/api/workspaces/harbor/tech/other",
      "/api/workspaces/harbor/dashboard",
      "/api/workspacesx/harbor/planning",
      "/api/lifeos",
    ]) {
      expect({ path, match: matchWorkspacePath(path) }).toEqual({ path, match: null });
    }
    for (const route of Object.keys(built) as SpecRouteName[]) {
      const path = new URL(built[route]("harbor", "002"), "http://127.0.0.1").pathname;
      expect({ route, match: matchWorkspacePath(path) }).toEqual({ route, match: null });
    }
    expect(matchSpecPath(workspaceRoutes.planning("harbor"))).toBeNull();
    expect(matchSpecPath(workspaceRoutes.idea("harbor", "x"))).toBeNull();
  });

  test("the table lists every workspace builder exactly once: the reads GET with the read statuses (the board query its own PUT), allocate POST as a refusable write", () => {
    const routes = WORKSPACE_ROUTE_TABLE.map((entry): string => entry.route);
    expect(routes.length).toBe(new Set(routes).size);
    expect([...routes].sort()).toEqual(Object.keys(workspaceRoutes).sort());
    const read = SPEC_ROUTE_TABLE.find((entry) => entry.route === "spec")?.statuses;
    const write = SPEC_ROUTE_TABLE.find((entry) => entry.route === "transition")?.statuses;
    for (const entry of WORKSPACE_ROUTE_TABLE) {
      expect(entry.method).toBe(entry.route === "allocate" ? "POST" : "GET");
      if (entry.method === "GET") expect(entry.request === undefined).toBe(entry.write === undefined);
      expect(entry.statuses).toEqual(
        entry.route === "allocate" ? (write ?? []) : entry.write === undefined ? (read ?? []) : [200, 304, 400, 403, 404, 405],
      );
      expect(matchWorkspacePath(new URL(WORKSPACE_ARGS[entry.route]("harbor"), "http://127.0.0.1").pathname)?.route).toBe(entry.route);
    }
    expect(WORKSPACE_ROUTE_TABLE.map((entry) => [entry.route, entry.method, entry.pattern, entry.write ?? null, entry.request ?? null, entry.response])).toEqual([
      ["planning", "GET", `${SPEC_API_ROOT}/:ws/planning`, null, null, "PlanningModel"],
      ["idea", "GET", `${SPEC_API_ROOT}/:ws/ideas/:slug`, null, null, "IdeaPage"],
      ["boardQuery", "GET", `${SPEC_API_ROOT}/:ws/board-query`, "PUT", "BoardQuery", "BoardQuery"],
      ["allocate", "POST", `${SPEC_API_ROOT}/:ws/ideas/:slug/allocate`, null, "AllocateRequest", "IdeaAllocated"],
      ["tech", "GET", `${SPEC_API_ROOT}/:ws/tech`, null, null, "TechModel"],
      ["techAsset", "GET", `${SPEC_API_ROOT}/:ws/tech/asset`, null, null, "file bytes"],
    ]);
  });

  test("allowForWorkspace: the reads answer GET and HEAD, the board query PUT too, the allocation POST", () => {
    expect(allowForWorkspace("planning")).toBe("GET, HEAD");
    expect(allowForWorkspace("idea")).toBe("GET, HEAD");
    expect(allowForWorkspace("boardQuery")).toBe("GET, HEAD, PUT");
    expect(allowForWorkspace("allocate")).toBe("POST");
    expect(allowForWorkspace("tech")).toBe("GET, HEAD");
    expect(allowForWorkspace("techAsset")).toBe("GET, HEAD");
  });

  test("IdeaPage's key list (no golden family yet)", () => {
    expect(Object.keys(keysOf<IdeaPage>({ idea: "req", page: "req", hash: "req" }))).toEqual(["idea", "page", "hash"]);
  });

  test("GOLDEN_FAMILY.planning names core/fixtures/<tree>.planning.golden.json, whose whole body is a PlanningModel", () => {
    expect(GOLDEN_FAMILY.planning).toBe("planning");
    const value = golden(GOLDEN_FAMILY.planning) as unknown as WorkspaceRouteResponses["planning"];
    const spec = keysOf<PlanningModel>({
      workflow: "req",
      stages: "req",
      stageCounts: "req",
      features: "req",
      milestones: "req",
      ideas: "req",
      recount: "req",
      diagnostics: "req",
    });
    expect(shapeProblems("planning", value, spec)).toEqual([]);
    expect(value.features.length).toBeGreaterThan(0);
  });
});

// ─── spec 008 bodies (spec 008, T81) ─────────────────────────────────────────────────────────────────────────────

// Compile-time pins: no golden family exists for these bodies, so the shapes are pinned against core's types and the
// key lists below. Each answer reuses core (`EventLine`, `TransitionPlan`) and never re-types it. Every route landed
// (T83, T87, T88, T91, T92), so there is no pending family any more.
type RefusedPlan = Extract<TransitionPlan, { readonly ok: false }>;
type WrittenPlan = Extract<TransitionPlan, { readonly ok: true }>;
const refusalIsThePlans: Equal<Pick<TransitionRefused, "reason" | "command">, Pick<RefusedPlan, "reason" | "command">> = true;
const writtenStagesArePlans: Equal<Pick<TransitionWritten, "from" | "to">, Pick<WrittenPlan, "from" | "to">> = true;
const writtenEventIsCore: Equal<TransitionWritten["event"], EventLine> = true;
const toIsAWorkflowStage: Equal<TransitionRequest["to"], WorkflowStage> = true;
const actorIsTheRow: Equal<ActorMapping, Omit<ActorRow, "updatedAt">> = true;
const transitionErrors: Equal<
  SpecRouteError<"transition">,
  NotFound | Forbidden | MethodNotAllowed | Unavailable | InvalidBody | Conflict<{ readonly spec: string }> | TransitionRefused | Locked
> = true;
const actorsErrors: Equal<ActorsError, Forbidden | MethodNotAllowed | InvalidBody> = true;
const actorsAnswer: Equal<ActorsResponse, readonly ActorMapping[]> = true;
const actorsBody: Equal<ActorsRequest, readonly ActorMapping[]> = true;

/** The key lists of the spec 008 bodies; `keysOf` rejects any list that is not exactly the type's keys. */
const BODY_KEYS = {
  TransitionRequest: keysOf<TransitionRequest>({ to: "req", hash: "req" }),
  TransitionWritten: keysOf<TransitionWritten>({ from: "req", to: "req", hash: "req", event: "req", lockSource: "req" }),
  TransitionRefused: keysOf<TransitionRefused>({ error: "req", reason: "req", command: "req" }),
  AllocateRequest: keysOf<AllocateRequest>({ hash: "req" }),
  IdeaAllocated: keysOf<IdeaAllocated>({ id: "req", folder: "req", files: "req", removed: "req", lockSource: "req" }),
  AllocateRefused: keysOf<AllocateRefused>({ error: "req", reason: "req", folder: "req" }),
  ActorMapping: keysOf<ActorMapping>({ id: "req", displayName: "req", gitIdentities: "req" }),
  BoardQuery: keysOf<BoardQuery>({ query: "req" }),
};

const HEX64_SAMPLE = hashForGate("spec.md", "# a\n");

describe("spec 008 bodies (T81): the shared shapes of the writes and resources", () => {
  test("compile-time pins: answers are core's types, errors per route, requests per writing route, names apart", () => {
    expect([
      refusalIsThePlans, writtenStagesArePlans, writtenEventIsCore, toIsAWorkflowStage, actorIsTheRow, transitionErrors,
      actorsErrors, actorsAnswer, actorsBody,
    ].every(Boolean)).toBe(true);
  });

  test("the paths are the plan's, each segment percent-encoded once", () => {
    expect(specRoutes.transition("harbor", "002")).toBe("/api/workspaces/harbor/specs/002/transition");
    expect(ACTORS_PATH).toBe("/api/actors");
    expect(ACTORS_ALLOW).toBe("GET, HEAD, PUT");
    expect([...ACTORS_STATUSES]).toEqual([200, 304, 400, 403, 405]);
  });




  test("the body key lists (no golden family for them)", () => {
    expect(Object.fromEntries(Object.entries(BODY_KEYS).map(([name, spec]) => [name, Object.keys(spec)]))).toEqual({
      TransitionRequest: ["to", "hash"],
      TransitionWritten: ["from", "to", "hash", "event", "lockSource"],
      TransitionRefused: ["error", "reason", "command"],
      AllocateRequest: ["hash"],
      IdeaAllocated: ["id", "folder", "files", "removed", "lockSource"],
      AllocateRefused: ["error", "reason", "folder"],
      ActorMapping: ["id", "displayName", "gitIdentities"],
      BoardQuery: ["query"],
    });
  });

  test("request validators: the transition and allocate hashes are raw sha256 hex, the stage a workflow stage", () => {
    expect(SPEC_HASH_HEADER).toBe("X-Spectant-Spec-Hash");
    expect(SPEC_HASH_HEADER).not.toBe(TASKS_HASH_HEADER);
    for (const to of ["plan", "build", "close-pending", "idea", "done"]) expect(isTransitionRequest({ to, hash: HEX64_SAMPLE })).toBe(true);
    expect(isTransitionRequest({ to: "shipping", hash: HEX64_SAMPLE })).toBe(false);
    expect(isTransitionRequest({ to: "build", hash: HEX64_SAMPLE.toUpperCase() })).toBe(false);
    expect(isTransitionRequest({ to: "build" })).toBe(false);
    expect(isTransitionRequest({ to: "build", hash: HEX64_SAMPLE, extra: 1 })).toBe(false);
    expect(isTransitionRequest(null)).toBe(false);
    expect(isAllocateRequest({ hash: HEX64_SAMPLE })).toBe(true);
    expect(isAllocateRequest({ hash: "short" })).toBe(false);
    expect(isAllocateRequest([HEX64_SAMPLE])).toBe(false);
  });

  test("request validators: an actor mapping and a board query", () => {
    const actor = { id: "u:3f9c0a7d", displayName: "Harbor Master", gitIdentities: ["harbor@example.org"] };
    expect(isActorMapping(actor)).toBe(true);
    expect(isActorMapping({ ...actor, gitIdentities: [] })).toBe(true);
    expect(isActorMapping({ ...actor, displayName: "  " })).toBe(false);
    expect(isActorMapping({ ...actor, id: "" })).toBe(false);
    expect(isActorMapping({ ...actor, gitIdentities: [1] })).toBe(false);
    expect(isActorMapping({ ...actor, updatedAt: "2026-03-01T00:00:00Z" })).toBe(false);
    // PUT /api/actors takes the whole mapping (T91): an array, each entry a mapping, each id once.
    expect(isActorMappings([])).toBe(true);
    expect(isActorMappings([actor, { ...actor, id: "u:0b1c2d3e" }])).toBe(true);
    expect(isActorMappings(actor)).toBe(false);
    expect(isActorMappings([actor, actor])).toBe(false);
    expect(isActorMappings([actor, null])).toBe(false);
    expect(isBoardQuery({ query: "" })).toBe(true);
    expect(isBoardQuery({ query: "feature=F2&group=milestone" })).toBe(true);
    expect(isBoardQuery({ query: "?feature=F2" })).toBe(false);
    expect(isBoardQuery({ query: "x".repeat(BOARD_QUERY_MAX + 1) })).toBe(false);
    expect(isBoardQuery({ query: null })).toBe(false);
  });

  test("the refusal codes are kebab-case and in API_ERRORS", () => {
    expect([...REFUSAL_ERRORS]).toEqual(["transition-refused", "allocate-refused"]);
    for (const code of REFUSAL_ERRORS) {
      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(API_ERRORS as readonly string[]).toContain(code);
    }
  });

});

// ─── golden assignability ────────────────────────────────────────────────────────────────────────────────────────

const golden = (family: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, `harbor.${family}.golden.json`), "utf8")) as Record<string, unknown>;
const SPEC_KEY = "specs/002-web-console";

const TIMELINE_KINDS = { decision: true, round: true, gate: true, commit: true, stage: true, note: true, agent: true, worktree: true } satisfies Record<TimelineKind, true>;
const FRAME_KINDS = { dispatch: true, result: true, live: true } satisfies Record<FrameKind, true>;
const CARD_STATES = {
  waiting: true, dispatched: true, running: true, question: true, concerns: true, fail: true,
  done: true, closed: true, absent: true, operatorOpen: true, operatorDone: true,
} satisfies Record<CardState, true>;
const GLYPHS = { open: true, takeable: true, taken: true, blocked: true, closed: true, dropped: true } satisfies Record<ClaimGlyphState, true>;
const CLAIM_KINDS = { normal: true, anti: true, antecedent: true } satisfies Record<ClaimKind, true>;
const TASK_STATUSES = {
  open: true, dispatched: true, held: true, question: true, concerns: true, fail: true, done: true, closed: true, struck: true,
} satisfies Record<TaskStatus, true>;

const oneOf = (label: string, value: unknown, set: Record<string, true>): string[] =>
  typeof value === "string" && value in set ? [] : [`${label}: ${JSON.stringify(value)} is not a declared value`];

describe("each 200 body type accepts its golden family's value (harbor 002)", () => {
  test("spec → SpecPageModel", () => {
    const value = golden("spec")[SPEC_KEY] as SpecRouteResponses["spec"];
    const gate = keysOf<GateView>({ state: "req", detail: "req", at: "opt", files: "opt" });
    expect([
      ...shapeProblems("spec", value, keysOf<SpecPageModel>({
        head: "req", keyNumbers: "req", ideaQuote: "req", ideaSource: "req", next: "req", lanes: "req",
        gates: "req", warnings: "req", waitingOnYou: "req", areas: "req", tldr: "req",
      })),
      ...shapeProblems("spec.head", value.head, keysOf<SpecHead>({
        id: "req", slug: "req", title: "req", type: "req", stage: "req",
        nextCommand: "req", // single-core: allow — key list of the core type, not a derivation
        nextReason: "req", phase: "req", started: "req", updated: "req", round: "req", lastRound: "req",
        uncommittedFiles: "req",
        // spec 008: optional until their fill-ins (T39, T47, T65) set them.
        priority: "opt", stageSource: "opt", assignee: "opt",
      })),
      ...shapeProblems("spec.keyNumbers", value.keyNumbers, keysOf<KeyNumbers>({
        claims: "req", tasks: "req", rounds: "req", gates: "req", waiting: "req",
      })),
      ...shapeProblems("spec.next", value.next, keysOf<SpecNextStep>({ command: "req", reasons: "req", since: "req", via: "req" })),
      ...Object.entries(value.gates).flatMap(([name, view]) => shapeProblems(`spec.gates.${name}`, view, gate)),
    ]).toEqual([]);
  });

  test("timeline → TimelineEntry[]", () => {
    const value = golden("timeline")[SPEC_KEY] as SpecRouteResponses["timeline"];
    const entry = keysOf<TimelineEntry>({
      ts: "req", kind: "req", derived: "req", title: "req", body: "opt", ref: "opt", id: "opt", actor: "opt",
      goalLock: "opt", from: "opt", to: "opt", command: "opt", undated: "opt", question: "opt", running: "opt",
    });
    expect(Array.isArray(value) && value.length > 0).toBe(true);
    expect(value.flatMap((e, i) => [...shapeProblems(`timeline[${i}]`, e, entry), ...oneOf(`timeline[${i}].kind`, e.kind, TIMELINE_KINDS)])).toEqual([]);
  });

  test("claims → ClaimViewModel", () => {
    const value = golden("claim-view")[SPEC_KEY] as SpecRouteResponses["claims"];
    const claim = keysOf<ClaimView>({
      id: "req", text: "req", feature: "req", state: "req", kind: "req", edges: "req", blockedBy: "req", probe: "req",
      verification: "req", lock: "req", dropped: "req", noteCount: "req", line: "req",
    });
    expect([
      ...shapeProblems("claims", value, keysOf<ClaimViewModel>({ claims: "req", features: "req", fog: "req", counts: "req" })),
      ...shapeProblems("claims.counts", value.counts, keysOf<ClaimViewCounts>({
        all: "req", open: "req", takeable: "req", taken: "req", blocked: "req", closed: "req", dropped: "req",
        normal: "req", anti: "req", antecedent: "req",
      })),
      ...value.claims.flatMap((c, i) => [
        ...shapeProblems(`claims[${i}]`, c, claim),
        ...oneOf(`claims[${i}].state`, c.state, GLYPHS),
        ...oneOf(`claims[${i}].kind`, c.kind, CLAIM_KINDS),
      ]),
    ]).toEqual([]);
    expect(value.claims.length).toBeGreaterThan(0);
  });

  test("tasks → TasksTab | null (null for a spec without tasks.md)", () => {
    const family = golden("tasks");
    expect(family["specs/003-config-loader"]).toBeNull();
    const value = family[SPEC_KEY] as NonNullable<SpecRouteResponses["tasks"]>;
    const row = keysOf<TaskRow>({
      id: "req", claim: "req", flags: "req", lane: "req", state: "req", edges: "req", paths: "req", text: "req",
      line: "req", status: "req", round: "req", builder: "req", reason: "req", note: "req", pathNote: "req",
    });
    expect([
      ...shapeProblems("tasks", value, keysOf<TasksTab>({ tasks: "req", probeMapping: "req", counts: "req", diagnostics: "req" })),
      ...value.tasks.flatMap((t, i) => [...shapeProblems(`tasks[${i}]`, t, row), ...oneOf(`tasks[${i}].status`, t.status, TASK_STATUSES)]),
    ]).toEqual([]);
    expect(value.tasks.length).toBeGreaterThan(0);
  });

  test("docs → DocsPage for every present doc; an absent one is null (the route's 404 DocMissing)", () => {
    const family = golden("docs") as { constitution: unknown; specs: Record<string, Record<string, unknown>> };
    const page = keysOf<DocsPage>({ html: "req", toc: "req", frontmatter: "req", figures: "req", sections: "req", wordCount: "req", decisions: "opt", goalSignal: "opt", constitution: "opt" });
    const perSpec = family.specs[SPEC_KEY] ?? {};
    // The per-spec family holds every DocName but the shared constitution, which sits at the top level.
    expect(Object.keys(perSpec).sort()).toEqual(DOC_NAMES.filter((n) => n !== "constitution").sort());
    const present: Array<[string, unknown]> = [["constitution", family.constitution], ...Object.entries(perSpec).filter(([, v]) => v !== null)];
    expect(present.length).toBeGreaterThan(1);
    expect(present.flatMap(([name, value]) => shapeProblems(`docs.${name}`, value as SpecRouteResponses["docs"], page))).toEqual([]);
  });

  test("frames → Frame[]", () => {
    const value = golden("frames")[SPEC_KEY] as SpecRouteResponses["frames"];
    const frame = keysOf<Frame>({
      index: "req", kind: "req", round: "req", ts: "req", label: "req", worst: "req", cards: "req", progress: "req",
      stop: "opt", closedClaims: "opt", recut: "opt",
    });
    const card = keysOf<FrameCard>({
      task: "req", claim: "req", lane: "req", text: "req", parallel: "req", seam: "req", state: "req", builder: "opt",
      reader: "opt", verdict: "opt", tries: "req", reason: "opt", note: "opt", lock: "opt",
    });
    expect(value.length).toBeGreaterThan(0);
    expect(
      value.flatMap((f, i) => [
        ...shapeProblems(`frames[${i}]`, f, frame),
        ...oneOf(`frames[${i}].kind`, f.kind, FRAME_KINDS),
        ...oneOf(`frames[${i}].worst`, f.worst, CARD_STATES),
        ...f.cards.flatMap((c, j) => [...shapeProblems(`frames[${i}].cards[${j}]`, c, card), ...oneOf(`frames[${i}].cards[${j}].state`, c.state, CARD_STATES)]),
      ]),
    ).toEqual([]);
  });

  test("evidence → EvidenceListing (no golden family yet: core's listing of the same folder)", async () => {
    const value: SpecRouteResponses["evidence"] = await listEvidence(join(FIXTURES, "harbor", "specs", "002-web-console"));
    const file = keysOf<EvidenceFile>({
      group: "req", path: "req", name: "req", bytes: "req", mediaType: "req", task: "req", claim: "req", symlink: "opt", refused: "opt",
    });
    const all = [...value.results, ...value.raw];
    expect(all.length).toBeGreaterThan(0);
    expect([
      ...shapeProblems("evidence", value, keysOf<EvidenceListing>({ results: "req", raw: "req", byClaim: "req", ungrouped: "req", diagnostics: "req" })),
      ...all.flatMap((f, i) => shapeProblems(`evidence[${i}]`, f, file)),
    ]).toEqual([]);
  });
});

// ─── answers, errors, writes ─────────────────────────────────────────────────────────────────────────────────────

const HOST = { Host: "127.0.0.1:7717" };
const workspace = { slug: "harbor", name: "harbor", path: join(FIXTURES, "harbor"), addedAt: "2026-03-01T00:00:00Z", position: 0 };

describe("the dashboard golden (core/fixtures/<tree>.golden.json) is a DashboardModel, its stories included (T70)", () => {
  test("dashboard → DashboardModel, ideas → DashboardIdeas, each story → DashboardIdea", () => {
    const value = JSON.parse(readFileSync(join(FIXTURES, "harbor.golden.json"), "utf8")) as DashboardModel;
    const model = keysOf<DashboardModel>({
      kpis: "req", stageCounts: "req", specs: "req", nextUp: "req", warningGroups: "req", archive: "req", brief: "req",
      services: "req", diagnostics: "req", ideas: "req",
    });
    const idea = keysOf<DashboardIdea>({ feature: "req", milestone: "req", slug: "req", title: "req", priority: "req" });
    expect([
      ...shapeProblems("dashboard", value, model),
      ...shapeProblems("dashboard.ideas", value.ideas, keysOf<DashboardIdeas>({ count: "req", list: "req" })),
      ...value.ideas.list.flatMap((entry, i) => shapeProblems(`dashboard.ideas.list[${i}]`, entry, idea)),
    ]).toEqual([]);
    expect(value.ideas.count).toBe(value.ideas.list.length);
    expect(value.ideas.count).toBe(2);
  });
});

describe("answers and errors are the API's existing convention", () => {
  test("JSON_ANSWER is what api.ts json() sends: content type, no-cache, strong sha256 base64url ETag", async () => {
    const api = dashboardApi({
      registry: { list: () => [workspace], get: (slug) => (slug === workspace.slug ? workspace : undefined) },
      loadWorkspace: () => Promise.resolve({ readable: false, error: "missing" }),
    });
    const url = new URL(`http://127.0.0.1:7717${WORKSPACES_PATH}`);
    const res = await api(new Request(url.href, { headers: HOST }), url);
    if (res === null) throw new Error("dashboardApi declined its own route");
    const body = await res.text();
    expect(res.headers.get("content-type")).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get("cache-control")).toBe(JSON_ANSWER.cacheControl);
    expect(res.headers.get("etag")).toBe(`"${new Bun.CryptoHasher("sha256").update(body).digest("base64url")}"`);

    const unknownUrl = new URL(`http://127.0.0.1:7717${WORKSPACES_PATH}/nope/dashboard`);
    const unknown = await api(new Request(unknownUrl.href, { headers: HOST }), unknownUrl);
    expect(unknown?.status).toBe(404);
    expect(await unknown?.json()).toEqual({ error: API_ERRORS[0] });

    const goneUrl = new URL(`http://127.0.0.1:7717${WORKSPACES_PATH}/harbor/dashboard`);
    const gone = await api(new Request(goneUrl.href, { headers: HOST }), goneUrl);
    expect(gone?.status).toBe(409);
    const unavailable: unknown = await gone?.json();
    expect(isUnavailable(unavailable)).toBe(true);
    expect(shapeProblems("409", unavailable, keysOf<Unavailable>({
      slug: "req", name: "req", pathTail: "req", readable: "req", error: "req", counts: "req",
    }))).toEqual([]);
  });

  test("every literal error code in api.ts and settings.ts is one of API_ERRORS or an unreadable code", () => {
    const unreadable = { missing: true, "not-a-directory": true, "permission-denied": true, unreadable: true } satisfies Record<UnreadableCode, true>;
    const known = new Set<string>([...API_ERRORS, ...Object.keys(unreadable)]);
    const found = ["api.ts", "settings.ts"].flatMap((file) =>
      [...readFileSync(join(ROOT, "server", "src", file), "utf8").matchAll(/\berror:\s*"([^"]+)"/g)].map((m) => m[1] ?? ""),
    );
    expect(found.length).toBeGreaterThan(3);
    expect(found.filter((code) => !known.has(code))).toEqual([]);
  });

  test("reviewed hash files are core's REVIEWED_FILES; the header round-trips; request bodies are validated", () => {
    expect(Object.values(REVIEWED_HASH_FILES)).toEqual([...REVIEWED_FILES]);
    const hashes = { spec: hashForGate("spec.md", "# a\n"), plan: hashForGate("plan.md", "# b\n"), tasks: null };
    const header = formatReviewedHashes(hashes);
    expect(header).toBe(`spec=${hashes.spec}, plan=${hashes.plan}, tasks=-`);
    expect(parseReviewedHashes(header)).toEqual(hashes);
    expect(parseReviewedHashes(null)).toBeNull();
    expect(parseReviewedHashes(`spec=${hashes.spec}, plan=-`)).toBeNull();
    expect(parseReviewedHashes(`spec=xyz, plan=-, tasks=-`)).toBeNull();
    expect(parseReviewedHashes(`spec=-, plan=-, tasks=-, extra=-`)).toBeNull();

    expect(isGateReviewedRequest({ hashes })).toBe(true);
    expect(isGateReviewedRequest({ hashes: { ...hashes, extra: null } })).toBe(false);
    expect(isGateReviewedRequest({ hashes: { spec: hashes.spec, plan: hashes.plan } })).toBe(false);
    expect(isGateReviewedRequest({ hashes: { ...hashes, spec: "ABC" } })).toBe(false);
    expect(isGateReviewedRequest(null)).toBe(false);
    expect(isTaskCheckRequest({ checked: true, hash: hashes.spec })).toBe(true);
    expect(isTaskCheckRequest({ checked: "yes", hash: hashes.spec })).toBe(false);
    expect(isTaskCheckRequest({ checked: false, hash: "short" })).toBe(false);
  });

  test("evidence file headers: charset for text, inline for images, markdown, text and JSON, attachment for HTML", () => {
    expect(evidenceFileHeaders("text/markdown")).toMatchObject({ "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": "inline" });
    expect(evidenceFileHeaders("application/json")).toMatchObject({ "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "inline" });
    expect(evidenceFileHeaders("image/png")).toMatchObject({ "Content-Type": "image/png", "Content-Disposition": "inline" });
    expect(evidenceFileHeaders("text/html")).toMatchObject({ "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "attachment" });
    expect(evidenceFileHeaders("application/octet-stream")).toMatchObject({ "Content-Disposition": "attachment" });
    for (const type of ["text/plain", "image/webp", "text/html"]) {
      expect(evidenceFileHeaders(type)["X-Content-Type-Options"]).toBe("nosniff");
    }
  });
});

// ─── browser safety ──────────────────────────────────────────────────────────────────────────────────────────────

describe("the contract is browser-safe", () => {
  /** Every module the contract reaches through its relative value imports; `import type` is erased from a bundle. */
  function reach(file: string, seen = new Set<string>()): Set<string> {
    if (seen.has(file)) return seen;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"](\.[^'"]+)['"]/gm)) {
      reach(resolve(dirname(file), m[1] ?? ""), seen);
    }
    return seen;
  }

  test("no module reached from the contract imports Bun or Node, or touches Bun.* or process.*", () => {
    const files = [...reach(CONTRACT)];
    expect(files.length).toBe(3);
    const offending = files.filter((file) => {
      // Code only: assets.contract.ts documents `Bun.file()` for its consumers in comments.
      const source = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      return /\bBun\.|\bprocess\.|\brequire\(|(?:from|import)\s*\(?\s*['"](?:node:|bun|fs|path|os|child_process)/.test(source);
    });
    expect(offending).toEqual([]);
  });
});
