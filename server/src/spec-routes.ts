/**
 * The spec routes (T45, ISC-71; plan 002 § Interfaces "HTTP"): every read route of `spec-routes.contract.ts`, answered
 * from the files of a registered workspace on each request. Nothing is cached; the ETag keeps an unchanged answer to
 * a 304.
 *
 * Per request: the loopback guard (403), the method (405 with `Allow: allowFor(route)`), the workspace by slug (404
 * unknown, 409 `Unavailable` when its directory cannot be read, the dashboard's body), the spec by `resolveSpec` (the
 * id `NNN`, the folder name or the bare slug; no match or an ambiguous one is a 404, never another spec), and a folder
 * without `spec.md` is no spec (404). Then one `core/` call per route (every parse is core's, ISC-5):
 *
 * | route | answer |
 * |-------|--------|
 * | spec | `buildSpecPage` over the dashboard's own reading (`readWorkspaceInput`), so page and row agree (ISC-72); header `X-Spectant-Reviewed-Hashes` |
 * | timeline | `buildTimeline({files, commits})`, commits from `git.ts` `commitsFor`; ETag over body and `HEAD` |
 * | claims | `buildClaimViews({files, locks})` |
 * | tasks | `parseTaskLines` or `null` without tasks.md; header `X-Spectant-Tasks-Hash` (sha256 hex of the raw bytes) |
 * | evidence | `listEvidence(specDir, {specText})` |
 * | evidenceFile | `evidenceFileResponse` (`evidence.ts`): 403 outside the two folders, 404 no file |
 * | docs/:name | `renderDocsMarkdown`, images confined to the workspace; 404 `DocMissing` with `docsFor(type)[name]` |
 * | frames | `buildFrames(files)` |
 * | live | `buildLiveFrame({files + constitution, locks, now})` |
 *
 * Inputs follow the golden families (`core/tests/golden.test.ts`), so a fixture's answer is its golden value: the
 * folder's own texts for timeline, claims and frames; the constitution added for tasks and live; master and
 * constitution for the spec page. Locks come from `core/`'s `readLockSources`: the repository's
 * `.spectant/activity.jsonl`, and the LifeOS frontier locks only when `options.lifeos` is present (ISC-37).
 *
 * The two writes (`POST …/gate/reviewed`, `POST …/tasks/:tid/check`): the body through `parseWriteBody` (400), then
 * `gate-route.ts` / `checkbox-route.ts` over `writes.ts` (404 unknown task, 409 hash mismatch, 423 lock, 200 written),
 * the answers typed by `writes.contract.ts`. No absolute path leaves this module (ISC-3): bodies are core models over texts, and
 * a workspace is its slug, its name and `pathTail`.
 */
import { existsSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { buildClaimViews } from "../../core/src/claim-view.ts";
import { listEvidence } from "../../core/src/evidence.ts";
import { DOC_FILES, specFilePath } from "../../core/src/files.ts";
import type { DocName, LockReading, SpecFiles } from "../../core/src/files.ts";
import { buildFrames } from "../../core/src/frames.ts";
import { parseFrontmatter } from "../../core/src/frontmatter.ts";
import { buildLiveFrame } from "../../core/src/live.ts";
import { readLockSources } from "../../core/src/locks.ts";
import { docsFor, renderDocsMarkdown } from "../../core/src/markdown-docs.ts";
import { type SpecRef, resolveSpec } from "../../core/src/resolve.ts";
import { buildSpecPage } from "../../core/src/spec.ts";
import { parseTaskLines } from "../../core/src/tasks.ts";
import { buildTimeline } from "../../core/src/timeline.ts";
import { json } from "./api.ts";
import { writeTaskCheck } from "./checkbox-route.ts";
import { evidenceFileResponse } from "./evidence.ts";
import { writeGateReviewed } from "./gate-route.ts";
import { CommitCache, type CommitsResult, commitsFor } from "./git.ts";
import type { ApiHandler } from "./http.ts";
import type { LifeosDetection } from "./lifeos.ts";
import type { Registry, Workspace } from "./registry.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";
import {
  type DocMissing,
  type NotFound,
  REVIEWED_HASHES_HEADER,
  SPEC_API_ROOT,
  type SpecRouteMatch,
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
  readIfExists,
  readSpecFiles,
  readWorkspaceInput,
  unreadableCode,
  workspaceUnreadable,
} from "./workspace-loader.ts";
import { parseWriteBody } from "./writes.contract.ts";
import { gateHashes } from "./writes.ts";

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

/**
 * The workspace's `specs/constitution.md`. Not `specFilePath(dir, "constitution")`: for an archived spec that names
 * `specs/archive/constitution.md`, and the workspace has one constitution for every spec, as `readWorkspaceInput` reads it.
 */
const constitutionPath = (root: string): string => join(root, "specs", "constitution.md");

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

  const locksOf = (root: string, now: Date): Promise<LockReading> => readLockSources({ repoRoot: root, lifeosStateDir: stateDir, now });

  /** harbor's `specs/002-web-console`: the folder relative to the workspace root, POSIX separators. */
  const folderOf = (root: string, ref: SpecRef): string => relative(root, ref.dir).split(sep).join("/");

  /**
   * The folder's commits, read-only (`rev-parse` and `log`, ISC-15). Never throws: a workspace that is no repository
   * of its own, a missing git or the deadline read as no commits, the way the golden families are built.
   */
  const commitsOf = (root: string, ref: SpecRef): Promise<CommitsResult> => commitsFor(root, folderOf(root, ref), { cache });

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
    const page = buildSpecPage({
      files: { folder: files.folder, texts },
      others: [...input.specs, ...input.archived].filter((f) => f !== files),
      tldr: input.tldr,
      worktreeTree: input.worktreeTree,
      commits: (await commitsOf(root, ref)).commits,
      ...(input.locks ? { locks: input.locks } : {}),
    });
    // The same hashes the gate write recomputes (`writes.ts`), so a render and its write can only differ by the files.
    return json(req, 200, page, { [REVIEWED_HASHES_HEADER]: formatReviewedHashes(gateHashes(files.texts)) });
  }

  function docs(req: Request, root: string, ref: SpecRef, files: SpecFiles, name: DocName): Response {
    const path = name === "constitution" ? constitutionPath(root) : specFilePath(ref.dir, DOC_FILES[name]);
    const text = readIfExists(path);
    if (text === null) {
      const type = parseFrontmatter(files.texts.spec ?? "").data.specType;
      const missing: DocMissing = { error: "not-found", doc: name, availability: docsFor(type)[name] };
      return json(req, 404, missing);
    }
    const dir = resolve(path, "..");
    const page = renderDocsMarkdown(text, {
      // Existence only, confined to the workspace: an image outside it reads as missing, and no image is ever read.
      assetExists: (src) => {
        const target = resolve(dir, src);
        return !relative(root, target).startsWith("..") && existsSync(target);
      },
    });
    return json(req, 200, page);
  }

  async function answer(req: Request, url: URL, match: SpecRouteMatch, workspace: Workspace): Promise<Response> {
    const root = workspace.path;
    const unreadable = workspaceUnreadable(root);
    if (unreadable !== null) throw new WorkspaceUnreadable(unreadable);
    const ref = resolveSpec(root, match.params.id);
    if (ref.kind !== "spec") return json(req, 404, NOT_FOUND);
    if (match.route === "spec") return specPage(req, root, ref);

    const files = readSpecFiles(ref);
    if (files.texts.spec === undefined) return json(req, 404, NOT_FOUND);
    const constitution = (): string | null => readIfExists(constitutionPath(root));

    switch (match.route) {
      case "timeline": {
        const { commits, head } = await commitsOf(root, ref);
        const timeline = buildTimeline({ files, commits });
        // With a HEAD the ETag covers it too, so a new commit revalidates even where the body would not change; without
        // one (no repository of its own) it is the plain body hash of every other route.
        return json(req, 200, timeline, head === null ? {} : { ETag: timelineEtag(timeline, head) });
      }
      case "claims":
        return json(req, 200, buildClaimViews({ files, locks: await locksOf(root, clock()) }));
      case "tasks": {
        // One read of the raw bytes: the hash covers exactly the text that was parsed.
        const bytes = readBytesIfExists(specFilePath(ref.dir, "tasks"));
        if (bytes === null) return json(req, 200, null);
        const text = constitution();
        const tab = parseTaskLines({
          tasks: bytes.toString("utf8"),
          ...(text === null ? {} : { constitution: text }),
          ...(files.texts.rounds === undefined ? {} : { rounds: files.texts.rounds }),
        });
        return json(req, 200, tab, { [TASKS_HASH_HEADER]: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
      }
      case "evidence":
        return json(req, 200, await listEvidence(ref.dir, { specText: files.texts.spec }));
      case "evidenceFile":
        return evidenceFileResponse(req, ref.dir, url.search);
      case "docs":
        return docs(req, root, ref, files, match.params.name);
      case "frames":
        return json(req, 200, buildFrames(files));
      case "live": {
        const now = clock();
        return json(req, 200, buildLiveFrame({ files: withConstitution(files, constitution()), locks: await locksOf(root, now), now }));
      }
      case "gateReviewed": {
        const parsed = parseWriteBody("gateReviewed", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const result = await writeGateReviewed({ root, ref, stateDir, now: clock(), body: parsed.body, constitution: constitution() });
        return json(req, result.status, result.body);
      }
      case "taskCheck": {
        const parsed = parseWriteBody("taskCheck", await req.text());
        if (!parsed.ok) return json(req, 400, parsed.error);
        const { tid } = match.params;
        const result = await writeTaskCheck({ root, ref, stateDir, now: clock(), tid, body: parsed.body, constitution: constitution() });
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

