// The public surface of `@spectant/core`: the parsers, the pure model functions and every type.
//
// Runtime exports come only from modules that are pure TypeScript with no file system, no Bun API and no Node API,
// so the barrel is safe for the browser bundle. `gates.ts` (in-memory hashing) and `dashboard.ts` (which assembles
// through it) export their types here; the server imports their functions from the module itself. Spec 002's model
// modules (spec.ts, timeline.ts, …) stay out for the reason files.ts gives: several read the file system.
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
export type * from './gates.ts';
export type * from './dashboard.ts';
