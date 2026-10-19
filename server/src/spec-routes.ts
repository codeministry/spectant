/**
 * The spec routes (T45, ISC-71; plan 002 § Interfaces "HTTP"): every read route of `spec-routes.contract.ts`, answered
 * from the files of a registered workspace on each request. Nothing is cached; the ETag keeps an unchanged answer to
 * a 304.
 *
 * Per request: the loopback guard (403), the method (405 with `Allow: allowFor(route)`), the workspace by slug (404
 * unknown, 409 `Unavailable` when its directory cannot be read, the dashboard's body), the spec by
 * `resolveWorkspaceSpec` (core's `resolveSpec`, then the specs only a spec worktree carries, spec 039 ISC-208.1; the id
 * `NNN`, the folder name or the bare slug; no match or an ambiguous one is a 404, never another spec), and a folder
 * without `spec.md` is no spec (404). Then one `core/` call per route (every parse is core's, ISC-5):
 *
 * | route | answer |
 * |-------|--------|
 * | spec | `buildSpecPage` over the dashboard's own reading (`readWorkspaceInput`), so page and row agree (ISC-72), the head's `state` the spec's item (spec 040), `guidance` that spec's slice of the workspace guidance from the same items (spec 020); headers `X-Spectant-Reviewed-Hashes` and `X-Spectant-Spec-Hash` (raw sha256 of spec.md) |
 * | timeline | `buildTimeline({files, commits, worktree})`, commits from `git.ts` `commitsFor`, the worktree from `timelineWorktreeOf`; ETag over body and `HEAD` |
 * | claims | `buildClaimViews({files, locks, specEdges, now})`, the spec edges resolved over the workspace reading (spec 025); each claim's `itemState` at the clock (spec 040) |
 * | tasks | `parseTaskLines` or `null` without tasks.md, each row's `itemState` its task's item (`itemStates`, spec 040), `steps` core's `taskSteps` beside it (spec 015); header `X-Spectant-Tasks-Hash` (sha256 hex of the raw bytes) |
 * | evidenceFile | `evidenceFileResponse` (`evidence.ts`): 403 outside `artifacts/`, `.evidence/` and `.design/`, 404 no file |
 * | frames | `buildFrames(files)` |
 * | live | `buildLiveFrame({files + constitution, locks, now, specEdges})`, edges as for claims; `steps` core's `taskSteps(locks, files)` beside it (spec 015, ISC-232) |
 *
 * The evidence listing (`…/evidence`) and the Docs tabs (`…/docs/:name`) went with spec 017 T53: the library reads and
 * renders every document (`api.ts`), and a request to either is the unmatched API path's 404.
 *
 * Inputs follow the golden families (`core/tests/golden.test.ts`), so a fixture's answer is its golden value: the
 * folder's own texts for timeline, claims and frames; the constitution added for tasks and live; master and
 * constitution for the spec page. The item states (spec 040, ISC-224) are core's `itemStates` over the workspace reading
 * (`workspaceItemStates`) at `options.now` with the `runAbortMinutes` abort age, read per request. Locks come from `core/`'s `readLockSources`: the repository's
 * `.spectant/activity.jsonl`, and the LifeOS frontier locks only when `options.lifeos` is present (ISC-37).
 *
 * The two writes (`POST …/gate/reviewed`, `POST …/tasks/:tid/check`): the body through `parseWriteBody` (400), then
 * `gate-route.ts` / `checkbox-route.ts` over `writes.ts` (404 unknown task, 409 hash mismatch, 423 lock, 200 written),
 * the answers typed by `writes.contract.ts`. The stage move (`POST …/transition`, T83) goes through `transition-route.ts`
 * over `writeTransition` and adds the 422 `transition-refused`. No absolute path leaves this module (ISC-3): bodies are core models over texts, and
 * a workspace is its slug, its name and `pathTail`.
 */
import { basename, relative, sep } from "node:path";
import { buildClaimViews } from "../../core/src/claim-view.ts";
import { specFilePath } from "../../core/src/files.ts";
import type { ItemStateInfo, LockReading, SpecEdge, SpecFiles } from "../../core/src/files.ts";
import { buildDashboard } from "../../core/src/dashboard.ts";
import { guidanceOf } from "../../core/src/guidance.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { resolveEdges } from "../../core/src/spec-edges.ts";
import { buildFrames } from "../../core/src/frames.ts";
import { buildLiveFrame } from "../../core/src/live.ts";
import { readLockSources } from "../../core/src/locks.ts";
import type { SpecRef } from "../../core/src/resolve.ts";
import { buildSpecPage } from "../../core/src/spec.ts";
import { taskSteps } from "../../core/src/steps.ts";
import { parseTaskLines } from "../../core/src/tasks.ts";
import { codeReviewOf } from "../../core/src/stage.ts";
import { buildTimeline, type TimelineNote, type TimelineSession } from "../../core/src/timeline.ts";
import { parseWorkflow } from "../../core/src/workflow.ts";
import { json } from "./api.ts";
import { writeTaskCheck } from "./checkbox-route.ts";
import { evidenceFileResponse } from "./evidence.ts";
import { writeGateReviewed } from "./gate-route.ts";
import { CommitCache, type CommitsResult, commitsFor } from "./git.ts";
import type { ApiHandler } from "./http.ts";
import type { LifeosDetection } from "./lifeos.ts";
import type { NoteStore } from "./notes.ts";
import type { Registry, Workspace } from "./registry.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";
import {
  type NotFound,
  REVIEWED_HASHES_HEADER,
  SPEC_API_ROOT,
  SPEC_HASH_HEADER,
  type SpecRouteMatch,
  type SpecRouteResponses,
  TASKS_HASH_HEADER,
  type Unavailable,
  allowFor,
  formatReviewedHashes,
  matchSpecPath,
  matchSpecRoute,
} from "./spec-routes.contract.ts";
import {
  type UnreadableCode,
  readBytesIfExists,
  readRepoFile,
  readSpecSource,
  resolveWorkspaceSpec,
  readWorktreeView,
  readWorkspaceInput,
  timelineWorktreeOf,
  unreadableCode,
  viewerActorOf,
  workspaceItemStates,
  workspaceUnreadable,
} from "./workspace-loader.ts";
import { transitionAnswer } from "./transition-route.ts";
import { parseWriteBody, writeActorOf } from "./writes.contract.ts";
import { gateHashes, rawSha256 } from "./writes.ts";

export type SpecRoutesOptions = {
  registry: Pick<Registry, "get">;
  /** As in `dashboardApi`: present adds the LifeOS frontier locks; absent (the default) reads no LifeOS path. */
  lifeos?: LifeosDetection;
  /** The clock of the live frame and of frontier staleness; the current time by default. Tests pin it. */
  now?: () => Date;
  /**
   * The cache of `git.ts` `commitsFor`, one per process: it skips `git log` while `HEAD` is unchanged. A fresh one
   * per `specRoutesApi` by default.
   */
  commitCache?: CommitCache;
  /**
   * The app's notes store (read only here): the timeline joins the spec's notes as `note` entries (spec 024). Absent,
   * the timeline carries no note.
   */
  notes?: Pick<NoteStore, "list">;
  /**
   * The age after which an open run reads `aborted` and stops locking the writes (spec 040, ISC-225): the
   * `runAbortMinutes` setting × 60 000, read per write so a changed setting applies at once. Absent, core's default.
   */
  abortAfterMs?: () => number;
  /**
   * The age after which a claim lock without a release shows `stale` and reads `aborted` (spec 032, ISC-35; ISC-223):
   * the `staleMinutes` setting × 60 000, read per request. The live frame's `staleAfterMs`, the claims' and the item
   * states' claim stale age. Absent, core's default (45 minutes).
   */
  staleAfterMs?: () => number;
};

/** Any path under `/api/workspaces/:ws/specs`: the spec routes own it, so an unknown tab is their 404, not the server's. */
const SPECS_SUBTREE = new RegExp(`^${SPEC_API_ROOT}/[^/]+/specs(?:/.*)?$`);

const NOT_FOUND: NotFound = { error: "not-found" };

/** A file system failure (it carries an errno code), as opposed to a defect, which must surface as a 500. */
const isFsError = (error: unknown): boolean => typeof (error as NodeJS.ErrnoException | null)?.code === "string";

/** Thrown inside a route to answer a workspace that cannot be read with the dashboard's 409 body. */
class WorkspaceUnreadable extends Error {
  constructor(readonly code: UnreadableCode) {
    super(code);
  }
}

function unavailable(workspace: Workspace, error: UnreadableCode): Unavailable {
  return { slug: workspace.slug, name: workspace.name, pathTail: basename(workspace.path), readable: false, error, counts: null };
}

/** The workspace's constitution text as an optional `texts` key, the way the golden families add it. */
const withConstitution = (files: SpecFiles, constitution: string | null): SpecFiles =>
  constitution === null ? files : { folder: files.folder, texts: { ...files.texts, constitution } };

/** The timeline's strong ETag: sha256 over the exact body and `HEAD`, base64url, quoted as `json()` quotes its own. */
export function timelineEtag(timeline: unknown, head: string): string {
  return `"${new Bun.CryptoHasher("sha256").update(JSON.stringify(timeline)).update("\0").update(head).digest("base64url")}"`;
}

export function specRoutesApi(options: SpecRoutesOptions): ApiHandler {
  const { registry } = options;
  const stateDir = options.lifeos?.stateDir ?? null;
  const clock = options.now ?? (() => new Date());
  const cache = options.commitCache ?? new CommitCache();
  /** The run lock's abort age for one write, as an optional input field. */
  const age = (): { abortAfterMs?: number } => (options.abortAfterMs === undefined ? {} : { abortAfterMs: options.abortAfterMs() });
  /** The claim stale age for one read (spec 032, ISC-35), as an optional input field: the live frame, claims, item states. */
  const staleAge = (): { staleAfterMs?: number } => (options.staleAfterMs === undefined ? {} : { staleAfterMs: options.staleAfterMs() });

  const locksOf = (root: string, now: Date): Promise<LockReading> => readLockSources({ repoRoot: root, lifeosStateDir: stateDir, now });

  /** harbor's `specs/002-web-console`: the folder relative to the workspace root, POSIX separators. */
  const folderOf = (root: string, ref: SpecRef): string => relative(root, ref.dir).split(sep).join("/");

  /**
   * The folder's commits, read-only (`rev-parse` and `log`, ISC-15). Never throws: a workspace that is no repository
   * of its own, a missing git or the deadline read as no commits, the way the golden families are built.
   */
  const commitsOf = (root: string, ref: SpecRef): Promise<CommitsResult> => commitsFor(root, folderOf(root, ref), { cache });

  /**
   * This spec's spec edges, resolved over the workspace (spec 025, ISC-163): the claims and live routes read one spec's
   * files, but whether an edge is met needs every folder and the merge state, so one `readWorkspaceInput` per request
   * (its git reads cached as for the dashboard). An unreadable workspace reads as no edges.
   */
  async function specEdgesOf(root: string, ref: SpecRef): Promise<readonly SpecEdge[]> {
    return (await workspaceOf(root, ref, null)).specEdges;
  }

  /**
   * This spec's spec edges and, with a clock, its items (spec 040, ISC-224: the spec, its marks, claims and tasks, by
   * `ItemStateInfo.spec` or the spec's own id) from one workspace reading. An unreadable workspace reads as neither.
   */
  async function workspaceOf(root: string, ref: SpecRef, now: Date | null): Promise<{ specEdges: readonly SpecEdge[]; items: readonly ItemStateInfo[] }> {
    const reading = await readWorkspaceInput(root, stateDir);
    if (!reading.readable) return { specEdges: [], items: [] };
    const { input } = reading;
    const specEdges = resolveEdges({ specs: input.specs, archived: input.archived, constitution: input.constitution }, reading.mergeState).edges.filter((e) => e.fromSpec === ref.id);
    if (now === null) return { specEdges, items: [] };
    const items = workspaceItemStates(input, buildDashboard(input), { now, ...age(), ...staleAge() }).filter((i) => i.spec === ref.id || (i.kind === "spec" && i.id === ref.id));
    return { specEdges, items };
  }

  async function specPage(req: Request, root: string, ref: SpecRef): Promise<Response> {
    const reading = await readWorkspaceInput(root, stateDir);
    if (!reading.readable) throw new WorkspaceUnreadable(reading.error);
    const { input } = reading;
    const files = (ref.archived ? input.archived : input.specs).find((f) => f.folder === ref.slug);
    if (files?.texts.spec === undefined) return json(req, 404, NOT_FOUND);
    const texts = {
      ...files.texts,
      ...(input.master === null ? {} : { master: input.master }),
      ...(input.constitution === null ? {} : { constitution: input.constitution }),
    };
    // One item-state reading for the head's state and the workspace guidance (spec 020), as the dashboard composes it.
    const dashboard = buildDashboard(input);
    const items = workspaceItemStates(input, dashboard, { now: clock(), ...age(), ...staleAge() });
    const state = ref.archived ? undefined : items.find((i) => i.kind === "spec" && i.id === ref.id);
    const page = buildSpecPage({
      files: { folder: files.folder, texts },
      others: [...input.specs, ...input.archived].filter((f) => f !== files),
      tldr: input.tldr,
      worktreeTree: input.worktreeTree,
      // The dashboard reading's worktrees, so the head's chip is the row's (spec 027, ISC-175).
      ...(input.worktrees === undefined ? {} : { worktrees: input.worktrees }),
      // The row's own read of this spec: its worktree's tree id (ISC-176), its source and the main copy (ISC-181).
      ...(input.perSpec?.[files.folder] === undefined ? {} : { read: input.perSpec[files.folder] }),
      commits: (await commitsOf(root, ref)).commits,
      ...(input.locks ? { locks: input.locks } : {}),
      workflow: reading.workflow,
      // The merge state beside the reading (spec 025): the head's stage and `waits` are the row's (ISC-163).
      mergeState: reading.mergeState,
      // The spec's item state as the board card has it (spec 040, ISC-224); an archived spec has none.
      ...(state === undefined ? {} : { state }),
      // The workspace guidance; core keeps this spec's entries (spec 020, ISC-237).
      guidance: guidanceOf({ workspace: input, dashboard, items }),
    });
    // The same hashes the gate write and the transition recompute (`writes.ts`), so a render and its write can only
    // differ by the files: the normalised gate hashes, and spec.md's raw bytes for the stage move (T83). Both over the
    // copy the page was read from, the worktree's when the source is `worktree` (plan 027 § Risks: one source per CAS).
    const specBytes = readBytesIfExists(specFilePath(reading.copies[ref.slug] ?? ref.dir, "spec"));
    return json(req, 200, page, {
      [REVIEWED_HASHES_HEADER]: formatReviewedHashes(gateHashes(files.texts)),
      ...(specBytes === null ? {} : { [SPEC_HASH_HEADER]: rawSha256(specBytes) }),
    });
  }

  async function answer(req: Request, url: URL, match: SpecRouteMatch, workspace: Workspace): Promise<Response> {
    const root = workspace.path;
    const unreadable = workspaceUnreadable(root);
    if (unreadable !== null) throw new WorkspaceUnreadable(unreadable);
    const ref = await resolveWorkspaceSpec(root, match.params.id);
    if (ref.kind !== "spec") return json(req, 404, NOT_FOUND);
    if (match.route === "spec") return specPage(req, root, ref);

    // The spec's read source, as the row and the head read it (spec 027, ISC-181): `dir` is the worktree copy's folder
    // when the source is `worktree`, for every file of the folder, the evidence file route's `artifacts/`, `.evidence/`
    // and `.design/` included (spec 039, ISC-208). The three writes on the spec (reviewed mark, tick, stage move) take
    // `source`: they read, compare and write the copy the client's hashes came from (T22), so a source that switched
    // between render and write is the plain 409 of the hash compare.
    const reading = await readWorktreeView(root);
    const { files, dir } = await readSpecSource(root, ref, reading);
    if (files.texts.spec === undefined) return json(req, 404, NOT_FOUND);
    const source = { ...ref, dir };
    // The constitution and the workflow from their read source (spec 039, ISC-209), as the dashboard reading reads them.
    const constitution = async (): Promise<string | null> => (await readRepoFile(root, "specs/constitution.md", reading)).text;

    switch (match.route) {
      case "timeline": {
        const { commits, head } = await commitsOf(root, ref);
        // The joins the files do not hold (spec 024): the spec's notes, and the sessions holding one of its claims.
        const notes: TimelineNote[] = (options.notes?.list(workspace.slug, { spec: ref.id }) ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, created: n.created }));
        const sessions: TimelineSession[] = buildClaimViews({ files, locks: await locksOf(root, clock()) }).claims.flatMap((c) =>
          c.lock === null ? [] : [{ claim: c.id, session: c.lock.session, since: c.lock.since }],
        );
        // The spec worktree's end from git (spec 027, ISC-175.1): merged into `main` or removed, one derived entry.
        const worktree = await timelineWorktreeOf(root, ref.slug, reading);
        // The type's code review under `specs/workflow.md` (spec 028, ISC-183.2): under `none` the derived stages step
        // build → close without a code-review entry, as the row reads it.
        const workflow = parseWorkflow((await readRepoFile(root, "specs/workflow.md", reading)).text);
        const codeReview = codeReviewOf(parseFrontmatter(files.texts.spec ?? "").data.specType, workflow);
        const timeline = buildTimeline({ files, commits, notes, sessions, worktree, codeReview });
        // With a HEAD the ETag covers it too, so a new commit revalidates even where the body would not change; without
        // one (no repository of its own) it is the plain body hash of every other route.
        return json(req, 200, timeline, head === null ? {} : { ETag: timelineEtag(timeline, head) });
      }
      case "claims": {
        // The clock gives each claim its `itemState` (spec 040, ISC-224), at the claim stale age of the live frame (the
        // `staleMinutes` setting, spec 032 ISC-35).
        const now = clock();
        return json(req, 200, buildClaimViews({ files, locks: await locksOf(root, now), specEdges: await specEdgesOf(root, ref), now, ...staleAge() }));
      }
      case "tasks": {
        // One read of the raw bytes: the hash covers exactly the text that was parsed.
        const bytes = readBytesIfExists(specFilePath(dir, "tasks"));
        if (bytes === null) return json(req, 200, null);
        const text = await constitution();
        const now = clock();
        const { specEdges, items } = await workspaceOf(root, ref, now);
        const tasks = bytes.toString("utf8");
        const tab = parseTaskLines({
          tasks,
          ...(text === null ? {} : { constitution: text }),
          ...(files.texts.rounds === undefined ? {} : { rounds: files.texts.rounds }),
          // The spec edges as the claims and live routes read them: a held task carries `waits on NNN` (ISC-162.2).
          specEdges,
          // Each row's `itemState`, the workspace model's item of its task (spec 040, ISC-224).
          itemStates: items,
        });
        // Each task's step timeline beside the tab (spec 015, ISC-232), over the very text the tab and the hash read.
        const steps = taskSteps(await locksOf(root, now), { ...files, texts: { ...files.texts, tasks } });
        return json(req, 200, { ...tab, steps } satisfies SpecRouteResponses["tasks"], { [TASKS_HASH_HEADER]: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
      }
      case "evidenceFile":
        return evidenceFileResponse(req, dir, url.search);
      case "frames":
        return json(req, 200, buildFrames(files));
      case "live": {
        const now = clock();
        const locks = await locksOf(root, now);
        // The stale age is the `staleMinutes` setting (spec 032, ISC-35): cards, agents and item states age by it.
        const frame = buildLiveFrame({ files: withConstitution(files, await constitution()), locks, now, specEdges: await specEdgesOf(root, ref), ...staleAge() });
        // Each task's step timeline beside the frame (spec 015, ISC-232): core's model over the same reading.
        return json(req, 200, { ...frame, steps: taskSteps(locks, files) } satisfies SpecRouteResponses["live"]);
      }
      case "gateReviewed": {
        const parsed = parseWriteBody("gateReviewed", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const actor = writeActorOf(await viewerActorOf(root));
        const result = await writeGateReviewed({ root, ref: source, stateDir, now: clock(), body: parsed.body, constitution: await constitution(), actor, ...age() });
        return json(req, result.status, result.body);
      }
      case "taskCheck": {
        const parsed = parseWriteBody("taskCheck", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const { tid } = match.params;
        const result = await writeTaskCheck({ root, ref: source, stateDir, now: clock(), tid, body: parsed.body, constitution: await constitution(), ...age() });
        return json(req, result.status, result.body);
      }
      case "transition": {
        const result = await transitionAnswer({ root, ref: source, stateDir, now: clock(), text: await req.text(), ...age() });
        return json(req, result.status, result.body);
      }
    }
  }

  return (req, url) => {
    const { pathname } = url;
    if (!SPECS_SUBTREE.test(pathname)) return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    const path = matchSpecPath(pathname);
    if (path === null) return json(req, 404, NOT_FOUND);
    const match = matchSpecRoute(pathname, req.method);
    if (match === null) return json(req, 405, { error: "method-not-allowed" }, { Allow: allowFor(path.route) });
    const workspace = registry.get(match.params.ws);
    if (!workspace) return json(req, 404, NOT_FOUND);
    return answer(req, url, match, workspace).catch((error: unknown) => {
      if (error instanceof WorkspaceUnreadable) return json(req, 409, unavailable(workspace, error.code));
      if (isFsError(error)) return json(req, 409, unavailable(workspace, unreadableCode(error)));
      throw error;
    });
  };
}

