/**
 * One registered repository read into the dashboard model's input (T47, ISC-16; plan 001 § Interfaces "HTTP").
 *
 * `readWorkspaceInput` reads the texts `core/` builds from: `ISA.md`, `specs/constitution.md`, `specs/tldr.md`,
 * `specs/workflow.md` (parsed by `core/`'s `parseWorkflow`, carried beside the input, T78), the story folder
 * `specs/ideas/` (T79), the viewer's actor id (`actorIdOf` over `git config --get user.email`, T80), and every text file
 * kind of every spec folder under `specs/` and `specs/archive/` (folders as `listSpecs` finds them). It parses nothing:
 * every parse is `core/`'s (ISC-5, `bun run check:single-core`). The lock sources are `core/`'s `readLockSources`
 * (T51): the repository's `.spectant/activity.jsonl`, plus the LifeOS frontier locks only when a LifeOS state directory
 * is passed (ISC-37).
 *
 * Read-only (ISC-15): no write, no temp file, no lock. The worktree tree id for the code-reviewed mark
 * (`infra/git/tree-id.ts`) runs only for a repository root (`.git` directly in the folder) with at least one active
 * spec that carries a code-reviewed mark; anything else is `null`, which `core/` reads as "tree id unavailable".
 *
 * An unreadable workspace (gone, not a directory, no permission) is a `{readable: false, error}` value with a stable
 * code, never a throw and never the OS message, which would carry the absolute path (ISC-3).
 */
import type { DashboardInput } from "../../../core/src/dashboard.ts";
import { actorIdOf } from "../../../core/src/actor-id.ts";
import { repoFilePath } from "../../../core/src/files.ts";
import type { FileDiagnostic, IdeaFiles, MergeState, RepoFileSource, SpecFiles, SpecRead, Workflow } from "../../../core/src/files.ts";
import { parseFrontmatter } from "../../../core/src/frontmatter.ts";
import { specIdOf } from "../../../core/src/spec-ref.ts";
import { readLockSources } from "../../../core/src/locks.ts";
import { listSpecs } from "../../../core/src/resolve.ts";
import { parseWorkflow } from "../../../core/src/workflow.ts";
import type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { type SpecBranch, userEmail } from "../infra/git/index.ts";
import { StateMemo, repoStateOf } from "../infra/git/repo-state.ts";
import { worktreeTreeId } from "../infra/git/tree-id.ts";
import { Unreadable, codeOf, workspaceUnreadable } from "../infra/fs/errno.ts";
import { readIdeaSources, readRepoFile, sourceFindings } from "./repo-files.ts";
import { specFiles } from "./spec-files.ts";
import { specSourceFor } from "./spec-source.ts";
import { readWorktreeView, withWorktreeOnly } from "./worktree-view.ts";

/**
 * A readable workspace: the model's input, the workflow table (T78, ISC-122; the default table when `specs/workflow.md`
 * is missing) and the reading's own findings, each under its repository-relative file name. The input carries the
 * same workflow (`DashboardInput.workflow`), which decides row 9 of the stage table (`close-pending`, spec 008 T49).
 * `ideas` is the story folder for `buildPlanning` (T79; `DashboardInput` has no field for it, so it rides beside the
 * input as `workflow` does); `viewer` is the viewer's `u:` id, null without a configured git address (T80). `copies`
 * names, per active spec read from its worktree's copy (spec 027, ISC-181), the absolute folder of that copy, so the
 * spec page hashes the same bytes it rendered; server-internal, it never reaches a response (ISC-3).
 */
export type WorkspaceReading =
  | {
      readable: true;
      input: DashboardInput;
      workflow: Workflow;
      ideas: IdeaFiles;
      /** Per story file name, the spec worktree it was read from (spec 039, ISC-209); absent for one read from main. */
      ideaSources: Readonly<Record<string, RepoFileSource>>;
      viewer: string | null;
      diagnostics: readonly FileDiagnostic[];
      copies: Readonly<Record<string, string>>;
      /**
       * One merge state per spec number, active and archived (spec 025, ISC-162.1; `mergeStateOf`): what `core/`'s
       * `resolveEdges` takes. The same rows ride in `input.mergeState`, where the dashboard's stage reads them (T14).
       */
      mergeState: readonly MergeState[];
    }
  | { readable: false; error: UnreadableCode };

/** The workflow table's repository-relative name, the `file` of its findings: never the absolute path (ISC-3). */
const WORKFLOW_FILE = repoFilePath("", "workflow");

/** The `user.email` per root, kept while `repoStateOf` stands: it covers the repository's and the global config (ISC-215). */
const VIEWER_EMAILS = new StateMemo<string | null>();

/** The viewer's actor id (`u:` + hash of `user.email`, core's `actorIdOf`), or null when no address is configured. */
export async function viewerActorOf(root: string): Promise<string | null> {
  const email = await VIEWER_EMAILS.get(root, repoStateOf(root), () => userEmail(root));
  return email === null ? null : actorIdOf(email);
}

/**
 * One `MergeState` per spec number of the workspace (spec 025, T10, ISC-162.1), active folders first, then archived
 * ones, the first folder of a number winning as in `core/`'s `resolveEdges`. `branches` are `infra/git/`'s
 * `mergedSpecBranches`: the spec's branch is the one with its number, the merged one when several carry it (the first
 * by name otherwise), and `merged` holds when any does; without one, `branch` is null and `merged` false. `complete`
 * is `phase: complete` in the frontmatter (core's `parseFrontmatter`), `archived` the folder's place. A failed git read
 * hands in no branch, so every row reads as branchless and `core/` decides by `complete` and `archived`.
 */
export function mergeStateOf(specs: readonly SpecFiles[], archived: readonly SpecFiles[], branches: readonly SpecBranch[]): MergeState[] {
  const rows: MergeState[] = [];
  const seen = new Set<string>();
  const add = (files: SpecFiles, inArchive: boolean): void => {
    const spec = specIdOf(files.folder);
    if (spec === null || seen.has(spec)) return;
    seen.add(spec);
    const own = branches.filter((b) => b.spec === spec);
    const branch = own.find((b) => b.merged) ?? own[0];
    const complete = files.texts.spec !== undefined && parseFrontmatter(files.texts.spec).data.phase === "complete";
    rows.push({ spec, branch: branch?.branch ?? null, merged: branch?.merged ?? false, complete, archived: inArchive });
  };
  for (const files of specs) add(files, false);
  for (const files of archived) add(files, true);
  return rows;
}

/**
 * Reads the workspace at `root` into the model's input, without services. The lock sources come from `core/`'s
 * `readLockSources`: the repository's `.spectant/activity.jsonl` always, the LifeOS frontier locks only with a
 * `lifeosStateDir` (T51, ISC-37). Without one, no path outside `root` is read.
 */
export async function readWorkspaceInput(root: string, lifeosStateDir: string | null = null): Promise<WorkspaceReading> {
  try {
    // A missing root, a file or a directory without read permission fails here, not as an empty workspace.
    const unreadable = workspaceUnreadable(root);
    if (unreadable !== null) throw new Unreadable(unreadable);
    const specs: SpecFiles[] = [];
    const archived: SpecFiles[] = [];
    const perSpec: Record<string, SpecRead> = {};
    const copies: Record<string, string> = {};
    const listed = listSpecs(root);
    const worktreeReading = await readWorktreeView(root, listed);
    const { view, branches, worktreeOnly } = worktreeReading;
    const refs = withWorktreeOnly(listed, worktreeOnly);
    const worktrees = view.live.length === 0 ? undefined : { ...view.assignment, worktrees: view.live };
    for (const ref of refs) {
      const main = specFiles(ref.dir, ref.slug);
      if (ref.archived) {
        archived.push(main);
        continue;
      }
      const source = await specSourceFor(root, ref, main, view);
      specs.push(source.files);
      if (source.read !== null) perSpec[ref.slug] = source.read;
      if (source.copy !== null) copies[ref.slug] = source.copy;
    }
    // The main checkout's tree only where a marked spec compares with it: one without a tree of its own (ISC-176).
    const reviewed = specs.some((f) => f.texts.gateCodeReviewed !== undefined && perSpec[f.folder]?.tree === undefined);
    // The repository files from their read source (spec 039, ISC-209): the main checkout's, or a spec worktree's newer one.
    const [master, constitution, tldr, workflowFile, ideas] = await Promise.all([
      readRepoFile(root, "ISA.md", worktreeReading),
      readRepoFile(root, "specs/constitution.md", worktreeReading),
      readRepoFile(root, "specs/tldr.md", worktreeReading),
      readRepoFile(root, "specs/workflow.md", worktreeReading),
      readIdeaSources(root, worktreeReading),
    ]);
    const workflow = parseWorkflow(workflowFile.text);
    const mergeState = mergeStateOf(specs, archived, branches);
    // Each file's conflict once (ISC-209.1): every repository file is read once in this reading.
    const sourceDiagnostics = sourceFindings([master, constitution, tldr, workflowFile, ...ideas.reads]);
    return {
      readable: true,
      workflow,
      ideas: ideas.files,
      ideaSources: ideas.sources,
      viewer: await viewerActorOf(root),
      diagnostics: workflow.diagnostics.map((diagnostic) => ({ file: WORKFLOW_FILE, diagnostic })),
      copies,
      mergeState,
      input: {
        master: master.text,
        constitution: constitution.text,
        tldr: tldr.text,
        ...(tldr.source.kind === "worktree" ? { tldrSource: tldr.source } : {}),
        ...(sourceDiagnostics.length === 0 ? {} : { sourceDiagnostics }),
        specs,
        archived,
        worktreeTree: reviewed ? await worktreeTreeId(root) : null,
        ...(worktrees === undefined ? {} : { worktrees }),
        ...(Object.keys(perSpec).length === 0 ? {} : { perSpec }),
        locks: await readLockSources({ repoRoot: root, lifeosStateDir }),
        workflow,
        mergeState,
      },
    };
  } catch (error) {
    return { readable: false, error: codeOf(error) };
  }
}
