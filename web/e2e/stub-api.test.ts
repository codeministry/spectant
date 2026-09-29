// stub-api.ts: the `/api` the e2e and visual suites run against (T57, ISC-17). `bun test web/e2e/stub-api.test.ts`.
//
// Two halves: the stub's own answers (states, golden bodies, ETag/304, 404/405/409, settings, reset), and a parity
// check that sends the same requests to the real `server/` handlers, fed the same golden models, and expects the same
// status, headers and bytes. The server modules are imported at runtime by a computed path, so the web/e2e tsconfig
// (which has no `allowImportingTsExtensions`) never type-checks the server tree; their shapes are declared here.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SESSION_HEADER, STATE_HEADER, STUB_STATES, type StubState, stubApi } from './stub-api';

const FIXTURES = join(import.meta.dir, '..', '..', 'core', 'fixtures');
const SERVER = join(import.meta.dir, '..', '..', 'server', 'src');
const ORIGIN = 'http://127.0.0.1:4173';

type Json = Record<string, unknown>;
type Handler = (req: Request, url: URL) => Response | Promise<Response> | null;

const goldenText = (name: string): string => readFileSync(join(FIXTURES, `${name}.golden.json`), 'utf8');
const golden = (name: string): Json => JSON.parse(goldenText(name)) as Json;

function request(path: string, init: RequestInit & { state?: StubState; session?: string } = {}): Request {
  const headers = new Headers(init.headers);
  headers.set('Host', '127.0.0.1:4173');
  if (init.state !== undefined) headers.set(STATE_HEADER, init.state);
  if (init.session !== undefined) headers.set(SESSION_HEADER, init.session);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

async function call(handler: Handler, req: Request): Promise<Response> {
  const answer = await handler(req, new URL(req.url));
  if (answer === null) throw new Error(`handler declined ${req.method} ${req.url}`);
  return answer;
}

const api = stubApi();
const ask = (path: string, init?: Parameters<typeof request>[1]): Promise<Response> => call(api, request(path, init));

describe('stub API: GET /api/workspaces per state', () => {
  test('the default state is two workspaces, harbor then lantern, readable, counts = each golden kpis', async () => {
    const res = await ask('/api/workspaces');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: golden('harbor')['kpis'] },
      { slug: 'lantern', name: 'lantern', pathTail: 'lantern', readable: true, counts: golden('lantern')['kpis'] },
    ]);
  });

  test('"two-workspaces" named explicitly is the default state', async () => {
    const plain = await (await ask('/api/workspaces')).text();
    expect(await (await ask('/api/workspaces', { state: 'two-workspaces' })).text()).toBe(plain);
  });

  test('"empty" lists no workspace', async () => {
    const res = await ask('/api/workspaces', { state: 'empty' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('[]');
  });

  test('"unreadable" keeps the order and marks the last workspace missing, with no error key on the readable one', async () => {
    const list = (await (await ask('/api/workspaces', { state: 'unreadable' })).json()) as Json[];
    expect(list).toEqual([
      { slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: golden('harbor')['kpis'] },
      { slug: 'lantern', name: 'lantern', pathTail: 'lantern', readable: false, error: 'missing', counts: null },
    ]);
    expect(Object.keys(list[1] ?? {})).toEqual(['slug', 'name', 'pathTail', 'readable', 'error', 'counts']);
    expect(Object.keys(list[0] ?? {})).not.toContain('error');
  });

  test('an unknown state is a loud 400, never a silent default', async () => {
    const res = await call(api, request('/api/workspaces', { headers: { [STATE_HEADER]: 'sepia' } }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-stub-state', state: 'sepia', states: [...STUB_STATES] });
  });

  test('a configured list replaces the default, and names the unreadable slug', async () => {
    const custom = stubApi({
      workspaces: [{ slug: 'one', name: 'One', golden: 'empty-master' }, { slug: 'two', name: 'Two', golden: 'lantern' }],
      unreadableSlug: 'one',
    });
    const list = (await (await call(custom, request('/api/workspaces', { state: 'unreadable' }))).json()) as Json[];
    expect(list.map((w) => [w['slug'], w['pathTail'], w['readable']])).toEqual([
      ['one', 'empty-master', false],
      ['two', 'lantern', true],
    ]);
  });

  test('a golden that does not exist fails when the stub is built, not on the first request', () => {
    expect(() => stubApi({ workspaces: [{ slug: 'x', name: 'x', golden: 'no-such-fixture' }] })).toThrow(/no-such-fixture/);
  });
});

describe('stub API: GET /api/workspaces/:slug/dashboard', () => {
  test.each(['harbor', 'lantern'])('%s: the body is the golden model in the server serialization', async (name) => {
    const res = await ask(`/api/workspaces/${name}/dashboard`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(JSON.stringify(JSON.parse(goldenText(name))));
    expect(JSON.parse(body)).toEqual(golden(name));
  });

  test('JSON headers: content type, no-cache, a strong sha256 ETag of the exact body', async () => {
    const res = await ask('/api/workspaces/harbor/dashboard');
    const body = await res.text();
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    const sha = new Bun.CryptoHasher('sha256').update(body).digest('base64url');
    expect(res.headers.get('ETag')).toBe(`"${sha}"`);
  });

  test('a matching If-None-Match is a 304 without a body; weak and list forms match too', async () => {
    const etag = (await ask('/api/workspaces/harbor/dashboard')).headers.get('ETag') ?? '';
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const res = await ask('/api/workspaces/harbor/dashboard', { headers: { 'If-None-Match': header } });
      expect(res.status).toBe(304);
      expect(res.headers.get('ETag')).toBe(etag);
      expect(await res.text()).toBe('');
    }
    const changed = await ask('/api/workspaces/harbor/dashboard', { headers: { 'If-None-Match': '"stale"' } });
    expect(changed.status).toBe(200);
  });

  test('the list revalidates too', async () => {
    const etag = (await ask('/api/workspaces')).headers.get('ETag') ?? '';
    expect((await ask('/api/workspaces', { headers: { 'If-None-Match': etag } })).status).toBe(304);
    // Another state is another body, so the tag of one state never answers 304 for another.
    expect((await ask('/api/workspaces', { state: 'empty', headers: { 'If-None-Match': etag } })).status).toBe(200);
  });

  test('HEAD answers the headers without the body', async () => {
    const get = await ask('/api/workspaces/lantern/dashboard');
    const head = await ask('/api/workspaces/lantern/dashboard', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('ETag')).toBe(get.headers.get('ETag'));
    expect(await head.text()).toBe('');
  });

  test('an unknown slug is 404 {error: "not-found"}, in every state', async () => {
    for (const state of STUB_STATES) {
      const res = await ask('/api/workspaces/nope/dashboard', { state });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not-found' });
    }
    expect((await ask('/api/workspaces/harbor/dashboard', { state: 'empty' })).status).toBe(404);
    expect((await ask('/api/workspaces/%E0%A4%A/dashboard')).status).toBe(404);
  });

  test('the unreadable workspace is 409 with its own list entry as the body', async () => {
    const res = await ask('/api/workspaces/lantern/dashboard', { state: 'unreadable' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      slug: 'lantern',
      name: 'lantern',
      pathTail: 'lantern',
      readable: false,
      error: 'missing',
      counts: null,
    });
    expect((await ask('/api/workspaces/harbor/dashboard', { state: 'unreadable' })).status).toBe(200);
  });

  test('any method but GET or HEAD is 405 with Allow: GET, HEAD', async () => {
    for (const path of ['/api/workspaces', '/api/workspaces/harbor/dashboard']) {
      const res = await ask(path, { method: 'POST', body: '{}' });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
      expect(await res.json()).toEqual({ error: 'method-not-allowed' });
    }
  });

  test('a foreign Host or a cross-site Origin is 403, as on the real server', async () => {
    const foreign = new Request(`${ORIGIN}/api/workspaces`, { headers: { Host: 'evil.example' } });
    expect((await call(api, foreign)).status).toBe(403);
    const crossSite = request('/api/settings', { headers: { Origin: 'https://evil.example' } });
    expect((await call(api, crossSite)).status).toBe(403);
  });

  test('any other /api path is the server JSON 404', async () => {
    const res = await ask('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('stub API: /api/settings', () => {
  const DEFAULTS = { theme: 'system', language: 'en', refreshSeconds: 30, singleKeyShortcuts: true };
  const put = (body: unknown, session?: string): Promise<Response> =>
    ask('/api/settings', { method: 'PUT', body: JSON.stringify(body), ...(session === undefined ? {} : { session }) });

  test('starts at the schema defaults', async () => {
    const fresh = stubApi();
    expect(await (await call(fresh, request('/api/settings'))).json()).toEqual(DEFAULTS);
  });

  test('PUT then GET round-trips, and the answer is the full settings', async () => {
    const res = await put({ theme: 'dark' }, 'round-trip');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...DEFAULTS, theme: 'dark' });
    expect(await (await ask('/api/settings', { session: 'round-trip' })).json()).toEqual({ ...DEFAULTS, theme: 'dark' });
  });

  test('sessions are isolated, so parallel tests never see each other', async () => {
    await put({ language: 'de' }, 'a');
    expect(await (await ask('/api/settings', { session: 'b' })).json()).toEqual(DEFAULTS);
  });

  test('POST /api/__stub/reset restores the defaults of that session only', async () => {
    await put({ refreshSeconds: 60 }, 'reset-me');
    await put({ refreshSeconds: 90 }, 'keep-me');
    const reset = await ask('/api/__stub/reset', { method: 'POST', session: 'reset-me' });
    expect(reset.status).toBe(204);
    expect(await (await ask('/api/settings', { session: 'reset-me' })).json()).toEqual(DEFAULTS);
    expect(((await (await ask('/api/settings', { session: 'keep-me' })).json()) as Json)['refreshSeconds']).toBe(90);
    expect((await ask('/api/__stub/reset')).status).toBe(405);
  });

  test('validation mirrors SettingsSchema: unknown key, invalid value, invalid body', async () => {
    const cases: Array<[unknown, Json]> = [
      [{ colour: 'red' }, { error: 'unknown-key', key: 'colour' }],
      [{ theme: 'sepia' }, { error: 'invalid-value', key: 'theme' }],
      [{ language: 'fr' }, { error: 'invalid-value', key: 'language' }],
      [{ refreshSeconds: 4 }, { error: 'invalid-value', key: 'refreshSeconds' }],
      [{ refreshSeconds: 3601 }, { error: 'invalid-value', key: 'refreshSeconds' }],
      [{ refreshSeconds: 30.5 }, { error: 'invalid-value', key: 'refreshSeconds' }],
      [{ singleKeyShortcuts: 'yes' }, { error: 'invalid-value', key: 'singleKeyShortcuts' }],
      [[], { error: 'invalid-body' }],
      [null, { error: 'invalid-body' }],
    ];
    for (const [body, error] of cases) {
      const res = await put(body, 'validation');
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(error);
    }
    const garbage = await ask('/api/settings', { method: 'PUT', body: '{', session: 'validation' });
    expect(garbage.status).toBe(400);
    // A refused PUT writes nothing, not even its valid keys.
    expect((await put({ theme: 'light', language: 'fr' }, 'validation')).status).toBe(400);
    expect(await (await ask('/api/settings', { session: 'validation' })).json()).toEqual(DEFAULTS);
  });

  test('weak ETag, 304 on GET, never on PUT; 405 names GET, HEAD, PUT', async () => {
    const res = await ask('/api/settings', { session: 'etag' });
    const etag = res.headers.get('ETag') ?? '';
    expect(etag).toMatch(/^W\/"[0-9a-z]+"$/);
    expect((await ask('/api/settings', { session: 'etag', headers: { 'If-None-Match': etag } })).status).toBe(304);
    const again = await ask('/api/settings', {
      method: 'PUT',
      body: '{}',
      session: 'etag',
      headers: { 'If-None-Match': etag },
    });
    expect(again.status).toBe(200);
    const del = await ask('/api/settings', { method: 'DELETE' });
    expect(del.status).toBe(405);
    expect(del.headers.get('Allow')).toBe('GET, HEAD, PUT');
  });
});

describe('stub API: every answer is deterministic', () => {
  test('two stubs answer the same bytes and tags for the same request', async () => {
    const other = stubApi();
    for (const state of STUB_STATES) {
      for (const path of ['/api/workspaces', '/api/workspaces/harbor/dashboard', '/api/workspaces/lantern/dashboard', '/api/settings']) {
        const a = await call(api, request(path, { state, session: `det-${state}` }));
        const b = await call(other, request(path, { state, session: `det-${state}` }));
        expect([b.status, b.headers.get('ETag'), await b.text()]).toEqual([a.status, a.headers.get('ETag'), await a.text()]);
      }
    }
  });
});

// ---- parity with the real server handlers -------------------------------------------------------------------------

type ServerWorkspace = { slug: string; path: string; name: string; addedAt: string; position: number };
type ServerLoad = { readable: true; model: unknown } | { readable: false; error: string };
type ApiModule = {
  dashboardApi: (options: {
    registry: { list: () => ServerWorkspace[]; get: (slug: string) => ServerWorkspace | undefined };
    loadWorkspace: (root: string) => Promise<ServerLoad>;
  }) => Handler;
};
type SettingsModule = { settingsApi: (store: unknown) => Handler; openSettings: (db: Database) => unknown };
type DbModule = { migrate: (db: Database) => void };

let db: Database | undefined;
let real: Record<StubState, Handler> | undefined;
let realSettings: Handler | undefined;

beforeAll(async () => {
  const apiModule = (await import(join(SERVER, 'api.ts'))) as ApiModule;
  const settingsModule = (await import(join(SERVER, 'settings.ts'))) as SettingsModule;
  const dbModule = (await import(join(SERVER, 'db.ts'))) as DbModule;

  const registered = (names: string[]): ServerWorkspace[] =>
    names.map((name, position) => ({ slug: name, path: `/fixtures/${name}`, name, addedAt: '2026-03-01T00:00:00Z', position }));
  const realFor = (names: string[], unreadable: string | null): Handler => {
    const workspaces = registered(names);
    return apiModule.dashboardApi({
      registry: { list: () => workspaces, get: (slug) => workspaces.find((w) => w.slug === slug) },
      loadWorkspace: (root) => {
        const name = root.split('/').pop() ?? '';
        return Promise.resolve(name === unreadable ? { readable: false, error: 'missing' } : { readable: true, model: golden(name) });
      },
    });
  };
  real = {
    'two-workspaces': realFor(['harbor', 'lantern'], null),
    empty: realFor([], null),
    unreadable: realFor(['harbor', 'lantern'], 'lantern'),
  };

  db = new Database(':memory:', { strict: true });
  dbModule.migrate(db);
  realSettings = settingsModule.settingsApi(settingsModule.openSettings(db));
});

afterAll(() => db?.close());

async function snapshot(res: Response): Promise<unknown[]> {
  const headers = ['Content-Type', 'Cache-Control', 'ETag', 'Allow'].map((h) => res.headers.get(h));
  return [res.status, headers, await res.text()];
}

describe('stub API matches the real server handlers byte for byte', () => {
  const requests: Array<[string, RequestInit]> = [
    ['/api/workspaces', {}],
    ['/api/workspaces', { method: 'HEAD' }],
    ['/api/workspaces', { method: 'DELETE' }],
    ['/api/workspaces/harbor/dashboard', {}],
    ['/api/workspaces/lantern/dashboard', {}],
    ['/api/workspaces/lantern/dashboard', { method: 'HEAD' }],
    ['/api/workspaces/nope/dashboard', {}],
    ['/api/workspaces/%E0%A4%A/dashboard', {}],
    ['/api/workspaces/harbor/dashboard', { method: 'PUT', body: '{}' }],
    ['/api/workspaces', { headers: { Origin: 'https://evil.example' } }],
  ];

  test.each([...STUB_STATES])('workspace routes, state %s', async (state) => {
    const handler = real?.[state];
    if (!handler) throw new Error('real handlers not loaded');
    for (const [path, init] of requests) {
      const stubbed = await snapshot(await call(api, request(path, { ...init, state })));
      const served = await snapshot(await call(handler, request(path, init)));
      expect({ path, method: init.method ?? 'GET', answer: stubbed }).toEqual({ path, method: init.method ?? 'GET', answer: served });
      // The same request with the tag the real server gave must be a 304 on both.
      const etag = (served[1] as Array<string | null>)[2];
      if (served[0] === 200 && etag) {
        const revalidate = { ...init, headers: { 'If-None-Match': etag } };
        expect((await call(api, request(path, { ...revalidate, state }))).status).toBe(304);
      }
    }
  });

  test('settings: the same sequence of requests gives the same answers', async () => {
    if (!realSettings) throw new Error('real settings handler not loaded');
    const stub = stubApi();
    const steps: RequestInit[] = [
      {},
      { method: 'HEAD' },
      { method: 'PUT', body: JSON.stringify({ theme: 'dark', refreshSeconds: 60 }) },
      {},
      { method: 'PUT', body: JSON.stringify({ language: 'fr' }) },
      { method: 'PUT', body: JSON.stringify({ nope: 1 }) },
      { method: 'PUT', body: '[]' },
      { method: 'PUT', body: '{' },
      { method: 'DELETE' },
      { headers: { Origin: 'https://evil.example' } },
    ];
    for (const init of steps) {
      const stubbed = await snapshot(await call(stub, request('/api/settings', init)));
      const served = await snapshot(await call(realSettings, request('/api/settings', init)));
      expect({ method: init.method ?? 'GET', answer: stubbed }).toEqual({ method: init.method ?? 'GET', answer: served });
    }
  });
});
