/**
 * The stub `/api` the e2e and visual suites run against (T57, ISC-17; plan 001 § Approach "Server and UI split").
 * `serve-dist.ts` plugs it into its `api` seam, so `bun run e2e` / `test:visual` need neither the binary nor a
 * registry: every dashboard body is a golden snapshot, `core/fixtures/<golden>.golden.json`, the `DashboardModel` the
 * real server returns for that fixture tree.
 *
 * The contract is the real server's, answer for answer (`server/src/api.ts`, `server/src/settings.ts`; the parity half
 * of `stub-api.test.ts` sends the same requests to both and compares status, headers and bytes):
 *
 * - `GET|HEAD /api/workspaces` → `[{slug, name, pathTail, readable, error?, counts}]` in list order, `counts` = the
 *   golden's `kpis`, `null` when unreadable.
 * - `GET|HEAD /api/workspaces/:slug/dashboard` → the golden model, serialized as the server does (`JSON.stringify`);
 *   404 `{error: "not-found"}` for an unknown slug; 409 with the list entry for the unreadable workspace.
 * - Both carry `Content-Type: application/json; charset=utf-8`, `Cache-Control: no-cache` and the strong ETag
 *   `"<sha256 base64url of the body>"`; a matching `If-None-Match` on a 200 is a 304. 405 `{error:
 *   "method-not-allowed"}` with `Allow: GET, HEAD` for other methods, 403 `{error: "forbidden"}` for a foreign `Host`
 *   or a cross-site `Origin`.
 * - `GET|HEAD|PUT /api/settings` → `{theme, language, refreshSeconds, singleKeyShortcuts}`, held in memory from the
 *   `SettingsSchema` defaults, validated as the server does (400 `{error, key}` / `{error: "invalid-body"}`), weak
 *   ETag `W/"<Bun.hash base36>"`, 405 with `Allow: GET, HEAD, PUT`.
 * - Any other `/api` path is the server's JSON 404, `{error: "not found"}`.
 *
 * Test controls, which the real server does not have (web/e2e/README.md § The stub API):
 *
 * - `X-Spectant-Stub-State: two-workspaces | empty | unreadable` picks the state per request (absent: the default
 *   state, `two-workspaces`); an unknown value is a 400. A spec sets it with `test.use({ extraHTTPHeaders })`.
 * - `X-Spectant-Stub-Session: <id>` scopes the settings store (absent: one shared session), so parallel workers that
 *   PUT a theme never see each other's; `POST /api/__stub/reset` restores that session's defaults (204).
 *
 * Nothing here reads the clock or the registry, and nothing is imported from `core/` or `server/` at runtime: the
 * goldens are read once when the stub is built, so a missing fixture fails at startup, not on a request.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ApiHandler } from './serve-dist';

/** The e2e states the spec names (ISC-16.1): two workspaces, none, and one whose directory cannot be read. */
export const STUB_STATES = ['two-workspaces', 'empty', 'unreadable'] as const;
export type StubState = (typeof STUB_STATES)[number];

export const STATE_HEADER = 'X-Spectant-Stub-State';
export const SESSION_HEADER = 'X-Spectant-Stub-Session';
export const RESET_PATH = '/api/__stub/reset';

export type StubWorkspace = {
  slug: string;
  /** The real registry names a workspace after its directory, so the defaults use the fixture name. */
  name: string;
  /** Fixture name: the body is `core/fixtures/<golden>.golden.json`. */
  golden: string;
  /** Default: `golden`, the last path segment of the fixture tree. */
  pathTail?: string;
};

export type StubApiOptions = {
  /** The registered workspaces, in list order. Default: harbor, lantern (ISC-16's two workspaces). */
  workspaces?: readonly StubWorkspace[];
  /** The workspace the `unreadable` state marks `missing`. Default: the last one. */
  unreadableSlug?: string;
  /** Where the golden snapshots live. Default: `core/fixtures`. */
  fixturesDir?: string;
  /** The state of a request without the state header. Default: `two-workspaces`. */
  defaultState?: StubState;
};

export const DEFAULT_WORKSPACES: readonly StubWorkspace[] = [
  { slug: 'harbor', name: 'harbor', golden: 'harbor' },
  { slug: 'lantern', name: 'lantern', golden: 'lantern' },
];

const FIXTURES = join(import.meta.dir, '..', '..', 'core', 'fixtures');
const WORKSPACES_PATH = '/api/workspaces';
const SETTINGS_PATH = '/api/settings';
const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;
const JSON_TYPE = 'application/json; charset=utf-8';

type Summary = {
  slug: string;
  name: string;
  pathTail: string;
  readable: boolean;
  error?: 'missing';
  counts: unknown;
};

/** What one state answers: the list and, per slug, a dashboard body or the 409 summary. */
type StateView = { list: Summary[]; dashboards: Map<string, { model: unknown } | { unreadable: Summary }> };

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

/** A workspace-route answer: strong ETag, 304 on a matching 200, no body on HEAD. */
function workspaceJson(req: Request, status: number, value: unknown, extra: Record<string, string> = {}): Response {
  const body = JSON.stringify(value);
  const etag = `"${new Bun.CryptoHasher('sha256').update(body).digest('base64url')}"`;
  const headers = { 'Content-Type': JSON_TYPE, 'Cache-Control': 'no-cache', ETag: etag, ...extra };
  if (status === 200 && matchesIfNoneMatch(req.headers.get('If-None-Match'), etag)) {
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

type Settings = { theme: string; language: string; refreshSeconds: number; singleKeyShortcuts: boolean };
type SettingKey = keyof Settings;

const SCHEMA: { readonly [K in SettingKey]: { default: Settings[K]; validate: (value: unknown) => boolean } } = {
  theme: { default: 'system', validate: (v) => v === 'system' || v === 'light' || v === 'dark' },
  language: { default: 'en', validate: (v) => v === 'en' || v === 'de' },
  refreshSeconds: { default: 30, validate: (v) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 3600 },
  singleKeyShortcuts: { default: true, validate: (v) => typeof v === 'boolean' },
};

const defaults = (): Settings => ({
  theme: SCHEMA.theme.default,
  language: SCHEMA.language.default,
  refreshSeconds: SCHEMA.refreshSeconds.default,
  singleKeyShortcuts: SCHEMA.singleKeyShortcuts.default,
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

// ---- the stub ------------------------------------------------------------------------------------------------------

function readGolden(dir: string, name: string): { model: unknown; kpis: unknown } {
  const path = join(dir, `${name}.golden.json`);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`stub-api: no golden snapshot ${name}.golden.json in core/fixtures`);
  }
  const model = JSON.parse(text) as { kpis?: unknown };
  if (typeof model.kpis !== 'object' || model.kpis === null) {
    throw new Error(`stub-api: ${name}.golden.json has no kpis; is it a DashboardModel?`);
  }
  return { model, kpis: model.kpis };
}

function isStubState(value: string): value is StubState {
  return (STUB_STATES as readonly string[]).includes(value);
}

/** The `api` handler for `serveDist({ api })`: the real `/api` contract, fed from the golden snapshots. */
export function stubApi(options: StubApiOptions = {}): ApiHandler {
  const workspaces = options.workspaces ?? DEFAULT_WORKSPACES;
  const dir = options.fixturesDir ?? FIXTURES;
  const unreadableSlug = options.unreadableSlug ?? workspaces.at(-1)?.slug;
  const defaultState = options.defaultState ?? 'two-workspaces';
  const goldens = new Map(workspaces.map((w) => [w.slug, readGolden(dir, w.golden)]));

  const view = (state: StubState): StateView => {
    const listed = state === 'empty' ? [] : workspaces;
    const list: Summary[] = [];
    const dashboards: StateView['dashboards'] = new Map();
    for (const w of listed) {
      const base = { slug: w.slug, name: w.name, pathTail: w.pathTail ?? w.golden };
      const golden = goldens.get(w.slug);
      if (!golden) continue;
      if (state === 'unreadable' && w.slug === unreadableSlug) {
        const summary: Summary = { ...base, readable: false, error: 'missing', counts: null };
        list.push(summary);
        dashboards.set(w.slug, { unreadable: summary });
      } else {
        list.push({ ...base, readable: true, counts: golden.kpis });
        dashboards.set(w.slug, { model: golden.model });
      }
    }
    return { list, dashboards };
  };
  const views = new Map(STUB_STATES.map((s) => [s, view(s)]));

  const sessions = new Map<string, Settings>();
  const sessionOf = (req: Request): string => req.headers.get(SESSION_HEADER) ?? '';
  const settingsOf = (req: Request): Settings => sessions.get(sessionOf(req)) ?? defaults();

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
    const dashboard = current.dashboards.get(slug);
    if (!dashboard) return workspaceJson(req, 404, { error: 'not-found' });
    if ('unreadable' in dashboard) return workspaceJson(req, 409, dashboard.unreadable);
    return workspaceJson(req, 200, dashboard.model);
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

  return (req, url) => {
    const { pathname } = url;
    if (pathname === RESET_PATH) {
      if (req.method !== 'POST') return settingsError(405, { error: 'method-not-allowed' }, { Allow: 'POST' });
      sessions.delete(sessionOf(req));
      return new Response(null, { status: 204 });
    }
    if (pathname === SETTINGS_PATH) return settingsRoute(req);

    const match = DASHBOARD_PATH.exec(pathname);
    if (pathname !== WORKSPACES_PATH && !match) return Response.json({ error: 'not found' }, { status: 404 });
    const requested = req.headers.get(STATE_HEADER) ?? defaultState;
    if (!isStubState(requested)) {
      return settingsError(400, { error: 'unknown-stub-state', state: requested, states: [...STUB_STATES] });
    }
    return workspaceRoute(req, requested, match?.[1]);
  };
}
