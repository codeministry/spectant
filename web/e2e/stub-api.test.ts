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

import type {
  ClaimViewModel,
  EvidenceListing,
  LiveFrame,
  SpecPageModel,
  TasksTab,
} from '../../core/src/files';
import {
  DOC_NAMES,
  GOLDEN_FAMILY,
  JSON_ANSWER,
  REVIEWED_HASHES_HEADER,
  type ReviewedHashes,
  SPEC_ROUTE_TABLE,
  type SpecRouteName,
  TASKS_HASH_HEADER,
  allowFor,
  evidenceFileHeaders,
  parseReviewedHashes,
  specRoutes,
} from '../../server/src/spec-routes.contract';
import {
  LOCKS_HEADER,
  LOCK_STATES,
  type LockState,
  SESSION_HEADER,
  STATE_HEADER,
  STUB_NOW,
  STUB_STATES,
  type StubState,
  WRITE_HEADER,
  WRITE_OUTCOMES,
  recountTasks,
  stubApi,
} from './stub-api';

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
  const DEFAULTS = { theme: 'system', language: 'en', refreshSeconds: 30, singleKeyShortcuts: true, railCollapsed: false };
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

// ---- the spec routes (T52): every route of SPEC_ROUTE_TABLE from the golden families -----------------------------

const WS = 'harbor';
const KEY = 'specs/002-web-console';
const SPEC_DIR = join(FIXTURES, 'harbor', 'specs', '002-web-console');
const CORE = join(import.meta.dir, '..', '..', 'core', 'src');
const HEX64 = /^[0-9a-f]{64}$/;

type EvidenceModule = {
  listEvidence: (dir: string) => Promise<EvidenceListing>;
  mediaTypeOf: (name: string) => string;
};
const family = (tree: string, name: string): Json => golden(`${tree}.${name}`);
const familyValue = (tree: string, name: string, key: string): unknown => family(tree, name)[key];

/** The golden value a read route answers for `harbor` / `specs/002-web-console`. */
function goldenFor(route: SpecRouteName): unknown {
  if (route === 'live') return familyValue(WS, 'live', KEY);
  const name = (GOLDEN_FAMILY as Partial<Record<SpecRouteName, string>>)[route];
  if (name === undefined) throw new Error(`no golden family for ${route}`);
  return familyValue(WS, name, KEY);
}

const specHashes = async (path: string, init?: Parameters<typeof request>[1]): Promise<ReviewedHashes> => {
  const res = await ask(path, init);
  const hashes = parseReviewedHashes(res.headers.get(REVIEWED_HASHES_HEADER));
  if (hashes === null) throw new Error(`no ${REVIEWED_HASHES_HEADER} on ${path}`);
  return hashes;
};
const postJson = (path: string, body: unknown, init: Parameters<typeof request>[1] = {}): Promise<Response> =>
  ask(path, { ...init, method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('stub API: every spec route answers its golden (harbor 002)', () => {
  const covered = new Set<SpecRouteName>();

  test('the JSON read routes: 200, body deep-equal to the per-spec golden value, the JSON_ANSWER headers', async () => {
    for (const entry of SPEC_ROUTE_TABLE) {
      if (entry.method !== 'GET' || ['evidence', 'evidenceFile', 'docs'].includes(entry.route)) continue;
      const build = specRoutes[entry.route] as (ws: string, id: string) => string;
      const res = await ask(build(WS, '002'));
      const body = await res.text();
      expect({ route: entry.route, status: res.status }).toEqual({ route: entry.route, status: 200 });
      expect(JSON.parse(body)).toEqual(goldenFor(entry.route));
      expect(res.headers.get('Content-Type')).toBe(JSON_ANSWER.contentType);
      expect(res.headers.get('Cache-Control')).toBe(JSON_ANSWER.cacheControl);
      expect(res.headers.get('ETag')).toBe(`"${new Bun.CryptoHasher('sha256').update(body).digest('base64url')}"`);
      covered.add(entry.route);
    }
  });

  test('docs: each Docs tab from the docs golden, constitution top level, a missing file is 404 DocMissing', async () => {
    const docs = family(WS, 'docs') as { constitution: unknown; specs: Record<string, Record<string, unknown>> };
    for (const name of DOC_NAMES) {
      const res = await ask(specRoutes.docs(WS, '002', name));
      const value = name === 'constitution' ? docs.constitution : docs.specs[KEY]?.[name];
      if (value === null) {
        expect(res.status).toBe(404);
        // harbor 002 is a feature: its missing design.md belongs to the type.
        expect(await res.json()).toEqual({ error: 'not-found', doc: name, availability: { applies: true, command: '/spec-design' } });
      } else {
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual(value);
      }
    }
    // A spike has no plan in its workflow: the reason says so.
    const spike = await ask(specRoutes.docs(WS, '005', 'plan'));
    expect(spike.status).toBe(404);
    expect(await spike.json()).toEqual({ error: 'not-found', doc: 'plan', availability: { applies: false, command: '/spec-plan' } });
    covered.add('docs');
  });

  test('evidence: the listing core builds from the real artifacts/ and .evidence/ of harbor 002', async () => {
    const core = (await import(join(CORE, 'evidence.ts'))) as EvidenceModule;
    const res = await ask(specRoutes.evidence(WS, '002'));
    expect(res.status).toBe(200);
    const listing = (await res.json()) as EvidenceListing;
    expect(listing).toEqual(await core.listEvidence(SPEC_DIR));
    expect(listing.results.map((f) => f.path)).toEqual([
      'artifacts/T12-dashboard-model.md',
      'artifacts/T13-routes.md',
      'artifacts/T18-e2e-report.md',
    ]);
    expect(listing.raw.map((f) => f.path)).toEqual(['.evidence/bun-test-r3.log', '.evidence/dashboard.har', '.evidence/kpi-band-390.png']);
    covered.add('evidence');
  });

  test('evidence/file: the bytes with evidenceFileHeaders, 403 for what confinement refuses, 404 for no file', async () => {
    const core = (await import(join(CORE, 'evidence.ts'))) as EvidenceModule;
    for (const path of ['artifacts/T12-dashboard-model.md', '.evidence/kpi-band-390.png', '.evidence/dashboard.har']) {
      const res = await ask(specRoutes.evidenceFile(WS, '002', path));
      expect(res.status).toBe(200);
      const expected = evidenceFileHeaders(core.mediaTypeOf(path));
      for (const [header, value] of Object.entries(expected)) expect(res.headers.get(header)).toBe(value);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(readFileSync(join(SPEC_DIR, path))));
    }
    const refused = ['spec.md', '../003-config-loader/spec.md', '%2e%2e%2fspec.md', '%252e%252e%252fspec.md', '/etc/hosts', ''];
    for (const raw of refused) {
      const res = await ask(`${specRoutes.evidence(WS, '002')}/file?path=${raw}`);
      expect({ raw, status: res.status }).toEqual({ raw, status: 403 });
      expect(await res.json()).toEqual({ error: 'forbidden' });
    }
    const missing = await ask(specRoutes.evidenceFile(WS, '002', 'artifacts/T99-nothing.md'));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'not-found' });
    covered.add('evidenceFile');
  });

  test('every GET route of the table was answered above', () => {
    const reads = SPEC_ROUTE_TABLE.filter((e) => e.method === 'GET').map((e) => e.route);
    expect([...covered].sort()).toEqual([...reads].sort());
  });
});

describe('stub API: spec routes, resolution and errors', () => {
  test('`:id` resolves like core: NNN, folder or bare slug, archived folders too', async () => {
    const byId = await (await ask(specRoutes.spec(WS, '002'))).text();
    expect(await (await ask(specRoutes.spec(WS, '002-web-console'))).text()).toBe(byId);
    expect(await (await ask(specRoutes.spec(WS, 'web-console'))).text()).toBe(byId);
    const archived = (await (await ask(specRoutes.spec(WS, 'manifest-sync'))).json()) as { head: { slug: string } };
    expect(archived.head.slug).toBe('001-manifest-sync');
    expect((await ask(specRoutes.spec(WS, '001'))).status).toBe(200);
    expect(((await (await ask(specRoutes.spec('lantern', '002'))).json()) as { head: { slug: string } }).head.slug).toBe('002-duplicate-links');
  });

  test('404 not-found: unknown workspace, spec id, slug; every workspace in the empty state', async () => {
    for (const path of [
      specRoutes.spec('nope', '002'),
      specRoutes.spec(WS, '999'),
      specRoutes.spec(WS, 'no-such-spec'),
      specRoutes.timeline(WS, '099-web-console'),
      specRoutes.live(WS, 'archive'),
    ]) {
      const res = await ask(path);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(await res.json()).toEqual({ error: 'not-found' });
    }
    expect((await ask(specRoutes.spec(WS, '002'), { state: 'empty' })).status).toBe(404);
    // A doc name outside DOC_NAMES is no route: the server's JSON 404.
    const noRoute = await ask(`${specRoutes.spec(WS, '002')}/docs/readme`);
    expect(noRoute.status).toBe(404);
    expect(await noRoute.json()).toEqual({ error: 'not found' });
  });

  test('the unreadable workspace answers every spec route with 409 and its summary', async () => {
    const res = await ask(specRoutes.claims('lantern', '001'), { state: 'unreadable' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ slug: 'lantern', name: 'lantern', pathTail: 'lantern', readable: false, error: 'missing', counts: null });
    expect((await ask(specRoutes.claims(WS, '002'), { state: 'unreadable' })).status).toBe(200);
  });

  test('405 with Allow from the table: GET routes allow GET, HEAD; the writes allow POST', async () => {
    const get = await ask(specRoutes.live(WS, '002'), { method: 'POST', body: '{}' });
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe(allowFor('live'));
    expect(await get.json()).toEqual({ error: 'method-not-allowed' });
    for (const path of [specRoutes.gateReviewed(WS, '002'), specRoutes.taskCheck(WS, '002', 'T27')]) {
      const res = await ask(path);
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
    }
  });

  test('403 for a foreign Host or a cross-site Origin', async () => {
    const res = await call(api, request(specRoutes.spec(WS, '002'), { headers: { Origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden' });
  });

  test('ETag and 304, HEAD without a body; the hash headers ride on 200, 304 and HEAD', async () => {
    const res = await ask(specRoutes.spec(WS, '002'));
    const etag = res.headers.get('ETag') ?? '';
    const hashes = res.headers.get(REVIEWED_HASHES_HEADER);
    expect(parseReviewedHashes(hashes)).not.toBeNull();
    const again = await ask(specRoutes.spec(WS, '002'), { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect(again.headers.get(REVIEWED_HASHES_HEADER)).toBe(hashes);
    const head = await ask(specRoutes.spec(WS, '002'), { method: 'HEAD' });
    expect([head.status, head.headers.get('ETag'), head.headers.get(REVIEWED_HASHES_HEADER), await head.text()]).toEqual([200, etag, hashes, '']);
  });

  test('hash headers: every file of the spec gets a hex hash, a missing file is "-"; tasks hash only with a tasks.md', async () => {
    const full = await specHashes(specRoutes.spec(WS, '002'));
    expect([full.spec, full.plan, full.tasks].map((h) => HEX64.test(h ?? ''))).toEqual([true, true, true]);
    expect(new Set([full.spec, full.plan, full.tasks]).size).toBe(3);
    const bug = await specHashes(specRoutes.spec(WS, '006'));
    expect([HEX64.test(bug.spec ?? ''), bug.plan, bug.tasks]).toEqual([true, null, null]);
    expect((await ask(specRoutes.tasks(WS, '002'))).headers.get(TASKS_HASH_HEADER)).toMatch(HEX64);
    const none = await ask(specRoutes.tasks(WS, '003'));
    expect([none.status, await none.text(), none.headers.get(TASKS_HASH_HEADER)]).toEqual([200, 'null', null]);
  });
});

describe('stub API: lock fixtures via X-Spectant-Stub-Locks', () => {
  const live = async (lock?: LockState, ws = WS, id = '002'): Promise<LiveFrame> =>
    (await (await ask(specRoutes.live(ws, id), lock === undefined ? {} : { headers: { [LOCKS_HEADER]: lock } })).json()) as LiveFrame;
  const lifeos = async (lock?: LockState): Promise<unknown> =>
    (await ask('/api/lifeos', lock === undefined ? {} : { headers: { [LOCKS_HEADER]: lock } })).json();

  test('activity is the default and serves the golden as it is; /api/lifeos is absent', async () => {
    expect(await live()).toEqual(goldenFor('live') as LiveFrame);
    expect(await live('activity')).toEqual(goldenFor('live') as LiveFrame);
    expect(await lifeos()).toEqual({ present: false });
    expect(await lifeos('activity')).toEqual({ present: false });
  });

  test('none: lock source none, no locks, no agents, the running card back to waiting without its lock', async () => {
    const frame = await live('none');
    expect([frame.lockSource, frame.locks, frame.agents]).toEqual(['none', [], []]);
    expect(frame.cards.filter((c) => c.state === 'running' || c.lock !== undefined)).toEqual([]);
    const t27 = frame.cards.find((c) => c.task === 'T27');
    expect(t27?.state).toBe('waiting');
    expect(t27 && ['since', 'elapsedMs', 'stale'].some((k) => k in t27)).toBe(false);
    expect(await lifeos('none')).toEqual({ present: false });
    const spec = (await (await ask(specRoutes.spec(WS, '002'), { headers: { [LOCKS_HEADER]: 'none' } })).json()) as SpecPageModel;
    expect(spec.areas.live).toEqual({ lockSource: 'none', agentsWorking: 0, lock: null });
  });

  test('frontier: the activity lock relabelled, a second frontier session on another open claim, LifeOS present', async () => {
    const frame = await live('frontier');
    expect(frame.lockSource).toBe('frontier');
    expect(frame.locks.every((l) => l.source === 'frontier')).toBe(true);
    expect(frame.locks.map((l) => l.claim)).toContain('ISC-74');
    expect(frame.locks).toHaveLength(2);
    expect(frame.agents.map((a) => a.source)).toEqual(['frontier', 'frontier']);
    expect(new Set(frame.agents.map((a) => a.session)).size).toBe(2);
    const running = frame.cards.filter((c) => c.state === 'running');
    expect(running).toHaveLength(2);
    expect(running.every((c) => c.lock?.source === 'frontier' && typeof c.since === 'string')).toBe(true);
    const claims = (familyValue(WS, 'claim-view', KEY) as ClaimViewModel).claims;
    const second = frame.locks.find((l) => l.claim !== 'ISC-74');
    expect(claims.find((c) => c.id === second?.claim)?.state).toMatch(/^(takeable|open|blocked)$/);
    expect(await lifeos('frontier')).toEqual({ present: true });
    const spec = (await (await ask(specRoutes.spec(WS, '002'), { headers: { [LOCKS_HEADER]: 'frontier' } })).json()) as SpecPageModel;
    expect(spec.areas.live.lockSource).toBe('frontier');
    expect(spec.areas.live.agentsWorking).toBe(2);
    expect(spec.keyNumbers.rounds.agentsWorking).toBe(2);
    // A workspace without an activity file still names frontier when LifeOS is present.
    expect((await live('frontier', 'lantern', '001')).lockSource).toBe('frontier');
  });

  test('an unknown lock state is a loud 400', async () => {
    const res = await ask(specRoutes.live(WS, '002'), { headers: { [LOCKS_HEADER]: 'sometimes' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-stub-locks', locks: 'sometimes', states: [...LOCK_STATES] });
  });
});

describe('stub API: the writes, scripted via X-Spectant-Stub-Write', () => {
  const gate = (id: string, body: unknown, init: Parameters<typeof request>[1] = {}): Promise<Response> =>
    postJson(specRoutes.gateReviewed(WS, id), body, init);
  const check = (tid: string, body: unknown, init: Parameters<typeof request>[1] = {}): Promise<Response> =>
    postJson(specRoutes.taskCheck(WS, '002', tid), body, init);
  const tasksHash = async (session: string): Promise<string> =>
    (await ask(specRoutes.tasks(WS, '002'), { session })).headers.get(TASKS_HASH_HEADER) ?? '';
  const taskRow = async (tid: string, session: string): Promise<TasksTab['tasks'][number] | undefined> =>
    ((await (await ask(specRoutes.tasks(WS, '002'), { session })).json()) as TasksTab).tasks.find((t) => t.id === tid);

  test('gate ok: 200 with the mark, and the session sees the gate fresh on the next GET; another session does not', async () => {
    const session = 'gate-ok';
    const hashes = await specHashes(specRoutes.spec(WS, '006'), { session });
    const before = (await (await ask(specRoutes.spec(WS, '006'), { session })).json()) as SpecPageModel;
    expect(before.gates.reviewed.state).toBe('stale');
    const res = await gate('006', { hashes }, { session });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ at: STUB_NOW, hashes, lockSource: 'activity' });
    const after = (await (await ask(specRoutes.spec(WS, '006'), { session })).json()) as SpecPageModel;
    expect(after.gates.reviewed).toEqual({ state: 'fresh', detail: 'matches spec.md', at: STUB_NOW, files: ['spec.md'] });
    const other = (await (await ask(specRoutes.spec(WS, '006'), { session: 'gate-other' })).json()) as SpecPageModel;
    expect(other.gates.reviewed.state).toBe('stale');
  });

  test('gate: hashes that differ from the header are a 409 even under ok, as on the server', async () => {
    const hashes = await specHashes(specRoutes.spec(WS, '002'));
    const res = await gate('002', { hashes: { ...hashes, spec: '0'.repeat(64) } }, { session: 'gate-mismatch' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'hash-mismatch', expected: hashes });
  });

  test('gate stale: 409 Conflict with the expected hashes; nothing written', async () => {
    const session = 'gate-stale';
    const hashes = await specHashes(specRoutes.spec(WS, '006'), { session });
    const res = await gate('006', { hashes }, { session, headers: { [WRITE_HEADER]: 'stale' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'hash-mismatch', expected: hashes });
    expect(((await (await ask(specRoutes.spec(WS, '006'), { session })).json()) as SpecPageModel).gates.reviewed.state).toBe('stale');
  });

  test('gate locked: 423 with the current lock fixture ClaimLock', async () => {
    const hashes = await specHashes(specRoutes.spec(WS, '002'));
    const activity = await gate('002', { hashes }, { session: 'gate-locked', headers: { [WRITE_HEADER]: 'locked' } });
    expect(activity.status).toBe(423);
    expect(await activity.json()).toEqual({ error: 'locked', lock: (goldenFor('live') as LiveFrame).locks[0] });
    const frontier = await gate('002', { hashes }, { session: 'gate-locked', headers: { [WRITE_HEADER]: 'locked', [LOCKS_HEADER]: 'frontier' } });
    const body = (await frontier.json()) as { lock: { source: string } };
    expect([frontier.status, body.lock.source]).toEqual([423, 'frontier']);
    // Without any lock the scripted 423 still names a frontier lock: only a frontier lock refuses a write (ISC-86).
    const none = await gate('002', { hashes }, { headers: { [WRITE_HEADER]: 'locked', [LOCKS_HEADER]: 'none' } });
    expect([none.status, ((await none.json()) as { lock: { source: string } }).lock.source]).toEqual([423, 'frontier']);
    expect(((await (await ask(specRoutes.spec(WS, '002'), { session: 'gate-locked' })).json()) as SpecPageModel).gates.reviewed.at).toBe(
      '2026-03-07T15:30:00Z',
    );
  });

  test('gate ok under lock state none reports lockSource none ("no agent source")', async () => {
    const hashes = await specHashes(specRoutes.spec(WS, '002'));
    const res = await gate('002', { hashes }, { session: 'gate-none', headers: { [LOCKS_HEADER]: 'none' } });
    expect(((await res.json()) as { lockSource: string }).lockSource).toBe('none');
  });

  test('check ok: 200 with the new raw hash, the session sees the box ticked, the old hash is now stale, unticking restores', async () => {
    const session = 'check-ok';
    const hash = await tasksHash(session);
    expect((await taskRow('T27', session))?.state).toBe('open');
    const res = await check('T27', { checked: true, hash }, { session });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as {
      task: string;
      checked: boolean;
      hash: string;
      lockSource: string;
      line: { number: number; text: string };
    };
    expect({ ...answer, hash: HEX64.test(answer.hash), line: answer.line.number }).toEqual({
      task: 'T27',
      checked: true,
      hash: true,
      lockSource: 'activity',
      line: 45,
    });
    // `TaskCheckWritten`: the line as it now stands, box ticked, the rest of the fixture line unchanged.
    expect(answer.line.text).toMatch(/^- \[x\] T27 · ISC-74 · web — settings-page/); // single-core: allow — asserts the stub's flipped line, no parsing
    expect(answer.hash).not.toBe(hash);
    expect(await tasksHash(session)).toBe(answer.hash);
    expect(await taskRow('T27', session)).toMatchObject({ state: 'done', status: 'done' });
    const tab = (await (await ask(specRoutes.tasks(WS, '002'), { session })).json()) as TasksTab;
    expect(tab.counts.boxes.landed).toBe(28);
    // The reviewed hash normalises checkboxes away, so a tick leaves it as it was.
    expect(await specHashes(specRoutes.spec(WS, '002'), { session })).toEqual(await specHashes(specRoutes.spec(WS, '002')));
    expect((await check('T27', { checked: false, hash }, { session })).status).toBe(409);
    expect((await check('T27', { checked: false, hash: answer.hash }, { session })).status).toBe(200);
    expect(await (await ask(specRoutes.tasks(WS, '002'), { session })).json()).toEqual(goldenFor('tasks'));
    expect(await tasksHash(session)).toBe(hash);
    expect(await taskRow('T27', 'check-other')).toMatchObject({ state: 'open' });
  });

  test('check stale: 409 with the expected tasks hash; locked: 423 naming the lock on the task claim', async () => {
    const hash = await tasksHash('check-script');
    const stale = await check('T27', { checked: true, hash }, { session: 'check-script', headers: { [WRITE_HEADER]: 'stale' } });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'hash-mismatch', expected: { tasks: hash } });
    const locked = await check('T27', { checked: true, hash }, { session: 'check-script', headers: { [WRITE_HEADER]: 'locked', [LOCKS_HEADER]: 'frontier' } });
    expect(locked.status).toBe(423);
    expect(await locked.json()).toEqual({ error: 'locked', lock: { source: 'frontier', claim: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T14:06:00Z' } });
    expect(await taskRow('T27', 'check-script')).toMatchObject({ state: 'open' });
  });

  test('400 invalid-body for a body the contract validators refuse; 404 for an unknown or struck task, or no tasks.md', async () => {
    const hash = await tasksHash('check-400');
    const hashes = await specHashes(specRoutes.spec(WS, '002'));
    for (const [res, status] of [
      [await check('T27', '{', {}), 400],
      [await check('T27', { checked: 'yes', hash }, {}), 400],
      [await check('T27', { checked: true, hash: 'abc' }, {}), 400],
      [await gate('002', { hashes: { spec: hashes.spec } }, {}), 400],
      [await gate('002', [], {}), 400],
      [await check('T999', { checked: true, hash }, {}), 404],
      [await postJson(specRoutes.taskCheck(WS, '003', 'T1'), { checked: true, hash }), 404],
    ] as const) {
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual(status === 400 ? { error: 'invalid-body' } : { error: 'not-found' });
    }
  });

  test('an unknown write outcome is a loud 400', async () => {
    const hashes = await specHashes(specRoutes.spec(WS, '002'));
    const res = await gate('002', { hashes }, { headers: { [WRITE_HEADER]: 'maybe' } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown-stub-write', write: 'maybe', outcomes: [...WRITE_OUTCOMES] });
  });

  test('POST /api/__stub/reset clears the session writes too', async () => {
    const session = 'reset-writes';
    const hashes = await specHashes(specRoutes.spec(WS, '006'), { session });
    expect((await gate('006', { hashes }, { session })).status).toBe(200);
    expect((await check('T27', { checked: true, hash: await tasksHash(session) }, { session })).status).toBe(200);
    expect((await ask('/api/__stub/reset', { method: 'POST', session })).status).toBe(204);
    expect(((await (await ask(specRoutes.spec(WS, '006'), { session })).json()) as SpecPageModel).gates.reviewed.state).toBe('stale');
    expect(await (await ask(specRoutes.tasks(WS, '002'), { session })).json()).toEqual(goldenFor('tasks'));
  });
});

describe('stub API: spec routes are deterministic', () => {
  test('two stubs answer the same bytes, tags and hash headers for every read route and lock state', async () => {
    const other = stubApi();
    const paths = [
      ...SPEC_ROUTE_TABLE.filter((e) => e.method === 'GET' && !['evidenceFile', 'docs'].includes(e.route)).map((e) =>
        (specRoutes[e.route] as (ws: string, id: string) => string)(WS, '002'),
      ),
      ...DOC_NAMES.map((name) => specRoutes.docs(WS, '002', name)),
      specRoutes.evidenceFile(WS, '002', 'artifacts/T13-routes.md'),
      specRoutes.live('lantern', '001'),
      '/api/lifeos',
    ];
    for (const lock of LOCK_STATES) {
      for (const path of paths) {
        const init = { headers: { [LOCKS_HEADER]: lock } };
        const a = await call(api, request(path, init));
        const b = await call(other, request(path, init));
        const view = async (r: Response): Promise<unknown[]> => [
          r.status,
          r.headers.get('ETag'),
          r.headers.get(REVIEWED_HASHES_HEADER),
          r.headers.get(TASKS_HASH_HEADER),
          await r.text(),
        ];
        expect({ lock, path, answer: await view(b) }).toEqual({ lock, path, answer: await view(a) });
      }
    }
  });

  test('the tasks counts the stub recomputes after a tick equal the golden counts when nothing is ticked', () => {
    for (const tree of ['harbor', 'lantern', 'leadgen', 'spectant-001']) {
      for (const [key, tab] of Object.entries(family(tree, 'tasks'))) {
        if (tab === null) continue;
        const t = tab as TasksTab;
        expect({ tree, key, counts: recountTasks(t.tasks, t.counts) }).toEqual({ tree, key, counts: t.counts });
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
