// The server's git reads (`infra/git/`): every one runs only read-only git commands under one environment and root
// rule, never fetches and never throws. This file is the area's public surface; the helpers the files share stay
// inside it.
export { type CommitsOptions, type CommitsResult, CommitCache, DEFAULT_LIMIT, type GitCommit, commitsFor, parseLog } from "./commits.ts";
export {
  MergeCache,
  type MergeCommit,
  type MergedBranchesOptions,
  SPEC_BRANCH_PREFIXES,
  type SpecBranch,
  type SpecBranches,
  mergeCommitOf,
  mergedSpecBranches,
} from "./merges.ts";
export { type TakenNumbers, type UserEmailOptions, takenSpecNumbers, userEmail } from "./refs.ts";
export { DEFAULT_TIMEOUT_MS, type GitRun, type GitRunner, defaultGitRunner, mapBounded } from "./runner.ts";
export { aheadOfMain, changedPaths, dirty, lastCommits, trackedPlanningPaths, trackedSpecPaths, worktreeList } from "./worktrees.ts";
