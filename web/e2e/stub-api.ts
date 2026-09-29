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
 * - Every route of `SPEC_ROUTE_TABLE` (`…/specs/:id…`): the per-spec value of the route's golden family
 *   (`core/fixtures/<golden>.<family>.golden.json`, keyed by `specs/<folder>`), `:id` resolved as `core/src/resolve.ts`
 *   does (`NNN`, folder or bare slug, archived folders too). 404 `NotFound` for an unknown workspace, spec or task, 404
 *   `DocMissing` (availability from core's `docsFor`) for a doc the spec lacks, 409 for the unreadable workspace, 405
 *   with `allowFor(route)`. The evidence listing and files come from the fixture tree's real `artifacts/` and
 *   `.evidence/` through core's `listEvidence` and `resolveEvidencePath` (403 for what confinement refuses). The two
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
 *   `locked` always 423 `Locked`.
 * - `X-Spectant-Stub-Session: <id>` scopes the settings and the writes (absent: one shared session);
 *   `POST /api/__stub/reset` restores that session's settings and notes and drops its writes (204).
 *
 * Nothing here reads the clock or the registry: every answer is a function of the fixture files and the request. The
 * goldens are read once when the stub is built, so a missing fixture fails at startup, not on a request. Core's
 * `listEvidence`, `resolveEvidencePath`, `docsFor` and `worstState` are loaded at runtime by a computed path, because
 * the core modules they pull in do not type-check under this tsconfig; their shapes are declared below.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';

import type {
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
  LiveAgent,
  LiveCard,
  LiveFrame,
  LockSource,
  SpecPageModel,
  SpecType,
  TaskRow,
  TaskStatus,
  TasksTab,
  TimelineEntry,
} from '../../core/src/files';
import {
  REVIEWED_HASHES_HEADER,
  REVIEWED_HASH_FILES,
  TASKS_HASH_HEADER,
  allowFor,
  evidenceFileHeaders,
  evidencePathQuery,
  formatReviewedHashes,
  isGateReviewedRequest,
  isTaskCheckRequest,
  matchSpecPath,
  matchSpecRoute,
  type Conflict,
  type DocMissing,
  type GateReviewedResponse,
  type Locked,
  type ReviewedHashFile,
  type ReviewedHashes,
  type SpecRouteMatch,
  type TaskCheckResponse,
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

/** The e2e states the spec names (ISC-16.1): two workspaces, none, and one whose directory cannot be read. */
export const STUB_STATES = ['two-workspaces', 'empty', 'unreadable'] as const;
export type StubState = (typeof STUB_STATES)[number];

/** The lock fixtures (ISC-85, ISC-86): no source, the repository's activity log (the goldens), a LifeOS frontier. */
export const LOCK_STATES = ['none', 'activity', 'frontier'] as const;
export type LockState = (typeof LOCK_STATES)[number];

/** The scripted outcomes of the two writes (ISC-26, ISC-86). */
export const WRITE_OUTCOMES = ['ok', 'stale', 'locked'] as const;
export type WriteOutcome = (typeof WRITE_OUTCOMES)[number];

export const STATE_HEADER = 'X-Spectant-Stub-State';
export const SESSION_HEADER = 'X-Spectant-Stub-Session';
export const LOCKS_HEADER = 'X-Spectant-Stub-Locks';
export const WRITE_HEADER = 'X-Spectant-Stub-Write';
export const RESET_PATH = '/api/__stub/reset';

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

/** A JSON answer (`JSON_ANSWER`): strong ETag, 304 on a matching 200, no body on HEAD. */
function workspaceJson(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const headers = { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-cache', ETag: strongEtag(body), ...extra };
  if (status === 200 && matchesIfNoneMatch(req.headers.get('If-None-Match'), headers.ETag)) {
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
  resolveEvidencePath: (specDir: string, requested: string) => Promise<EvidencePathResult>;
  mediaTypeOf: (name: string) => string;
  docsFor: (type: SpecType | null) => Readonly<Record<DocName, DocAvailability>>;
  worstState: (states: Iterable<CardState>) => CardState;
};

/** Core's pure functions, loaded by a computed path so `tsc -p web/e2e` never walks core's module graph. */
function loadCore(): Core {
  const load = createRequire(import.meta.url);
  const src = join(import.meta.dir, '..', '..', 'core', 'src');
  const evidence = load(join(src, 'evidence.ts')) as Pick<Core, 'listEvidence' | 'resolveEvidencePath' | 'mediaTypeOf'>;
  const docs = load(join(src, 'markdown-docs.ts')) as Pick<Core, 'docsFor'>;
  const frames = load(join(src, 'frames.ts')) as Pick<Core, 'worstState'>;
  return { ...evidence, ...docs, ...frames };
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

/** A deterministic stand-in for a sha256 hex: the hash of a label, never of a file (the stub reads no spec file). */
const fakeHex = (label: string): string => new Bun.CryptoHasher('sha256').update(`stub-api:${label}`).digest('hex');

const byClaimId = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** A copy of `value` without `keys`, the other keys in their order. */
function without<T extends object>(value: T, keys: ReadonlyArray<keyof T>): T {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key as keyof T))) as T;
}

/** A lock-free copy of a live card: the running state goes back to waiting, the lock fields go. */
function released(card: LiveCard): LiveCard {
  const rest = without(card, ['lock', 'since', 'elapsedMs', 'stale']);
  return card.state === 'running' ? { ...rest, state: 'waiting' } : rest;
}

const LANDED_OR_GONE: ReadonlySet<CardState> = new Set<CardState>(['done', 'operatorDone', 'closed', 'absent', 'operatorOpen']);

/**
 * The lock fixtures of one spec, from its golden live frame (built under the activity reading) and spec page.
 * `none`: no source, every lock released. `frontier`: every golden lock relabelled `frontier`, plus a synthetic
 * session on the first open claim no lock holds (a waiting or dispatched card's claim first, else any open claim).
 */
function lockFixtures(core: Core, spec: SpecPageModel, live: LiveFrame, claims: ClaimViewModel): SpecGoldens['locked'] {
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
    const session = `spec-${spec.head.id}-${claim}`;
    const since = new Date(Date.parse(live.ts) - SYNTHETIC_LOCK_AGE_MS).toISOString().replace('.000Z', 'Z');
    const stale = SYNTHETIC_LOCK_AGE_MS > live.staleAfterMs;
    locks.push({ source: 'frontier', claim, session, since });
    locks.sort((a, b) => byClaimId(a.claim, b.claim));
    agents.push({ session, source: 'frontier', claims: [claim], since, elapsedMs: SYNTHETIC_LOCK_AGE_MS, stale });
    agents.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    cards = cards.map((c) => {
      if (c.claim !== claim || LANDED_OR_GONE.has(c.state) || c.lane === 'operator') return c;
      // In flight: the session is the reason, so a waiting or dispatch reason is dropped (as core's live.ts does).
      return { ...without(c, ['reason']), state: 'running', lock: { source: 'frontier', session }, since, elapsedMs: SYNTHETIC_LOCK_AGE_MS, stale };
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

  return {
    none: { spec: pageWith('none', [], []), live: none },
    activity: { spec, live },
    frontier: { spec: pageWith('frontier', agents, locks), live: frontierLive },
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
        locked: lockFixtures(core, spec, live, claims),
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

// ---- the stub ------------------------------------------------------------------------------------------------------

type SessionWrites = { reviewed: Map<string, GateView>; marks: Map<string, Map<string, boolean>> };

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
    return workspaceJson(req, 200, dashboards.get(slug)?.model);
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
  const specPage = (req: Request, tree: TreeGoldens, spec: SpecGoldens, locks: LockState): SpecPageModel => {
    const page = spec.locked[locks].spec;
    const reviewed = writesOf(req).reviewed.get(`${tree.golden}\0${spec.key}`);
    return reviewed ? { ...page, gates: { ...page.gates, reviewed } } : page;
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

  /** The lock a scripted 423 names: the fixture's lock on `claim`, any lock of the spec, else a frontier lock. */
  const lockFor = (spec: SpecGoldens, locks: LockState, claim: string | null): ClaimLock => {
    const current = spec.locked[locks].live.locks;
    const frontier = spec.locked.frontier.live.locks;
    const onClaim = claim === null ? undefined : (current.find((l) => l.claim === claim) ?? frontier.find((l) => l.claim === claim));
    const fallbackClaim = claim ?? spec.claims.claims[0]?.id ?? 'ISC-1';
    return (
      onClaim ??
      current[0] ??
      frontier[0] ?? { source: 'frontier', claim: fallbackClaim, session: `spec-${spec.spec.head.id}-${fallbackClaim}`, since: STUB_NOW }
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
        return workspaceJson(req, 200, specPage(req, tree, spec, locks), { [REVIEWED_HASHES_HEADER]: formatReviewedHashes(spec.hashes) });
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
    return match.route === 'gateReviewed' || match.route === 'taskCheck'
      ? writeRoute(req, match, found.tree, spec, locks, outcome)
      : readRoute(req, url, match, found.tree, spec, locks);
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
      return new Response(null, { status: 204 });
    }
    if (pathname === SETTINGS_PATH) return settingsRoute(req);

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
    const write = req.headers.get(WRITE_HEADER) ?? 'ok';
    if (!isOneOf(WRITE_OUTCOMES, write)) {
      return settingsError(400, { error: 'unknown-stub-write', write, outcomes: [...WRITE_OUTCOMES] });
    }
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
