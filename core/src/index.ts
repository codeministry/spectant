// The public surface of `@spectant/core`: the parsers, the pure model functions and every type.
//
// Runtime exports come only from modules that are pure TypeScript with no file system, no Bun API and no Node API,
// so the barrel is safe for the browser bundle. `gates.ts` (in-memory hashing) and `dashboard.ts` (which assembles
// through it) export their types here; the server imports their functions from the module itself. `planning.ts`
// imports only browser-safe parsers at runtime (claims, frontmatter), so it rides the barrel whole. Spec 002's model
// modules (spec.ts, timeline.ts, …) stay out for the reason files.ts gives: several read the file system. Spec 008's
// readers and planners (workflow.ts, ideas.ts, actor.ts, transition.ts, allocate.ts) take their texts from the caller and ride the barrel whole;
// glossary.ts is literal data and rides it too. Spec 009's tokens.ts takes transcript and repository texts from the
// caller and rides it whole. Spec 023's tech.ts takes tech.md and the spec texts from the caller and rides it whole.
// Spec 036's backlog.ts takes the text of `specs/backlog.md` from the caller and rides it whole.
// Spec 027's worktrees.ts takes the text of `git worktree list --porcelain` from the caller and rides it whole.
// Spec 026's relations.ts builds its index from the planning tree alone (type-only imports) and rides it whole.
// Spec 017's catalog types (`LibraryCatalog`, `LibraryDoc`, `SpecGroupHead`, `LibraryFogLine`, …) ride it through
// files.ts; its reader `readCatalog` (library.ts) walks the workspace through node:fs, so it stays out like
// evidence.ts and the server imports it from the module itself; only its types are re-exported here.
// Spec 025's spec edges: `splitSpecEdges` rides the barrel with claims.ts, and spec-ref.ts (pure string helpers,
// `SPEC_ID` and `specIdOf`) rides it whole, so a reader can match an edge's `NNN` to its active or archived folder.
// spec-edges.ts (`resolveEdges`, `edgeMet`) takes the folder texts and the server's merge state from the caller, runs
// no git and reads no file, and rides it whole.
// Spec 040's item-state.ts (`itemStates`, `STATE_TABLE`, the default ages) takes the parsed workspace, the dashboard
// model and the task runs from the caller, imports dashboard.ts for types only and neither gates.ts nor locks.ts, so it
// rides it whole; its types `ItemStateInfo`, `ItemState`, `ItemRun`, `ItemWaits` and `OpenRun` ride with files.ts.
// Spec 031's spec-text.ts (`specFolderText`, `mintClaimsText`, `projectClaimsText`, `appendVerificationText`,
// `appendDecisionText`) takes the file texts from the caller, imports only claims.ts and frontmatter.ts, writes nothing and
// rides it whole; the plugin CLI writes what it returns.
// Spec 020's guidance.ts (`guidanceOf`, `withGuidance`, `guidanceOfSpec`) takes the workspace, the dashboard model and
// the item states from the caller and reads no file, so it is browser-safe and rides it whole; its types ride with files.ts.
// Spec 015's steps.ts (`taskSteps`) takes the lock reading and the spec folder's texts from the caller and reads no
// file; the ISC-213 helper `runSpecOf` it shares with locks.ts lives in spec-ref.ts, so it rides it whole.
// Spec 031's activity-text.ts (`claimLine`, `releaseLine`, `runStartLine`, `runEndLine`, `runEventLine`, `probeLine`,
// `questionLine`, `newRunId`) plans the lines of `.spectant/activity.jsonl` from the caller's input, imports only
// actor.ts, spec-ref.ts and types, writes nothing and rides it whole; the plugin CLI appends what it returns.
// Spec 010's pack.ts (`buildPack`, `capPack`, `PACK_LIMIT`, `PackError`) takes the spec folder's and the constitution's
// texts from the caller, imports only archive.ts, claims.ts and tasks.ts, reads no file and rides it whole.
export * from './files.ts';
export * from './spec-ref.ts';
export * from './spec-edges.ts';
export type * from './diagnostics.ts';
export * from './relations.ts';
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
export * from './gantt.ts';
export * from './workflow.ts';
export * from './ideas.ts';
export * from './actor.ts';
export * from './assignee.ts';
export * from './transition.ts';
export * from './allocate.ts';
export * from './spec-text.ts';
export * from './activity-text.ts';
export * from './glossary.ts';
export * from './tokens.ts';
export * from './backlog.ts';
export * from './tech.ts';
export * from './worktrees.ts';
export * from './repo-source.ts';
export * from './item-state.ts';
export * from './guidance.ts';
export * from './steps.ts';
export * from './pack.ts';
export type * from './gates.ts';
export type * from './dashboard.ts';
export type * from './library.ts';
