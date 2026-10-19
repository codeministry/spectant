/**
 * The stub `/api` the e2e and visual suites run against (T57, ISC-17; T52, ISC-78; plan 001 § Approach "Server and UI
 * split", plan 002 § Interfaces "HTTP"). `serve-dist.ts` plugs it into its `api` seam, so `bun run e2e` /
 * `test:visual` need neither the binary nor a registry: every body is a golden snapshot, `core/fixtures/<golden>…
 * .golden.json`, the model the real server returns for that fixture tree.
 *
 * The contract is the real server's, answer for answer (`server/src/api.ts`, `server/src/settings.ts`,
 * `server/src/lifeos.ts`, `server/src/spec-routes.contract.ts`; the parity half of `stub-api.test.ts` sends the same
 * requests to both and compares status, headers and bytes):
 *
 * - `GET|HEAD /api/workspaces` → `[{slug, name, pathTail, readable, error?, counts}]` in list order, `counts` = the
 *   golden's `kpis`, `null` when unreadable.
 * - `GET|HEAD /api/workspaces/:slug/dashboard` → the golden model, serialized as the server does (`JSON.stringify`);
 *   404 `{error: "not-found"}` for an unknown slug; 409 with the list entry for the unreadable workspace.
 * - Every route of `WORKSPACE_ROUTE_TABLE` with a golden family (`GET|HEAD /api/workspaces/:ws/planning`, spec 003
 *   T20): the whole golden
 *   file of the route's family, `core/fixtures/<golden>.planning.golden.json` (`GOLDEN_FAMILY.planning`), not keyed by
 *   folder; matched with the contract's `matchWorkspacePath`. The goldens are built at `2026-03-20`, so a live server
 *   answer can differ in the milestones' `state` alone. Same guards as the dashboard: 403, 405 with
 *   `allowForWorkspace(route)`, 404 `{error: "not-found"}` for an unknown slug, 409 with the list entry for the
 *   unreadable workspace; the lock and write headers change nothing here.
 * - The library (spec 017, T3, ISC-156), under the same guards: `GET|HEAD …/:ws/library/asset?path=` the fixture
 *   tree's image under `specs/` with the evidence file's headers (`evidenceFileHeaders(mediaTypeOf(name))`, strong ETag over the bytes, 304, HEAD without a body):
 *   403 for a path that leaves `specs/` (a `..` segment, an absolute path, a backslash, a control character, a
 *   second encoding layer, a symlink out, a file that is not an image), 404 for no regular file. `GET|HEAD …/:ws/library` the workspace's
 *   `LibraryCatalog`, core's `readCatalog` over the fixture tree made deterministic (`buildCatalog`: fixed times,
 *   group heads and fog lines from the spec goldens and `core/fixtures/<golden>.tech.golden.json`, `TECH_GOLDEN_FAMILY`) plus `STUB_LIBRARY` on harbor (a `stale` plan, a
 *   `missing` tasks.md, 57 evidence documents in 002, a prototype with two pages and a preview, the reader's prose
 *   cases appended to 002's T18 artifact); `…/library/doc?path=`
 *   one Markdown document of that catalog as core's `renderDocsMarkdown` page, 404 for any path it does not list as
 *   one; `…/library/search?q=` the `LibrarySearchResult` over those documents, `{query: '', hits: []}` for a blank `q`.
 *   The tech page's routes (`…/tech`, `…/tech/asset`) went with spec 017 T51. `GET|HEAD /proto/:ws/:spec/:folder/*` (outside `/api`;
 *   `serve-dist.ts` forwards it here) one file of a catalog prototype through core's resolver, every answer with
 *   `PROTOTYPE_CSP`; on harbor's stub prototype also the stub-only page `STUB_LIBRARY.prototype.offline` (T40).
 * - Every route of `SPEC_ROUTE_TABLE` (`…/specs/:id…`): the per-spec value of the route's golden family
 *   (`core/fixtures/<golden>.<family>.golden.json`, keyed by `specs/<folder>`), `:id` resolved as `core/src/resolve.ts`
 *   does (`NNN`, folder or bare slug, archived folders too). 404 `NotFound` for an unknown workspace, spec or task, 409
 *   for the unreadable workspace, 405 with `allowFor(route)`. The evidence files come from the fixture tree's real
 *   `artifacts/` and `.evidence/` (also `.design/`) through core's `resolveEvidencePath` (403 for what confinement
 *   refuses). The evidence listing and the Docs tabs went with spec 017 T53. The two
 *   hash headers carry deterministic fake sha256 hex values the client sends back with a write.
 * - Every JSON answer carries `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-cache` and the strong
 *   ETag `"<sha256 base64url of the body>"` (`JSON_ANSWER`); a matching `If-None-Match` on a 200 is a 304. 405
 *   `{error: "method-not-allowed"}` with `Allow`, 403 `{error: "forbidden"}` for a foreign `Host` or a cross-site
 *   `Origin`.
 * - `GET|HEAD /api/lifeos` → `{present}`, true only under the `frontier` lock fixture.
 * - `GET|HEAD|PUT /api/settings` → `{theme, language, density, refreshSeconds, singleKeyShortcuts, railCollapsed, notesImportDismissed, runAbortMinutes}`, held in memory from the
 *   `SettingsSchema` defaults, validated as the server does (400 `{error, key}` / `{error: "invalid-body"}`), weak
 *   ETag `W/"<Bun.hash base36>"`, 405 with `Allow: GET, HEAD, PUT`.
 * - The notes routes of `NOTE_ROUTE_TABLE` (`server/src/notes.contract.ts`, T94; `server/src/notes.ts`, T95): list with
 *   `parseNotesQuery`, `note-counts`, `POST` (201), `PUT` (the draft replaced whole), `DELETE` (204, `no-store`), held in
 *   memory per session and seeded with `STUB_NOTES` (three notes on harbor 002, one per anchor kind). Ids and times are
 *   deterministic: the n-th write of a session is stamped `STUB_NOW` plus n minutes.
 * - The Stage-3 board seam (spec 008, T119, `stub-board.ts`), per session like the writes: `GET|HEAD …/planning` is the
 *   session's tree (the golden until a board write); `GET|HEAD …/ideas/:slug` the `IdeaPage` (the tree's `IdeaRef`,
 *   core's `renderDocsMarkdown` over the fixture's story file, its raw sha256); `GET|HEAD|PUT …/board-query` and
 *   `GET|HEAD|PUT /api/actors` in memory with the server's validation (`isBoardQuery`, `isActorMappings` plus persons
 *   only); `GET …/specs/:id` adds `X-Spectant-Spec-Hash`, the holder's hash. The two board writes answer by the request:
 *   `POST …/specs/:id/transition` 400 → 409 (hash not the holder's, or `stale`) → 423 (a lock of the fixture on the
 *   spec, or `locked`) → 422 (a move the workflow row does not list) → 200 (the holder moved); `POST …/ideas/:slug/
 *   allocate` 400 → 404 → 409 (hash not the story file's, or `stale`) → 423 (`locked` only) → 422 (`not-in-index`
 *   from the golden's `ideas-index` finding) → 200 (the story gone, the new spec at `plan`).
 * - `GET /api/events` (`EVENTS_PATH`, spec 030, plan 030 § Interfaces) → 200 `text/event-stream`, `Cache-Control:
 *   no-cache`, and the stream stays open: a `: ping` comment at once and every `LIVE_HEARTBEAT_MS`, and one
 *   `event: update` (`LIVE_EVENT`) frame whose `data:` is a `LiveUpdate` per `POST /api/__stub/bump` of the stream's
 *   session (below). 403 `{error: "forbidden"}` for a foreign `Host` or a cross-site `Origin`, 405 with
 *   `Allow: GET` (`EVENTS_ALLOW`) for any other method, HEAD included. Open streams are held in memory per session.
 * - Any other `/api` path is the server's JSON 404, `{error: "not found"}`.
 *
 * Test controls, which the real server does not have (web/e2e/README.md § The stub API), each chosen per request so
 * parallel workers never race; an unknown value is a loud 400, never a silent default:
 *
 * - `X-Spectant-Stub-State: two-workspaces | empty | unreadable` picks the workspace state (absent: `two-workspaces`).
 * - `X-Spectant-Stub-Locks: none | activity | frontier` picks the lock fixture (absent: `activity`, what the goldens
 *   hold). `none` releases every lock; `frontier` relabels the golden's locks `frontier`, adds a second frontier
 *   session on another open claim and makes LifeOS present. `runs` (spec 040, T53) keeps every golden as `activity`
 *   has it and lists the fixture tree `beacon` after the other workspaces (`STUB_RUN.workspace`), rebuilt by core
 *   (`runVariant`: `itemStates` over core's `activityReading` of its log, at `STUB_NOW`, the default abort age); a
 *   400 beside `X-Spectant-Stub-Worktrees: on`, `X-Spectant-Stub-Edges` or `X-Spectant-Stub-Midnight: on`.
 * - `X-Spectant-Stub-Run: none | running | ended` switches beacon's `/spec-tasks 003` run (`STUB_RUN`) under the
 *   `runs` locks (absent: `running`; a 400 under any other lock fixture), each body derived by core from the edited
 *   log, never written by hand: `none` drops its run-start line, so 003 reads `open` with `/spec-tasks 003`;
 *   `running` is the log as it is, every body beacon's golden (003 `running` since 14:52); `ended` appends its
 *   `run-end` with outcome `ok`, so 003 reads the state its files give, which no file change moves: `open` again.
 * - `X-Spectant-Stub-Waits: 0 | 1 | 7` (spec 020, T15) picks how many entries wait on the principal in the first
 *   workspace column of the start (`STUB_WAITS`; absent: the goldens as they are), each body core's own output:
 *   `0` lists lantern alone (its golden holds no waiting entry), `1` lists beacon rebuilt by core without its folder
 *   `009-timezone-labels` (`runVariant`; only 004's review waits) before lantern, `7` lists harbor (its golden's
 *   seven) before lantern. A 400 beside `X-Spectant-Stub-Locks: runs`, `-Worktrees: on`, `-Edges` or `-Midnight: on`.
 * - `X-Spectant-Stub-Dense: off | on` (spec 021, T5; absent: `off`, the goldens as they are): `on` lists harbor alone,
 *   its dashboard rebuilt by core over its tree plus fourteen done specs and a fresh TL;DR (`STUB_DENSE`): 22 specs,
 *   3 Next-up entries, a first brief section of at most 400 characters, harbor's own warnings. Harbor's 002 to 006 and 009 carry the long
 *   titles and goals of `STUB_DENSE.long` (T34, ISC-248), so every spec row's and Next-up entry's "More…" appears
 *   through overflow; the spec page of each such spec is core's over the edited spec.md, so `/w/harbor/s/002` shows a
 *   goal sentence long enough for the spec head's goal toggle at every width (`STUB_DENSE.goalSpec`); every other
 *   spec page stays the golden's. The library adds `STUB_DENSE.doc` (T53, ISC-251), a document with 20 `##` sections
 *   and about 30 screens at 1440 × 900, rendered by core: `/w/harbor/library#002-web-console/artifacts/
 *   T40-console-operations-guide.md`, a 404 without the header. Its other routes stay the golden's. A 400 beside
 *   `X-Spectant-Stub-Waits`, `-Locks: runs`, `-Worktrees: on`, `-Edges` or `-Midnight: on`.
 * - `X-Spectant-Stub-Write: ok | stale | locked` scripts the two writes (absent: `ok`). `ok` answers as the server
 *   does: 200 when the hashes sent equal the ones the stub last sent, else 409; `stale` is always 409 `Conflict`,
 *   `locked` always 423 `Locked`. The board writes (transition, allocate) honour it the same way.
 * - `X-Spectant-Stub-Library: catalog | empty` picks the library (absent: `catalog`): `empty` answers every readable
 *   workspace with `EMPTY_CATALOG`, a workspace without one document (the `empty` state lists no workspace at all).
 * - `X-Spectant-Stub-Session: <id>` scopes the settings and the writes (absent: one shared session);
 *   `POST /api/__stub/reset` restores that session's settings and notes, drops its writes and bumps and closes its
 *   open `/api/events` streams (204).
 * - `POST /api/__stub/bump?ws=<slug>` changes that workspace's dashboard for that session between two polls (T68,
 *   ISC-62): each call raises `kpis.claims.closed` by one, so the body and its ETag change as a file on disk would.
 *   Before its 204 it also pushes one `update` frame to every open `/api/events` stream of that session (spec 030,
 *   T17), as the real stream does after a change on disk: `{ws, views}` with the workspace's dashboard, planning tree
 *   and every spec page (`specs/NNN`), each view's `etag` and `body` the stub's own `GET` of that path with the
 *   stream's headers, so a page that primes its cache with them gets a 304 on its next poll; a path that does not
 *   answer 200 under those headers is left out. 404 for a workspace the stub does not hold; 405 with `Allow: POST`
 *   for another method.
 * - `PUT /api/__stub/workflow?ws=<slug>` with a `specs/workflow.md` text as the body stands in for an edit of that
 *   workspace's workflow file (T151, ISC-123): core's `parseWorkflow` reads the text, and that session's planning tree
 *   carries the result as its `workflow` until a reset, so the next read shows the changed table (body and ETag). 204;
 *   404 for a workspace the stub does not hold; 405 with `Allow: PUT` for another method.
 * - `X-Spectant-Stub-Worktrees: off | on` lays the worktree overlay of spec 027 over harbor (T33, `stub-board.ts`;
 *   absent: `off`, the goldens as they are): worktrees with branch, `ahead` and `dirty` on 002, 003 and 009 (003's a
 *   branch mismatch, its warning on the row, the panel, the page and the counts), 002 read from its worktree copy with
 *   the main copy beside it, runs in every state on harbor 002's live frame and its round group, and a `worktree`
 *   timeline entry on 007 (merged) and 006 (removed).
 * - `X-Spectant-Stub-Edges: off | waiting | met` serves harbor rebuilt by core with the spec edges of `STUB_EDGES`
 *   (spec 025, T20; absent: `off`, the goldens as they are): 009 waits on 002 whole, 002's web tasks on 006, 002's
 *   ticked T1 names the unknown 042; under `met` the blockers are merged and every wait is gone. A 400 beside
 *   `X-Spectant-Stub-Worktrees: on`.
 * - `X-Spectant-Stub-Midnight: off | on` (spec 006, T4; absent: `off`, the goldens as they are): `on` puts the
 *   instant of `STUB_MIDNIGHT`, half an hour before midnight UTC, on harbor 002's reviewed mark, its newest round and
 *   reviewed event in the timeline, and its spec.md's `modified` in the library catalog; a 400 beside
 *   `X-Spectant-Stub-Worktrees: on` or `X-Spectant-Stub-Edges`. The milestone day of the same spec is `STUB_MILESTONE`,
 *   the planning golden's own.
 * - `POST /api/__stub/bump-run?ws=<slug>&spec=<id>&task=<tid>` moves that task's run one run event on for that session
 *   (T33): none → dispatched → building → patched → applied-open (`applied` once tasks.md ticked it); the last stays.
 *   The live frame's body and ETag change as an activity log line would change them. 204; 404 for an unknown
 *   workspace, spec or task, or an `absent` card; 405 with `Allow: POST` for another method. A reset drops it.
 *
 * Nothing here reads the clock or the registry: every answer is a function of the fixture files and the request. The
 * goldens are read once when the stub is built, so a missing fixture fails at startup, not on a request. Core's
 * `resolveEvidencePath`, `renderDocsMarkdown` and `worstState` are loaded at runtime by a computed path, because
 * the core modules they pull in do not type-check under this tsconfig; their shapes are declared below.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

import type {
  ActorRef,
  AgentLockSource,
  CardState,
  ClaimLock,
  ClaimViewModel,
  DocName,
  DocsPage,
  EvidencePathResult,
  Frame,
  GateView,
  LibraryCatalog,
  LibraryDoc,
  LibraryFogLine,
  LiveAgent,
  LiveCard,
  LiveFrame,
  LockSource,
  MergeState,
  SpecEdge,
  SpecFiles,
  SpecGroupHead,
  SpecPageModel,
  SpecWait,
  TaskRow,
  TaskRun,
  TaskStatus,
  TaskSteps,
  TasksTab,
  TechModel,
  TimelineEntry,
  Workflow,
} from '../../core/src/files';
import { parseActor } from '../../core/src/actor';
import type { PlanningHolder, PlanningModel } from '../../core/src/planning';
import {
  ACTIVITY_HASH_HEADER,
  ACTORS_ALLOW,
  ACTORS_PATH,
  EVENTS_ALLOW,
  EVENTS_PATH,
  LIVE_EVENT,
  SPEC_HASH_HEADER,
  type LiveUpdate,
  type LiveView,
  specRoutes,
  workspaceRoutes,
  isActorMappings,
  isAllocateRequest,
  isBacklogRequest,
  isBoardQuery,
  isTransitionRequest,
  runReleaseRequestFromHeader,
  type ActorMapping,
  type AllocateRefused,
  type BacklogRefused,
  type BoardQuery,
  type IdeaAllocated,
  type IdeaPage,
  type TransitionRefused,
  type TransitionWritten,
  GOLDEN_FAMILY,
  REVIEWED_HASHES_HEADER,
  REVIEWED_HASH_FILES,
  TASKS_HASH_HEADER,
  allowFor,
  allowForWorkspace,
  evidenceFileHeaders,
  evidencePathQuery,
  formatReviewedHashes,
  isGateReviewedRequest,
  isTaskCheckRequest,
  matchSpecPath,
  matchSpecRoute,
  matchWorkspacePath,
  matchPrototypePath,
  prototypeFolderOf,
  PROTOTYPE_ALLOW,
  PROTOTYPE_CSP,
  PROTOTYPE_PREFIX,
  type LibrarySearchHit,
  type LibrarySearchResult,
  type PrototypeRouteMatch,
  type Conflict,
  type GateReviewedResponse,
  type Locked,
  type ReviewedHashFile,
  type ReviewedHashes,
  type SpecRouteMatch,
  type TaskCheckResponse,
  type WorkspaceRouteMatch,
  type WorkspaceRouteName,
  type LibraryDocPage,
} from '../../server/src/spec-routes.contract';
import {
  type Note,
  type NoteCounts,
  type NotesQuery,
  matchNoteRoute,
  noteAllowFor,
  parseNewNote,
  parseNoteCountsQuery,
  parseNoteDraft,
  parseNotesQuery,
} from '../../server/src/notes.contract';
import type { ApiHandler } from './serve-dist';
import {
  OVERLAY_GOLDEN,
  STUB_RUNS,
  STUB_TIMELINE_WORKTREES,
  type StoryFile,
  advancedRun,
  allocatedPlanning,
  commandFor,
  holderOf,
  loadBoardCore,
  movedPlanning,
  overlaidDashboard,
  rawSha256,
  overlaidPage,
  readStories,
  refusalOf,
  rowFor,
  withBacklogText,
  withRuns,
  withWorktreeEntry,
} from './stub-board';

/** The e2e states the spec names (ISC-16.1): two workspaces, none, and one whose directory cannot be read. */
export const STUB_STATES = ['two-workspaces', 'empty', 'unreadable'] as const;
export type StubState = (typeof STUB_STATES)[number];

/**
 * The lock fixtures (ISC-85, ISC-86): no source, the repository's activity log (the goldens), a LifeOS frontier; for
 * who works a task (T149, ISC-131.1) the log's claim lines without their releases, and the golden's locks held by a
 * person; for the item states (spec 040, T53) the goldens as `activity` has them plus the fixture tree `beacon` with
 * its run variants (`X-Spectant-Stub-Run`, `runVariant`).
 */
export const LOCK_STATES = ['none', 'activity', 'frontier', 'claims', 'person', 'runs'] as const;
export type LockState = (typeof LOCK_STATES)[number];

/** The scripted outcomes of the two writes (ISC-26, ISC-86). */
export const WRITE_OUTCOMES = ['ok', 'stale', 'locked'] as const;
export type WriteOutcome = (typeof WRITE_OUTCOMES)[number];

export const STATE_HEADER = 'X-Spectant-Stub-State';
export const SESSION_HEADER = 'X-Spectant-Stub-Session';
export const LOCKS_HEADER = 'X-Spectant-Stub-Locks';
export const WRITE_HEADER = 'X-Spectant-Stub-Write';
export const RESET_PATH = '/api/__stub/reset';
export const BUMP_PATH = '/api/__stub/bump';
export const WORKFLOW_PATH = '/api/__stub/workflow';
export const BUMP_RUN_PATH = '/api/__stub/bump-run';
/** The stub stream's heartbeat, the real route's `: ping` interval (plan 030), under Bun's `idleTimeout` of 10 s. */
export const LIVE_HEARTBEAT_MS = 5_000;

/**
 * The worktree overlay of spec 027 (T33, `stub-board.ts`): `off`, the goldens as they are; `on`, harbor's worktree
 * facts, runs and worktree timeline entries laid over them. Absent: `off`.
 */
export const WORKTREE_STATES = ['off', 'on'] as const;
export type WorktreeState = (typeof WORKTREE_STATES)[number];
export const WORKTREES_HEADER = 'X-Spectant-Stub-Worktrees';

/**
 * The library fixtures (spec 017, ISC-156): the workspace's catalog, or none at all. The `empty` workspace state lists
 * no workspace, so every library route there is a 404 as on the server; a readable workspace without one document is
 * this header's `empty` (the page's empty state, `/spec-bootstrap`).
 */
export const LIBRARY_STATES = ['catalog', 'empty', 'tech-heading'] as const;
export type StubLibraryState = (typeof LIBRARY_STATES)[number];
export const LIBRARY_HEADER = 'X-Spectant-Stub-Library';

/**
 * `tech-heading` (ISC-157.2): harbor's catalog as `catalog`, its tech.md served with the architecture section under this
 * heading instead of `## Architecture`, so the reader must take the section from core's `techSections`, not the words.
 */
export const STUB_TECH_HEADING = 'How Harbor is built';
const TECH_ARCHITECTURE_HEAD = '<!-- section: architecture -->\n## Architecture\n';

function techHeadingText(text: string): string {
  if (!text.includes(TECH_ARCHITECTURE_HEAD)) throw new Error('stub-api: tech.md has no architecture section to rename');
  return text.replace(TECH_ARCHITECTURE_HEAD, `<!-- section: architecture -->\n## ${STUB_TECH_HEADING}\n`);
}

/** The catalog of a workspace without one document: what `readCatalog` returns for a tree with no spec folder. */
export const EMPTY_CATALOG: LibraryCatalog = { docs: [], groups: [], fog: [], missing: 0, stale: 0 };

/**
 * What the stub adds to harbor's catalog, so one workspace carries every case the library page draws (T3): a `stale`
 * plan, a `missing` tasks.md (the one core reports for harbor, ISC-155.2: 003 has a plan but no tasks; core marks
 * only plan.md and tasks.md missing), more than 50 evidence documents in one spec (the collapsed subgroup that loads
 * in blocks) and a prototype with two pages and a preview. The evidence documents are Markdown the stub
 * holds; the prototype's files are the library fixture's `002-tide-board/.design/prototype/board/` (two HTML pages,
 * CSS, script, image), served under harbor's `004-retention-policies/.design/prototype/board`.
 *
 * `reader` (T35, ISC-156.3): the reader's prose cases in one document no fixture file holds together. The stub serves
 * harbor's `T18-e2e-report.md` artifact with `appendix` after its own text: level-2 headings for the table of
 * contents, a mermaid fence, a relative image under `.evidence/` (a file of the fixture tree, so the asset route serves
 * its bytes) and two relative links to other catalog documents. The catalog entry (path, title) stays core's, so the
 * list draws exactly what it drew before.
 */
export const STUB_LIBRARY = {
  reader: {
    path: '002-web-console/artifacts/T18-e2e-report.md',
    image: '002-web-console/.evidence/kpi-band-390.png',
    xrefs: ['002-web-console/artifacts/T13-routes.md', '002-web-console/plan.md'],
    appendix: [
      '',
      '## Reading path',
      '',
      '```mermaid',
      'flowchart LR',
      '  rows[Rows] --> reader[Reader]',
      '  reader --> spec[Spec page]',
      '```',
      '',
      '## Captured band',
      '',
      '![The KPI band at 390](../.evidence/kpi-band-390.png)',
      '',
      '## Related records',
      '',
      'The route table stands in [T13 — routes](T13-routes.md); the approach in [the plan](../plan.md).',
      '',
    ].join('\n'),
  },
  stale: '004-retention-policies/plan.md',
  missing: { path: '003-config-loader/tasks.md', type: 'tasks', after: '003-config-loader/plan.md' },
  evidence: { spec: '002-web-console', count: 56, after: '002-web-console/.evidence/kpi-band-390.png' },
  prototype: {
    path: '004-retention-policies/.design/prototype/board',
    after: '004-retention-policies/.design/mobile-ist.png',
    preview: '004-retention-policies/.design/mobile-ist.png',
    source: ['library', 'specs', '002-tide-board', '.design', 'prototype', 'board'],
    /**
     * `offline` (T40, ISC-159.2): a page only the stub serves, in the prototype's folder but not among its catalog
     * `pages` (so no fixture file carries an external URL): it names an external stylesheet, an external script and
     * an `@font-face` source on hosts of the reserved `.example` TLD (RFC 2606). The prototype route's CSP must keep
     * the browser from asking for any of them; `offline.spec.ts` opens it in a prototype tab under a guard that
     * aborts and records every non-loopback request.
     */
    offline: {
      file: 'offline.html',
      external: {
        stylesheet: 'https://cdn.example/prototype/theme.css',
        script: 'https://cdn.example/prototype/widget.js',
        font: 'https://fonts.example/far-sans.woff2',
      },
      family: 'Far Sans',
    },
  },
} as const;

/** The stub-only prototype page `STUB_LIBRARY.prototype.offline` as it is served. */
export function stubOfflinePrototypeHtml(): string {
  const { external, family } = STUB_LIBRARY.prototype.offline;
  return [
    '<!doctype html>',
    `<link rel="stylesheet" href="${external.stylesheet}">`,
    `<style>@font-face { font-family: "${family}"; src: url("${external.font}") format("woff2"); } body { font-family: "${family}", sans-serif; }</style>`,
    `<script src="${external.script}"></script>`,
    '<title>Offline probe</title>',
    '<h1>Offline probe</h1>',
    '<p>Every resource of this page lives on a host outside the loopback.</p>',
    '',
  ].join('\n');
}

/** The path of the n-th synthetic evidence document (1-based): `002-web-console/.evidence/run-07/probe.md`. */
export const stubEvidencePath = (n: number): string => `${STUB_LIBRARY.evidence.spec}/.evidence/run-${String(n).padStart(2, '0')}/probe.md`;

/**
 * The workspace routes with a whole-file golden family: the contract's `GOLDEN_FAMILY.planning`.
 */
export const WORKSPACE_GOLDEN_FAMILY = {
  planning: GOLDEN_FAMILY.planning,
} as const satisfies Partial<Record<WorkspaceRouteName, string>>;

/**
 * The tech golden (`core/tests/golden.test.ts` `FAMILIES.tech`, core's `readTech`): no route since spec 017 T51, it
 * still feeds the library catalog's group heads and fog lines (`buildCatalog`).
 */
export const TECH_GOLDEN_FAMILY = 'tech';

/** The dashboard model with `kpis.claims.closed` raised by `by` (the bump hook); the golden itself is never touched. */
export function bumpDashboard(model: unknown, by: number): unknown {
  if (by === 0) return model;
  const copy = structuredClone(model) as { kpis?: { claims?: { closed?: unknown } } };
  const claims = copy.kpis?.claims;
  if (claims && typeof claims.closed === 'number') claims.closed += by;
  return copy;
}

/** The stub's clock: the `now` the live goldens were built with; the `at` of every reviewed mark the stub writes. */
export const STUB_NOW = '2026-03-08T15:00:00Z';

/** The near-midnight fixture (spec 006, T4): `off` serves the goldens as they are, `on` lays `STUB_MIDNIGHT` over harbor. */
export const MIDNIGHT_STATES = ['off', 'on'] as const;
export type MidnightState = (typeof MIDNIGHT_STATES)[number];
export const MIDNIGHT_HEADER = 'X-Spectant-Stub-Midnight';

/**
 * The near-midnight instant (spec 006, T4, ISC-114): under `X-Spectant-Stub-Midnight: on` harbor 002 carries `instant`,
 * half an hour before midnight UTC, as
 *
 * - the reviewed mark's `at` (`gates.reviewed.at` on the spec page, every lock fixture): the gate button in the spec
 *   head and the Status tab's gate row;
 * - the `timeline` entries `round-3` (the newest round) and `gate-reviewed` (the reviewed event): the Status tab's
 *   round summary and Activity rows, the Timeline tab; both stay the newest, so the order is the golden's;
 * - the library document `doc`'s `modified`: its date in the Library list and the Reader's "updated" line.
 *
 * Nothing else changes (other specs, lantern, the dashboard, the planning tree), and without the header every answer
 * is the golden's byte for byte, so no other e2e or visual baseline moves. A 400 beside `X-Spectant-Stub-Worktrees: on`
 * or `X-Spectant-Stub-Edges`. `zones` names a browser zone on each side of UTC with the local day and hour the instant
 * must show there (`utc` the UTC ones), for `test.use({ timezoneId })`; `routes` the pages that show it. The instant
 * lies before `FIXED_NOW` (`fixtures.ts`) and away from any DST switch, so the offsets are fixed: Tokyo +9, Los
 * Angeles -7 (Berlin, the suites' default zone, +2: already the next day).
 */
export const STUB_MIDNIGHT = {
  instant: '2026-08-31T23:30:00Z',
  golden: 'harbor',
  workspace: 'harbor',
  spec: '002',
  folder: '002-web-console',
  doc: '002-web-console/spec.md',
  timeline: ['round-3', 'gate-reviewed'],
  utc: { day: '2026-08-31', hour: 23 },
  zones: {
    east: { timezoneId: 'Asia/Tokyo', day: '2026-09-01', hour: 8 },
    west: { timezoneId: 'America/Los_Angeles', day: '2026-08-31', hour: 16 },
  },
  routes: {
    library: '/w/harbor/library',
    reader: '/w/harbor/library#002-web-console/spec.md',
    status: '/w/harbor/s/002/status',
    timeline: '/w/harbor/s/002/timeline',
  },
} as const;

/**
 * The calendar day of spec 006 (T4, ISC-114.3): harbor's first open milestone some spec names, `target` as the planning
 * golden holds it in every stub state (no header needed, nothing is overlaid). A pure day: read as an instant it is
 * UTC midnight, so a zone west of UTC would show `misreadWest`, the day before; the east shows the day itself. It shows
 * in the planning tree (`routes.tree`), the Gantt lens's group head (`routes.gantt`, spec 038), the board's milestone swimlanes
 * (`routes.board`), the command palette's milestone entry (search `name`) and the page menu's milestones summary,
 * whose "next" is this milestone (`routes.pageMenu`, any harbor page).
 */
export const STUB_MILESTONE = {
  workspace: 'harbor',
  slug: 'harbor-0-9',
  name: 'Harbor 0.9',
  target: '2026-03-15',
  misreadWest: '2026-03-14',
  routes: {
    tree: '/w/harbor/planning/tree',
    gantt: '/w/harbor/planning/gantt',
    board: '/w/harbor/board?group=milestone',
    pageMenu: '/w/harbor',
  },
} as const;

/** Harbor 002 with `STUB_MIDNIGHT.instant` on its reviewed mark and the two timeline entries; a missing one fails loud. */
function midnightTree(tree: TreeGoldens): TreeGoldens {
  const { instant, folder, timeline } = STUB_MIDNIGHT;
  const moved: ReadonlySet<string> = new Set(timeline);
  const found = tree.specs.find((spec) => spec.key === `specs/${folder}`);
  if (found?.timeline.filter((entry) => moved.has(entry.id ?? '')).length !== moved.size) {
    throw new Error(`stub-api: ${tree.golden} has no ${folder} with the timeline entries ${timeline.join(', ')}`);
  }
  const marked = (page: SpecPageModel): SpecPageModel => ({ ...page, gates: { ...page.gates, reviewed: { ...page.gates.reviewed, at: instant } } });
  return {
    ...tree,
    specs: tree.specs.map((spec): SpecGoldens => {
      if (spec !== found) return spec;
      type Fixture = SpecGoldens['locked'][LockState];
      const locked = Object.fromEntries(
        LOCK_STATES.map((s): [LockState, Fixture] => [s, { ...spec.locked[s], spec: marked(spec.locked[s].spec) }]),
      ) as Record<LockState, Fixture>;
      const entries = spec.timeline.map((entry) => (moved.has(entry.id ?? '') ? { ...entry, ts: instant } : entry));
      return { ...spec, spec: marked(spec.spec), timeline: entries, locked };
    }),
  };
}

/** A catalog with `STUB_MIDNIGHT.instant` as the `modified` of `STUB_MIDNIGHT.doc`; texts, prototypes and pages shared. */
function midnightCatalog(stub: StubCatalog): StubCatalog {
  const { instant, doc } = STUB_MIDNIGHT;
  if (!stub.catalog.docs.some((d) => d.path === doc)) throw new Error(`stub-api: the catalog lists no ${doc}`);
  return { ...stub, catalog: { ...stub.catalog, docs: stub.catalog.docs.map((d) => (d.path === doc ? { ...d, modified: instant } : d)) } };
}

/** The notes every session starts with (ISC-95): harbor 002, one per anchor kind, newest first as the server lists. */
// Each seed goes through `seedNote`: `pinned` (notes.contract on main) is on every literal and type-checks on either base.
const seedNote = (note: Note & { pinned?: boolean }): Note => note;
export const STUB_NOTES: readonly Note[] = [
  seedNote({
    id: '00000000-0000-4000-8000-000000000003',
    workspace: 'harbor',
    pinned: false,
    anchor: { kind: 'task', spec: '002', id: 'T1' },
    title: 'Ask about the port',
    body: 'Which port does the console default to?\n\nCheck before T1 lands.',
    created: '2026-03-08T11:15:00.000Z',
    updated: '2026-03-08T11:15:00.000Z',
  }),
  seedNote({
    id: '00000000-0000-4000-8000-000000000002',
    workspace: 'harbor',
    pinned: false,
    anchor: { kind: 'claim', spec: '002', id: 'ISC-51' },
    title: 'Probe for the empty state',
    body: 'The probe should also cover an **empty** workspace.\n\nSee `bun run e2e -- smoke`.',
    created: '2026-03-07T14:30:00.000Z',
    updated: '2026-03-07T14:30:00.000Z',
  }),
  seedNote({
    id: '00000000-0000-4000-8000-000000000001',
    workspace: 'harbor',
    pinned: false,
    anchor: { kind: 'spec', spec: '002' },
    title: 'Rollout order',
    body: '# Rollout order\n\nShip the **read-only** console first, then the writes.\n\n- dashboard\n- spec page',
    created: '2026-03-06T09:00:00.000Z',
    updated: '2026-03-06T09:00:00.000Z',
  }),
];

export type StubWorkspace = {
  slug: string;
  /** The real registry names a workspace after its directory, so the defaults use the fixture name. */
  name: string;
  /** Fixture name: the bodies are `core/fixtures/<golden>[.<family>].golden.json`, the tree `core/fixtures/<golden>/`. */
  golden: string;
  /** Default: `golden`, the last path segment of the fixture tree. */
  pathTail?: string;
};

export type StubApiOptions = {
  /** The registered workspaces, in list order. Default: harbor, lantern (ISC-16's two workspaces). */
  workspaces?: readonly StubWorkspace[];
  /** The workspace the `unreadable` state marks `missing`. Default: the last one. */
  unreadableSlug?: string;
  /** Where the golden snapshots and fixture trees live. Default: `core/fixtures`. */
  fixturesDir?: string;
  /** The state of a request without the state header. Default: `two-workspaces`. */
  defaultState?: StubState;
};

export const DEFAULT_WORKSPACES: readonly StubWorkspace[] = [
  { slug: 'harbor', name: 'harbor', golden: 'harbor' },
  { slug: 'lantern', name: 'lantern', golden: 'lantern' },
];

const WORKSPACES_PATH = '/api/workspaces';
const SETTINGS_PATH = '/api/settings';
const LIFEOS_PATH = '/api/lifeos';
const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;
const JSON_TYPE = 'application/json; charset=utf-8';
/** How long the synthetic frontier session has held its lock at `STUB_NOW`: 20 minutes, not stale. */
const SYNTHETIC_LOCK_AGE_MS = 20 * 60 * 1000;
/** `TaskStatus` in its declared order, the order of `TasksTab.counts.byStatus` (`core/src/tasks.ts` STATUS_ORDER). */
const STATUS_ORDER: readonly TaskStatus[] = ['open', 'dispatched', 'held', 'question', 'concerns', 'fail', 'done', 'closed', 'struck'];

type Summary = {
  slug: string;
  name: string;
  pathTail: string;
  readable: boolean;
  error?: 'missing';
  counts: unknown;
};

/** What one state answers: the list and, per slug, the workspace's goldens or the 409 summary. */
type StateView = { list: Summary[]; workspaces: Map<string, { tree: TreeGoldens } | { unreadable: Summary }> };

// ---- the shared HTTP rules of server/src/http.ts, api.ts and settings.ts ----------------------------------------

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

function isLoopbackHost(host: string | null): boolean {
  if (host === null) return false;
  try {
    return LOOPBACK_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function isLoopbackOrigin(origin: string | null): boolean {
  if (origin === null) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

function guarded(req: Request): boolean {
  return isLoopbackHost(req.headers.get('Host')) && isLoopbackOrigin(req.headers.get('Origin'));
}

/** RFC 9110 weak comparison: `*`, or any listed tag with `W/` stripped. */
function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false;
  const opaque = etag.replace(/^W\//, '');
  return header.split(',').some((raw) => {
    const tag = raw.trim();
    return tag === '*' || tag.replace(/^W\//, '') === opaque;
  });
}

const strongEtag = (bytes: string | Uint8Array): string => `"${new Bun.CryptoHasher('sha256').update(bytes).digest('base64url')}"`;

/** A JSON answer (`JSON_ANSWER`): strong ETag, 304 on a matching 200 of a read (as `api.ts` `json()`), no body on HEAD. */
function workspaceJson(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const headers = { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-cache', ETag: strongEtag(body), ...extra };
  const read = req.method === 'GET' || req.method === 'HEAD';
  if (status === 200 && read && matchesIfNoneMatch(req.headers.get('If-None-Match'), headers.ETag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === 'HEAD' ? null : body, { status, headers });
}

/** A settings error answer, `no-store`, no ETag. */
function settingsError(status: number, value: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-store', ...extra },
  });
}

// ---- settings: SettingsSchema of server/src/settings.ts, in memory ------------------------------------------------

type Settings = { theme: string; language: string; density: string; refreshSeconds: number; singleKeyShortcuts: boolean; railCollapsed: boolean; notesImportDismissed: boolean; runAbortMinutes: number };
type SettingKey = keyof Settings;

const SCHEMA: { readonly [K in SettingKey]: { default: Settings[K]; validate: (value: unknown) => boolean } } = {
  theme: { default: 'system', validate: (v) => v === 'system' || v === 'light' || v === 'dark' },
  language: { default: 'en', validate: (v) => v === 'en' || v === 'de' },
  density: { default: 'comfortable', validate: (v) => v === 'comfortable' || v === 'compact' },
  refreshSeconds: { default: 30, validate: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 3600 },
  singleKeyShortcuts: { default: true, validate: (v) => typeof v === 'boolean' },
  railCollapsed: { default: false, validate: (v) => typeof v === 'boolean' },
  notesImportDismissed: { default: false, validate: (v) => typeof v === 'boolean' },
  runAbortMinutes: { default: 120, validate: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 1440 },
};

const defaults = (): Settings => ({
  theme: SCHEMA.theme.default,
  language: SCHEMA.language.default,
  density: SCHEMA.density.default,
  refreshSeconds: SCHEMA.refreshSeconds.default,
  singleKeyShortcuts: SCHEMA.singleKeyShortcuts.default,
  railCollapsed: SCHEMA.railCollapsed.default,
  notesImportDismissed: SCHEMA.notesImportDismissed.default,
  runAbortMinutes: SCHEMA.runAbortMinutes.default,
});

const isKey = (key: string): key is SettingKey => Object.hasOwn(SCHEMA, key);

function settingsJson(req: Request, settings: Settings): Response {
  const body = JSON.stringify(settings);
  const etag = `W/"${Bun.hash(body).toString(36)}"`;
  const headers = { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-cache', ETag: etag };
  if (req.method !== 'PUT' && matchesIfNoneMatch(req.headers.get('If-None-Match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(req.method === 'HEAD' ? null : body, { headers });
}

// ---- core at runtime ----------------------------------------------------------------------------------------------

type Core = {
  resolveEvidencePath: (specDir: string, requested: string, reach?: 'evidence' | 'tree') => Promise<EvidencePathResult>;
  mediaTypeOf: (name: string) => string;
  prototypeMediaTypeOf: (name: string) => string;
  worstState: (states: Iterable<CardState>) => CardState;
  parseWorkflow: (text: string | null) => Workflow;
  boardStages: (workflow: Workflow) => PlanningModel['stages'];
  readCatalog: (root: string) => Promise<LibraryCatalog>;
  renderDocsMarkdown: (markdown: string, options?: unknown) => DocsPage;
  techSectionHeads: (tech: string) => NonNullable<LibraryDocPage['techSections']>;
  docsRenderOptions: (root: string, docPath: string, name: DocName) => unknown;
  levelTwoSection: (text: string, headings: readonly string[]) => string | null;
  firstParagraph: (section: string) => string | null;
  GOAL_HEADINGS: readonly string[];
};

/** Core's pure functions, loaded by a computed path so `tsc -p web/e2e` never walks core's module graph. */
function loadCore(): Core {
  const load = createRequire(import.meta.url);
  const src = join(import.meta.dir, '..', '..', 'core', 'src');
  const evidence = load(join(src, 'evidence.ts')) as Pick<Core, 'resolveEvidencePath' | 'mediaTypeOf' | 'prototypeMediaTypeOf' | 'docsRenderOptions'>;
  const docs = load(join(src, 'markdown-docs.ts')) as Pick<Core, 'renderDocsMarkdown'>;
  const frames = load(join(src, 'frames.ts')) as Pick<Core, 'worstState'>;
  const workflow = load(join(src, 'workflow.ts')) as Pick<Core, 'parseWorkflow' | 'boardStages'>;
  const library = load(join(src, 'library.ts')) as Pick<Core, 'readCatalog'>;
  const archive = load(join(src, 'archive.ts')) as Pick<Core, 'levelTwoSection' | 'firstParagraph' | 'GOAL_HEADINGS'>;
  const tech = load(join(src, 'tech.ts')) as Pick<Core, 'techSectionHeads'>;
  return {
    resolveEvidencePath: evidence.resolveEvidencePath,
    mediaTypeOf: evidence.mediaTypeOf,
    prototypeMediaTypeOf: evidence.prototypeMediaTypeOf,
    docsRenderOptions: evidence.docsRenderOptions,
    renderDocsMarkdown: docs.renderDocsMarkdown,
    techSectionHeads: tech.techSectionHeads,
    worstState: frames.worstState,
    parseWorkflow: workflow.parseWorkflow,
    boardStages: workflow.boardStages,
    readCatalog: library.readCatalog,
    levelTwoSection: archive.levelTwoSection,
    firstParagraph: archive.firstParagraph,
    GOAL_HEADINGS: archive.GOAL_HEADINGS,
  };
}

// ---- the goldens --------------------------------------------------------------------------------------------------

/** One spec's value in every golden family, and what the lock fixtures make of it. */
type SpecGoldens = {
  /** The golden key, `specs/<folder>` or `specs/archive/<folder>`. */
  key: string;
  folder: string;
  spec: SpecPageModel;
  timeline: readonly TimelineEntry[];
  claims: ClaimViewModel;
  tasks: TasksTab | null;
  /** Every task's steps (spec 015, T24): harbor's `harbor.steps.golden.json` entry, `{}` on the other trees. */
  steps: TaskSteps;
  docs: Readonly<Record<Exclude<DocName, 'constitution'>, DocsPage | null>>;
  frames: readonly Frame[];
  /** The spec page and the live frame per lock fixture; `activity` is the golden as it is. */
  locked: Readonly<Record<LockState, { spec: SpecPageModel; live: LiveFrame }>>;
  /** The reviewed hashes the stub sends and expects back. */
  hashes: ReviewedHashes;
};

type TreeGoldens = {
  golden: string;
  /** The fixture tree, `core/fixtures/<golden>`: the evidence is read from it. */
  root: string;
  constitution: DocsPage | null;
  specs: readonly SpecGoldens[];
};

function readJson(dir: string, file: string): unknown {
  let text: string;
  try {
    text = readFileSync(join(dir, file), 'utf8');
  } catch {
    throw new Error(`stub-api: no golden snapshot ${file} in core/fixtures`);
  }
  return JSON.parse(text) as unknown;
}

function readDashboard(dir: string, name: string): { model: unknown; kpis: unknown } {
  const model = readJson(dir, `${name}.golden.json`) as { kpis?: unknown };
  if (typeof model.kpis !== 'object' || model.kpis === null) {
    throw new Error(`stub-api: ${name}.golden.json has no kpis; is it a DashboardModel?`);
  }
  return { model, kpis: model.kpis };
}

/**
 * The planning route's body: a workspace route's golden family is the whole file (`GOLDEN_FAMILY`), not keyed by
 * folder, read as it is; the stub parses no spec.
 */
function readPlanning(dir: string, name: string): PlanningModel {
  const file = `${name}.${GOLDEN_FAMILY.planning}.golden.json`;
  const model = readJson(dir, file) as { features?: unknown; milestones?: unknown; ideas?: unknown; stageCounts?: unknown };
  if (!Array.isArray(model.features) || !Array.isArray(model.milestones) || !Array.isArray(model.ideas) || typeof model.stageCounts !== 'object') {
    throw new Error(`stub-api: ${file} has no features, milestones, ideas or stageCounts; is it a PlanningModel?`);
  }
  return model as PlanningModel;
}

/** The whole `<golden>.tech.golden.json` (`readTech`'s `TechModel`), read as it is, for the catalog. */
function readTechGolden(dir: string, name: string): unknown {
  const file = `${name}.${TECH_GOLDEN_FAMILY}.golden.json`;
  const model = readJson(dir, file) as { pages?: unknown; specs?: unknown; diagnostics?: unknown };
  if (!('pages' in model) || typeof model.pages !== 'object' || !Array.isArray(model.specs) || !Array.isArray(model.diagnostics)) {
    throw new Error(`stub-api: ${file} has no pages, specs or diagnostics; is it a TechModel?`);
  }
  return model;
}

/** A deterministic stand-in for a sha256 hex: the hash of a label, never of a file (the stub reads no spec file). */
const fakeHex = (label: string): string => new Bun.CryptoHasher('sha256').update(`stub-api:${label}`).digest('hex');

const byClaimId = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** A copy of `value` without `keys`, the other keys in their order. */
function without<T extends object>(value: T, keys: ReadonlyArray<keyof T>): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as keyof T))) as T;
}

/** A lock-free copy of a live card: the running state goes back to waiting, the lock fields go, and nobody works it. */
function released(card: LiveCard): LiveCard {
  const rest = { ...without(card, ['lock', 'since', 'elapsedMs', 'stale']), agent: null, subagent: null };
  return card.state === 'running' ? { ...rest, state: 'waiting' } : rest;
}

/**
 * Who works a card under a lock held by `actor` (spec 008, T66, ISC-131.1), as core's `live.ts` `workersOf` says it:
 * an agent is the agent; a sub-agent names its parent session as the agent and itself as the sub-agent when its task is
 * this card's; a person or a legacy session is no agent.
 */
function workersOf(actor: ActorRef, task: string): Pick<LiveCard, 'agent' | 'subagent'> {
  if (actor.kind === 'agent') return { agent: actor, subagent: null };
  if (actor.kind === 'subagent') return { agent: parseActor(actor.id), subagent: actor.task === task ? actor : null };
  return { agent: null, subagent: null };
}

/** The person the `person` lock fixture puts on the golden's locks: the `u:` id harbor's planning golden already uses. */
export const STUB_PERSON = 'u:3f9c0a7d';

/**
 * The claim lines of a fixture tree's `.spectant/activity.jsonl`, without its releases (the `claims` lock fixture): as
 * `core/tests/live.test.ts` keeps only `event: "claim"` before core's reader, each line held since its `ts`, a later
 * claim on the same claim taking it over. Empty without a log.
 */
function claimLines(root: string): ClaimLock[] {
  let text: string;
  try {
    text = readFileSync(join(root, '.spectant', 'activity.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const held = new Map<string, ClaimLock>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line) as { event?: unknown; claim?: unknown; session?: unknown; ts?: unknown };
    if (entry.event !== 'claim' || typeof entry.claim !== 'string' || typeof entry.session !== 'string' || typeof entry.ts !== 'string') continue;
    held.delete(entry.claim);
    held.set(entry.claim, { source: 'activity', claim: entry.claim, session: entry.session, actor: parseActor(entry.session), since: entry.ts });
  }
  return [...held.values()].sort((a, b) => byClaimId(a.claim, b.claim));
}

/** The rail's agents for `locks`, as core's `live.ts` `agentsOf`: one per source and session, oldest lock first. */
function railOf(locks: readonly ClaimLock[], now: number, staleAfterMs: number): LiveAgent[] {
  const groups = new Map<string, { session: string; source: AgentLockSource; claims: string[]; since: string }>();
  for (const lock of locks) {
    const key = `${lock.source}\u0000${lock.session}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { session: lock.session, source: lock.source, claims: [lock.claim], since: lock.since });
      continue;
    }
    group.claims.push(lock.claim);
    if (Date.parse(lock.since) < Date.parse(group.since)) group.since = lock.since;
  }
  return [...groups.values()]
    .map((g): LiveAgent => {
      const elapsedMs = Math.max(0, now - Date.parse(g.since));
      return { session: g.session, source: g.source, claims: [...g.claims].sort(byClaimId), since: g.since, elapsedMs, stale: elapsedMs > staleAfterMs };
    })
    .sort((a, b) => b.elapsedMs - a.elapsedMs || a.session.localeCompare(b.session) || a.source.localeCompare(b.source));
}

/**
 * The golden live frame under another set of activity `locks` (the `claims` and `person` fixtures): only locks on this
 * spec's claims count; a card whose claim one holds is in flight with its lock, `since`, `elapsedMs`, `stale` and its
 * workers, a landed one re-opened (as `core/tests/live.test.ts` unticks T4 and T25 for the claim lines); every other
 * card is released. The operator lane and struck cards never run, as in core.
 */
function relocked(core: Core, live: LiveFrame, claims: ClaimViewModel, all: readonly ClaimLock[]): LiveFrame {
  const ours = new Set([...claims.claims.map((c) => c.id), ...live.cards.map((c) => c.claim)]);
  const locks = all.filter((l) => ours.has(l.claim));
  const held = new Map(locks.map((l) => [l.claim, l]));
  const now = Date.parse(live.ts);
  const cards = live.cards.map((card): LiveCard => {
    const lock = held.get(card.claim);
    if (lock === undefined || card.state === 'absent' || card.lane === 'operator') return released(card);
    const elapsedMs = Math.max(0, now - Date.parse(lock.since));
    return {
      ...without(card, ['reason']),
      state: 'running',
      lock: { source: lock.source, session: lock.session },
      since: lock.since,
      elapsedMs,
      stale: elapsedMs > live.staleAfterMs,
      ...workersOf(lock.actor, card.task),
      // The item's run names the new holder too (spec 040): the same swap of session and actor, nothing recomputed.
      ...(card.itemState?.run === undefined ? {} : { itemState: { ...card.itemState, run: { ...card.itemState.run, session: lock.session, actor: lock.actor } } }),
    };
  });
  return {
    ...live,
    cards,
    worst: core.worstState(cards.map((c) => c.state)),
    lockSource: 'activity',
    locks,
    agents: railOf(locks, now, live.staleAfterMs),
    needsYou: NEEDS_YOU.flatMap((state) => cards.filter((c) => c.state === state)),
  };
}

/** The Needs you list's states, in core's order (`live.ts` `NEEDS_YOU`). */
const NEEDS_YOU: readonly CardState[] = ['question', 'concerns', 'operatorOpen'];

/**
 * The session id of a lock the stub makes up (the frontier fixture's second session, a scripted 423's fallback): an
 * agent id of the actor grammar (`core/src/actor.ts`, `a:<kind>:<id>`), so `parseActor` reads it as `legacy: false`
 * like the goldens' own `a:claude:sess-2`; `ISC-75` of spec 002 becomes `a:claude:stub-002-isc-75`.
 */
export const syntheticSession = (specId: string, claim: string): string => `a:claude:stub-${specId}-${claim.toLowerCase()}`;

const LANDED_OR_GONE: ReadonlySet<CardState> = new Set<CardState>(['done', 'operatorDone', 'closed', 'absent', 'operatorOpen']);

/**
 * The lock fixtures of one spec, from its golden live frame (built under the activity reading) and spec page.
 * `none`: no source, every lock released. `frontier`: every golden lock relabelled `frontier`, plus a synthetic
 * session on the first open claim no lock holds (a waiting or dispatched card's claim first, else any open claim).
 * `claims`: the tree's activity claim lines without their releases (`claimLines`). `person`: the golden's locks held by
 * `STUB_PERSON` instead. Every in-flight card names its workers as core does (`workersOf`).
 */
function lockFixtures(core: Core, spec: SpecPageModel, live: LiveFrame, claims: ClaimViewModel, activityClaims: readonly ClaimLock[]): SpecGoldens['locked'] {
  const pageWith = (lockSource: LockSource, agents: readonly LiveAgent[], locks: readonly ClaimLock[]): SpecPageModel => {
    const newest = [...locks].sort((a, b) => (a.since < b.since ? 1 : a.since > b.since ? -1 : 0))[0] ?? null;
    return {
      ...spec,
      keyNumbers: { ...spec.keyNumbers, rounds: { ...spec.keyNumbers.rounds, agentsWorking: agents.length } },
      areas: { ...spec.areas, live: { lockSource, agentsWorking: agents.length, lock: newest } },
    };
  };

  const noneCards = live.cards.map(released);
  const none: LiveFrame = {
    ...live,
    cards: noneCards,
    worst: core.worstState(noneCards.map((c) => c.state)),
    lockSource: 'none',
    locks: [],
    agents: [],
  };

  const frontier = (source: AgentLockSource): AgentLockSource => (source === 'activity' ? 'frontier' : source);
  const locks: ClaimLock[] = live.locks.map((l) => ({ ...l, source: frontier(l.source) }));
  const agents: LiveAgent[] = live.agents.map((a) => ({ ...a, source: frontier(a.source) }));
  let cards: LiveCard[] = live.cards.map((c) => (c.lock ? { ...c, lock: { ...c.lock, source: frontier(c.lock.source) } } : c));
  const held = new Set(locks.map((l) => l.claim));
  const open = claims.claims.filter((c) => ['takeable', 'open', 'blocked'].includes(c.state) && !held.has(c.id)).map((c) => c.id);
  const waitingCard = cards.find((c) => (c.state === 'waiting' || c.state === 'dispatched') && open.includes(c.claim));
  const claim = waitingCard?.claim ?? open[0];
  if (claim !== undefined) {
    const session = syntheticSession(spec.head.id, claim);
    const since = new Date(Date.parse(live.ts) - SYNTHETIC_LOCK_AGE_MS).toISOString().replace('.000Z', 'Z');
    const stale = SYNTHETIC_LOCK_AGE_MS > live.staleAfterMs;
    locks.push({ source: 'frontier', claim, session, actor: parseActor(session), since });
    locks.sort((a, b) => byClaimId(a.claim, b.claim));
    agents.push({ session, source: 'frontier', claims: [claim], since, elapsedMs: SYNTHETIC_LOCK_AGE_MS, stale });
    agents.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    cards = cards.map((c) => {
      if (c.claim !== claim || LANDED_OR_GONE.has(c.state) || c.lane === 'operator') return c;
      // In flight: the session is the reason, so a waiting or dispatch reason is dropped (as core's live.ts does).
      return {
        ...without(c, ['reason']),
        state: 'running',
        lock: { source: 'frontier', session },
        since,
        elapsedMs: SYNTHETIC_LOCK_AGE_MS,
        stale,
        ...workersOf(parseActor(session), c.task),
      };
    });
  }
  // A card the new lock set running no longer waits on the principal.
  const needsYou = live.needsYou.filter((n) => cards.find((c) => c.task === n.task)?.state === n.state);
  const frontierLive: LiveFrame = {
    ...live,
    cards,
    worst: core.worstState(cards.map((c) => c.state)),
    lockSource: 'frontier',
    locks,
    agents,
    needsYou,
  };

  const claimsLive = relocked(core, live, claims, activityClaims);
  const person = parseActor(STUB_PERSON);
  const personLive = relocked(core, live, claims, live.locks.map((l) => ({ ...l, session: STUB_PERSON, actor: person })));

  return {
    none: { spec: pageWith('none', [], []), live: none },
    activity: { spec, live },
    frontier: { spec: pageWith('frontier', agents, locks), live: frontierLive },
    claims: { spec: pageWith('activity', claimsLive.agents, claimsLive.locks), live: claimsLive },
    person: { spec: pageWith('activity', personLive.agents, personLive.locks), live: personLive },
    // The run variants change no lock: every tree reads as under `activity` (beacon's variants are rebuilt by core).
    runs: { spec, live },
  };
}

function readTree(core: Core, dir: string, golden: string): TreeGoldens {
  const read = (family: string): Record<string, unknown> => readJson(dir, `${golden}.${family}.golden.json`) as Record<string, unknown>;
  const specs = read('spec') as Record<string, SpecPageModel>;
  const families = {
    timeline: read('timeline') as Record<string, readonly TimelineEntry[]>,
    claims: read('claim-view') as Record<string, ClaimViewModel>,
    tasks: read('tasks') as Record<string, TasksTab | null>,
    frames: read('frames') as Record<string, readonly Frame[]>,
    live: read('live') as Record<string, LiveFrame>,
  };
  const docs = read('docs') as { constitution: DocsPage | null; specs: Record<string, SpecGoldens['docs']> };
  const pick = <T>(record: Record<string, T>, key: string, family: string): T => {
    if (!Object.hasOwn(record, key)) throw new Error(`stub-api: ${golden}.${family}.golden.json has no ${key}`);
    return record[key] as T;
  };
  const activityClaims = claimLines(join(dir, golden));
  const steps = golden === 'harbor' ? (read('steps') as Record<string, TaskSteps>) : {};
  return {
    golden,
    root: join(dir, golden),
    constitution: docs.constitution,
    specs: Object.entries(specs).map(([key, spec]): SpecGoldens => {
      const claims = pick(families.claims, key, 'claim-view');
      const tasks = pick(families.tasks, key, 'tasks');
      const specDocs = pick(docs.specs, key, 'docs');
      const live = pick(families.live, key, 'live');
      const hashes: ReviewedHashes = {
        spec: fakeHex(`${golden}:${key}:spec.md`),
        plan: specDocs.plan === null ? null : fakeHex(`${golden}:${key}:plan.md`),
        tasks: tasks === null ? null : fakeHex(`${golden}:${key}:tasks.md`),
      };
      return {
        key,
        folder: key.split('/').at(-1) ?? key,
        spec,
        timeline: pick(families.timeline, key, 'timeline'),
        claims,
        tasks,
        steps: steps[key] ?? {},
        docs: specDocs,
        frames: pick(families.frames, key, 'frames'),
        locked: lockFixtures(core, spec, live, claims, activityClaims),
        hashes,
      };
    }),
  };
}

/** The task ids tasks.md has ticked: a run of one is `applied`, and it leaves the round (core's `live.ts`). */
function tickedOf(spec: SpecGoldens): ReadonlySet<string> {
  return new Set((spec.tasks?.tasks ?? []).filter((t) => t.state === 'done').map((t) => t.id));
}

/** A tree with the worktree overlay of `stub-board.ts` (spec 027, T33) on every spec's page, live frames and timeline. */
function overlaidTree(tree: TreeGoldens): TreeGoldens {
  return {
    ...tree,
    specs: tree.specs.map((spec): SpecGoldens => {
      const id = spec.folder.slice(0, 3);
      const input = STUB_TIMELINE_WORKTREES[id];
      const timeline = input === undefined ? spec.timeline : withWorktreeEntry(spec.timeline, input);
      const runs = new Map((STUB_RUNS[id] ?? []).map((run): [string, TaskRun] => [run.task, run]));
      const ticked = tickedOf(spec);
      type Fixture = SpecGoldens['locked'][LockState];
      const lay = (fixture: Fixture): Fixture => ({
        spec: overlaidPage(fixture.spec, id, timeline.length - spec.timeline.length),
        live: withRuns(fixture.live, runs, ticked),
      });
      const locked = Object.fromEntries(LOCK_STATES.map((s) => [s, lay(spec.locked[s])])) as Record<LockState, Fixture>;
      return { ...spec, timeline, locked };
    }),
  };
}

// ---- spec edges (spec 025, T20) ---------------------------------------------------------------------------------

/**
 * The spec-edge variants (spec 025, T20, ISC-163): `off` serves the goldens as they are; `waiting` and `met` serve harbor
 * rebuilt by core from its fixture tree with the edges of `STUB_EDGES` added to the texts in memory, against a merge
 * state in which the blockers are unmerged (`waiting`) or merged (`met`).
 */
export const EDGE_STATES = ['off', 'waiting', 'met'] as const;
export type EdgeState = (typeof EDGE_STATES)[number];
export const EDGES_HEADER = 'X-Spectant-Stub-Edges';

/**
 * The spec edges the variants add to harbor (`OVERLAY_GOLDEN`), in memory only; the fixture files stay as they are.
 * `full`: the open claim of 009, ISC-131, carries `(after: 002)`, so all its open work waits: the stage falls from `build`
 * to `blocked` with `waits on 002`, the claim is held (`blocked`, `waitsOn`).
 * `partial`: every open web task of 002 carries `(after: 006)`, four of its five open tasks (the operator's T31 is not
 * held), so the web lane waits whole. `unknown`: 002's ticked T1 names 042, which no spec carries: a `spec-edge`
 * diagnostic on 002's row in both variants, no hold. 002 and 004 keep their overlap (no edge joins them), so its
 * `spec-overlap` warning stays with its direction.
 */
export const STUB_EDGES = {
  golden: OVERLAY_GOLDEN,
  full: { spec: '009', folder: '009-chunked-upload-limits', on: '002' },
  partial: { spec: '002', folder: '002-web-console', lane: 'web', tasks: ['T27', 'T28', 'T29', 'T32'], on: '006' },
  unknown: { spec: '002', folder: '002-web-console', task: 'T1', on: '042' },
} as const;

/** The blockers' merge state per variant: a branch of each, unmerged or merged (`MergeState`, ISC-162.1). */
export function stubMergeState(state: Exclude<EdgeState, 'off'>): MergeState[] {
  const branches: Readonly<Record<string, string>> = { '002': 'feature/002-web-console', '006': 'feature/006-partial-push' };
  return Object.entries(branches).map(([spec, branch]) => ({ spec, branch, merged: state === 'met', complete: false, archived: false }));
}

/** The input core's builders read, as `core/tests/helpers/read-tree.ts` `readTreeAt` returns it (`DashboardInput`). */
type TreeInput = {
  master: string | null;
  constitution: string | null;
  tldr: string | null;
  specs: SpecFiles[];
  archived: SpecFiles[];
  workflow?: Workflow;
  [key: string]: unknown;
};

/** Core's builders for the edge variants, loaded by a computed path like `loadCore` (the golden builders' own inputs). */
type EdgeCore = {
  readTreeAt: (root: string) => TreeInput;
  ideaFilesAt: (root: string) => Record<string, string>;
  PLANNING_NOW: string;
  buildDashboard: (input: unknown) => { kpis: unknown; specs: Array<{ slug: string; stage: string; stageSource: string; waits: SpecWait | null }> };
  itemStates: (input: unknown) => readonly unknown[];
  withItemStates: <T>(model: T, items: readonly unknown[]) => T;
  /** core's guidance (spec 020, ISC-237), composed as the server's `loadDashboard` and spec route compose it. */
  guidanceOf: (input: { workspace: unknown; dashboard: unknown; items: readonly unknown[] }) => unknown;
  withGuidance: <T>(model: T, guidance: unknown) => T;
  taskRunsOf: (specs: readonly SpecFiles[], locks: unknown, now: Date) => unknown;
  DEFAULT_ABORT_AFTER_MS: number;
  buildPlanning: (input: unknown) => PlanningModel;
  buildSpecPage: (input: unknown) => SpecPageModel;
  buildClaimViews: (input: unknown) => ClaimViewModel;
  buildLiveFrame: (input: unknown) => LiveFrame;
  parseTaskLines: (input: unknown) => TasksTab;
  resolveEdges: (model: unknown, mergeState: readonly MergeState[]) => { edges: readonly SpecEdge[] };
  readLockSources: (input: { repoRoot: string }) => Promise<unknown>;
  activityReading: (text: string) => unknown;
  withIdeaStates: (model: PlanningModel, items: readonly unknown[]) => PlanningModel;
  hashForGate: (file: string, text: string) => string;
  /** core's `runLockOf` and the run release's pure helpers of `server/src/writes.contract.ts` (spec 040, ISC-226). */
  runLockOf: (openRuns: readonly StubOpenRun[], target: { spec: string } | { idea: string }, options: { now: Date }) => unknown;
  activityConflict: (sent: string, now: string) => unknown;
  runReleaseEvent: (ts: string, run: StubOpenRun, viewer: string) => unknown;
  runReleaseAppendBytes: (existing: string, event: unknown) => string;
};

/** An open run as core's `activityReading` lists it, as far as the release reads it. */
type StubOpenRun = { run: string; command: string; spec?: string; idea?: string };

function loadEdgeCore(): EdgeCore {
  const load = createRequire(import.meta.url);
  const core = join(import.meta.dir, '..', '..', 'core');
  const at = (...path: string[]): Partial<EdgeCore> => load(join(core, ...path)) as Partial<EdgeCore>;
  const modules = [
    at('tests', 'helpers', 'read-tree.ts'),
    at('tests', 'helpers', 'planning-model.ts'),
    ...['dashboard', 'planning', 'spec', 'claim-view', 'live', 'tasks', 'spec-edges', 'locks', 'gates', 'item-state', 'guidance'].map((name) => at('src', `${name}.ts`)),
  ];
  const [tree, planning, dashboard, plan, spec, claimView, live, tasks, edges, locks, gates, state, guidance] = modules;
  const writes = load(join(import.meta.dir, '..', '..', 'server', 'src', 'writes.contract.ts')) as Partial<EdgeCore>;
  const loaded: Partial<EdgeCore> = {
    readTreeAt: tree?.readTreeAt,
    ideaFilesAt: tree?.ideaFilesAt,
    PLANNING_NOW: planning?.PLANNING_NOW,
    buildDashboard: dashboard?.buildDashboard,
    itemStates: state?.itemStates,
    withItemStates: state?.withItemStates,
    guidanceOf: guidance?.guidanceOf,
    withGuidance: guidance?.withGuidance,
    taskRunsOf: live?.taskRunsOf,
    DEFAULT_ABORT_AFTER_MS: state?.DEFAULT_ABORT_AFTER_MS,
    buildPlanning: plan?.buildPlanning,
    buildSpecPage: spec?.buildSpecPage,
    buildClaimViews: claimView?.buildClaimViews,
    buildLiveFrame: live?.buildLiveFrame,
    parseTaskLines: tasks?.parseTaskLines,
    resolveEdges: edges?.resolveEdges,
    readLockSources: locks?.readLockSources,
    activityReading: locks?.activityReading,
    withIdeaStates: state?.withIdeaStates,
    hashForGate: gates?.hashForGate,
    runLockOf: state?.runLockOf,
    activityConflict: writes.activityConflict,
    runReleaseEvent: writes.runReleaseEvent,
    runReleaseAppendBytes: writes.runReleaseAppendBytes,
  };
  const missing = Object.entries(loaded).filter(([, value]) => (value as unknown) === undefined).map(([key]) => key);
  if (missing.length > 0) throw new Error(`stub-api: core exports no ${missing.join(', ')}`);
  return loaded as EdgeCore;
}

/** A task or claim line with `(after: on)` added: into its `(after: …)` group, else before the path column or at the end. */
function withSpecEdge(line: string, on: string): string {
  const group = /\(after: ([^)]*)\)/.exec(line);
  if (group) return line.replace(group[0], `(after: ${group[1] ?? ''}, ${on})`);
  const path = line.lastIndexOf(' · `');
  return path === -1 ? `${line} (after: ${on})` : `${line.slice(0, path)} (after: ${on})${line.slice(path)}`;
}

/** `text` with `edit` applied to every line `pick` selects; loud when it selects none (the fixture moved). */
function editLines(text: string | undefined, pick: (line: string) => boolean, edit: (line: string) => string, what: string): string {
  let hits = 0;
  const out = (text ?? '')
    .split('\n')
    .map((line) => (pick(line) ? ((hits += 1), edit(line)) : line))
    .join('\n');
  if (hits === 0) throw new Error(`stub-api: no line for ${what} in the ${STUB_EDGES.golden} fixture`);
  return out;
}

/**
 * One folder's texts with the `STUB_EDGES` edges added. A reviewed mark that matched a file before the edit is
 * re-marked over the edited file (core's `hashForGate`), so adding an edge leaves a fresh review fresh, as a re-review
 * would; a stale one stays stale.
 */
function edgedFiles(core: EdgeCore, files: SpecFiles): SpecFiles {
  const texts: { -readonly [K in keyof SpecFiles['texts']]: SpecFiles['texts'][K] } = { ...files.texts };
  const { full, partial, unknown } = STUB_EDGES;
  if (files.folder === full.folder) {
    texts.spec = editLines(texts.spec, (l) => /^- \[ \] ISC-[\d.]+:/.test(l), (l) => withSpecEdge(l, full.on), `${full.spec}'s open claims`);
  }
  if (files.folder === partial.folder) {
    const held = new Set<string>(partial.tasks);
    const taskOf = (l: string): string | undefined => /^- \[[ x]\] (T\d+) · /.exec(l)?.[1];
    let tasks = editLines(texts.tasks, (l) => held.has(taskOf(l) ?? ''), (l) => withSpecEdge(l, partial.on), `${partial.spec}'s web tasks`);
    tasks = editLines(tasks, (l) => taskOf(l) === unknown.task, (l) => withSpecEdge(l, unknown.on), `${unknown.spec} ${unknown.task}`);
    texts.tasks = tasks;
  }
  const mark = remarked(core, files.texts, texts);
  if (mark !== undefined) texts.gateReviewed = mark;
  return { folder: files.folder, texts };
}

/**
 * The reviewed mark over edited texts: a hash that matched spec.md or tasks.md before the edit is re-marked over the
 * edited file (core's `hashForGate`), so a fresh review stays fresh, as a re-review would; a stale one stays stale.
 * Undefined when the folder has no reviewed mark.
 */
function remarked(core: Pick<EdgeCore, 'hashForGate'>, before: SpecFiles['texts'], after: SpecFiles['texts']): string | undefined {
  const mark = before.gateReviewed;
  if (mark === undefined) return undefined;
  const parsed = JSON.parse(mark) as { files?: Record<string, string> };
  const marked = { ...parsed.files };
  for (const [kind, name] of [['spec', 'spec.md'], ['tasks', 'tasks.md']] as const) {
    const was = before[kind];
    const is = after[kind];
    if (was === undefined || is === undefined || was === is) continue;
    if (marked[name] === core.hashForGate(name, was)) marked[name] = core.hashForGate(name, is);
  }
  return `${JSON.stringify({ ...parsed, files: marked }, null, 2)}\n`;
}

/** One edge variant of harbor: the dashboard, the planning tree and the spec families, each built by core. */
type EdgeVariant = { dashboard: { model: unknown; kpis: unknown }; planning: PlanningModel; tree: TreeGoldens };

/** The golden builders' clock for the live frames (`core/tests/golden.test.ts` `LIVE_NOW`), `STUB_NOW`. */
const LIVE_NOW = new Date(STUB_NOW);

/**
 * Harbor under one edge variant, built as its goldens are (`core/tests/golden.test.ts`, `helpers/planning-model.ts`,
 * `fixtures.test.ts`) from the edged texts plus the merge state: `buildDashboard`, `buildPlanning` with each row's
 * stage and `waits`, and per spec `buildSpecPage`, `buildClaimViews` and `buildLiveFrame` with that spec's resolved
 * edges, `parseTaskLines`; the lock fixtures over them as for the goldens. Timeline, frames and docs stay the golden's.
 */
async function edgeVariant(core: Core, edge: EdgeCore, base: TreeGoldens, state: Exclude<EdgeState, 'off'>): Promise<EdgeVariant> {
  const read = edge.readTreeAt(base.root);
  const input: TreeInput = { ...read, specs: read.specs.map((f) => edgedFiles(edge, f)), archived: read.archived };
  const mergeState = stubMergeState(state);
  const locks = await edge.readLockSources({ repoRoot: base.root });
  // The item states as the state golden family builds them (core/tests/helpers/state-model.ts), over the edged tree.
  const stateWorkspace = { ...input, mergeState, locks };
  const items = edge.itemStates({ workspace: stateWorkspace, dashboard: edge.buildDashboard(stateWorkspace), taskRuns: edge.taskRunsOf(input.specs, locks, LIVE_NOW), now: LIVE_NOW, abortAfterMs: edge.DEFAULT_ABORT_AFTER_MS });
  const plainModel = edge.buildDashboard({ ...input, mergeState });
  const guidance = edge.guidanceOf({ workspace: stateWorkspace, dashboard: plainModel, items });
  const model = edge.withGuidance(edge.withItemStates(plainModel, items), guidance);
  const specTexts = new Map(input.specs.map((f) => [f.folder, f.texts.spec]));
  const specStates = model.specs.map((row) => {
    const spec = specTexts.get(row.slug);
    const hash = spec === undefined ? {} : { hash: new Bun.CryptoHasher('sha256').update(spec).digest('hex') };
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, waits: row.waits, ...hash };
  });
  const { master, specs, archived, workflow, constitution, tldr } = input;
  const edges = edge.resolveEdges({ specs, archived, constitution }, mergeState).edges;
  const planning = edge.buildPlanning({ master, specs, archived, ideas: edge.ideaFilesAt(base.root), now: edge.PLANNING_NOW, ...(workflow ? { workflow } : {}), specStates, specEdges: edges });
  const all = new Map([...specs, ...archived].map((f): [string, SpecFiles] => [f.folder, f]));
  const activityClaims = claimLines(base.root);
  const tree: TreeGoldens = {
    ...base,
    specs: base.specs.map((golden): SpecGoldens => {
      const files = all.get(golden.folder);
      if (files === undefined) throw new Error(`stub-api: ${base.golden} has no folder ${golden.folder}`);
      const specEdges = edges.filter((e) => e.fromSpec === golden.folder.slice(0, 3));
      const own = { ...files.texts, ...(master === null ? {} : { master }), ...(constitution === null ? {} : { constitution }) };
      const others = [...all.values()].filter((f) => f !== files);
      const id = golden.folder.slice(0, 3);
      const specItem = (items as ReadonlyArray<{ kind: string; id: string; spec?: string }>).find((i) => i.kind === 'spec' && i.id === id);
      const page = edge.buildSpecPage({ files: { folder: files.folder, texts: own }, others, tldr, ...(workflow ? { workflow } : {}), mergeState, ...(specItem === undefined ? {} : { state: specItem }), guidance });
      const claims = edge.buildClaimViews({ files, specEdges, now: LIVE_NOW });
      const { tasks: tasksText, rounds } = files.texts;
      const tasks = tasksText === undefined ? null : edge.parseTaskLines({ tasks: tasksText, ...(constitution === null ? {} : { constitution }), ...(rounds === undefined ? {} : { rounds }), specEdges, itemStates: (items as ReadonlyArray<{ spec?: string }>).filter((i) => i.spec === id) });
      const liveFiles = { folder: files.folder, texts: { ...files.texts, ...(constitution === null ? {} : { constitution }) } };
      const live = edge.buildLiveFrame({ files: liveFiles, locks, now: LIVE_NOW, specEdges });
      return { ...golden, spec: page, claims, tasks, locked: lockFixtures(core, page, live, claims, activityClaims) };
    }),
  };
  return { dashboard: { model, kpis: model.kpis }, planning, tree };
}

// ---- run variants (spec 040, T53) -------------------------------------------------------------------------------

/**
 * The run variants (spec 040, T53, ISC-224, ISC-224.1): under `X-Spectant-Stub-Locks: runs` the stub also serves the
 * fixture tree `beacon`, rebuilt by core from its files with `.spectant/activity.jsonl` edited in memory per
 * `X-Spectant-Stub-Run` (absent: `running`). `none` drops the run-start of `STUB_RUN`, so 003 reads `open` with
 * `/spec-tasks 003`; `running` is the log as it is, so the bodies equal beacon's goldens (003 `running` since 14:52);
 * `ended` appends that run's `run-end` with outcome `ok` and gives 003 the `tasks.md` the run wrote (`STUB_RUN_TASKS`,
 * in memory), so 003 reads the stage and state its files then give: `review`, open with `/spec-review 003` (ISC-224.1).
 */
export const RUN_STATES = ['none', 'running', 'ended'] as const;
export type StubRunState = (typeof RUN_STATES)[number];
export const RUN_HEADER = 'X-Spectant-Stub-Run';

/** The run the variants switch: beacon's `/spec-tasks 003`, open at `STUB_NOW` for eight minutes. */
export const STUB_RUN = {
  workspace: { slug: 'beacon', name: 'beacon', golden: 'beacon' },
  spec: '003',
  folder: '003-alert-rules',
  run: 'r-0308-1452',
  command: '/spec-tasks 003',
  session: 'a:claude:sess-32',
  since: '2026-03-08T14:52:00Z',
  /** When the `ended` variant's run-end line is stamped, before `STUB_NOW`. */
  endedAt: '2026-03-08T14:58:00Z',
} as const;

/** The `tasks.md` the `ended` run leaves in 003, one task per claim; only the stub's memory holds it. */
export const STUB_RUN_TASKS = [
  '---',
  'spec: 003-alert-rules',
  'plan: plan.md',
  `updated: ${STUB_RUN.endedAt}`,
  '---',
  '',
  '# Tasks 003 — Alert rules',
  '',
  '## Tasks',
  '',
  '- [ ] T1 · ISC-7 · api — an alert rule names a check, a threshold and a channel · `api/src/alert-rules.ts`',
  '- [ ] T2 · ISC-8 · api — fire once per outage · `api/src/alert-rules.ts`',
  '- [ ] T3 · ISC-9 · api — refuse an unknown channel on save · `api/src/alert-rules.ts`',
  '',
].join('\n');

/** beacon's activity log under one run variant; loud when the run's start line is not there exactly once. */
export function runActivity(text: string, state: StubRunState): string {
  const lines = text.split('\n');
  const start = lines.filter((l) => l.includes(`"run":"${STUB_RUN.run}"`) && l.includes('"event":"run-start"'));
  if (start.length !== 1) throw new Error(`stub-api: ${STUB_RUN.workspace.golden}'s activity log has ${start.length} run-start lines of ${STUB_RUN.run}`);
  if (state === 'running') return text;
  if (state === 'none') return lines.filter((l) => l !== start[0]).join('\n');
  const end = { ts: STUB_RUN.endedAt, event: 'run-end', run: STUB_RUN.run, command: STUB_RUN.command, session: STUB_RUN.session, spec: STUB_RUN.folder, outcome: 'ok' };
  return `${text.endsWith('\n') ? text : `${text}\n`}${JSON.stringify(end)}\n`;
}

/** One run variant of a tree: the dashboard, the planning tree and the spec families, each built by core. */
type RunVariant = { dashboard: { model: unknown; kpis: unknown }; planning: PlanningModel; tree: TreeGoldens };

/**
 * A tree under one run variant, built as its goldens are (`core/tests/fixtures.test.ts`, `golden.test.ts`,
 * `helpers/state-model.ts`, `helpers/planning-model.ts`) from its files and core's reading of the edited log
 * (`activityReading`): the items (`itemStates` at `STUB_NOW` with the default abort age), the dashboard and the planning
 * tree with them, and per spec the page with its `spec` item, the Tasks tab with its items, the claims over the log's
 * locks and the spec's edges (as the claims route reads them) and the live frame; timeline, frames and docs read no run
 * line and stay the golden's.
 */
function runVariant(
  core: Core,
  edge: EdgeCore,
  base: TreeGoldens,
  state: StubRunState,
  withReleases: (text: string) => string = (text) => text,
  without: ReadonlySet<string> = new Set(),
): RunVariant {
  const onDisk = edge.readTreeAt(base.root);
  // A folder left out (the waits variant `1`, spec 020 T15) is read as if the tree had none.
  const read = { ...onDisk, specs: onDisk.specs.filter((f) => !without.has(f.folder)) };
  // The ended run wrote 003's tasks.md; the other variants read the tree as it is.
  const withTasks = (f: SpecFiles): SpecFiles => (state === 'ended' && f.folder === STUB_RUN.folder ? { ...f, texts: { ...f.texts, tasks: STUB_RUN_TASKS } } : f);
  const input: TreeInput = { ...read, specs: read.specs.map(withTasks) };
  // The session's run releases (spec 040, ISC-226) append their run-end lines after the variant's edit.
  const locks = edge.activityReading(withReleases(runActivity(readFileSync(join(base.root, '.spectant', 'activity.jsonl'), 'utf8'), state)));
  const workspace = { ...input, locks };
  const items = edge.itemStates({ workspace, dashboard: edge.buildDashboard(workspace), taskRuns: edge.taskRunsOf(input.specs, locks, LIVE_NOW), now: LIVE_NOW, abortAfterMs: edge.DEFAULT_ABORT_AFTER_MS }) as ReadonlyArray<{ kind: string; id: string; spec?: string }>;
  const plain = edge.buildDashboard(input);
  const guidance = edge.guidanceOf({ workspace, dashboard: plain, items });
  const model = edge.withGuidance(edge.withItemStates(plain, items), guidance);
  const { master, specs, archived, workflow, constitution, tldr } = input;
  const specTexts = new Map(specs.map((f) => [f.folder, f.texts.spec]));
  const specStates = plain.specs.map((row) => {
    const spec = specTexts.get(row.slug);
    return { slug: row.slug, stage: row.stage, stageSource: row.stageSource, ...(spec === undefined ? {} : { hash: new Bun.CryptoHasher('sha256').update(spec).digest('hex') }) };
  });
  const built = edge.buildPlanning({ master, specs, archived, ideas: edge.ideaFilesAt(base.root), now: edge.PLANNING_NOW, ...(workflow ? { workflow } : {}), specStates });
  const planning = edge.withIdeaStates(built, items);
  const all = new Map([...specs, ...archived].map((f): [string, SpecFiles] => [f.folder, f]));
  const activityClaims = claimLines(base.root);
  const edges = edge.resolveEdges({ specs, archived, constitution }, []).edges;
  const tree: TreeGoldens = {
    ...base,
    specs: base.specs.filter((golden) => !without.has(golden.folder)).map((golden): SpecGoldens => {
      const files = all.get(golden.folder);
      if (files === undefined) throw new Error(`stub-api: ${base.golden} has no folder ${golden.folder}`);
      const id = golden.folder.slice(0, 3);
      const own = { ...files.texts, ...(master === null ? {} : { master }), ...(constitution === null ? {} : { constitution }) };
      const others = [...all.values()].filter((f) => f !== files);
      const specItem = items.find((i) => i.kind === 'spec' && i.id === id);
      const page = edge.buildSpecPage({ files: { folder: files.folder, texts: own }, others, tldr, ...(workflow ? { workflow } : {}), ...(specItem === undefined ? {} : { state: specItem }), guidance });
      const { tasks: tasksText, rounds } = files.texts;
      const tasks = tasksText === undefined ? null : edge.parseTaskLines({ tasks: tasksText, ...(constitution === null ? {} : { constitution }), ...(rounds === undefined ? {} : { rounds }), itemStates: items.filter((i) => i.spec === id) });
      const live = edge.buildLiveFrame({ files: { folder: files.folder, texts: { ...files.texts, ...(constitution === null ? {} : { constitution }) } }, locks, now: LIVE_NOW });
      // The claims as the claims route builds them (spec 040, ISC-224): over the run's locks and the spec's edges, so a
      // held claim reads `running`, a stale one `aborted` and one after another spec `waiting`.
      const claims = edge.buildClaimViews({ files, locks, specEdges: edges.filter((e) => e.fromSpec === id), now: LIVE_NOW });
      return { ...golden, spec: page, claims, tasks, locked: lockFixtures(core, page, live, claims, activityClaims) };
    }),
  };
  return { dashboard: { model, kpis: (model as { kpis: unknown }).kpis }, planning, tree };
}

// ---- waiting-entry variants (spec 020, T15) -----------------------------------------------------------------------

/**
 * The waits variants (spec 020, T15, ISC-238): `X-Spectant-Stub-Waits` picks the workspace list, so the start's first
 * column holds 0, 1 or 7 entries in `guidance.waits`. Every body is core's: lantern's and harbor's goldens as they are,
 * and for `1` beacon rebuilt by core (`runVariant`, its log as it is) without `STUB_WAITS.dropped`, whose close step
 * is beacon's second waiting entry; 004's review is then the only one.
 */
export const WAITS_STATES = ['0', '1', '7'] as const;
export type StubWaitsState = (typeof WAITS_STATES)[number];
export const WAITS_HEADER = 'X-Spectant-Stub-Waits';

/**
 * The open-question variant (spec 015, T24, ISC-232.1): `X-Spectant-Stub-Question: open` gives harbor 002's running
 * card T27 (held by `a:claude:sess-2` under the `activity` locks) a latest step `question` that no step follows, and
 * puts that card first under Needs you with `question: { text, ts }`, as core's `live.ts` lists an open question. Every
 * other spec, and any other value, answers as without the header. The steps of every answer otherwise come from
 * `core/fixtures/harbor.steps.golden.json` for harbor and are `{}` for the other trees.
 */
export const QUESTION_HEADER = 'X-Spectant-Stub-Question';
export const STUB_QUESTION = {
  spec: 'specs/002-web-console',
  task: 'T27',
  session: 'a:claude:sess-2',
  started: '2026-03-08T14:06:00Z',
  ts: '2026-03-08T14:58:00Z',
  text: 'Should the focus ring follow the theme accent or stay the fixed primary outline on every settings control?',
} as const;

/** The live answer and the steps with the stub's open question on `STUB_QUESTION.task`; a frame without that card is unchanged. */
export function withOpenQuestion(live: LiveFrame, steps: TaskSteps): { live: LiveFrame; steps: TaskSteps } {
  const card = live.cards.find((c) => c.task === STUB_QUESTION.task);
  if (card === undefined) return { live, steps };
  const { task, session: actor, started, ts, text } = STUB_QUESTION;
  const timeline = [...(steps[task] ?? [{ kind: 'build' as const, ts: started, actor }]), { kind: 'question' as const, ts, actor, text }];
  const needsYou = [{ ...card, question: { text, ts } }, ...live.needsYou.filter((n) => n.task !== task)];
  return { live: { ...live, needsYou }, steps: { ...steps, [task]: timeline } };
}

const LANTERN: StubWorkspace = { slug: 'lantern', name: 'lantern', golden: 'lantern' };
export const STUB_WAITS = {
  workspaces: {
    '0': [LANTERN],
    '1': [STUB_RUN.workspace, LANTERN],
    '7': [{ slug: 'harbor', name: 'harbor', golden: 'harbor' }, LANTERN],
  } satisfies Record<StubWaitsState, readonly StubWorkspace[]>,
  /** The beacon folder the `1` variant leaves out. */
  dropped: '009-timezone-labels',
} as const;

// ---- the dense workspace (spec 021, T5) ---------------------------------------------------------------------------

/**
 * The dense workspace (spec 021, T5, ISC-246, path P3): `X-Spectant-Stub-Dense: on` lists harbor alone, its dashboard
 * rebuilt by core (`denseDashboard`) over harbor's tree plus the fourteen done specs of `STUB_DENSE.added` and the fresh
 * `specs/tldr.md` of `STUB_DENSE.tldr`: 22 specs, Next up harbor's own three (a done spec has no next step) and a brief
 * that is not stale, its first section a realistic overview of at most 400 characters (decision E1). T34 lengthens titles and goals (`DENSE_LONG`) and
 * rebuilds those specs' pages; T53 adds one long library document (`DENSE_DOC`). Every other harbor route (the other
 * spec pages, planning, the rest of the library) stays the golden's, so an added spec's page is a 404. Absent or
 * `off`: the goldens as they are.
 */
export const DENSE_STATES = ['off', 'on'] as const;
export type StubDenseState = (typeof DENSE_STATES)[number];
export const DENSE_HEADER = 'X-Spectant-Stub-Dense';

/** One added spec: a closed chore whose two claims carry their evidence, read by core as `phase: complete`. */
type DenseSpec = { slug: string; title: string; goal: string; updated: string };

const DENSE_ADDED: readonly DenseSpec[] = [
  { slug: '010-tag-filter-rules', title: 'Filter mirrored tags by pattern', goal: 'A sync mirrors only the tags its include and exclude patterns select.', updated: '2026-02-02T10:00:00Z' },
  { slug: '011-digest-pinning', title: 'Pin a mirrored image to its digest', goal: 'A pinned image is mirrored by its manifest digest, never by a moving tag.', updated: '2026-02-04T11:30:00Z' },
  { slug: '012-sync-dry-run', title: 'Preview a sync without pushing', goal: 'A dry run lists every blob and manifest a sync would push and pushes none.', updated: '2026-02-06T09:15:00Z' },
  { slug: '013-rate-limit-backoff', title: 'Back off when the registry rate-limits', goal: 'A 429 from the registry pauses the sync for the time it names and then resumes it.', updated: '2026-02-09T14:00:00Z' },
  { slug: '014-history-export', title: 'Export the sync history as CSV', goal: 'The sync history leaves the console as one CSV file with a row per run.', updated: '2026-02-11T16:20:00Z' },
  { slug: '015-multi-arch-manifests', title: 'Mirror every platform of a multi-arch image', goal: 'An image index is mirrored with every platform manifest it lists.', updated: '2026-02-13T08:45:00Z' },
  { slug: '016-mirror-health', title: 'Report each mirror’s health in one command', goal: 'One command names every mirror that is behind, failing or unreachable.', updated: '2026-02-16T13:10:00Z' },
  { slug: '017-credential-helper', title: 'Read registry credentials through a helper', goal: 'Credentials come from the configured credential helper and never sit in the config.', updated: '2026-02-18T10:40:00Z' },
  { slug: '018-proxy-support', title: 'Sync through an HTTP proxy', goal: 'A sync reaches the registry through the proxy the environment names.', updated: '2026-02-20T15:00:00Z' },
  { slug: '019-layer-dedup', title: 'Skip layers the target already holds', goal: 'A layer the target registry already holds is mounted, not uploaded again.', updated: '2026-02-23T09:30:00Z' },
  { slug: '020-schedule-pause', title: 'Pause a schedule without deleting it', goal: 'A paused schedule keeps its settings and starts no run until it is resumed.', updated: '2026-02-25T12:00:00Z' },
  { slug: '021-log-redaction', title: 'Redact tokens from the sync log', goal: 'No token, password or signed URL appears in the sync log.', updated: '2026-02-27T17:45:00Z' },
  { slug: '022-config-validate', title: 'Validate the config before a run', goal: 'A config error stops the run before the first request and names its line.', updated: '2026-03-02T11:15:00Z' },
  { slug: '023-failure-webhook', title: 'Notify a webhook when a sync fails', goal: 'A failed sync posts its error and the mirror’s name to the configured webhook.', updated: '2026-03-04T14:30:00Z' },
];

/** After every harbor spec's `updated:` and newest round, so core reads the brief as fresh (`tldrState`). */
const DENSE_GENERATED = '2026-03-09T18:00:00Z';

const DENSE_TLDR = `---
generated: ${DENSE_GENERATED}
---

# TL;DR — harbor

<!-- section: overview -->
Harbor mirrors container images between registries; the 0.9 line is about the console and the config.
Fourteen smaller specs closed in five weeks, so the sync is feature-complete for this milestone. The web console
(002) is in its last build round with one question only you can answer. Retention policies (004) wait for code
review, and the partial push (006) waits for your review of its spec.

<!-- section: try -->
Run \`harbor sync --dry-run\` against the sample config, then open the console on port 4200 and walk the sync history.

<!-- section: per-spec -->
- **002** Web console: 25 of 30 closed; one question open about the empty state.
- **003** Config loader rewrite: claims written, tasks not yet.
- **004** Retention policies: all 30 closed; waits for its code review.
- **005** Config format choice: two fog lines to resolve before the decision.
- **006** Partial push: waits for its spec review.
- **007** Rotate the mirror token: both claims closed.
- **008** Referrers support: one sibling still open before it closes.
- **009** Chunked upload limits: building.

<!-- section: risks -->
The config loader rewrite touches every package at once; its parity snapshots are the only guard.

<!-- section: next -->
Answer the empty-state question in 002, then run the code review for 004.
`;

/**
 * Spec 021, T34 (ISC-248): harbor's own specs whose `task:` title or `## Goal` text the dense variant lengthens, so that
 * every expand toggle of the dashboard (each spec row's "More…", each Next-up entry's) and the spec head's goal toggle
 * appear through overflow at 1440, 600 and 390 px. Core reads the edited texts; the first five rows in core's order
 * (004, 005, 006, 002, 009) and in id order (002 to 006) each carry a long title or goal, and every Next-up entry
 * (004, 005, 006) a long title.
 */
const DENSE_LONG: Readonly<Record<string, { readonly title?: string; readonly goal?: string }>> = {
  '002-web-console': {
    title: 'Show every sync run and its failures in a small web console that a teammate can search, filter by mirror and read on a phone-sized screen',
    goal: 'A teammate opens the console, finds any mirrored repository in two steps from the start screen, sees each sync run with its pushed and skipped blobs, its failures and the registry answer that caused each one, and reads all of it on a phone-sized screen and with the keyboard alone, without a second tool or a shell on the sync host. The console never writes to a registry.',
  },
  '003-config-loader': {
    title: 'Read the config through one loader in the CLI, the API and the console, with defaults, environment overrides and include files resolved in one order',
    goal: 'The CLI, the API and the console read their configuration through one loader that resolves defaults, environment overrides and include files in a single documented order, and the effective config for every case in the snapshot corpus, the malformed ones included, is unchanged byte for byte after the rewrite.',
  },
  '004-retention-policies': {
    title: 'Delete old manifests on a written retention schedule, preview what each policy would remove, and never touch a manifest a tag still references',
    goal: 'A team writes its retention policy once in the config, sees its effect in a dry-run listing before anything goes, keeps every manifest that a tag, a referrer or a pinned digest still references, and finds each deletion in the sync history afterwards, with the policy line that caused it.',
  },
  '005-config-format-choice': {
    title: 'Decide which config format version 2 uses, weighing comments, schema validation, merge behaviour and the migration cost for existing setups',
  },
  '006-partial-push': {
    title: 'Stop a timed-out or cancelled push from leaving a half-written manifest, an orphaned tag or an unreferenced blob behind on the target registry',
  },
  '009-chunked-upload-limits': {
    title: 'Find the largest blob chunk each target registry accepts, record how it refuses a larger one, and keep every push below that recorded limit',
    goal: 'A recorded table names the chunk size each target registry accepts, its largest blob and how it answers a chunk that is too large, and Harbor never picks a chunk larger than the limit recorded for the registry it pushes to, even when that limit changes between two scheduled runs.',
  },
};

/** One harbor spec.md with its `DENSE_LONG` title and goal; loud when the text has no `task:` line or `## Goal`. */
function denseLongText(folder: string, text: string): string {
  const long = DENSE_LONG[folder];
  if (long === undefined) return text;
  let out = text;
  const { title, goal: sentence } = long;
  if (title !== undefined) {
    if (!/^task: .*$/m.test(out)) throw new Error(`stub-api: harbor ${folder}/spec.md has no task: line`);
    out = out.replace(/^task: .*$/m, () => `task: ${JSON.stringify(title)}`);
  }
  if (sentence !== undefined) {
    const goal = /(\n## Goal\n\n)[\s\S]*?(\n\n## )/;
    if (!goal.test(out)) throw new Error(`stub-api: harbor ${folder}/spec.md has no ## Goal section`);
    out = out.replace(goal, (_, head: string, next: string) => `${head}${sentence}${next}`);
  }
  return out;
}

/** One `##` section of the long library document: its heading, the noun its paragraphs speak of, its own first sentence. */
type DenseDocSection = { heading: string; subject: string; first: string };

const DENSE_DOC_SECTIONS: readonly DenseDocSection[] = [
  { heading: 'Purpose of this guide', subject: 'the guide', first: 'This guide walks an operator through the console from the first start to the weekly review of every mirror.' },
  { heading: 'Starting the console', subject: 'the start screen', first: 'The console starts with the sync service and listens on the loopback address only, on the port the config names.' },
  { heading: 'Finding a repository', subject: 'the repository search', first: 'Any mirrored repository is two steps away: type part of its name in the search box, then pick it from the list.' },
  { heading: 'Reading a sync run', subject: 'a sync run', first: 'A sync run lists every blob and manifest it pushed or skipped, in the order the registry answered them.' },
  { heading: 'Failures and their causes', subject: 'a failure', first: 'Each failure names the registry answer that caused it, its status code and the request that drew it.' },
  { heading: 'Filtering by mirror', subject: 'the mirror filter', first: 'The mirror filter narrows the history to one source and target pair and keeps that choice in the address.' },
  { heading: 'The phone-sized layout', subject: 'the narrow layout', first: 'Below 640 pixels the console stacks its columns, so the run list comes first and the details follow it.' },
  { heading: 'Keyboard use', subject: 'the keyboard path', first: 'Every action of the console has a keyboard path, and the focus ring shows where the next key press lands.' },
  { heading: 'The sync history', subject: 'the sync history', first: 'The sync history keeps one entry per run for ninety days and never rewrites an entry once it is written.' },
  { heading: 'Exporting the history', subject: 'the export', first: 'The export writes the filtered history as one CSV file, a row per run and a column per counter.' },
  { heading: 'Retention previews', subject: 'the retention preview', first: 'A retention preview lists the manifests a policy would remove and the tag or digest that keeps the rest.' },
  { heading: 'Schedules', subject: 'a schedule', first: 'A schedule starts a sync at the times its cron line names and skips a start while the previous run is busy.' },
  { heading: 'Pausing a schedule', subject: 'a paused schedule', first: 'A paused schedule keeps its settings and its history, and it starts no run until an operator resumes it.' },
  { heading: 'Rate limits', subject: 'a rate limit', first: 'When a registry answers with a rate limit, the run waits for the time the answer names and then resumes.' },
  { heading: 'Credentials', subject: 'the credential helper', first: 'The console never shows a credential; it names the helper that supplies it and the time of its last use.' },
  { heading: 'Proxies', subject: 'the proxy setting', first: 'A sync behind a proxy reads the proxy from the environment, and the run header shows which one it used.' },
  { heading: 'Health checks', subject: 'the health check', first: 'The health check names every mirror that is behind, failing or unreachable, and the run that showed it.' },
  { heading: 'Webhook notices', subject: 'the failure webhook', first: 'A failed run posts its error and the mirror name to the configured webhook, once per failure and run.' },
  { heading: 'Troubleshooting', subject: 'a stuck run', first: 'A run that makes no progress for ten minutes is marked stuck, and its last request stands at the top.' },
  { heading: 'Weekly review', subject: 'the weekly review', first: 'Once a week an operator reads the health check, the failures of the week and the retention preview together.' },
];

/** The paragraphs after a section's first one, each about five reference lines; `$` is the section's subject. */
const DENSE_DOC_PARAGRAPHS: readonly string[] = [
  'An operator reads $ from top to bottom, and nothing in it changes while it is open unless a new run arrives. When a new run arrives, the page marks it at the top and keeps the reading position where it was. The marker stays until the operator scrolls to it, so a busy hour of syncs never pushes a line out of view while it is being read.',
  'The numbers next to $ come from the sync service itself, never from an estimate in the browser. A counter that the service has not reported yet shows a dash instead of a zero, so a missing value is never mistaken for an empty one. Every number uses tabular figures, so a column of counts lines up and a changing value does not shift its neighbours.',
  'Links inside $ open the referenced run, mirror or manifest in the same tab, and the back button returns to the same scroll position. A link to a registry opens in a new tab only when the operator holds the modifier key. No link leaves the machine on its own, and the console loads no font, script or image from another host.',
  'When $ has nothing to show, the page says so in one sentence and names the step that would fill it. An empty state never shows a spinner, because nothing is loading; it shows the command or setting that produces the first entry. The same sentence appears in the narrow layout, where it takes the place of the whole column.',
  'Every text around $ is available in English and German, and the console follows the language the settings name. Dates use the operator time zone and say which zone they are in, so a run near midnight is never read as the wrong day. Durations under a minute show seconds, longer ones minutes, and a run longer than an hour shows hours and minutes.',
  'The colours of $ follow the light or dark theme the operator picked, and every state also has its own shape and word. A failure is never shown by colour alone, so it reads the same on a grey-scale screen or for a reader who does not tell red from green. Contrast stays above the level the accessibility guidelines ask for in both themes.',
  'Printing $ gives the same content without the navigation, one run per block and no block split across two pages. The print view drops the interactive controls and keeps the numbers, the states and the timestamps. An operator who files the weekly review on paper can therefore read every figure without the screen at hand.',
  'Changes to $ are recorded in the sync history with the operator, the time and the setting that changed. The record shows the value before and after the change, and a change that was undone stays visible as two entries. Nothing in the console edits a past entry, so the history remains a faithful account of what each run did.',
];

/** The long library document (spec 021, T53, ISC-251) as Markdown: an H1, a lead, then 20 `##` sections of nine paragraphs. */
function denseDocText(title: string): string {
  const sections = DENSE_DOC_SECTIONS.map(({ heading, subject, first }) => {
    const opening = `${first} The rest of this section explains how ${subject} behaves in daily use, what it shows and what it never does, so an operator can rely on it without reading the source of the console or asking the team that runs the sync.`;
    const rest = DENSE_DOC_PARAGRAPHS.map((p) => p.replaceAll('$', subject));
    return [`## ${heading}`, opening, ...rest].join('\n\n');
  });
  return [`# ${title}`, 'How the console is operated day to day, written for the operators who keep the mirrors in sync.', ...sections].join('\n\n') + '\n';
}

/** The long document's catalog entry: next to the reader document of `STUB_LIBRARY`, in the same spec. */
const DENSE_DOC = {
  path: '002-web-console/artifacts/T40-console-operations-guide.md',
  title: 'Console operations guide',
  sections: DENSE_DOC_SECTIONS.length,
} as const;

export const STUB_DENSE = {
  workspace: { slug: 'harbor', name: 'harbor', golden: 'harbor' } satisfies StubWorkspace,
  /** Harbor's eight active specs plus the added ones. */
  specs: 22,
  /** Next up: harbor's own three. */
  next: 3,
  added: DENSE_ADDED,
  generated: DENSE_GENERATED,
  tldr: DENSE_TLDR,
  /** T34: the lengthened titles and goals by folder, as core reads them. */
  long: DENSE_LONG,
  /** T34: the spec whose page carries the long goal sentence: `/w/harbor/s/002` under the header. */
  goalSpec: '002',
  /** T53: the long library document, `/w/harbor/library#<path>` under the header; 404 without it. */
  doc: DENSE_DOC,
} as const;

/** One added spec's two claim lines, as its spec.md and the master's feature `DENSE_FEATURE` both hold them. */
function denseClaims(spec: DenseSpec, index: number): [string, string] {
  return [`- [x] ISC-${301 + 2 * index}: ${spec.goal}`, `- [x] ISC-${302 + 2 * index}: Anti: a sync configured without it behaves differently than before.`];
}

/** The master's feature that owns the added specs' claims, so core reads them without drift. */
const DENSE_FEATURE = 'F8';

/** Harbor's master with the feature `DENSE_FEATURE` and every added claim before its milestones. */
function denseMaster(master: string | null): string | null {
  if (master === null) return null;
  const section = `### ${DENSE_FEATURE} · Sync operations\nWhy: the small changes that make a scheduled sync safe to leave alone.\n\n${DENSE_ADDED.flatMap(denseClaims).join('\n')}\n\n`;
  const at = master.indexOf('## Milestones');
  if (at < 0) throw new Error('stub-api: harbor ISA.md has no ## Milestones section for the dense feature');
  return `${master.slice(0, at)}${section}${master.slice(at)}`;
}

/** One added spec's folder as core reads it: a closed chore, two checked claims with their evidence. */
function denseSpecFiles(spec: DenseSpec, index: number): SpecFiles {
  const id = spec.slug.slice(0, 3);
  const [a, b] = [301 + 2 * index, 302 + 2 * index];
  const [claimA, claimB] = denseClaims(spec, index);
  const text = `---
task: "${spec.title}"
slug: ${spec.slug}
spec_type: chore
isa_master: ../../ISA.md
isa_feature: ${DENSE_FEATURE}
constitution: ../constitution.md
phase: complete
progress: 2/2
started: ${spec.updated.slice(0, 10)}T08:00:00Z
updated: ${spec.updated}
context_sufficient: true
interview_invoked: false
---

# ${id} — ${spec.title}

## Problem

The sync had no way to do this, so it was done by hand around the tool.

## Goal

${spec.goal}

## Claims

${claimA}
${claimB}

## Test Strategy

| isc | type | check | threshold | tool | anchors_to | severity |
|-----|------|-------|-----------|------|------------|----------|
| ISC-${a} | bun-test | the behaviour the goal names | as stated | \`bun test tests/${spec.slug.slice(4)}.test.ts\` | literal |  |
| ISC-${b} | bun-test | a sync without the setting | unchanged | \`bun test tests/${spec.slug.slice(4)}.test.ts -t "default"\` | derived: no-regression |  |

## Verification

- ISC-${a}: \`bun test tests/${spec.slug.slice(4)}.test.ts\` passed, ${spec.updated.slice(0, 10)}
- ISC-${b}: \`bun test tests/${spec.slug.slice(4)}.test.ts -t "default"\` passed, ${spec.updated.slice(0, 10)}
`;
  return { folder: spec.slug, texts: { spec: text } };
}

/**
 * Harbor under `X-Spectant-Stub-Dense: on`, composed as `runVariant` composes beacon's: core's `buildDashboard` over
 * harbor's tree with the `DENSE_LONG` titles and goals, plus the added specs and the fresh brief, the items over its
 * activity log at `STUB_NOW`, `guidanceOf` over them. The tree is the golden's but for the page of each spec
 * `DENSE_LONG` edits (T34), which core's `buildSpecPage` rebuilds over the same input; its claims, tasks, live frame,
 * timeline and docs stay the golden's, since the edit touches no claim or task line.
 */
function denseVariant(core: Core, edge: EdgeCore, base: TreeGoldens): { dashboard: { model: unknown; kpis: unknown }; tree: TreeGoldens } {
  const read = edge.readTreeAt(base.root);
  // A reviewed mark is re-marked over the lengthened spec.md, so the edit moves no gate and Next up stays harbor's.
  const own = read.specs.map((f): SpecFiles => {
    if (!(f.folder in DENSE_LONG) || f.texts.spec === undefined) return f;
    const texts = { ...f.texts, spec: denseLongText(f.folder, f.texts.spec) };
    const mark = remarked(edge, f.texts, texts);
    return { folder: f.folder, texts: mark === undefined ? texts : { ...texts, gateReviewed: mark } };
  });
  const input: TreeInput = { ...read, master: denseMaster(read.master), specs: [...own, ...DENSE_ADDED.map(denseSpecFiles)], tldr: DENSE_TLDR };
  const locks = edge.activityReading(readFileSync(join(base.root, '.spectant', 'activity.jsonl'), 'utf8'));
  const workspace = { ...input, locks };
  const items = edge.itemStates({ workspace, dashboard: edge.buildDashboard(workspace), taskRuns: edge.taskRunsOf(input.specs, locks, LIVE_NOW), now: LIVE_NOW, abortAfterMs: edge.DEFAULT_ABORT_AFTER_MS }) as ReadonlyArray<{ kind: string; id: string }>;
  const plain = edge.buildDashboard(input);
  const guidance = edge.guidanceOf({ workspace, dashboard: plain, items });
  const model = edge.withGuidance(edge.withItemStates(plain, items), guidance);
  const { master, specs, archived, workflow, constitution, tldr } = input;
  const all = [...specs, ...archived];
  const activityClaims = claimLines(base.root);
  const tree: TreeGoldens = {
    ...base,
    specs: base.specs.map((golden): SpecGoldens => {
      const files = golden.key === `specs/${golden.folder}` && golden.folder in DENSE_LONG ? all.find((f) => f.folder === golden.folder) : undefined;
      if (files === undefined) return golden;
      const texts = { ...files.texts, ...(master === null ? {} : { master }), ...(constitution === null ? {} : { constitution }) };
      const specItem = items.find((i) => i.kind === 'spec' && i.id === golden.folder.slice(0, 3));
      const others = all.filter((f) => f !== files);
      const page = edge.buildSpecPage({ files: { folder: files.folder, texts }, others, tldr, ...(workflow ? { workflow } : {}), ...(specItem === undefined ? {} : { state: specItem }), guidance });
      return { ...golden, spec: page, locked: lockFixtures(core, page, golden.locked.activity.live, golden.claims, activityClaims) };
    }),
  };
  return { dashboard: { model, kpis: (model as { kpis: unknown }).kpis }, tree };
}

const SPEC_FOLDER = /^(\d{3})-(.+)$/;
const SPEC_ID = /^\d{3}$/;

/** `resolveSpec` of `core/src/resolve.ts` over the golden keys: exactly one match or none, never a fallback. */
function resolveSpec(specs: readonly SpecGoldens[], ref: string): SpecGoldens | null {
  const one = (matches: readonly SpecGoldens[]): SpecGoldens | null => (matches.length === 1 ? (matches[0] ?? null) : null);
  if (SPEC_ID.test(ref)) return one(specs.filter((s) => s.folder.slice(0, 3) === ref));
  if (SPEC_FOLDER.test(ref)) {
    const byFolder = specs.filter((s) => s.folder === ref);
    if (byFolder.length > 0) return one(byFolder);
  }
  return one(specs.filter((s) => SPEC_FOLDER.test(s.folder) && s.folder.slice(4) === ref));
}

/** `TasksTab.counts` for `tasks` as `core/src/tasks.ts` counts them; `byLane` is unchanged by a tick. */
export function recountTasks(tasks: readonly TaskRow[], counts: TasksTab['counts']): TasksTab['counts'] {
  const boxes = tasks.filter((t) => t.state !== 'struck');
  return {
    rows: tasks.length,
    done: tasks.filter((t) => t.status === 'done' || t.status === 'closed').length,
    boxes: { landed: boxes.filter((t) => t.state === 'done').length, total: boxes.length },
    byLane: counts.byLane,
    byStatus: STATUS_ORDER.map((name) => ({ name, count: tasks.filter((t) => t.status === name).length })).filter((c) => c.count > 0 || c.name === 'done'),
  };
}

/**
 * A row with its checkbox set as a session wrote it. Setting it back to the golden state restores the golden row; the
 * other way, `done` for a tick (a checked box outranks an unfinished round) and `open` for an untick.
 */
function marked(row: TaskRow, checked: boolean): TaskRow {
  if ((row.state === 'done') === checked) return row;
  return checked ? { ...row, state: 'done', status: 'done' } : { ...row, state: 'open', status: 'open' };
}

// ---- the library (spec 017, T3) -----------------------------------------------------------------------------------

/** One workspace's catalog as the stub serves it, and what the document, search and prototype routes read behind it. */
type StubCatalog = {
  catalog: LibraryCatalog;
  /** The Markdown the stub holds for its synthetic documents, by `LibraryDoc.path`. */
  texts: ReadonlyMap<string, string>;
  /** Each prototype document's folder on disk, by `LibraryDoc.path`. */
  prototypes: ReadonlyMap<string, string>;
  /** The rendered pages, filled on first read. */
  pages: Map<string, DocsPage>;
};

const emptyStubCatalog = (): StubCatalog => ({ catalog: EMPTY_CATALOG, texts: new Map(), prototypes: new Map(), pages: new Map() });

/** plan.md's approach heading, as `core/src/tech.ts` reads it (its constant is not exported). */
const APPROACH_HEADINGS: readonly string[] = ['Approach'];

/** The `Origin` a sandboxed prototype page sends (opaque); `prototypeFileRoute` answers it for a render fetch alone. */
const OPAQUE_ORIGIN = 'null';
/** The `Sec-Fetch-Dest` values of what a page runs or renders in CORS mode, as `server/src/prototype.ts`. */
const OPAQUE_DESTINATIONS: ReadonlySet<string> = new Set(['script', 'style', 'font']);

const isoMinutesBefore = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) - minutes * 60_000).toISOString().replace('.000Z', 'Z');

function readTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function insertAfter(docs: LibraryDoc[], anchor: string, entries: readonly LibraryDoc[]): void {
  const at = docs.findIndex((doc) => doc.path === anchor);
  if (at === -1) throw new Error(`stub-api: the library anchor ${anchor} is not in the catalog`);
  docs.splice(at + 1, 0, ...entries);
}

/** `NNN-slug` of a path relative to `specs/`. */
const specOfPath = (path: string): string => path.split('/')[0] ?? path;

/**
 * One workspace's catalog: core's `readCatalog` over the fixture tree for the documents (path, type, spec, title,
 * media, pages), then made deterministic as a golden is: `modified` is the spec's frontmatter `updated:` (a workspace
 * document `STUB_NOW`), every present document `ok` and core's own `missing` entries dropped, so a checkout's mtimes
 * never change an answer. The group heads come from the spec and tech goldens (type, stage, claims, tasks, fog) and the
 * fixture's spec.md and plan.md through core's section reader (goal, approach as Markdown source); the fog lines are
 * the tech golden's. Harbor then gets `STUB_LIBRARY`.
 */
async function buildCatalog(core: Core, dir: string, tree: TreeGoldens, tech: TechModel): Promise<StubCatalog> {
  const raw = await core.readCatalog(tree.root);
  const active = tree.specs.filter((s) => s.key === `specs/${s.folder}`).sort((a, b) => (a.folder < b.folder ? -1 : a.folder > b.folder ? 1 : 0));
  const heads = new Map(active.map((s) => [s.folder, s.spec.head]));
  const updatedOf = (spec: string): string => heads.get(spec)?.updated ?? STUB_NOW;
  const docs: LibraryDoc[] = raw.docs
    .filter((doc) => doc.state !== 'missing')
    .map((doc) => ({ ...doc, state: 'ok', modified: doc.spec === 'workspace' ? STUB_NOW : updatedOf(doc.spec) }));
  const texts = new Map<string, string>();
  const prototypes = new Map<string, string>(
    docs.filter((doc) => doc.type === 'prototype').map((doc) => [doc.path, join(tree.root, 'specs', ...doc.path.split('/'))]),
  );

  if (tree.golden === 'harbor') {
    const { reader, stale, missing, evidence, prototype } = STUB_LIBRARY;
    if (!docs.some((doc) => doc.path === reader.path)) throw new Error(`stub-api: the reader document ${reader.path} is not in the catalog`);
    texts.set(reader.path, `${readFileSync(join(tree.root, 'specs', ...reader.path.split('/')), 'utf8')}${reader.appendix}`);
    const at = docs.findIndex((doc) => doc.path === stale);
    const staleDoc = docs[at];
    if (staleDoc === undefined) throw new Error(`stub-api: the stale document ${stale} is not in the catalog`);
    docs[at] = { ...staleDoc, state: 'stale', modified: heads.get(staleDoc.spec)?.started ?? STUB_NOW };
    insertAfter(docs, missing.after, [
      { path: missing.path, type: missing.type, spec: specOfPath(missing.path), title: basename(missing.path), modified: null, state: 'missing', media: 'markdown' },
    ]);
    const runs = Array.from({ length: evidence.count }, (_, i): LibraryDoc => {
      const n = i + 1;
      const path = stubEvidencePath(n);
      const title = `Probe run ${String(n).padStart(2, '0')}`;
      texts.set(path, `# ${title}\n\nThe probe of run ${n} passed against the console build of round ${1 + (n % 3)}.\n`);
      return { path, type: 'evidence', spec: evidence.spec, title, modified: isoMinutesBefore(updatedOf(evidence.spec), n * 10), state: 'ok', media: 'markdown' };
    });
    insertAfter(docs, evidence.after, runs);
    const source = join(dir, ...prototype.source);
    const pages = readdirSync(source, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
      .map((entry) => entry.name)
      .sort();
    const spec = specOfPath(prototype.path);
    insertAfter(docs, prototype.after, [
      { path: prototype.path, type: 'prototype', spec, title: basename(prototype.path), modified: updatedOf(spec), state: 'ok', media: 'prototype', pages, preview: prototype.preview },
    ]);
    prototypes.set(prototype.path, source);
  }

  const fogOf = new Map(tech.specs.map((s) => [s.slug, s.fog]));
  const groups = active.map((s): SpecGroupHead => {
    const folder = join(tree.root, 'specs', s.folder);
    const goal = core.levelTwoSection(readTextOrNull(join(folder, 'spec.md')) ?? '', core.GOAL_HEADINGS)?.trim() ?? '';
    const plan = readTextOrNull(join(folder, 'plan.md'));
    const section = plan === null ? null : core.levelTwoSection(plan, APPROACH_HEADINGS);
    const { claims, tasks } = s.spec.keyNumbers;
    return {
      spec: s.folder,
      type: s.spec.head.type,
      stage: s.spec.head.stage,
      claimsClosed: claims.closed,
      claimsTotal: claims.total,
      tasksDone: tasks.landed,
      tasksTotal: tasks.total,
      fog: fogOf.get(s.folder)?.length ?? 0,
      goal: goal === '' ? null : goal,
      approach: section === null ? null : core.firstParagraph(section),
    };
  });
  const fog = tech.specs.flatMap((s) => s.fog.map((text): LibraryFogLine => ({ spec: s.slug, text })));
  const catalog: LibraryCatalog = {
    docs,
    groups,
    fog,
    missing: docs.filter((doc) => doc.state === 'missing').length,
    stale: docs.filter((doc) => doc.state === 'stale').length,
  };
  return { catalog, texts, prototypes, pages: new Map() };
}

/**
 * Harbor's catalog under `X-Spectant-Stub-Dense: on` (spec 021, T53, ISC-251): the golden catalog with the long
 * document `DENSE_DOC` right after the reader document of `STUB_LIBRARY` (same spec, type and media), its Markdown
 * `denseDocText`. The document route renders it with core's `renderDocsMarkdown` as every other document.
 */
function denseCatalogOf(base: StubCatalog): StubCatalog {
  const docs = [...base.catalog.docs];
  const anchor = docs.find((doc) => doc.path === STUB_LIBRARY.reader.path);
  if (anchor === undefined) throw new Error(`stub-api: the reader document ${STUB_LIBRARY.reader.path} is not in the catalog`);
  insertAfter(docs, anchor.path, [{ ...anchor, path: DENSE_DOC.path, title: DENSE_DOC.title }]);
  const texts = new Map(base.texts);
  texts.set(DENSE_DOC.path, denseDocText(DENSE_DOC.title));
  return { catalog: { ...base.catalog, docs }, texts, prototypes: base.prototypes, pages: new Map() };
}

/** The Docs tab a catalog document renders as:the constitution's and the Design tab's own options, else a plain page. */
const docNameOf = (type: LibraryDoc['type']): DocName => (type === 'constitution' ? 'constitution' : type === 'design' ? 'design' : 'plan');

const ENTITY: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** A rendered page as plain text: tags dropped, the five entities decoded, whitespace collapsed. */
const plainTextOf = (page: DocsPage): string =>
  page.html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITY[entity] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The plain text around a match at `at`: 40 characters before it and 60 after, an ellipsis where the text is cut. */
function snippetAt(text: string, at: number, length: number): string {
  const start = Math.max(0, at - 40);
  const end = Math.min(text.length, at + length + 60);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

// ---- the stub ------------------------------------------------------------------------------------------------------

type SessionWrites = { reviewed: Map<string, GateView>; marks: Map<string, Map<string, boolean>> };

/** One session's board writes: the planning tree per workspace slug, the write count (it seeds the new hashes), allocations per slug. */
type BoardSession = { planning: Map<string, PlanningModel>; writes: number; allocated: Map<string, number> };

type AllocateMatch = Extract<WorkspaceRouteMatch, { route: 'allocate' }>;
type IdeaMatch = Extract<WorkspaceRouteMatch, { route: 'idea' }>;

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

/** The `api` handler for `serveDist({ api })`: the real `/api` contract, fed from the golden snapshots. */
export function stubApi(options: StubApiOptions = {}): ApiHandler {
  const workspaces = options.workspaces ?? DEFAULT_WORKSPACES;
  const dir = options.fixturesDir ?? join(import.meta.dir, '..', '..', 'core', 'fixtures');
  const unreadableSlug = options.unreadableSlug ?? workspaces.at(-1)?.slug;
  const defaultState = options.defaultState ?? 'two-workspaces';
  const core = loadCore();
  const dashboards = new Map(workspaces.map((w) => [w.slug, readDashboard(dir, w.golden)]));
  const trees = new Map(workspaces.map((w) => [w.slug, readTree(core, dir, w.golden)]));
  const plannings = new Map(workspaces.map((w) => [w.slug, readPlanning(dir, w.golden)]));
  // beacon's tech golden beside them, for its library under the run variants (spec 040, T53).
  const techs = new Map([...workspaces, STUB_RUN.workspace].map((w) => [w.slug, readTechGolden(dir, w.golden)]));
  // The worktree overlay (spec 027, T33): harbor's dashboard and spec goldens with its worktree facts, built once.
  const overlays = (slug: string): boolean => workspaces.find((w) => w.slug === slug)?.golden === OVERLAY_GOLDEN;
  const dashboardsOn = new Map(
    [...dashboards].map(([slug, d]): [string, { model: unknown; kpis: unknown }] => {
      if (!overlays(slug)) return [slug, d];
      const model = overlaidDashboard(d.model) as { kpis: unknown };
      return [slug, { model, kpis: model.kpis }];
    }),
  );
  const treesOn = new Map([...trees].map(([slug, tree]): [string, TreeGoldens] => [slug, overlays(slug) ? overlaidTree(tree) : tree]));
  const worktreesOn = (req: Request): boolean => req.headers.get(WORKTREES_HEADER) === 'on';
  // The spec-edge variants (spec 025, T20): harbor rebuilt by core with `STUB_EDGES`, both variants built together on
  // the first request that asks for one (core's lock reader is async) and then held; every other workspace stays its
  // golden. A failed build fails that request loudly and every later one that asks for a variant.
  const edgeCore = loadEdgeCore();
  type EdgeView = {
    dashboards: Map<string, { model: unknown; kpis: unknown }>;
    trees: Map<string, TreeGoldens>;
    plannings: Map<string, PlanningModel>;
    views: Map<StubState, StateView>;
  };
  const edgeViews = new Map<Exclude<EdgeState, 'off'>, EdgeView>();
  let edgesBuilt: Promise<void> | null = null;
  const buildEdges = (): Promise<void> =>
    (edgesBuilt ??= Promise.all(
      (['waiting', 'met'] as const).map(async (state): Promise<void> => {
        const out: EdgeView = { dashboards: new Map(dashboards), trees: new Map(trees), plannings: new Map(plannings), views: new Map() };
        for (const w of workspaces) {
          const tree = trees.get(w.slug);
          if (w.golden !== STUB_EDGES.golden || tree === undefined) continue;
          const variant = await edgeVariant(core, edgeCore, tree, state);
          out.dashboards.set(w.slug, variant.dashboard);
          out.trees.set(w.slug, variant.tree);
          out.plannings.set(w.slug, variant.planning);
        }
        for (const s of STUB_STATES) out.views.set(s, view(s, false, out));
        edgeViews.set(state, out);
      }),
    ).then(() => undefined));
  /** The edge variant a request asks for (`X-Spectant-Stub-Edges`), null for `off`; the handler built it before. */
  const edgeViewOf = (req: Request): EdgeView | null => {
    const state = req.headers.get(EDGES_HEADER);
    return state === 'waiting' || state === 'met' ? (edgeViews.get(state) ?? null) : null;
  };
  // The run variants (spec 040, T53): the listed workspaces as their goldens plus beacon rebuilt by core per
  // `X-Spectant-Stub-Run`, each variant built on the first request that asks for it and then held.
  const runWorkspaces: readonly StubWorkspace[] = [...workspaces.filter((w) => w.slug !== STUB_RUN.workspace.slug), STUB_RUN.workspace];
  let runBase: TreeGoldens | null = null;
  const runViews = new Map<string, EdgeView>();
  /** The run variant a request names (`X-Spectant-Stub-Run`, absent: `running`). */
  const runStateOf = (req: Request): StubRunState => {
    const header = req.headers.get(RUN_HEADER) ?? 'running';
    return isOneOf(RUN_STATES, header) ? header : 'running';
  };
  /**
   * The session's run releases (spec 040, ISC-226), per workspace slug: the `run-end` lines `POST …/runs/:run/release`
   * appended, applied in order after the run variant's edit, so the session's next reads show the run ended.
   */
  const releases = new Map<string, Map<string, unknown[]>>();
  const withReleasesOf = (req: Request, ws: string) => (text: string): string =>
    (releases.get(sessionOf(req))?.get(ws) ?? []).reduce<string>((acc, event) => acc + edgeCore.runReleaseAppendBytes(acc, event), text);
  /** The workspace's `.spectant/activity.jsonl` as the request's variant and session read it; `''` without the file. */
  const activityTextOf = (req: Request, ws: string, root: string): string => {
    let text: string;
    try {
      text = readFileSync(join(root, '.spectant', 'activity.jsonl'), 'utf8');
    } catch {
      text = '';
    }
    const variant = req.headers.get(LOCKS_HEADER) === 'runs' && ws === STUB_RUN.workspace.slug ? runActivity(text, runStateOf(req)) : text;
    return withReleasesOf(req, ws)(variant);
  };
  /** The run variant a request asks for (`X-Spectant-Stub-Locks: runs`), null under any other lock fixture. */
  const runViewOf = (req: Request): EdgeView | null => {
    if (req.headers.get(LOCKS_HEADER) !== 'runs') return null;
    const state = runStateOf(req);
    const own = releases.get(sessionOf(req))?.get(STUB_RUN.workspace.slug) ?? [];
    const key = own.length === 0 ? state : `${state}\n${JSON.stringify(own)}`;
    const held = runViews.get(key);
    if (held) return held;
    runBase ??= readTree(core, dir, STUB_RUN.workspace.golden);
    const variant = runVariant(core, edgeCore, runBase, state, withReleasesOf(req, STUB_RUN.workspace.slug));
    const { slug } = STUB_RUN.workspace;
    const out: EdgeView = {
      dashboards: new Map([...dashboards, [slug, variant.dashboard]]),
      trees: new Map([...trees, [slug, variant.tree]]),
      plannings: new Map([...plannings, [slug, variant.planning]]),
      views: new Map(),
    };
    for (const s of STUB_STATES) out.views.set(s, view(s, false, out, runWorkspaces));
    runViews.set(key, out);
    return out;
  };
  // The waits variants (spec 020, T15), each built on the first request that asks for it and then held.
  const waitsViews = new Map<StubWaitsState, EdgeView>();
  /** The waits variant a request asks for (`X-Spectant-Stub-Waits`), null without the header. */
  const waitsViewOf = (req: Request): EdgeView | null => {
    const state = req.headers.get(WAITS_HEADER);
    if (state === null || !isOneOf(WAITS_STATES, state)) return null;
    const held = waitsViews.get(state);
    if (held) return held;
    const from = STUB_WAITS.workspaces[state];
    const out: EdgeView = { dashboards: new Map(), trees: new Map(), plannings: new Map(), views: new Map() };
    for (const w of from) {
      if (state === '1' && w.slug === STUB_RUN.workspace.slug) {
        runBase ??= readTree(core, dir, STUB_RUN.workspace.golden);
        const variant = runVariant(core, edgeCore, runBase, 'running', undefined, new Set([STUB_WAITS.dropped]));
        out.dashboards.set(w.slug, variant.dashboard);
        out.trees.set(w.slug, variant.tree);
        out.plannings.set(w.slug, variant.planning);
      } else {
        out.dashboards.set(w.slug, dashboards.get(w.slug) ?? readDashboard(dir, w.golden));
        out.trees.set(w.slug, trees.get(w.slug) ?? readTree(core, dir, w.golden));
        out.plannings.set(w.slug, plannings.get(w.slug) ?? readPlanning(dir, w.golden));
      }
    }
    for (const s of STUB_STATES) out.views.set(s, view(s, false, out, from));
    waitsViews.set(state, out);
    return out;
  };
  // The dense variant (spec 021, T5), built on the first request that asks for it and then held.
  let denseView: EdgeView | null = null;
  /** The dense variant a request asks for (`X-Spectant-Stub-Dense: on`), null otherwise. */
  const denseViewOf = (req: Request): EdgeView | null => {
    if (req.headers.get(DENSE_HEADER) !== 'on') return null;
    if (denseView) return denseView;
    const w = STUB_DENSE.workspace;
    const variant = denseVariant(core, edgeCore, trees.get(w.slug) ?? readTree(core, dir, w.golden));
    const out: EdgeView = {
      dashboards: new Map([[w.slug, variant.dashboard]]),
      trees: new Map([[w.slug, variant.tree]]),
      plannings: new Map([[w.slug, plannings.get(w.slug) ?? readPlanning(dir, w.golden)]]),
      views: new Map(),
    };
    for (const s of STUB_STATES) out.views.set(s, view(s, false, out, [w]));
    denseView = out;
    return out;
  };
  /** Each workspace's catalog, built on first read (core's `readCatalog` is async) and then held: one per stub. */
  const catalogs = new Map<string, Promise<StubCatalog>>();
  const catalogOf = (slug: string, tree: TreeGoldens): Promise<StubCatalog> => {
    let found = catalogs.get(slug);
    if (found === undefined) {
      found = buildCatalog(core, dir, tree, techs.get(slug) as TechModel);
      catalogs.set(slug, found);
    }
    return found;
  };
  // The dense library (spec 021, T53): harbor's golden catalog plus the long document, built once on first read.
  let denseCatalog: Promise<StubCatalog> | null = null;
  /** The catalog a library request reads: the dense one under `X-Spectant-Stub-Dense: on`, else `catalogOf`. */
  const catalogFor = (req: Request, slug: string, tree: TreeGoldens): Promise<StubCatalog> => {
    if (slug !== STUB_DENSE.workspace.slug || denseViewOf(req) === null) return catalogOf(slug, tree);
    // Built over the golden tree, never the dense one, so the default catalog it caches stays the golden's.
    denseCatalog ??= catalogOf(slug, trees.get(slug) ?? tree).then(denseCatalogOf);
    return denseCatalog;
  };
  const board = loadBoardCore();
  const stories = new Map(
    [...workspaces, STUB_RUN.workspace].map((w): [string, ReadonlyMap<string, StoryFile>] => [w.slug, readStories(board, join(dir, w.golden), readPlanning(dir, w.golden))]),
  );

  const view = (
    state: StubState,
    on = false,
    src?: { dashboards: ReadonlyMap<string, { kpis: unknown }>; trees: ReadonlyMap<string, TreeGoldens> },
    from: readonly StubWorkspace[] = workspaces,
  ): StateView => {
    const listed = state === 'empty' ? [] : from;
    const list: Summary[] = [];
    const byslug: StateView['workspaces'] = new Map();
    for (const w of listed) {
      const base = { slug: w.slug, name: w.name, pathTail: w.pathTail ?? w.golden };
      const dashboard = (src?.dashboards ?? (on ? dashboardsOn : dashboards)).get(w.slug);
      const tree = (src?.trees ?? (on ? treesOn : trees)).get(w.slug);
      if (!dashboard || !tree) continue;
      if (state === 'unreadable' && w.slug === unreadableSlug) {
        const summary: Summary = { ...base, readable: false, error: 'missing', counts: null };
        list.push(summary);
        byslug.set(w.slug, { unreadable: summary });
      } else {
        list.push({ ...base, readable: true, counts: dashboard.kpis });
        byslug.set(w.slug, { tree });
      }
    }
    return { list, workspaces: byslug };
  };
  const views = new Map(STUB_STATES.map((s) => [s, view(s)]));
  const viewsOn = new Map(STUB_STATES.map((s) => [s, view(s, true)]));
  // The near-midnight fixture (spec 006, T4): harbor's tree with `STUB_MIDNIGHT` on 002, built once; its catalog per slug.
  const midnightGolden = (slug: string): boolean => workspaces.find((w) => w.slug === slug)?.golden === STUB_MIDNIGHT.golden;
  const midnightOn = (req: Request): boolean => req.headers.get(MIDNIGHT_HEADER) === 'on';
  const treesMidnight = new Map([...trees].map(([slug, tree]): [string, TreeGoldens] => [slug, midnightGolden(slug) ? midnightTree(tree) : tree]));
  const viewsMidnight = new Map(STUB_STATES.map((s) => [s, view(s, false, { dashboards, trees: treesMidnight })]));
  const midnightCatalogs = new Map<string, StubCatalog>();
  const midnightCatalogOf = (slug: string, base: StubCatalog): StubCatalog => {
    let found = midnightCatalogs.get(slug);
    if (found === undefined) {
      found = midnightCatalog(base);
      midnightCatalogs.set(slug, found);
    }
    return found;
  };
  const viewOf = (req: Request, state: StubState): StateView => {
    const dense = denseViewOf(req);
    if (dense) return dense.views.get(state) ?? view(state, false, dense, [STUB_DENSE.workspace]);
    const waited = waitsViewOf(req);
    if (waited) return waited.views.get(state) ?? view(state, false, waited);
    const ran = runViewOf(req);
    if (ran) return ran.views.get(state) ?? view(state, false, ran, runWorkspaces);
    if (midnightOn(req)) return viewsMidnight.get(state) ?? view(state, false, { dashboards, trees: treesMidnight });
    const edged = edgeViewOf(req);
    if (edged) return edged.views.get(state) ?? view(state, false, edged);
    return (worktreesOn(req) ? viewsOn : views).get(state) ?? view(state, worktreesOn(req));
  };

  const sessions = new Map<string, Settings>();
  const writes = new Map<string, SessionWrites>();
  /** Bumps per session, then per workspace slug. */
  const bumps = new Map<string, Map<string, number>>();
  const bumpsOf = (req: Request, slug: string): number => bumps.get(sessionOf(req))?.get(slug) ?? 0;
  const bumpRoute = async (req: Request, url: URL): Promise<Response> => {
    if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
    const slug = url.searchParams.get('ws');
    if (slug === null || !dashboards.has(slug)) return settingsError(404, { error: 'not-found' });
    const id = sessionOf(req);
    const own = bumps.get(id) ?? new Map<string, number>();
    own.set(slug, (own.get(slug) ?? 0) + 1);
    bumps.set(id, own);
    // Pushed before the 204, so a caller that awaited the bump finds the frame already on every open stream.
    await pushUpdate(id, slug);
    return new Response(null, { status: 204 });
  };

  // ---- the live update stream (spec 030, T17), per session like the bumps ----

  /** An open `GET /api/events`: its session, what its synthetic reads go out with, and how to write to or end it. */
  type LiveStream = { session: string; origin: string; headers: Headers; send: (text: string) => void; close: () => void };
  const streams = new Set<LiveStream>();
  /**
   * `GET /api/events` (plan 030 § Interfaces): 403 for a foreign `Host` or `Origin`, 405 with `EVENTS_ALLOW` for any
   * other method, else 200 `text/event-stream` that stays open: a `: ping` comment at once and every
   * `LIVE_HEARTBEAT_MS`, one `LIVE_EVENT` frame per bump of the session. It ends on a reset of the session or when the
   * reader cancels.
   */
  const eventsRoute = (req: Request): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET') return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: EVENTS_ALLOW });
    const headers = new Headers(req.headers);
    headers.delete('If-None-Match');
    const encoder = new TextEncoder();
    let drop = (): void => undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (text: string): void => {
          if (open) controller.enqueue(encoder.encode(text));
        };
        const timer = setInterval(() => send(': ping\n\n'), LIVE_HEARTBEAT_MS);
        drop = (): void => {
          open = false;
          clearInterval(timer);
          streams.delete(stream);
        };
        const close = (): void => {
          if (!open) return;
          drop();
          controller.close();
        };
        const stream: LiveStream = { session: sessionOf(req), origin: new URL(req.url).origin, headers, send, close };
        streams.add(stream);
        req.signal.addEventListener('abort', () => drop(), { once: true });
        send(': ping\n\n');
      },
      cancel() {
        drop();
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
  };
  /**
   * The `LiveUpdate` a stream gets for a change of workspace `ws`: the dashboard, the planning tree and each spec page of
   * that workspace, each the answer of the stub's own `GET` with the stream's headers (the same body and ETag a poll of
   * that page gets); a path that does not answer 200 for it is left out, and no 200 at all sends no frame.
   */
  const liveUpdateOf = async (stream: LiveStream, ws: string): Promise<LiveUpdate | null> => {
    const read = (path: string): Request => new Request(`${stream.origin}${path}`, { headers: stream.headers });
    const state = stream.headers.get(STATE_HEADER) ?? defaultState;
    const found = isOneOf(STUB_STATES, state) ? viewOf(read(workspaceRoutes.planning(ws)), state).workspaces.get(ws) : undefined;
    const ids = found && 'tree' in found ? [...new Set(found.tree.specs.map((spec) => spec.spec.head.id))] : [];
    const paths = [`${WORKSPACES_PATH}/${encodeURIComponent(ws)}/dashboard`, workspaceRoutes.planning(ws), ...ids.map((id) => specRoutes.spec(ws, id))];
    const views: LiveView[] = [];
    for (const path of paths) {
      const req = read(path);
      const res = await answer(req, new URL(req.url));
      if (res.status === 200) views.push({ path, etag: res.headers.get('ETag') ?? '', body: (await res.json()) as unknown });
    }
    return views.length === 0 ? null : { ws, views };
  };
  /** One `LIVE_EVENT` frame for workspace `ws` to every open stream of the session, each built from its own headers. */
  const pushUpdate = async (session: string, ws: string): Promise<void> => {
    for (const stream of [...streams]) {
      if (stream.session !== session) continue;
      const update = await liveUpdateOf(stream, ws);
      if (update !== null) stream.send(`event: ${LIVE_EVENT}\ndata: ${JSON.stringify(update)}\n\n`);
    }
  };
  /** Run bumps (T33) per session, then per `<slug>\0<spec key>\0<task>`: how many run events each task moved on. */
  const runBumps = new Map<string, Map<string, number>>();
  const bumpRunRoute = (req: Request, url: URL): Response => {
    if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
    const slug = url.searchParams.get('ws') ?? '';
    const ref = url.searchParams.get('spec');
    const tree = trees.get(slug);
    const spec = tree && ref !== null ? resolveSpec(tree.specs, ref) : null;
    const card = spec?.locked.activity.live.cards.find((c) => c.task === url.searchParams.get('task'));
    if (!spec || !card || card.state === 'absent') return settingsError(404, { error: 'not-found' });
    const id = sessionOf(req);
    const own = runBumps.get(id) ?? new Map<string, number>();
    const key = `${slug}\0${spec.key}\0${card.task}`;
    own.set(key, (own.get(key) ?? 0) + 1);
    runBumps.set(id, own);
    return new Response(null, { status: 204 });
  };
  /** The live frame this session sees: the fixture's, each bumped task's run moved on by its bumps (T33). */
  const liveOf = (req: Request, ws: string, spec: SpecGoldens, locks: LockState): LiveFrame => {
    const live = spec.locked[locks].live;
    const own = runBumps.get(sessionOf(req));
    if (!own) return live;
    const ticked = tickedOf(spec);
    const runs = new Map<string, TaskRun>();
    for (const card of live.cards) {
      const steps = own.get(`${ws}\0${spec.key}\0${card.task}`) ?? 0;
      const at = new Date(Date.parse(STUB_NOW) + steps * 60_000).toISOString().replace('.000Z', 'Z');
      const run = steps === 0 ? null : advancedRun(card.run ?? null, card.task, steps, ticked.has(card.task), at);
      if (run !== null && run !== card.run) runs.set(card.task, run);
    }
    return withRuns(live, runs, ticked);
  };
  /** The live frame and the steps a request gets: with the stub's open question on harbor 002 under `X-Spectant-Stub-Question: open`. */
  const questionOf = (req: Request, tree: TreeGoldens, spec: SpecGoldens, live: LiveFrame): { live: LiveFrame; steps: TaskSteps } =>
    req.headers.get(QUESTION_HEADER) === 'open' && tree.golden === 'harbor' && spec.key === STUB_QUESTION.spec
      ? withOpenQuestion(live, spec.steps)
      : { live, steps: spec.steps };
  const sessionOf = (req: Request): string => req.headers.get(SESSION_HEADER) ?? '';
  const settingsOf = (req: Request): Settings => sessions.get(sessionOf(req)) ?? defaults();
  const writesOf = (req: Request): SessionWrites => {
    const id = sessionOf(req);
    const found = writes.get(id);
    if (found) return found;
    const fresh: SessionWrites = { reviewed: new Map(), marks: new Map() };
    writes.set(id, fresh);
    return fresh;
  };
  // ---- the Stage-3 board state (T119), per session: the planning tree after the session's moves and allocations ----

  const boards = new Map<string, BoardSession>();
  const boardOf = (req: Request): BoardSession => {
    const id = sessionOf(req);
    const found = boards.get(id);
    if (found) return found;
    const fresh: BoardSession = { planning: new Map(), writes: 0, allocated: new Map() };
    boards.set(id, fresh);
    return fresh;
  };
  /** Workflows sent through `PUT /api/__stub/workflow` (T151), per session, then per workspace slug, as core parsed them. */
  const workflows = new Map<string, Map<string, Workflow>>();
  const workflowRoute = async (req: Request, url: URL): Promise<Response> => {
    if (req.method !== 'PUT') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'PUT' });
    const slug = url.searchParams.get('ws');
    if (slug === null || !plannings.has(slug)) return settingsError(404, { error: 'not-found' });
    const id = sessionOf(req);
    const own = workflows.get(id) ?? new Map<string, Workflow>();
    own.set(slug, core.parseWorkflow(await req.text()));
    workflows.set(id, own);
    return new Response(null, { status: 204 });
  };
  /**
   * The planning tree this session sees for a workspace slug: its own after a write, else the golden as it is; with
   * the session's workflow from `PUT /api/__stub/workflow` and core's board columns for it in place of the tree's,
   * when one was sent (the counts stay the tree's: the specs' stages are not re-derived).
   */
  const planningOf = (req: Request, slug: string): PlanningModel | undefined => {
    const model = boards.get(sessionOf(req))?.planning.get(slug) ?? ((denseViewOf(req) ?? waitsViewOf(req) ?? runViewOf(req) ?? edgeViewOf(req))?.plannings ?? plannings).get(slug);
    const workflow = workflows.get(sessionOf(req))?.get(slug);
    return model && workflow ? { ...model, workflow, stages: core.boardStages(workflow) } : model;
  };
  /** spec.md's raw hash as this session sees it: the planning holder's (the golden's real sha256, or a move's), else a fake. */
  const specHashOf = (req: Request, ws: string, tree: TreeGoldens, spec: SpecGoldens): string => {
    const model = planningOf(req, ws);
    return (model ? holderOf(model, spec.folder)?.hash : null) ?? fakeHex(`${tree.golden}:${spec.key}:spec.md:raw`);
  };
  const actorLists = new Map<string, ActorMapping[]>();
  const boardQueries = new Map<string, Map<string, string>>();

  const notebooks = new Map<string, { notes: Note[]; writes: number }>();
  const notebookOf = (req: Request): { notes: Note[]; writes: number } => {
    const id = sessionOf(req);
    const found = notebooks.get(id);
    if (found) return found;
    const fresh = { notes: [...STUB_NOTES], writes: 0 };
    notebooks.set(id, fresh);
    return fresh;
  };

  const workspaceRoute = (req: Request, state: StubState, slugSegment: string | undefined): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
    }
    const current = viewOf(req, state);
    if (slugSegment === undefined) return workspaceJson(req, 200, current.list);
    let slug: string;
    try {
      slug = decodeURIComponent(slugSegment);
    } catch {
      return workspaceJson(req, 404, { error: 'not-found' });
    }
    const found = current.workspaces.get(slug);
    if (!found) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in found) return workspaceJson(req, 409, found.unreadable);
    const source = (denseViewOf(req) ?? waitsViewOf(req) ?? runViewOf(req) ?? edgeViewOf(req))?.dashboards ?? (worktreesOn(req) ? dashboardsOn : dashboards);
    // The hash a run release sends back (spec 040, ISC-226), as `api.ts` sends it: the log the request's variant reads.
    const activityHash = { [ACTIVITY_HASH_HEADER]: rawSha256(activityTextOf(req, slug, found.tree.root)) };
    return workspaceJson(req, 200, bumpDashboard(source.get(slug)?.model, bumpsOf(req, slug)), activityHash);
  };

  /**
   * A route of `WORKSPACE_ROUTE_TABLE` with a whole-file golden family (`…/planning`, `…/tech`), with the guard order
   * and statuses of the dashboard branch above and of `server/src/api.ts`: 403, 405 with `allowForWorkspace`, 404
   * unknown slug, 409 the unreadable summary, else the whole golden file of the route's family (planning: the session's
   * tree).
   */
  const workspaceFamilyRoute = (req: Request, state: StubState, match: WorkspaceRouteMatch): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace(match.route) });
    }
    const found = (viewOf(req, state)).workspaces.get(match.params.ws);
    if (!found) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in found) return workspaceJson(req, 409, found.unreadable);
    const served = planningOf(req, match.params.ws);
    const text = backlogTextOf(req, match.params.ws, found.tree.root);
    // After a backlog write of this session the real route reads the new ranks and priorities (spec 037, T26).
    const written = backlogs.get(sessionOf(req))?.has(match.params.ws) === true;
    const master = written ? masterOf(found.tree.root) : null;
    const model = served && master !== null ? withBacklogText(board, served, text, board.backlogFeatures(master).map((f) => f.id)) : served;
    // The real route adds the hash of specs/backlog.md (spec 036), the session's after a backlog write.
    return workspaceJson(req, 200, model && { ...model, backlogHash: rawSha256(text ?? '') });
  };

  /**
   * `GET|HEAD …/:ws/library/asset?path=` (spec 017; formerly `…/tech/asset`, spec 023 T10): the guards of the family route above, then the fixture tree's
   * file under `specs/` through core's `resolveEvidencePath` with `reach: 'tree'`, images only, answered as the evidence file is: `evidenceFileHeaders` of core's
   * `mediaTypeOf`, a strong ETag over the bytes, 304 on a match, no body on HEAD.
   */
  const libraryAssetRoute = async (req: Request, url: URL, state: StubState, match: WorkspaceRouteMatch): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace(match.route) });
    }
    const tree = readableTree(req, state, match.params.ws);
    if (tree instanceof Response) return tree;
    // The one resolver (core's, as `api.ts` uses it): `specs/` as the root, any file below it, images only.
    const resolved = await core.resolveEvidencePath(join(tree.root, 'specs'), evidencePathQuery(url.search), 'tree');
    if (!resolved.ok) {
      const status = resolved.reason === 'not-found' || resolved.reason === 'not-a-file' ? 404 : 403;
      return workspaceJson(req, status, { error: status === 403 ? 'forbidden' : 'not-found' });
    }
    const type = core.mediaTypeOf(basename(resolved.path));
    if (!type.startsWith('image/')) return workspaceJson(req, 403, { error: 'forbidden' });
    const bytes = new Uint8Array(readFileSync(resolved.absolute));
    const headers = { ...evidenceFileHeaders(type), ETag: strongEtag(bytes) };
    if (matchesIfNoneMatch(req.headers.get('If-None-Match'), headers.ETag)) return new Response(null, { status: 304, headers });
    return new Response(req.method === 'HEAD' ? null : bytes, { headers });
  };

  /** The `X-Spectant-Stub-Library` value of a request, or its loud 400. */
  const libraryStateOf = (req: Request): StubLibraryState | Response => {
    const value = req.headers.get(LIBRARY_HEADER) ?? 'catalog';
    return isOneOf(LIBRARY_STATES, value) ? value : settingsError(400, { error: 'unknown-stub-library', library: value, states: [...LIBRARY_STATES] });
  };

  /** One Markdown document of the catalog rendered as a Docs page; null for a path the catalog does not list as one. */
  const libraryPage = (stub: StubCatalog, tree: TreeGoldens, raw: string, library: StubLibraryState): LibraryDocPage | null => {
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return null;
    }
    const doc = stub.catalog.docs.find((d) => d.path === path && isReadable(d));
    return doc === undefined ? null : renderDoc(stub, tree, doc, library);
  };
  const isReadable = (doc: LibraryDoc): boolean => doc.media === 'markdown' && doc.state !== 'missing';
  // As the server: tech.md adds core's `techSectionHeads` over the same text (ISC-157.2), no other document does.
  const renderDoc = (stub: StubCatalog, tree: TreeGoldens, doc: LibraryDoc, library: StubLibraryState = 'catalog'): LibraryDocPage => {
    const differing = library === 'tech-heading' && doc.type === 'tech';
    const cached = differing ? undefined : stub.pages.get(doc.path);
    if (cached) return cached;
    const absolute = join(tree.root, 'specs', ...doc.path.split('/'));
    const own = stub.texts.get(doc.path) ?? readFileSync(absolute, 'utf8');
    const text = differing ? techHeadingText(own) : own;
    const rendered = core.renderDocsMarkdown(text, core.docsRenderOptions(tree.root, absolute, docNameOf(doc.type)));
    const page: LibraryDocPage = doc.type === 'tech' ? { ...rendered, techSections: core.techSectionHeads(text) } : rendered;
    if (!differing) stub.pages.set(doc.path, page);
    return page;
  };

  /**
   * The search over the catalog's Markdown documents, in catalog order: case-insensitive, the first match in the
   * rendered text (as plain text) gives the snippet, else a match in the title gives the title. An empty or blank `q`
   * is `{query: '', hits: []}`.
   */
  const librarySearch = (stub: StubCatalog, tree: TreeGoldens, q: string): LibrarySearchResult => {
    const query = q.trim();
    if (query === '') return { query: '', hits: [] };
    const needle = query.toLowerCase();
    const hits = stub.catalog.docs.flatMap((doc): LibrarySearchHit[] => {
      if (!isReadable(doc)) return [];
      const text = plainTextOf(renderDoc(stub, tree, doc));
      const at = text.toLowerCase().indexOf(needle);
      if (at !== -1) return [{ path: doc.path, snippet: snippetAt(text, at, needle.length) }];
      return doc.title.toLowerCase().includes(needle) ? [{ path: doc.path, snippet: doc.title }] : [];
    });
    return { query, hits };
  };

  /**
   * `GET|HEAD …/:ws/library`, `…/library/doc?path=` and `…/library/search?q=` (spec 017, T3): the guards of the family
   * routes (403, 405 with `allowForWorkspace`, 404 unknown slug, 409 the unreadable summary), then the workspace's
   * catalog (`EMPTY_CATALOG` under `X-Spectant-Stub-Library: empty`), one of its Markdown documents as a Docs page (404
   * for any path the catalog does not list as one, never a read of the path), or the search result.
   */
  const libraryRoute = async (
    req: Request,
    url: URL,
    state: StubState,
    library: StubLibraryState,
    match: Extract<WorkspaceRouteMatch, { route: 'library' | 'libraryDoc' | 'librarySearch' }>,
  ): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace(match.route) });
    }
    const tree = readableTree(req, state, match.params.ws);
    if (tree instanceof Response) return tree;
    const ws = match.params.ws;
    const base = library === 'empty' ? emptyStubCatalog() : await catalogFor(req, ws, tree);
    const stub = library !== 'empty' && midnightOn(req) && midnightGolden(ws) ? midnightCatalogOf(ws, base) : base;
    switch (match.route) {
      case 'library':
        return workspaceJson(req, 200, stub.catalog);
      case 'libraryDoc': {
        const page = libraryPage(stub, tree, evidencePathQuery(url.search), library);
        return page === null ? workspaceJson(req, 404, { error: 'not-found' }) : workspaceJson(req, 200, page);
      }
      case 'librarySearch':
        return workspaceJson(req, 200, librarySearch(stub, tree, url.searchParams.get('q') ?? ''));
    }
  };

  /**
   * `GET|HEAD /proto/:ws/:spec/:folder/*` (spec 017, ISC-159): one file of a `prototype` catalog document, through
   * core's resolver with the prototype's folder as the root (403 for what confinement refuses, 404 for no file), with
   * the evidence file's headers but inline and `PROTOTYPE_CSP`; every answer, errors included, carries that CSP. 404 for
   * a path the contract does not match or a prototype the catalog does not list; 405 with `PROTOTYPE_ALLOW`. As
   * `server/src/prototype.ts` (spec 017 T58, ISC-159.3): `Origin: null` (the sandboxed page) gets any file but HTML
   * with `Access-Control-Allow-Origin: *`, only for a fetch the browser makes to run or render it (`Sec-Fetch-Mode: cors`
   * with `Sec-Fetch-Dest` `script`, `style` or `font`); every other answer to it is 403 without that header. Every
   * non-HTML answer carries `Vary: Origin, Sec-Fetch-Mode, Sec-Fetch-Dest`.
   */
  const prototypeFileRoute = async (req: Request, pathname: string): Promise<Response> => {
    const opaque = req.headers.get('Origin') === OPAQUE_ORIGIN;
    if (!opaque) return prototypeFileAnswer(req, pathname, false);
    if (!isLoopbackHost(req.headers.get('Host'))) return prototypeForbidden(req);
    const renderFetch = req.headers.get('Sec-Fetch-Mode') === 'cors' && OPAQUE_DESTINATIONS.has(req.headers.get('Sec-Fetch-Dest') ?? '');
    if (!renderFetch) return prototypeForbidden(req);
    const res = await prototypeFileAnswer(req, pathname, true);
    return res.status === 200 || res.status === 304 ? res : prototypeForbidden(req);
  };

  const withCsp = (res: Response): Response => {
    res.headers.set('Content-Security-Policy', PROTOTYPE_CSP);
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  };

  const prototypeForbidden = (req: Request): Response => withCsp(workspaceJson(req, 403, { error: 'forbidden' }));

  /** The prototype answer; `opaque` (a request from `Origin: null`) is answered for any file but HTML. */
  const prototypeFileAnswer = async (req: Request, pathname: string, opaque: boolean): Promise<Response> => {
    if (!opaque && !guarded(req)) return prototypeForbidden(req);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return withCsp(workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: PROTOTYPE_ALLOW }));
    }
    const match: PrototypeRouteMatch | null = matchPrototypePath(pathname);
    if (match === null) return withCsp(workspaceJson(req, 404, { error: 'not-found' }));
    const state = req.headers.get(STATE_HEADER) ?? defaultState;
    if (!isOneOf(STUB_STATES, state)) return withCsp(settingsError(400, { error: 'unknown-stub-state', state, states: [...STUB_STATES] }));
    const library = libraryStateOf(req);
    if (library instanceof Response) return withCsp(library);
    const tree = readableTree(req, state, match.params.ws);
    if (tree instanceof Response) return withCsp(tree);
    const stub = library === 'empty' ? emptyStubCatalog() : await catalogFor(req, match.params.ws, tree);
    const doc = stub.catalog.docs.find((d) => d.type === 'prototype' && d.spec === match.params.spec && prototypeFolderOf(d) === match.params.folder);
    const source = doc === undefined ? undefined : stub.prototypes.get(doc.path);
    if (source === undefined || doc === undefined) return withCsp(workspaceJson(req, 404, { error: 'not-found' }));
    const { offline } = STUB_LIBRARY.prototype;
    const stubOnly = doc.path === STUB_LIBRARY.prototype.path && match.params.file === offline.file;
    let name: string;
    let read: () => Uint8Array<ArrayBuffer>;
    if (stubOnly) {
      name = offline.file;
      read = () => new TextEncoder().encode(stubOfflinePrototypeHtml());
    } else {
      const resolved = await core.resolveEvidencePath(source, match.params.file, 'tree');
      if (!resolved.ok) {
        const status = resolved.reason === 'not-found' || resolved.reason === 'not-a-file' ? 404 : 403;
        return withCsp(workspaceJson(req, status, { error: status === 403 ? 'forbidden' : 'not-found' }));
      }
      name = basename(resolved.path);
      read = () => new Uint8Array(readFileSync(resolved.absolute));
    }
    const type = core.prototypeMediaTypeOf(name);
    const html = type.startsWith('text/html');
    if (opaque && html) return prototypeForbidden(req);
    const bytes = read();
    const etag = strongEtag(bytes);
    const headers: Record<string, string> = {
      ...evidenceFileHeaders(type),
      'Content-Disposition': 'inline',
      'Content-Security-Policy': PROTOTYPE_CSP,
      ETag: etag,
      ...(html ? {} : { Vary: 'Origin, Sec-Fetch-Mode, Sec-Fetch-Dest' }),
      ...(opaque ? { 'Access-Control-Allow-Origin': '*' } : {}),
    };
    if (matchesIfNoneMatch(req.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
    return new Response(req.method === 'HEAD' ? null : bytes, { headers });
  };

  /** The guard order every workspace route shares (`api.ts`): 404 unknown slug, 409 the unreadable summary, else the tree. */
  const readableTree = (req: Request, state: StubState, ws: string): TreeGoldens | Response => {
    const found = (viewOf(req, state)).workspaces.get(ws);
    if (!found) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in found) return workspaceJson(req, 409, found.unreadable);
    return found.tree;
  };

  /**
   * `GET|HEAD …/ideas/:slug` (`api.ts` `idea`): the session tree's `IdeaRef`, the page core renders from the fixture's
   * story file and its raw sha256. 404 for a story the session's tree no longer lists (allocated) or never did.
   */
  const ideaRoute = (req: Request, state: StubState, match: IdeaMatch): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace('idea') });
    }
    const tree = readableTree(req, state, match.params.ws);
    if (tree instanceof Response) return tree;
    const idea = planningOf(req, match.params.ws)?.ideas.find((ref) => ref.slug === match.params.slug);
    const file = stories.get(match.params.ws)?.get(match.params.slug);
    if (!idea || !file) return workspaceJson(req, 404, { error: 'not-found' });
    return workspaceJson(req, 200, { idea, page: file.page, hash: file.hash } satisfies IdeaPage);
  };

  /**
   * `GET|HEAD|PUT …/board-query` (`api.ts` `boardQuery`): per session and workspace, in memory, `''` until a PUT.
   * 405 before the slug, 404 for a workspace the state does not list; no 409, the database is not the workspace's files.
   */
  const boardQueryRoute = async (req: Request, state: StubState, ws: string): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'PUT') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace('boardQuery') });
    }
    if (!(viewOf(req, state)).workspaces.has(ws)) return workspaceJson(req, 404, { error: 'not-found' });
    const own = boardQueries.get(sessionOf(req)) ?? new Map<string, string>();
    if (req.method !== 'PUT') return workspaceJson(req, 200, { query: own.get(ws) ?? '' } satisfies BoardQuery);
    const body = await readJson(req);
    if (!isBoardQuery(body)) return workspaceJson(req, 400, { error: 'invalid-body' });
    own.set(ws, body.query);
    boardQueries.set(sessionOf(req), own);
    return workspaceJson(req, 200, { query: body.query } satisfies BoardQuery);
  };

  /** `GET|HEAD|PUT /api/actors` (`api.ts` `actorsApi`): the session's list ordered by id, replaced whole by a PUT of persons. */
  const actorsRoute = async (req: Request): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    const list = actorLists.get(sessionOf(req)) ?? [];
    if (req.method === 'GET' || req.method === 'HEAD') return workspaceJson(req, 200, list);
    if (req.method !== 'PUT') return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: ACTORS_ALLOW });
    const body = await readJson(req);
    if (!isActorMappings(body) || !body.every((actor) => parseActor(actor.id).kind === 'person')) {
      return workspaceJson(req, 400, { error: 'invalid-body' });
    }
    const stored = body
      .map(({ id, displayName, gitIdentities }) => ({ id, displayName, gitIdentities: [...gitIdentities] }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    actorLists.set(sessionOf(req), stored);
    return workspaceJson(req, 200, stored);
  };

  /** The lock a scripted 423 of a workspace write names: the first lock any spec holds under the fixture, else a frontier one. */
  const anyLock = (tree: TreeGoldens, locks: LockState): ClaimLock => {
    for (const fixture of [locks, 'frontier'] as const) {
      for (const spec of tree.specs) {
        const lock = spec.locked[fixture].live.locks[0];
        if (lock) return lock;
      }
    }
    return fallbackLock('ISC-1', syntheticSession('000', 'ISC-1'));
  };

  /**
   * `POST …/ideas/:slug/allocate` (`allocate-route.ts`, `writes.ts` `writeAllocate`), scripted by the request: 400 for a
   * body `isAllocateRequest` refuses, 404 for a story the session's tree does not list, 409 `StaleIdea` for a hash that
   * is not the story file's raw sha256 (or `X-Spectant-Stub-Write: stale`), 423 only under `X-Spectant-Stub-Write:
   * locked` (the real write never answers it: a story has no claim), 422 `not-in-index` for a story the planning
   * golden's `ideas-index` finding names, else 200: the next number past every folder of the tree and the session's
   * earlier allocations, the story gone from the session's tree and the new spec at `plan` (`allocatedPlanning`).
   */
  const allocateRoute = async (req: Request, state: StubState, locks: LockState, outcome: WriteOutcome, match: AllocateMatch): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'POST') return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace('allocate') });
    const { ws, slug } = match.params;
    const tree = readableTree(req, state, ws);
    if (tree instanceof Response) return tree;
    const body = await readJson(req);
    if (!isAllocateRequest(body)) return workspaceJson(req, 400, { error: 'invalid-body' });
    const model = planningOf(req, ws);
    const story = model?.ideas.find((ref) => ref.slug === slug);
    const file = stories.get(ws)?.get(slug);
    if (!model || !story || !file) return workspaceJson(req, 404, { error: 'not-found' });
    const stale = outcome === 'stale' ? { error: 'hash-mismatch', files: [story.path], expected: { idea: file.hash } } : board.ideaConflict(story.path, body.hash, file.hash);
    if (stale !== null) return workspaceJson(req, 409, stale);
    if (outcome === 'locked') return workspaceJson(req, 423, { error: 'locked', lock: anyLock(tree, locks) } satisfies Locked);
    const session = boards.get(sessionOf(req));
    const taken = Math.max(0, ...tree.specs.map((s) => Number.parseInt(s.folder.slice(0, 3), 10)).filter(Number.isFinite));
    const id = String(taken + 1 + (session?.allocated.get(ws) ?? 0)).padStart(3, '0');
    const name = `${id}-${slug}`;
    const folder = `specs/${name}/`;
    const unindexed = model.diagnostics.some((d) => d.diagnostic.code === 'ideas-index' && d.diagnostic.subject === slug);
    if (unindexed) return workspaceJson(req, 422, { error: 'allocate-refused', reason: 'not-in-index', folder } satisfies AllocateRefused);
    const own = boardOf(req);
    own.writes += 1;
    own.allocated.set(ws, (own.allocated.get(ws) ?? 0) + 1);
    const holder: PlanningHolder = {
      id,
      slug: name,
      // No `task:` in the spec.md `allocationOf` writes: the title falls back to the folder slug without its number.
      title: slug,
      archived: false,
      main: true,
      held: 0,
      stage: 'plan',
      stageSource: 'explicit',
      priority: story.priority,
      hash: fakeHex(`${tree.golden}:specs/${name}:spec.md:allocate-${String(own.writes)}`),
      assignee: null,
    };
    own.planning.set(ws, allocatedPlanning(model, story, holder));
    const paths = board.writePathsOf('allocate', name, slug);
    const lockSource = tree.specs[0]?.locked[locks].live.lockSource ?? 'none';
    return workspaceJson(req, 200, { id, folder, files: paths.writes, removed: paths.removes[0] ?? story.path, lockSource } satisfies IdeaAllocated);
  };

  /** The fixture tree's master, null when it has none. */
  const masterOf = (root: string): string | null => {
    try {
      return readFileSync(join(root, 'ISA.md'), 'utf8');
    } catch {
      return null;
    }
  };
  /** The session's `specs/backlog.md` per workspace slug after its backlog writes (spec 036); absent, the fixture's file. */
  const backlogs = new Map<string, Map<string, string | null>>();
  const backlogTextOf = (req: Request, ws: string, root: string): string | null => {
    const own = backlogs.get(sessionOf(req));
    if (own?.has(ws)) return own.get(ws) ?? null;
    try {
      return readFileSync(join(root, 'specs', 'backlog.md'), 'utf8');
    } catch {
      return null;
    }
  };
  /**
   * `POST …/:ws/backlog` (`backlog-route.ts`, `writes.ts` `writeBacklog`), over the fixture tree's own master and
   * `specs/backlog.md` (none on harbor, so its hash is the empty text's) and the session's earlier writes: 400 for a body
   * `isBacklogRequest` refuses, 409 `StaleBacklog` for any other hash (or `X-Spectant-Stub-Write: stale`), 422 with
   * core's reason for a write `planBacklogMove` / `planBacklogPriority` refuses, else 200 with the new hash and the
   * event by `STUB_PERSON` at `STUB_NOW`. Never 423: the real write reads no lock. The planning tree is not re-ranked
   * here; the board's rank lens reads the stored text once it exists (spec 037).
   */
  const backlogRoute = async (req: Request, state: StubState, outcome: WriteOutcome, ws: string): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'POST') return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace('backlog') });
    const tree = readableTree(req, state, ws);
    if (tree instanceof Response) return tree;
    const body = await readJson(req);
    if (!isBacklogRequest(body)) return workspaceJson(req, 400, { error: 'invalid-body' });
    const own = backlogs.get(sessionOf(req)) ?? new Map<string, string | null>();
    const text = backlogTextOf(req, ws, tree.root);
    const now = rawSha256(text ?? '');
    const stale = outcome === 'stale' ? { error: 'hash-mismatch', files: ['specs/backlog.md'], expected: { backlog: now } } : board.backlogConflict(body.hash, now);
    if (stale !== null) return workspaceJson(req, 409, stale);
    const master = masterOf(tree.root);
    const base = { text, features: master === null ? [] : board.backlogFeatures(master), feature: body.feature, actor: STUB_PERSON, now: new Date(STUB_NOW) };
    const plan = body.op === 'move' ? board.planBacklogMove({ ...base, before: body.before }) : board.planBacklogPriority({ ...base, priority: body.priority });
    if (!plan.ok) return workspaceJson(req, 422, { error: 'backlog-refused', reason: plan.reason } satisfies BacklogRefused);
    own.set(ws, plan.text);
    backlogs.set(sessionOf(req), own);
    return workspaceJson(req, 200, { hash: rawSha256(plan.text), event: plan.event });
  };

  /**
   * `POST …/:ws/runs/:run/release` (`run-release-route.ts`, `writes.ts` `writeRunRelease`; spec 040, ISC-226) over the
   * workspace's activity log as the request's run variant and session read it (`activityTextOf`): 400 without a
   * well-formed `X-Spectant-Activity-Hash`, 404 for a run core's `activityReading` lists as no open run, 409
   * `StaleActivity` for any other hash (or `X-Spectant-Stub-Write: stale`), 422 `run-aborted` for a run core's
   * `runLockOf` reads `aborted` at `STUB_NOW` (beacon's `r-0308-1140`), else 200 with the `run-end` line by
   * `STUB_PERSON` at `STUB_NOW`, kept for the session: its next reads (under `runs`, beacon rebuilt by core with the
   * line) show the item no longer running. The stub always has a viewer, so it never answers `no-viewer`; never 423.
   */
  const runReleaseRoute = (req: Request, state: StubState, outcome: WriteOutcome, ws: string, run: string): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'POST') return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowForWorkspace('runRelease') });
    const tree = readableTree(req, state, ws);
    if (tree instanceof Response) return tree;
    const request = runReleaseRequestFromHeader(req.headers.get(ACTIVITY_HASH_HEADER));
    if (request === null) return workspaceJson(req, 400, { error: 'invalid-body' });
    const text = activityTextOf(req, ws, tree.root);
    const reading = edgeCore.activityReading(text) as { openRuns?: readonly StubOpenRun[] };
    const open = (reading.openRuns ?? []).find((r) => r.run === run);
    if (open === undefined) return workspaceJson(req, 404, { error: 'not-found' });
    const now = rawSha256(text);
    const stale = edgeCore.activityConflict(outcome === 'stale' ? '' : request.hash, now);
    if (stale !== null) return workspaceJson(req, 409, stale);
    const target = open.spec === undefined ? { idea: open.idea ?? '' } : { spec: open.spec };
    if (edgeCore.runLockOf([open], target, { now: new Date(STUB_NOW) }) === null) {
      return workspaceJson(req, 422, { error: 'release-refused', reason: 'run-aborted' });
    }
    const event = edgeCore.runReleaseEvent(new Date(STUB_NOW).toISOString(), open, STUB_PERSON);
    const own = releases.get(sessionOf(req)) ?? new Map<string, unknown[]>();
    own.set(ws, [...(own.get(ws) ?? []), event]);
    releases.set(sessionOf(req), own);
    return workspaceJson(req, 200, { hash: rawSha256(text + edgeCore.runReleaseAppendBytes(text, event)), event });
  };

  const settingsRoute = async (req: Request): Promise<Response> => {
    if (!guarded(req)) return settingsError(403, { error: 'forbidden' });
    if (req.method === 'GET' || req.method === 'HEAD') return settingsJson(req, settingsOf(req));
    if (req.method !== 'PUT') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD, PUT' });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return settingsError(400, { error: 'invalid-body' });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return settingsError(400, { error: 'invalid-body' });
    const next: Record<string, unknown> = { ...settingsOf(req) };
    // Validate the whole partial before writing any of it, as `openSettings().set` does.
    for (const [key, value] of Object.entries(body)) {
      if (!isKey(key)) return settingsError(400, { error: 'unknown-key', key });
      if (!SCHEMA[key].validate(value)) return settingsError(400, { error: 'invalid-value', key });
      next[key] = value;
    }
    const saved = next as Settings;
    sessions.set(sessionOf(req), saved);
    return settingsJson(req, saved);
  };

  // ---- the spec routes ----

  /** The spec page as this session sees it: the lock fixture's page with the session's reviewed mark. */
  const specPage = (req: Request, ws: string, tree: TreeGoldens, spec: SpecGoldens, locks: LockState): SpecPageModel => {
    const page = spec.locked[locks].spec;
    const reviewed = writesOf(req).reviewed.get(`${tree.golden}\0${spec.key}`);
    const gated = reviewed ? { ...page, gates: { ...page.gates, reviewed } } : page;
    // A stage move of this session (T119) shows in the head as the board shows it; nothing else of the page moves.
    const moved = boards.get(sessionOf(req))?.planning.get(ws);
    const holder = moved ? holderOf(moved, spec.folder) : null;
    if (!holder?.stage || holder.stage === gated.head.stage) return gated;
    return { ...gated, head: { ...gated.head, stage: holder.stage, stageSource: 'explicit' } };
  };

  /** The Tasks tab as this session sees it, and the raw tasks.md hash that goes with it. */
  const tasksTab = (req: Request, tree: TreeGoldens, spec: SpecGoldens): { tab: TasksTab | null; hash: string | null } => {
    if (spec.tasks === null) return { tab: null, hash: null };
    const marks = writesOf(req).marks.get(`${tree.golden}\0${spec.key}`);
    const label = `${tree.golden}:${spec.key}:tasks.md:raw`;
    if (!marks || marks.size === 0) return { tab: spec.tasks, hash: fakeHex(label) };
    const tasks = spec.tasks.tasks.map((row) => (marks.has(row.id) ? marked(row, marks.get(row.id) === true) : row));
    const ticks = [...marks].sort(([a], [b]) => byClaimId(a, b)).map(([id, on]) => `${id}=${on ? 1 : 0}`);
    return { tab: { ...spec.tasks, tasks, counts: recountTasks(tasks, spec.tasks.counts) }, hash: fakeHex(`${label}:${ticks.join(',')}`) };
  };

  const fallbackLock = (claim: string, session: string): ClaimLock => ({ source: 'frontier', claim, session, actor: parseActor(session), since: STUB_NOW });
  /** The lock a scripted 423 names: the fixture's lock on `claim`, any lock of the spec, else a frontier lock. */
  const lockFor = (spec: SpecGoldens, locks: LockState, claim: string | null): ClaimLock => {
    const current = spec.locked[locks].live.locks;
    const frontier = spec.locked.frontier.live.locks;
    const onClaim = claim === null ? undefined : (current.find((l) => l.claim === claim) ?? frontier.find((l) => l.claim === claim));
    const fallbackClaim = claim ?? spec.claims.claims[0]?.id ?? 'ISC-1';
    return (
      onClaim ??
      current[0] ??
      frontier[0] ?? fallbackLock(fallbackClaim, syntheticSession(spec.spec.head.id, fallbackClaim))
    );
  };

  const evidenceFile = async (req: Request, url: URL, tree: TreeGoldens, spec: SpecGoldens): Promise<Response> => {
    const resolved = await core.resolveEvidencePath(join(tree.root, spec.key), evidencePathQuery(url.search));
    if (!resolved.ok) {
      const refused = resolved.reason === 'outside' || resolved.reason === 'symlink-escape';
      return refused ? workspaceJson(req, 403, { error: 'forbidden' }) : workspaceJson(req, 404, { error: 'not-found' });
    }
    const bytes = new Uint8Array(readFileSync(resolved.absolute));
    const headers = { ...evidenceFileHeaders(core.mediaTypeOf(basename(resolved.path))), ETag: strongEtag(bytes) };
    if (matchesIfNoneMatch(req.headers.get('If-None-Match'), headers.ETag)) return new Response(null, { status: 304, headers });
    return new Response(req.method === 'HEAD' ? null : bytes, { headers });
  };

  const readRoute = async (
    req: Request,
    url: URL,
    match: SpecRouteMatch,
    tree: TreeGoldens,
    spec: SpecGoldens,
    locks: LockState,
  ): Promise<Response> => {
    switch (match.route) {
      case 'spec':
        return workspaceJson(req, 200, specPage(req, match.params.ws, tree, spec, locks), {
          [REVIEWED_HASHES_HEADER]: formatReviewedHashes(spec.hashes),
          [SPEC_HASH_HEADER]: specHashOf(req, match.params.ws, tree, spec),
        });
      case 'timeline':
        return workspaceJson(req, 200, spec.timeline);
      case 'claims':
        return workspaceJson(req, 200, spec.claims);
      case 'tasks': {
        const { tab, hash } = tasksTab(req, tree, spec);
        const body = tab === null ? null : { ...tab, steps: questionOf(req, tree, spec, liveOf(req, match.params.ws, spec, locks)).steps };
        return workspaceJson(req, 200, body, hash === null ? {} : { [TASKS_HASH_HEADER]: hash });
      }
      case 'evidenceFile':
        return evidenceFile(req, url, tree, spec);
      case 'frames':
        return workspaceJson(req, 200, spec.frames);
      case 'live': {
        const { live, steps } = questionOf(req, tree, spec, liveOf(req, match.params.ws, spec, locks));
        return workspaceJson(req, 200, { ...live, steps });
      }
      default:
        return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowFor(match.route) });
    }
  };

  const writeRoute = async (
    req: Request,
    match: SpecRouteMatch,
    tree: TreeGoldens,
    spec: SpecGoldens,
    locks: LockState,
    outcome: WriteOutcome,
  ): Promise<Response> => {
    const id = `${tree.golden}\0${spec.key}`;
    const lockSource = spec.locked[locks].live.lockSource;
    let row: TaskRow | undefined;
    if (match.route === 'taskCheck') {
      row = spec.tasks?.tasks.find((t) => t.id === match.params.tid && t.state !== 'struck');
      if (!row) return workspaceJson(req, 404, { error: 'not-found' });
    }
    let body: unknown;
    try {
      body = JSON.parse(await req.text()) as unknown;
    } catch {
      return workspaceJson(req, 400, { error: 'invalid-body' });
    }

    if (match.route === 'gateReviewed') {
      if (!isGateReviewedRequest(body)) return workspaceJson(req, 400, { error: 'invalid-body' });
      if (outcome === 'locked') return workspaceJson(req, 423, { error: 'locked', lock: lockFor(spec, locks, null) } satisfies Locked);
      const sent = REVIEWED_FILES.every((file) => body.hashes[file] === spec.hashes[file]);
      if (outcome === 'stale' || !sent) {
        return workspaceJson(req, 409, { error: 'hash-mismatch', expected: spec.hashes } satisfies Conflict<ReviewedHashes>);
      }
      const files = REVIEWED_FILES.filter((file) => spec.hashes[file] !== null).map((file) => REVIEWED_HASH_FILES[file]);
      writesOf(req).reviewed.set(id, { state: 'fresh', detail: `matches ${files.join(', ')}`, at: STUB_NOW, files });
      return workspaceJson(req, 200, { at: STUB_NOW, hashes: spec.hashes, lockSource } satisfies GateReviewedResponse);
    }

    if (!isTaskCheckRequest(body) || !row) return workspaceJson(req, 400, { error: 'invalid-body' });
    if (outcome === 'locked') return workspaceJson(req, 423, { error: 'locked', lock: lockFor(spec, locks, row.claim) } satisfies Locked);
    const current = tasksTab(req, tree, spec).hash ?? '';
    if (outcome === 'stale' || body.hash !== current) {
      return workspaceJson(req, 409, { error: 'hash-mismatch', expected: { tasks: current } } satisfies Conflict<{ tasks: string }>);
    }
    const all = writesOf(req).marks;
    const marks = all.get(id) ?? new Map<string, boolean>();
    if (body.checked === (row.state === 'done')) marks.delete(row.id);
    else marks.set(row.id, body.checked);
    all.set(id, marks);
    const hash = tasksTab(req, tree, spec).hash ?? '';
    // `TaskCheckWritten` (writes.contract.ts): the base answer plus the task's line as it now stands.
    const line = { number: row.line, text: writtenLine(tree, spec, row, body.checked) };
    return workspaceJson(req, 200, { task: row.id, checked: body.checked, hash, lockSource, line } satisfies TaskCheckResponse & {
      line: { number: number; text: string };
    });
  };

  /** The task's line of the fixture tree's tasks.md with its box set as written; built from the row if absent. */
  const writtenLine = (tree: TreeGoldens, spec: SpecGoldens, row: TaskRow, checked: boolean): string => {
    const box = checked ? '[x]' : '[ ]';
    let text: string | undefined;
    try {
      text = readFileSync(join(tree.root, spec.key, 'tasks.md'), 'utf8').split('\n')[row.line - 1];
    } catch {
      text = undefined;
    }
    return text !== undefined && /^\s*[-*]\s+\[[ xX]\]/.test(text) // single-core: allow — stub flips the fixture's box for the scripted 200, no parsing
      ? text.replace(/\[[ xX]\]/, box) // single-core: allow — stub flips the fixture's box for the scripted 200, no parsing
      : `- ${box} ${row.id} · ${row.claim} · ${row.lane} — ${row.text}`;
  };

  const specRoute = async (req: Request, url: URL, state: StubState, locks: LockState, outcome: WriteOutcome): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    const path = matchSpecPath(url.pathname);
    const match = matchSpecRoute(url.pathname, req.method);
    if (path === null) return Response.json({ error: 'not found' }, { status: 404 });
    if (match === null) return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: allowFor(path.route) });
    const found = (viewOf(req, state)).workspaces.get(match.params.ws);
    if (!found) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in found) return workspaceJson(req, 409, found.unreadable);
    const spec = resolveSpec(found.tree.specs, match.params.id);
    if (!spec) return workspaceJson(req, 404, { error: 'not-found' });
    if (match.route === 'transition') return transitionRoute(req, match.params.ws, found.tree, spec, locks, outcome);
    return match.route === 'gateReviewed' || match.route === 'taskCheck'
      ? writeRoute(req, match, found.tree, spec, locks, outcome)
      : readRoute(req, url, match, found.tree, spec, locks);
  };

  /**
   * `POST …/:id/transition` (`transition-route.ts`, `writes.ts` `writeTransition`), scripted by the request in the
   * real write's order: 400 for a body `isTransitionRequest` refuses; 409 `StaleSpec` for a hash that is not the one the
   * session's planning holder (and `X-Spectant-Spec-Hash`) carries, or under `X-Spectant-Stub-Write: stale`; 423 while
   * the lock fixture holds a lock on the spec (`blockingLock`; 002 under `activity`, every spec with an open claim under
   * `frontier`, none under `none`), or under `locked`; 422 `transition-refused` for a move the spec's workflow row does
   * not list (`refusalOf`), `command` the spec's next command; else 200: the holder moved in the session's tree
   * (`movedPlanning`, a new fake hash), the event by `VIEWER_ACTOR_FALLBACK` at `STUB_NOW`.
   */
  const transitionRoute = async (req: Request, ws: string, tree: TreeGoldens, spec: SpecGoldens, locks: LockState, outcome: WriteOutcome): Promise<Response> => {
    const body = await readJson(req);
    if (!isTransitionRequest(body)) return workspaceJson(req, 400, { error: 'invalid-body' });
    const hash = specHashOf(req, ws, tree, spec);
    const stale = outcome === 'stale' ? { error: 'hash-mismatch', files: ['spec.md'], expected: { spec: hash } } : board.specConflict(body.hash, hash);
    if (stale !== null) return workspaceJson(req, 409, stale);
    const live = spec.locked[locks].live;
    const locked = outcome === 'locked' ? ({ error: 'locked', lock: lockFor(spec, locks, null) } satisfies Locked) : board.blockingLock(live.locks, null);
    if (locked !== null) return workspaceJson(req, 423, locked);
    const model = planningOf(req, ws);
    const holder = model ? holderOf(model, spec.folder) : null;
    const { head } = spec.spec;
    const refuse = (reason: string): Response =>
      workspaceJson(req, 422, { error: 'transition-refused', reason, command: head.nextCommand } satisfies TransitionRefused);
    const from = holder?.stage ?? null;
    if (!model || from === null) return refuse(`${spec.folder} has no stage on the board`);
    const reason = refusalOf(board, rowFor(board, model.workflow, head.type), head.type, from, body.to);
    // No row lists a move into `idea` (only a story stands there), so the second test only narrows the type.
    if (reason !== null || body.to === 'idea') return refuse(reason ?? `the spec cannot move back to idea`);
    const command = commandFor(board, from, head.id) ?? commandFor(board, body.to, head.id);
    if (command === null) return refuse(`no stage table command makes the move ${from} → ${body.to}`);
    const own = boardOf(req);
    own.writes += 1;
    const next = fakeHex(`${tree.golden}:${spec.key}:spec.md:move-${String(own.writes)}:${body.to}`);
    own.planning.set(ws, movedPlanning(model, spec.folder, from, body.to, next));
    const event = { ts: new Date(STUB_NOW).toISOString(), from, to: body.to, command, actor: board.VIEWER_ACTOR_FALLBACK };
    return workspaceJson(req, 200, { from, to: body.to, hash: next, event, lockSource: live.lockSource } satisfies TransitionWritten);
  };

  // ---- the notes routes (server/src/notes.ts), per session ----

  const readJson = async (req: Request): Promise<unknown> => {
    try {
      return (await req.json()) as unknown;
    } catch {
      return undefined; // the contract's parsers answer `invalid-body` for it
    }
  };

  const notesRoute = async (req: Request, url: URL, state: StubState): Promise<Response> => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    const match = matchNoteRoute(url.pathname, req.method);
    if (match === null) return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: noteAllowFor(url.pathname) ?? '' });
    const { ws } = match.params;
    if (!(viewOf(req, state)).workspaces.has(ws)) return workspaceJson(req, 404, { error: 'not-found' });
    const book = notebookOf(req);
    const stamp = (): string => new Date(Date.parse(STUB_NOW) + ++book.writes * 60_000).toISOString();
    const reachable = (note: Note, id: string): boolean => note.id === id && (note.workspace === ws || note.workspace === null);
    switch (match.route) {
      case 'list': {
        const query = parseNotesQuery(url.searchParams);
        return query.ok ? workspaceJson(req, 200, listNotes(book.notes, ws, query.value)) : workspaceJson(req, 400, { error: query.error });
      }
      case 'counts': {
        const query = parseNoteCountsQuery(url.searchParams);
        const own = book.notes.filter((note) => note.workspace === ws);
        return query.ok ? workspaceJson(req, 200, countNotes(own, query.value.spec)) : workspaceJson(req, 400, { error: query.error });
      }
      case 'create': {
        const draft = parseNewNote(ws, await readJson(req));
        if (!draft.ok) return workspaceJson(req, 400, { error: draft.error });
        const at = stamp();
        const note = { id: `00000000-0000-4000-8000-${String(100 + book.writes).padStart(12, '0')}`, pinned: false, ...draft.value, created: at, updated: at } as Note;
        book.notes = [note, ...book.notes];
        return workspaceJson(req, 201, note);
      }
      case 'update': {
        const draft = parseNoteDraft(await readJson(req));
        if (!draft.ok) return workspaceJson(req, 400, { error: draft.error });
        const found = book.notes.find((note) => reachable(note, match.params.id));
        if (!found) return workspaceJson(req, 404, { error: 'not-found' });
        const note = { ...found, ...draft.value, updated: stamp() } as Note;
        book.notes = [note, ...book.notes.filter((other) => other !== found)];
        return workspaceJson(req, 200, note);
      }
      case 'remove': {
        const kept = book.notes.filter((note) => !reachable(note, match.params.id));
        if (kept.length === book.notes.length) return workspaceJson(req, 404, { error: 'not-found' });
        book.notes = kept;
        return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      }
    }
  };

  const lifeosRoute = (req: Request, locks: LockState): Response => {
    if (!guarded(req)) return workspaceJson(req, 403, { error: 'forbidden' });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return workspaceJson(req, 405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
    }
    return workspaceJson(req, 200, { present: locks === 'frontier' });
  };

  const handle = (req: Request, url: URL): Response | Promise<Response> => {
    const { pathname } = url;
    if (pathname === RESET_PATH) {
      if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
      sessions.delete(sessionOf(req));
      writes.delete(sessionOf(req));
      notebooks.delete(sessionOf(req));
      bumps.delete(sessionOf(req));
      runBumps.delete(sessionOf(req));
      boards.delete(sessionOf(req));
      actorLists.delete(sessionOf(req));
      boardQueries.delete(sessionOf(req));
      workflows.delete(sessionOf(req));
      backlogs.delete(sessionOf(req));
      releases.delete(sessionOf(req));
      for (const stream of [...streams]) if (stream.session === sessionOf(req)) stream.close();
      return new Response(null, { status: 204 });
    }
    if (pathname === BUMP_PATH) return bumpRoute(req, url);
    if (pathname === BUMP_RUN_PATH) return bumpRunRoute(req, url);
    if (pathname === WORKFLOW_PATH) return workflowRoute(req, url);
    if (pathname === SETTINGS_PATH) return settingsRoute(req);
    if (pathname === ACTORS_PATH) return actorsRoute(req);
    if (pathname.startsWith(PROTOTYPE_PREFIX)) return prototypeFileRoute(req, pathname);

    const locks = req.headers.get(LOCKS_HEADER) ?? 'activity';
    if (!isOneOf(LOCK_STATES, locks)) {
      return settingsError(400, { error: 'unknown-stub-locks', locks, states: [...LOCK_STATES] });
    }
    const worktrees = req.headers.get(WORKTREES_HEADER) ?? 'off';
    if (!isOneOf(WORKTREE_STATES, worktrees)) {
      return settingsError(400, { error: 'unknown-stub-worktrees', worktrees, states: [...WORKTREE_STATES] });
    }
    const edges = req.headers.get(EDGES_HEADER) ?? 'off';
    if (!isOneOf(EDGE_STATES, edges)) {
      return settingsError(400, { error: 'unknown-stub-edges', edges, states: [...EDGE_STATES] });
    }
    if (edges !== 'off' && worktrees === 'on') return settingsError(400, { error: 'stub-edges-with-worktrees', edges, worktrees });
    const midnight = req.headers.get(MIDNIGHT_HEADER) ?? 'off';
    if (!isOneOf(MIDNIGHT_STATES, midnight)) {
      return settingsError(400, { error: 'unknown-stub-midnight', midnight, states: [...MIDNIGHT_STATES] });
    }
    if (midnight === 'on' && (worktrees === 'on' || edges !== 'off')) {
      return settingsError(400, { error: 'stub-midnight-with-overlay', midnight, worktrees, edges });
    }
    const run = req.headers.get(RUN_HEADER);
    if (run !== null && !isOneOf(RUN_STATES, run)) return settingsError(400, { error: 'unknown-stub-run', run, states: [...RUN_STATES] });
    if (run !== null && locks !== 'runs') return settingsError(400, { error: 'stub-run-without-runs', run, locks });
    if (locks === 'runs' && (worktrees === 'on' || edges !== 'off' || midnight === 'on')) {
      return settingsError(400, { error: 'stub-runs-with-overlay', locks, worktrees, edges, midnight });
    }
    const waits = req.headers.get(WAITS_HEADER);
    if (waits !== null && !isOneOf(WAITS_STATES, waits)) return settingsError(400, { error: 'unknown-stub-waits', waits, states: [...WAITS_STATES] });
    if (waits !== null && (locks === 'runs' || worktrees === 'on' || edges !== 'off' || midnight === 'on')) {
      return settingsError(400, { error: 'stub-waits-with-overlay', waits, locks, worktrees, edges, midnight });
    }
    const dense = req.headers.get(DENSE_HEADER) ?? 'off';
    if (!isOneOf(DENSE_STATES, dense)) return settingsError(400, { error: 'unknown-stub-dense', dense, states: [...DENSE_STATES] });
    if (dense === 'on' && (waits !== null || locks === 'runs' || worktrees === 'on' || edges !== 'off' || midnight === 'on')) {
      return settingsError(400, { error: 'stub-dense-with-overlay', dense, waits, locks, worktrees, edges, midnight });
    }
    if (pathname === LIFEOS_PATH) return lifeosRoute(req, locks);
    // After the header checks: a stream's headers are the ones its synthetic reads go out with.
    if (pathname === EVENTS_PATH) return eventsRoute(req);

    if (noteAllowFor(pathname) !== null) {
      const state = req.headers.get(STATE_HEADER) ?? defaultState;
      if (!isOneOf(STUB_STATES, state)) return settingsError(400, { error: 'unknown-stub-state', state, states: [...STUB_STATES] });
      return notesRoute(req, url, state);
    }
    const dashboard = DASHBOARD_PATH.exec(pathname);
    const spec = pathname.startsWith(`${WORKSPACES_PATH}/`) && !dashboard;
    if (pathname !== WORKSPACES_PATH && !dashboard && !spec) return Response.json({ error: 'not found' }, { status: 404 });
    const requested = req.headers.get(STATE_HEADER) ?? defaultState;
    if (!isOneOf(STUB_STATES, requested)) {
      return settingsError(400, { error: 'unknown-stub-state', state: requested, states: [...STUB_STATES] });
    }
    if (!spec) return workspaceRoute(req, requested, dashboard?.[1]);
    // Every route of WORKSPACE_ROUTE_TABLE before the spec catch-all, which answers every other path under a workspace
    // with the server's JSON 404 (T119: the story page, the board query and the allocation joined the planning tree).
    const family = matchWorkspacePath(pathname);
    if (family?.route === 'planning') return workspaceFamilyRoute(req, requested, family);
    if (family?.route === 'libraryAsset') return libraryAssetRoute(req, url, requested, family);
    if (family?.route === 'library' || family?.route === 'libraryDoc' || family?.route === 'librarySearch') {
      const library = libraryStateOf(req);
      return library instanceof Response ? library : libraryRoute(req, url, requested, library, family);
    }
    if (family?.route === 'idea') return ideaRoute(req, requested, family);
    if (family?.route === 'boardQuery') return boardQueryRoute(req, requested, family.params.ws);
    const write = req.headers.get(WRITE_HEADER) ?? 'ok';
    if (!isOneOf(WRITE_OUTCOMES, write)) {
      return settingsError(400, { error: 'unknown-stub-write', write, outcomes: [...WRITE_OUTCOMES] });
    }
    if (family?.route === 'allocate') return allocateRoute(req, requested, locks, write, family);
    if (family?.route === 'backlog') return backlogRoute(req, requested, write, family.params.ws);
    if (family?.route === 'runRelease') return runReleaseRoute(req, requested, write, family.params.ws, family.params.run);
    return specRoute(req, url, requested, locks, write);
  };
  const answer: ApiHandler = (req, url) => {
    const edges = req.headers.get(EDGES_HEADER);
    const wanted = edges === 'waiting' || edges === 'met';
    return wanted && !edgeViews.has(edges) ? buildEdges().then(() => handle(req, url)) : handle(req, url);
  };
  return answer;
}

const REVIEWED_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

/** `filterOf` of server/src/notes.ts over a list already ordered newest first. */
export function listNotes(notes: readonly Note[], ws: string, query: NotesQuery): Note[] {
  if (query.orphans) return notes.filter((note) => note.workspace === null);
  const own = notes.filter((note) => note.workspace === ws);
  if (query.unanchored) return own.filter((note) => note.anchor === null);
  if (query.spec === undefined) return own;
  const inSpec = own.filter((note) => note.anchor?.spec === query.spec);
  if (query.claim !== undefined) return inSpec.filter((note) => note.anchor?.kind === 'claim' && note.anchor.id === query.claim);
  if (query.task !== undefined) return inSpec.filter((note) => note.anchor?.kind === 'task' && note.anchor.id === query.task);
  return inSpec;
}

/** `counts` of server/src/notes.ts over one workspace's notes. */
export function countNotes(notes: readonly Note[], spec: string): NoteCounts {
  const claims: Record<string, number> = {};
  const tasks: Record<string, number> = {};
  let total = 0;
  let onSpec = 0;
  for (const { anchor } of notes) {
    if (anchor?.spec !== spec) continue;
    total += 1;
    if (anchor.kind === 'spec') onSpec += 1;
    else {
      const table = anchor.kind === 'claim' ? claims : tasks;
      table[anchor.id] = (table[anchor.id] ?? 0) + 1;
    }
  }
  return { spec, total, onSpec, claims, tasks };
}
