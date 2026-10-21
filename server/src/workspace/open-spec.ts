/**
 * The prelude of every request on one spec (spec 059, T38): the workspace must be readable, the spec resolved by
 * `resolveWorkspaceSpec` (core's `resolveSpec`, then the specs only a spec worktree carries, spec 039 ISC-208.1; the id
 * `NNN`, the folder name or the bare slug), and then, on `open`, the spec's files from its read source and the
 * workspace's constitution. The spec routes answer every read and every write on a spec from it, so the reads and the
 * writes share one prelude without importing each other.
 *
 * `onSpec` and `onOpenedSpec` are that prelude as the route layer of every route on one spec, after the router
 * (spec 059, ISC-412) has guarded, matched and checked the method: 404 for an unknown workspace, the 409 `Unavailable`
 * when its directory cannot be read, 404 for no spec, then the route, which answers before `open` (the spec page) or
 * after it (every other route; a folder without `spec.md` is no spec, 404).
 */
import type { SpecFiles } from "../../../core/src/files.ts";
import type { SpecRef } from "../../../core/src/resolve.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import type { Registry, Workspace } from "../infra/db/registry.ts";
import { unreadableCode, workspaceUnreadable } from "../infra/fs/errno.ts";
import { json } from "../infra/http/json.ts";
import { readRepoFile } from "./repo-files.ts";
import { readSpecSource, resolveWorkspaceSpec } from "./spec-source.ts";
import { unavailable } from "./summary.ts";
import { type WorktreeReading, readWorktreeView } from "./worktree-view.ts";

/** One spec read from its read source, with what every route on it needs beside its files. */
export interface OpenedSpec {
  /** The workspace's worktree view, read once for the spec's source and every later read of the request. */
  readonly reading: WorktreeReading;
  /** The spec's files from its read source. */
  readonly files: SpecFiles;
  /** The folder the copy kinds were read from: the worktree copy's, or the main checkout's `ref.dir`. */
  readonly dir: string;
  /** The spec with `dir` as its folder: what the three writes on the spec read, compare and write. */
  readonly source: SpecRef;
  /** The constitution from its read source (spec 039, ISC-209), read on each call. */
  readonly constitution: () => Promise<string | null>;
}

/**
 * The spec a request names: `unreadable` with the workspace's code, `not-found` when no spec or an ambiguous one
 * matches, else the spec, whose read source `open` reads (null when its folder has no `spec.md`, no spec either).
 */
export type SpecOpening =
  | { readonly kind: "unreadable"; readonly code: UnreadableCode }
  | { readonly kind: "not-found" }
  | { readonly kind: "spec"; readonly ref: SpecRef; readonly open: () => Promise<OpenedSpec | null> };

export async function openSpec(root: string, id: string): Promise<SpecOpening> {
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return { kind: "unreadable", code: unreadable };
  const ref = await resolveWorkspaceSpec(root, id);
  if (ref.kind !== "spec") return { kind: "not-found" };
  return {
    kind: "spec",
    ref,
    open: async () => {
      // The spec's read source, as the row and the head read it (spec 027, ISC-181): `dir` is the worktree copy's folder
      // when the source is `worktree`, for every file of the folder, the evidence file route's `artifacts/`, `.evidence/`
      // and `.design/` included (spec 039, ISC-208). The three writes on the spec (reviewed mark, tick, stage move) take
      // `source`: they read, compare and write the copy the client's hashes came from (T22), so a source that switched
      // between render and write is the plain 409 of the hash compare.
      const reading = await readWorktreeView(root);
      const { files, dir } = await readSpecSource(root, ref, reading);
      if (files.texts.spec === undefined) return null;
      const source = { ...ref, dir };
      // The constitution and the workflow from their read source (spec 039, ISC-209), as the dashboard reading reads them.
      const constitution = async (): Promise<string | null> => (await readRepoFile(root, "specs/constitution.md", reading)).text;
      return { reading, files, dir, source, constitution };
    },
  };
}

/** Thrown inside a route on a spec to answer a workspace that cannot be read with the dashboard's 409 body. */
export class WorkspaceUnreadable extends Error {
  constructor(readonly code: UnreadableCode) {
    super(code);
  }
}

/** The params every route on a spec names: the workspace slug and the spec ref, each decoded once. */
export interface SpecTargetParams {
  readonly ws: string;
  readonly id: string;
}

/** The spec a route on it answers: its workspace, the resolved spec and the lazy read of its source (`SpecOpening`). */
export interface SpecTarget {
  readonly workspace: Workspace;
  readonly ref: SpecRef;
  readonly open: () => Promise<OpenedSpec | null>;
}

const NOT_FOUND = { error: "not-found" } as const;

/** A file system failure (it carries an errno code), as opposed to a defect, which must surface as a 500. */
const isFsError = (error: unknown): boolean => typeof (error as NodeJS.ErrnoException | null)?.code === "string";

/**
 * One route on one spec behind the prelude (module header); `answer` gets the spec before its source is read. A
 * `WorkspaceUnreadable` or an errno failure inside `answer` is the 409 with the workspace's summary; any other throw is
 * a defect.
 */
export function onSpec(
  registry: Pick<Registry, "get">,
  req: Request,
  params: SpecTargetParams,
  answer: (spec: SpecTarget) => Promise<Response>,
): Response | Promise<Response> {
  const workspace = registry.get(params.ws);
  if (!workspace) return json(req, 404, NOT_FOUND);
  const resolved = async (): Promise<Response> => {
    const opening = await openSpec(workspace.path, params.id);
    if (opening.kind === "unreadable") throw new WorkspaceUnreadable(opening.code);
    if (opening.kind === "not-found") return json(req, 404, NOT_FOUND);
    return answer({ workspace, ref: opening.ref, open: opening.open });
  };
  return resolved().catch((error: unknown) => {
    if (error instanceof WorkspaceUnreadable) return json(req, 409, unavailable(workspace, error.code));
    if (isFsError(error)) return json(req, 409, unavailable(workspace, unreadableCode(error)));
    throw error;
  });
}

/** `onSpec` with the spec's source read: a folder without `spec.md` is no spec (404). */
export function onOpenedSpec(
  registry: Pick<Registry, "get">,
  req: Request,
  params: SpecTargetParams,
  answer: (spec: SpecTarget, opened: OpenedSpec) => Promise<Response>,
): Response | Promise<Response> {
  return onSpec(registry, req, params, async (spec) => {
    const opened = await spec.open();
    return opened === null ? json(req, 404, NOT_FOUND) : answer(spec, opened);
  });
}
