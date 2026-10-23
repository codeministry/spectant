/**
 * The planning tree and the story page, each matched by the contract's `matchWorkspacePath` and dispatched by
 * `dashboardApi` after its guard and method check.
 *
 * The planning route (spec 003 T19, ISC-103): `GET /api/workspaces/:ws/planning` → the `PlanningModel` of
 * `core/src/planning.ts`, `buildPlanning` over the master and every spec folder, active and archived, that
 * `readWorkspaceInput` reads. It answers with the same guard order and the same statuses as the dashboard route: 403,
 * 405 with `allowForWorkspace`, 404, 409 with the workspace's summary. The milestone states compare target dates with
 * today's local date (the context's `today`, `localDate` by default), so a stub or golden built at a fixed day differs
 * from a live answer in `state` alone.
 * Spec 026 (T11, ISC-171): the same answer carries each milestone's feature assignment (`featureIds`, the no-milestone
 * group `unassignedFeatures`) and the relation index `relations` that `buildPlanning` derives (`core/src/relations.ts`);
 * the detail sidebar reads both from here, so there is no relations route and nothing new is read or written.
 * Spec 025 (T32, ISC-170.1): it also carries the spec edges `resolveEdges` resolves against the reading's merge state
 * (`specEdges`, absent without any), from which the Diagram lens draws its `spec-edge` arrows.
 * Spec 040 (ISC-224): every story of it (`ideas`, and those under a feature or a milestone) carries its `idea` item as
 * `IdeaRef.state`, core's `ideaStateOf` over the reading's open runs at the request clock and the `runAbortMinutes`
 * abort age, attached by `withIdeaStates`: the dashboard model lists no stories, so the board reads them from here.
 * Spec 067 (ISC-530): each relation entry carries its overview facts (`Relation.facts`), and an open claim's facts name
 * the session holding its lock (`ClaimFacts.lockHolder`) from the reading's lock source, passed as `claimLocks` so the
 * locks reach the claim facts alone and every holder's `assignee` stays the events'. Still no route of their own.
 *
 * The story route (spec 008 T88, ISC-124.2): `GET /api/workspaces/:ws/ideas/:slug` → `IdeaPage`, with the same guard
 * order. It reads the story folder and the activity log alone, never the whole workspace: a story page needs no spec
 * folder, and its state (`idea.state`, spec 040, ISC-224, `ideaStateOf` at the request clock and abort age) only the
 * open runs. Each story comes from its read source (`readIdeaSources`, `readRepoFile`, spec 039, ISC-209), so a story a
 * spec worktree changed last shows that version and `source` names the worktree; the git facts behind it are the
 * worktree view's, kept while the repository state stands. The slug must be one `readIdeas` lists, so a path out of
 * the folder, the index or a skipped file is a 404 before any file is opened by it; then one read of the file's bytes
 * gives the `IdeaRef` (`readIdeas` over the folder with that text), the page (`renderDocsMarkdown`, images confined to
 * the workspace as on a Docs tab) and `hash`, the raw sha256 hex of those bytes (`rawSha256`, the hash `allocate`
 * checks). The ETag is `json()`'s body hash, and the body carries `hash`, so any byte change revalidates. 404 for an
 * unknown story and for a workspace without stories; 409 with the summary when the folder cannot be read.
 */
import { buildDashboard } from "../../../core/src/dashboard.ts";
import { docsRenderOptions } from "../../../core/src/evidence.ts";
import { repoFilePath, specFilePath } from "../../../core/src/files.ts";
import { readIdeas } from "../../../core/src/ideas.ts";
import { ideaStateOf, withIdeaStates } from "../../../core/src/item-state.ts";
import { readLockSources } from "../../../core/src/locks.ts";
import { renderDocsMarkdown } from "../../../core/src/markdown-docs.ts";
import { type PlanningSpecState, buildPlanning } from "../../../core/src/planning.ts";
import { listSpecs } from "../../../core/src/resolve.ts";
import { resolveEdges } from "../../../core/src/spec-edges.ts";
import type { WorkspaceRouteResponses } from "../contracts/spec-routes.contract.ts";
import { rawSha256 } from "../infra/hash.ts";
import { json } from "../infra/http/json.ts";
import {
  type WorkspaceContext,
  type WorkspaceReading,
  readBytesIfExists,
  readIdeaSources,
  readRepoFile,
  readableWorkspace,
  summaryOf,
} from "../workspace/index.ts";

/**
 * Each active spec's state for the board (spec 008, T83): the stage and its source from the dashboard rows of the very
 * reading the tree is built from, and the raw sha256 of spec.md's bytes, the hash `writes.ts` compares a transition
 * against (`rawSha256`), so a card's move fails only on a file changed since the board was read.
 */
export function specStatesOf(root: string, reading: Extract<WorkspaceReading, { readable: true }>): PlanningSpecState[] {
  const dirs = new Map(listSpecs(root).filter((ref) => !ref.archived).map((ref) => [ref.slug, ref.dir]));
  return buildDashboard(reading.input).specs.map((row): PlanningSpecState => {
    const dir = dirs.get(row.slug);
    const bytes = dir === undefined ? null : readBytesIfExists(specFilePath(dir, "spec"));
    // `waits`: the row's, so the board card shows the same `waits on NNN` as the row (spec 025, ISC-163).
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, waits: row.waits, ...(bytes === null ? {} : { hash: rawSha256(bytes) }) };
  });
}

/** The planning route and the story page over one context; the caller has guarded, matched and method-checked the request. */
export function planningRoutes(ctx: WorkspaceContext): {
  planning: (req: Request, slug: string) => Promise<Response>;
  idea: (req: Request, slug: string, story: string) => Promise<Response>;
} {
  const { registry, read, today, stateClock } = ctx;

  // The board's stages come from the reading's own lock source (the repository's activity log); no LifeOS path is read.
  const planning = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    const reading = await read(workspace.path);
    if (!reading.readable) return json(req, 409, summaryOf(workspace, reading));
    const { master, specs, archived, constitution } = reading.input;
    // The feature backlog (spec 036): text and hash from one read of the bytes, so the hash the client sends back with
    // a backlog write is the hash of the order it rendered; the hash of the empty text without the file.
    const backlogBytes = readBytesIfExists(repoFilePath(workspace.path, "backlog"));
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
      backlog: backlogBytes === null ? null : backlogBytes.toString("utf8"),
      backlogHash: rawSha256(backlogBytes ?? ""),
      // Spec 067 (ISC-530): the open claim locks for the claim facts' lock holder alone, never the board's assignee.
      ...(reading.input.locks === undefined ? {} : { claimLocks: reading.input.locks.locks }),
    });
    // Each story's item from its open runs at this request's clock (spec 040, ISC-224).
    const at = stateClock();
    const openRuns = reading.input.locks?.openRuns ?? [];
    return json(req, 200, withIdeaStates(model, model.ideas.map((idea) => ideaStateOf(idea.slug, openRuns, at))));
  };

  // The story folder alone: no spec folder or lock source feeds a story page (header).
  const idea = (req: Request, slug: string, story: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      // The stories from their read sources (spec 039, ISC-209): a story changed in a spec worktree shows that version.
      const { files } = await readIdeaSources(root);
      // Only a slug `readIdeas` lists names a file: never a path built from the request alone.
      if (!readIdeas(files).ideas.some((ref) => ref.slug === story)) return json(req, 404, { error: "not-found" });
      const name = `${story}.md`;
      const read = await readRepoFile(root, `specs/ideas/${name}`);
      const path = read.absolute;
      const bytes = readBytesIfExists(path);
      if (bytes === null) return json(req, 404, { error: "not-found" });
      // One read: the ref, the page and the hash all describe these bytes, even if the file changed since the listing.
      const text = bytes.toString("utf8");
      const ref = readIdeas({ ...files, [name]: text }).ideas.find((r) => r.slug === story);
      if (ref === undefined) return json(req, 404, { error: "not-found" });
      // The story's state from the activity log's open runs alone (spec 040, ISC-224), as the planning route reads it.
      const { openRuns = [] } = await readLockSources({ repoRoot: root });
      // A story renders as a Docs tab that is not the Design tab: images confined to the workspace, no spec assets.
      const body: WorkspaceRouteResponses["idea"] = {
        idea: { ...ref, state: ideaStateOf(story, openRuns, stateClock()) },
        page: renderDocsMarkdown(text, docsRenderOptions(root, path, "plan")),
        hash: rawSha256(bytes),
        ...(read.source.kind === "worktree" ? { source: read.source } : {}),
      };
      return json(req, 200, body);
    });

  return { planning, idea };
}
