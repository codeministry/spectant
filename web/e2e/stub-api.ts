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
 *   unreadable workspace; the lock and write headers change nothing here. The tech page (spec 023, T10, ISC-134.1):
 *   `GET|HEAD …/:ws/tech` is the whole `core/fixtures/<golden>.tech.golden.json` (`WORKSPACE_GOLDEN_FAMILY.tech`) under
 *   the same guards, and `GET|HEAD …/:ws/tech/asset?path=` the fixture tree's file under `specs/` with the evidence
 *   file's headers (`evidenceFileHeaders(mediaTypeOf(name))`, strong ETag over the bytes, 304, HEAD without a body):
 *   403 for a path that leaves `specs/` (a `..` segment, an absolute path, a backslash, a control character, a
 *   second encoding layer, a symlink out), 404 for no regular file.
 * - The library (spec 017, T3, ISC-156), under the same guards: `GET|HEAD …/:ws/library` the workspace's
 *   `LibraryCatalog`, core's `readCatalog` over the fixture tree made deterministic (`buildCatalog`: fixed times,
 *   group heads and fog lines from the spec and tech goldens) plus `STUB_LIBRARY` on harbor (a `stale` plan, a
 *   `missing` tasks.md, 57 evidence documents in 002, a prototype with two pages and a preview, the reader's prose
 *   cases appended to 002's T18 artifact); `…/library/doc?path=`
 *   one Markdown document of that catalog as core's `renderDocsMarkdown` page, 404 for any path it does not list as
 *   one; `…/library/search?q=` the `LibrarySearchResult` over those documents, `{query: '', hits: []}` for a blank `q`;
 *   `…/library/asset?path=` the tech asset's answer. `GET|HEAD /proto/:ws/:spec/:folder/*` (outside `/api`;
 *   `serve-dist.ts` forwards it here) one file of a catalog prototype through core's resolver, every answer with
 *   `PROTOTYPE_CSP`; on harbor's stub prototype also the stub-only page `STUB_LIBRARY.prototype.offline` (T40).
 * - Every route of `SPEC_ROUTE_TABLE` (`…/specs/:id…`): the per-spec value of the route's golden family
 *   (`core/fixtures/<golden>.<family>.golden.json`, keyed by `specs/<folder>`), `:id` resolved as `core/src/resolve.ts`
 *   does (`NNN`, folder or bare slug, archived folders too). 404 `NotFound` for an unknown workspace, spec or task, 404
 *   `DocMissing` (availability from core's `docsFor`) for a doc the spec lacks, 409 for the unreadable workspace, 405
 *   with `allowFor(route)`. The evidence listing and files come from the fixture tree's real `artifacts/` and
 *   `.evidence/` (files also from `.design/`, the Design tab's images) through core's `listEvidence` and
 *   `resolveEvidencePath` (403 for what confinement refuses). The two
 *   hash headers carry deterministic fake sha256 hex values the client sends back with a write.
 * - Every JSON answer carries `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-cache` and the strong
 *   ETag `"<sha256 base64url of the body>"` (`JSON_ANSWER`); a matching `If-None-Match` on a 200 is a 304. 405
 *   `{error: "method-not-allowed"}` with `Allow`, 403 `{error: "forbidden"}` for a foreign `Host` or a cross-site
 *   `Origin`.
 * - `GET|HEAD /api/lifeos` → `{present}`, true only under the `frontier` lock fixture.
 * - `GET|HEAD|PUT /api/settings` → `{theme, language, refreshSeconds, singleKeyShortcuts, railCollapsed, notesImportDismissed}`, held in memory from the
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
 * - Any other `/api` path is the server's JSON 404, `{error: "not found"}`.
 *
 * Test controls, which the real server does not have (web/e2e/README.md § The stub API), each chosen per request so
 * parallel workers never race; an unknown value is a loud 400, never a silent default:
 *
 * - `X-Spectant-Stub-State: two-workspaces | empty | unreadable` picks the workspace state (absent: `two-workspaces`).
 * - `X-Spectant-Stub-Locks: none | activity | frontier` picks the lock fixture (absent: `activity`, what the goldens
 *   hold). `none` releases every lock; `frontier` relabels the golden's locks `frontier`, adds a second frontier
 *   session on another open claim and makes LifeOS present.
 * - `X-Spectant-Stub-Write: ok | stale | locked` scripts the two writes (absent: `ok`). `ok` answers as the server
 *   does: 200 when the hashes sent equal the ones the stub last sent, else 409; `stale` is always 409 `Conflict`,
 *   `locked` always 423 `Locked`. The board writes (transition, allocate) honour it the same way.
 * - `X-Spectant-Stub-Library: catalog | empty` picks the library (absent: `catalog`): `empty` answers every readable
 *   workspace with `EMPTY_CATALOG`, a workspace without one document (the `empty` state lists no workspace at all).
 * - `X-Spectant-Stub-Session: <id>` scopes the settings and the writes (absent: one shared session);
 *   `POST /api/__stub/reset` restores that session's settings and notes and drops its writes and bumps (204).
 * - `POST /api/__stub/bump?ws=<slug>` changes that workspace's dashboard for that session between two polls (T68,
 *   ISC-62): each call raises `kpis.claims.closed` by one, so the body and its ETag change as a file on disk would.
 *   204; 404 for a workspace the stub does not hold; 405 with `Allow: POST` for another method.
 * - `PUT /api/__stub/workflow?ws=<slug>` with a `specs/workflow.md` text as the body stands in for an edit of that
 *   workspace's workflow file (T151, ISC-123): core's `parseWorkflow` reads the text, and that session's planning tree
 *   carries the result as its `workflow` until a reset, so the next read shows the changed table (body and ETag). 204;
 *   404 for a workspace the stub does not hold; 405 with `Allow: PUT` for another method.
 *
 * Nothing here reads the clock or the registry: every answer is a function of the fixture files and the request. The
 * goldens are read once when the stub is built, so a missing fixture fails at startup, not on a request. Core's
 * `listEvidence`, `resolveEvidencePath`, `docsFor` and `worstState` are loaded at runtime by a computed path, because
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
  DocAvailability,
  DocName,
  DocsPage,
  EvidenceListing,
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
  SpecGroupHead,
  SpecPageModel,
  SpecType,
  TaskRow,
  TaskStatus,
  TasksTab,
  TechModel,
  TimelineEntry,
  Workflow,
} from '../../core/src/files';
import { parseActor } from '../../core/src/actor';
import type { PlanningHolder, PlanningModel } from '../../core/src/planning';
import {
  ACTORS_ALLOW,
  ACTORS_PATH,
  SPEC_HASH_HEADER,
  isActorMappings,
  isAllocateRequest,
  isBoardQuery,
  isTransitionRequest,
  type ActorMapping,
  type AllocateRefused,
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
  type DocMissing,
  type GateReviewedResponse,
  type Locked,
  type ReviewedHashFile,
  type ReviewedHashes,
  type SpecRouteMatch,
  type TaskCheckResponse,
  type WorkspaceRouteMatch,
  type WorkspaceRouteName,
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
  type StoryFile,
  allocatedPlanning,
  commandFor,
  holderOf,
  loadBoardCore,
  movedPlanning,
  readStories,
  refusalOf,
  rowFor,
} from './stub-board';

/** The e2e states the spec names (ISC-16.1): two workspaces, none, and one whose directory cannot be read. */
export const STUB_STATES = ['two-workspaces', 'empty', 'unreadable'] as const;
export type StubState = (typeof STUB_STATES)[number];

/**
 * The lock fixtures (ISC-85, ISC-86): no source, the repository's activity log (the goldens), a LifeOS frontier; for
 * who works a task (T149, ISC-131.1) the log's claim lines without their releases, and the golden's locks held by a
 * person.
 */
export const LOCK_STATES = ['none', 'activity', 'frontier', 'claims', 'person'] as const;
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

/**
 * The library fixtures (spec 017, ISC-156): the workspace's catalog, or none at all. The `empty` workspace state lists
 * no workspace, so every library route there is a 404 as on the server; a readable workspace without one document is
 * this header's `empty` (the page's empty state, `/spec-bootstrap`).
 */
export const LIBRARY_STATES = ['catalog', 'empty'] as const;
export type StubLibraryState = (typeof LIBRARY_STATES)[number];
export const LIBRARY_HEADER = 'X-Spectant-Stub-Library';

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
 * The workspace routes with a whole-file golden family: the contract's `GOLDEN_FAMILY.planning` and the tech page's
 * `tech` (spec 023, `core/tests/golden.test.ts` `FAMILIES.tech`), which the contract's map does not name yet.
 */
export const WORKSPACE_GOLDEN_FAMILY = {
  planning: GOLDEN_FAMILY.planning,
  tech: 'tech',
} as const satisfies Partial<Record<WorkspaceRouteName, string>>;

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

type Settings = { theme: string; language: string; refreshSeconds: number; singleKeyShortcuts: boolean; railCollapsed: boolean; notesImportDismissed: boolean };
type SettingKey = keyof Settings;

const SCHEMA: { readonly [K in SettingKey]: { default: Settings[K]; validate: (value: unknown) => boolean } } = {
  theme: { default: 'system', validate: (v) => v === 'system' || v === 'light' || v === 'dark' },
  language: { default: 'en', validate: (v) => v === 'en' || v === 'de' },
  refreshSeconds: { default: 30, validate: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 3600 },
  singleKeyShortcuts: { default: true, validate: (v) => typeof v === 'boolean' },
  railCollapsed: { default: false, validate: (v) => typeof v === 'boolean' },
  notesImportDismissed: { default: false, validate: (v) => typeof v === 'boolean' },
};

const defaults = (): Settings => ({
  theme: SCHEMA.theme.default,
  language: SCHEMA.language.default,
  refreshSeconds: SCHEMA.refreshSeconds.default,
  singleKeyShortcuts: SCHEMA.singleKeyShortcuts.default,
  railCollapsed: SCHEMA.railCollapsed.default,
  notesImportDismissed: SCHEMA.notesImportDismissed.default,
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
  listEvidence: (specDir: string) => Promise<EvidenceListing>;
  resolveEvidencePath: (specDir: string, requested: string, reach?: 'evidence' | 'tree') => Promise<EvidencePathResult>;
  mediaTypeOf: (name: string) => string;
  prototypeMediaTypeOf: (name: string) => string;
  docsFor: (type: SpecType | null) => Readonly<Record<DocName, DocAvailability>>;
  worstState: (states: Iterable<CardState>) => CardState;
  parseWorkflow: (text: string | null) => Workflow;
  boardStages: (workflow: Workflow) => PlanningModel['stages'];
  readCatalog: (root: string) => Promise<LibraryCatalog>;
  renderDocsMarkdown: (markdown: string, options?: unknown) => DocsPage;
  docsRenderOptions: (root: string, docPath: string, name: DocName) => unknown;
  levelTwoSection: (text: string, headings: readonly string[]) => string | null;
  firstParagraph: (section: string) => string | null;
  GOAL_HEADINGS: readonly string[];
};

/** Core's pure functions, loaded by a computed path so `tsc -p web/e2e` never walks core's module graph. */
function loadCore(): Core {
  const load = createRequire(import.meta.url);
  const src = join(import.meta.dir, '..', '..', 'core', 'src');
  const evidence = load(join(src, 'evidence.ts')) as Pick<Core, 'listEvidence' | 'resolveEvidencePath' | 'mediaTypeOf' | 'prototypeMediaTypeOf' | 'docsRenderOptions'>;
  const docs = load(join(src, 'markdown-docs.ts')) as Pick<Core, 'docsFor' | 'renderDocsMarkdown'>;
  const frames = load(join(src, 'frames.ts')) as Pick<Core, 'worstState'>;
  const workflow = load(join(src, 'workflow.ts')) as Pick<Core, 'parseWorkflow' | 'boardStages'>;
  const library = load(join(src, 'library.ts')) as Pick<Core, 'readCatalog'>;
  const archive = load(join(src, 'archive.ts')) as Pick<Core, 'levelTwoSection' | 'firstParagraph' | 'GOAL_HEADINGS'>;
  return {
    listEvidence: evidence.listEvidence,
    resolveEvidencePath: evidence.resolveEvidencePath,
    mediaTypeOf: evidence.mediaTypeOf,
    prototypeMediaTypeOf: evidence.prototypeMediaTypeOf,
    docsRenderOptions: evidence.docsRenderOptions,
    docsFor: docs.docsFor,
    renderDocsMarkdown: docs.renderDocsMarkdown,
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

/** The tech route's body: the whole `<golden>.tech.golden.json` (`readTech`'s `TechModel`), read as it is. */
function readTechGolden(dir: string, name: string): unknown {
  const file = `${name}.${WORKSPACE_GOLDEN_FAMILY.tech}.golden.json`;
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
        docs: specDocs,
        frames: pick(families.frames, key, 'frames'),
        locked: lockFixtures(core, spec, live, claims, activityClaims),
        hashes,
      };
    }),
  };
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
    boxes: { landed: boxes.filter((t) => t.state === 'done').length, total: boxes.length },
    byLane: counts.byLane,
    byStatus: STATUS_ORDER.map((name) => ({ name, count: tasks.filter((t) => t.status === name).length })).filter((c) => c.count > 0),
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

/** The `Origin` a sandboxed prototype page sends (opaque); `prototypeFileRoute` answers it for a font alone. */
const OPAQUE_ORIGIN = 'null';

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

/** The Docs tab a catalog document renders as: the constitution's and the Design tab's own options, else a plain page. */
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
  const techs = new Map(workspaces.map((w) => [w.slug, readTechGolden(dir, w.golden)]));
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
  const board = loadBoardCore();
  const stories = new Map(
    workspaces.map((w): [string, ReadonlyMap<string, StoryFile>] => [w.slug, readStories(board, join(dir, w.golden), readPlanning(dir, w.golden))]),
  );

  const view = (state: StubState): StateView => {
    const listed = state === 'empty' ? [] : workspaces;
    const list: Summary[] = [];
    const byslug: StateView['workspaces'] = new Map();
    for (const w of listed) {
      const base = { slug: w.slug, name: w.name, pathTail: w.pathTail ?? w.golden };
      const dashboard = dashboards.get(w.slug);
      const tree = trees.get(w.slug);
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

  const sessions = new Map<string, Settings>();
  const writes = new Map<string, SessionWrites>();
  /** Bumps per session, then per workspace slug. */
  const bumps = new Map<string, Map<string, number>>();
  const bumpsOf = (req: Request, slug: string): number => bumps.get(sessionOf(req))?.get(slug) ?? 0;
  const bumpRoute = (req: Request, url: URL): Response => {
    if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
    const slug = url.searchParams.get('ws');
    if (slug === null || !dashboards.has(slug)) return settingsError(404, { error: 'not-found' });
    const id = sessionOf(req);
    const own = bumps.get(id) ?? new Map<string, number>();
    own.set(slug, (own.get(slug) ?? 0) + 1);
    bumps.set(id, own);
    return new Response(null, { status: 204 });
  };
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
    const model = boards.get(sessionOf(req))?.planning.get(slug) ?? plannings.get(slug);
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

  const evidence = new Map<string, Promise<EvidenceListing>>();
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
    const current = views.get(state) ?? view(state);
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
    return workspaceJson(req, 200, bumpDashboard(dashboards.get(slug)?.model, bumpsOf(req, slug)));
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
    const found = (views.get(state) ?? view(state)).workspaces.get(match.params.ws);
    if (!found) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in found) return workspaceJson(req, 409, found.unreadable);
    return workspaceJson(req, 200, match.route === 'tech' ? techs.get(match.params.ws) : planningOf(req, match.params.ws));
  };

  /**
   * `GET|HEAD …/:ws/tech/asset?path=` (spec 023, T10): the guards of the family route above, then the fixture tree's
   * file under `specs/` through core's `resolveEvidencePath` with `reach: 'tree'`, images only, answered as the evidence file is: `evidenceFileHeaders` of core's
   * `mediaTypeOf`, a strong ETag over the bytes, 304 on a match, no body on HEAD.
   */
  const techAssetRoute = async (req: Request, url: URL, state: StubState, match: WorkspaceRouteMatch): Promise<Response> => {
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
  const libraryPage = (stub: StubCatalog, tree: TreeGoldens, raw: string): DocsPage | null => {
    let path: string;
    try {
      path = decodeURIComponent(raw);
    } catch {
      return null;
    }
    const doc = stub.catalog.docs.find((d) => d.path === path && isReadable(d));
    return doc === undefined ? null : renderDoc(stub, tree, doc);
  };
  const isReadable = (doc: LibraryDoc): boolean => doc.media === 'markdown' && doc.state !== 'missing';
  const renderDoc = (stub: StubCatalog, tree: TreeGoldens, doc: LibraryDoc): DocsPage => {
    const cached = stub.pages.get(doc.path);
    if (cached) return cached;
    const absolute = join(tree.root, 'specs', ...doc.path.split('/'));
    const text = stub.texts.get(doc.path) ?? readFileSync(absolute, 'utf8');
    const page = core.renderDocsMarkdown(text, core.docsRenderOptions(tree.root, absolute, docNameOf(doc.type)));
    stub.pages.set(doc.path, page);
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
    const stub = library === 'empty' ? emptyStubCatalog() : await catalogOf(match.params.ws, tree);
    switch (match.route) {
      case 'library':
        return workspaceJson(req, 200, stub.catalog);
      case 'libraryDoc': {
        const page = libraryPage(stub, tree, evidencePathQuery(url.search));
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
   * `server/src/prototype.ts`: `Origin: null` (the sandboxed page) gets a font (`font/*`) with
   * `Access-Control-Allow-Origin: *`, every other answer to it is 403 without that header; a font carries `Vary: Origin`.
   */
  const prototypeFileRoute = async (req: Request, pathname: string): Promise<Response> => {
    const opaque = req.headers.get('Origin') === OPAQUE_ORIGIN;
    if (!opaque) return prototypeFileAnswer(req, pathname, false);
    if (!isLoopbackHost(req.headers.get('Host'))) return prototypeForbidden(req);
    const res = await prototypeFileAnswer(req, pathname, true);
    return res.status === 200 || res.status === 304 ? res : prototypeForbidden(req);
  };

  const withCsp = (res: Response): Response => {
    res.headers.set('Content-Security-Policy', PROTOTYPE_CSP);
    res.headers.set('X-Content-Type-Options', 'nosniff');
    return res;
  };

  const prototypeForbidden = (req: Request): Response => withCsp(workspaceJson(req, 403, { error: 'forbidden' }));

  /** The prototype answer; `opaque` (a request from `Origin: null`) is answered for a font file alone. */
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
    const stub = library === 'empty' ? emptyStubCatalog() : await catalogOf(match.params.ws, tree);
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
    const font = type.startsWith('font/');
    if (opaque && !font) return prototypeForbidden(req);
    const bytes = read();
    const etag = strongEtag(bytes);
    const headers: Record<string, string> = {
      ...evidenceFileHeaders(type),
      'Content-Disposition': 'inline',
      'Content-Security-Policy': PROTOTYPE_CSP,
      ETag: etag,
      ...(font ? { Vary: 'Origin' } : {}),
      ...(opaque ? { 'Access-Control-Allow-Origin': '*' } : {}),
    };
    if (matchesIfNoneMatch(req.headers.get('If-None-Match'), etag)) return new Response(null, { status: 304, headers });
    return new Response(req.method === 'HEAD' ? null : bytes, { headers });
  };

  /** The guard order every workspace route shares (`api.ts`): 404 unknown slug, 409 the unreadable summary, else the tree. */
  const readableTree = (req: Request, state: StubState, ws: string): TreeGoldens | Response => {
    const found = (views.get(state) ?? view(state)).workspaces.get(ws);
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
    if (!(views.get(state) ?? view(state)).workspaces.has(ws)) return workspaceJson(req, 404, { error: 'not-found' });
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

  const readEvidence = (tree: TreeGoldens, spec: SpecGoldens): Promise<EvidenceListing> => {
    const id = `${tree.golden}\0${spec.key}`;
    let listing = evidence.get(id);
    if (!listing) {
      listing = core.listEvidence(join(tree.root, spec.key));
      evidence.set(id, listing);
    }
    return listing;
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
        return workspaceJson(req, 200, tab, hash === null ? {} : { [TASKS_HASH_HEADER]: hash });
      }
      case 'evidence':
        return workspaceJson(req, 200, await readEvidence(tree, spec));
      case 'evidenceFile':
        return evidenceFile(req, url, tree, spec);
      case 'docs': {
        const name = match.params.name;
        const page = name === 'constitution' ? tree.constitution : spec.docs[name];
        if (page !== null) return workspaceJson(req, 200, page);
        const missing: DocMissing = { error: 'not-found', doc: name, availability: core.docsFor(spec.spec.head.type)[name] };
        return workspaceJson(req, 404, missing);
      }
      case 'frames':
        return workspaceJson(req, 200, spec.frames);
      case 'live':
        return workspaceJson(req, 200, spec.locked[locks].live);
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
    const found = (views.get(state) ?? view(state)).workspaces.get(match.params.ws);
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
    if (!(views.get(state) ?? view(state)).workspaces.has(ws)) return workspaceJson(req, 404, { error: 'not-found' });
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

  return (req, url) => {
    const { pathname } = url;
    if (pathname === RESET_PATH) {
      if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
      sessions.delete(sessionOf(req));
      writes.delete(sessionOf(req));
      notebooks.delete(sessionOf(req));
      bumps.delete(sessionOf(req));
      boards.delete(sessionOf(req));
      actorLists.delete(sessionOf(req));
      boardQueries.delete(sessionOf(req));
      workflows.delete(sessionOf(req));
      return new Response(null, { status: 204 });
    }
    if (pathname === BUMP_PATH) return bumpRoute(req, url);
    if (pathname === WORKFLOW_PATH) return workflowRoute(req, url);
    if (pathname === SETTINGS_PATH) return settingsRoute(req);
    if (pathname === ACTORS_PATH) return actorsRoute(req);
    if (pathname.startsWith(PROTOTYPE_PREFIX)) return prototypeFileRoute(req, pathname);

    const locks = req.headers.get(LOCKS_HEADER) ?? 'activity';
    if (!isOneOf(LOCK_STATES, locks)) {
      return settingsError(400, { error: 'unknown-stub-locks', locks, states: [...LOCK_STATES] });
    }
    if (pathname === LIFEOS_PATH) return lifeosRoute(req, locks);

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
    if (family?.route === 'planning' || family?.route === 'tech') return workspaceFamilyRoute(req, requested, family);
    if (family?.route === 'techAsset' || family?.route === 'libraryAsset') return techAssetRoute(req, url, requested, family);
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
    return specRoute(req, url, requested, locks, write);
  };
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
