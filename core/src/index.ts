// The public surface of `@spectant/core`: the parsers, the pure model functions and every type.
//
// Runtime exports come only from modules that are pure TypeScript with no file system, no Bun API and no Node API,
// so the barrel is safe for the browser bundle. `gates.ts` (in-memory hashing) and `dashboard.ts` (which assembles
// through it) export their types here; the server imports their functions from the module itself. `planning.ts`
// imports only browser-safe parsers at runtime (claims, frontmatter), so it rides the barrel whole. Spec 002's model
// modules (spec.ts, timeline.ts, …) stay out for the reason files.ts gives: several read the file system. Spec 008's
// readers and planners (workflow.ts, ideas.ts, actor.ts, transition.ts, allocate.ts) take their texts from the caller and ride the barrel whole;
// glossary.ts is literal data and rides it too. Spec 009's tokens.ts takes transcript and repository texts from the
// caller and rides it whole.
export * from './files.ts';
export type * from './diagnostics.ts';
export * from './frontmatter.ts';
export * from './claims.ts';
export * from './status.ts';
export * from './stage.ts';
export * from './takeable.ts';
export * from './diagrams.ts';
export * from './tldr.ts';
export * from './markdown.ts';
export * from './archive.ts';
export * from './milestones.ts';
export * from './planning.ts';
export * from './workflow.ts';
export * from './ideas.ts';
export * from './actor.ts';
export * from './assignee.ts';
export * from './transition.ts';
export * from './allocate.ts';
export * from './glossary.ts';
export * from './tokens.ts';
export type * from './gates.ts';
export type * from './dashboard.ts';
