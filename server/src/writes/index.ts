/**
 * The `writes/` slice's one public surface (spec 059): the write mechanism (`run-write.ts`) and the write paths on
 * top of it, the reviewed mark, the task tick, the stage move, the allocation, the backlog, the run release and the
 * feature-level code-review mark, the write routes' answers (`routes.ts`), plus the in-place primitives, the raw
 * sha256 and the gate hashes the routes and the CLI write and compare with.
 */
export { appendInPlace, writeInPlace } from "../infra/fs/in-place.ts";
export { rawSha256 } from "../infra/hash.ts";
export { gateHashes } from "../workspace/index.ts";
export { type WriteInput, type WriteRead, type WriteResult, ensureGatesDir, runWrite, specLocks } from "./run-write.ts";
export { type GateWriteInput, writeGateReviewed } from "./gate.ts";
export { type CheckboxWriteInput, writeTaskCheck } from "./checkbox.ts";
export { type TransitionWriteInput, writeTransition } from "./transition.ts";
export { type AllocateWriteInput, writeAllocate } from "./allocate.ts";
export { type BacklogWriteInput, writeBacklog } from "./backlog.ts";
export { type RunReleaseWriteInput, writeRunRelease } from "./run-release.ts";
export {
  FEATURE_ARG,
  FEATURE_GATE_TO,
  type FeatureGateOptions,
  type FeatureGateResult,
  type FeatureGateTarget,
  codeReviewFeature,
  featureGateEventCommand,
  featureMarkPath,
} from "./feature-gate.ts";
export {
  type AllocateRouteInput,
  type BacklogRouteInput,
  type RunReleaseRouteInput,
  type TransitionRouteInput,
  type WorkspaceWriteRoute,
  type WorkspaceWriteRoutes,
  allocateAnswer,
  backlogAnswer,
  runReleaseAnswer,
  transitionAnswer,
  workspaceWriteHandlers,
  workspaceWriteRoutes,
} from "./routes.ts";
export { type SpecWriteContext, type SpecWriteRoute, specWriteHandlers } from "./spec-handlers.ts";
