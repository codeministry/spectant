/**
 * The `writes/` slice's one public surface (spec 059): the write mechanism (`run-write.ts`) and the write paths on
 * top of it, the stage move, the allocation, the backlog and the run release, plus the in-place primitives, the raw
 * sha256 and the gate hashes the routes and the CLI write and compare with.
 */
export { appendInPlace, writeInPlace } from "../infra/fs/in-place.ts";
export { rawSha256 } from "../infra/hash.ts";
export { gateHashes } from "../workspace/index.ts";
export { type WriteInput, type WriteRead, type WriteResult, ensureGatesDir, runWrite, specLocks } from "./run-write.ts";
export { type TransitionWriteInput, writeTransition } from "./transition.ts";
export { type AllocateWriteInput, writeAllocate } from "./allocate.ts";
export { type BacklogWriteInput, writeBacklog } from "./backlog.ts";
export { type RunReleaseWriteInput, writeRunRelease } from "./run-release.ts";
