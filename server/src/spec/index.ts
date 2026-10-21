/**
 * The `spec/` slice's one public surface (spec 059): the spec routes, every path under `/api/workspaces/:ws/specs`,
 * their family, their seven read handlers and their composition with the three write handlers of `writes/`, plus the
 * timeline's ETag.
 */
export { SPEC_FAMILY } from "./family.ts";
export { type SpecReadMatch, specReadHandlers, specRoutesApi } from "./handler.ts";
export { type SpecRoutesOptions, timelineEtag } from "./reads.ts";
