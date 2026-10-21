/**
 * The `spec/` slice's one public surface (spec 059): the spec routes, every path under `/api/workspaces/:ws/specs`,
 * their seven reads and the dispatch of the three writes on a spec, plus the timeline's ETag.
 */
export { specRoutesApi } from "./handler.ts";
export { type SpecRoutesOptions, timelineEtag } from "./reads.ts";
