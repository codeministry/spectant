/**
 * The `workspace/` slice's one public surface (spec 059): one registered repository read into the dashboard model,
 * its worktree view, the read sources of its repository files and specs, and the library's catalog loads.
 */
export type { UnreadableCode } from "../contracts/spec-routes.contract.ts";
export { unreadableCode, workspaceUnreadable } from "../infra/fs/errno.ts";
export { readBytesIfExists, readIfExists } from "../infra/fs/read.ts";
export { worktreeTreeId } from "../infra/git/tree-id.ts";
export { gateHashes, readIdeaFiles, readSpecFiles } from "./spec-files.ts";
export { type WorkspaceReading, mergeStateOf, readWorkspaceInput, viewerActorOf } from "./reading.ts";
export { type DashboardLoad, type ServicesProbe, type StateClock, loadDashboard, workspaceItemStates } from "./load.ts";
export {
  type CheckoutFacts,
  type RepoFacts,
  type WorktreeReading,
  insideRepository,
  readWorktreeView,
  timelineWorktreeOf,
  withWorktreeOnly,
} from "./worktree-view.ts";
export { type IdeaSources, type RepoFileReading, readIdeaSources, readRepoFile } from "./repo-files.ts";
export { readCopies, readSpecSource, resolveWorkspaceSpec } from "./spec-source.ts";
export { type CatalogLoad, type CopiesLoad, loadCatalog, loadCatalogDoc, loadCatalogDocs, readRepoCatalogFiles } from "./catalog-load.ts";
