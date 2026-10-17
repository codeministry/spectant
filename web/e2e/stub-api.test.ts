// stub-api.ts: the `/api` the e2e and visual suites run against (T57, ISC-17). `bun test web/e2e/stub-api.test.ts`.
//
// Two halves: the stub's own answers (states, golden bodies, ETag/304, 404/405/409, settings, reset), and a parity
// check that sends the same requests to the real `server/` handlers, fed the same golden models, and expects the same
// status, headers and bytes. The server modules are imported at runtime by a computed path, so the web/e2e tsconfig
// (which has no `allowImportingTsExtensions`) never type-checks the server tree; their shapes are declared here.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ClaimViewModel,
  DocsPage,
  LibraryCatalog,
  LibraryDocType,
  LiveFrame,
  MainCopy,
  SpecPageModel,
  SpecOverlap,
  SpecWait,
  SpecWarning,
  TasksTab,
  TimelineEntry,
  Worktree,
} from '../../core/src/files';
import {
  ACTORS_ALLOW,
  ACTORS_PATH,
  ACTORS_STATUSES,
  GOLDEN_FAMILY,
  JSON_ANSWER,
  type LibrarySearchResult,
  PROTOTYPE_ALLOW,
  PROTOTYPE_CSP,
  prototypeFolderOf,
  prototypeRoute,
  REVIEWED_HASHES_HEADER,
  type ReviewedHashes,
  SPEC_HASH_HEADER,
  SPEC_ROUTE_TABLE,
  type SpecRouteName,
  TASKS_HASH_HEADER,
  WORKSPACE_ROUTE_TABLE,
  allowFor,
  allowForWorkspace,
  evidenceFileHeaders,
  parseReviewedHashes,
  specRoutes,
  workspaceRoutes,
} from '../../server/src/spec-routes.contract';
import {
  BUMP_RUN_PATH,
  EDGES_HEADER,
  EDGE_STATES,
  EMPTY_CATALOG,
  LIBRARY_HEADER,
  LOCKS_HEADER,
  LOCK_STATES,
  MIDNIGHT_HEADER,
  MIDNIGHT_STATES,
  RESET_PATH,
  STUB_EDGES,
  STUB_LIBRARY,
  STUB_MIDNIGHT,
  STUB_MILESTONE,
  stubEvidencePath,
  stubOfflinePrototypeHtml,
  type LockState,
  SESSION_HEADER,
  STATE_HEADER,
  STUB_NOTES,
  STUB_NOW,
  STUB_STATES,
  type StubState,
  WRITE_HEADER,
  WORKSPACE_GOLDEN_FAMILY,
  WORKTREES_HEADER,
  WORKTREE_STATES,
  WRITE_OUTCOMES,
  recountTasks,
  stubApi,
  stubMergeState,
} from './stub-api';

/** sha256 of the empty text: the backlog hash of a tree without specs/backlog.md (spec 036). */
const EMPTY_SHA256 = new Bun.CryptoHasher('sha256').update('').digest('hex');
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

describe('stub API: GET /api/workspaces/:slug/planning', () => {
  // `GOLDEN_FAMILY.planning` is a whole-file family: the route's body is the golden file itself, not a per-spec key.
  const planningText = (tree: string): string => goldenText(`${tree}.${GOLDEN_FAMILY.planning}`);
  const planningPath = (slug: string): string => workspaceRoutes.planning(slug);

  test.each(['harbor', 'lantern'])('%s: the body is the whole planning golden in the server serialization', async (name) => {
    const res = await ask(planningPath(name));
    expect(res.status).toBe(200);
    const body = await res.text();
    // Plus the hash of specs/backlog.md the real route adds (spec 036): neither tree has the file, so the empty text's.
    expect(body).toBe(JSON.stringify({ ...(JSON.parse(planningText(name)) as object), backlogHash: EMPTY_SHA256 }));
    expect(res.headers.get('Content-Type')).toBe(JSON_ANSWER.contentType);
    expect(res.headers.get('Cache-Control')).toBe(JSON_ANSWER.cacheControl);
    expect(res.headers.get('ETag')).toBe(`"${new Bun.CryptoHasher('sha256').update(body).digest('base64url')}"`);
  });

  test('harbor carries features; lantern carries no milestone', async () => {
    const harbor = (await (await ask(planningPath('harbor'))).json()) as { features: unknown[] };
    expect(harbor.features.length).toBeGreaterThan(0);
    // In general a milestone row can hold no spec (0/0): an unnamed block entry of the master still lists. lantern's
    // master names no milestone and none of its specs carries one, so its list is empty and the Milestones view hides.
    const lantern = (await (await ask(planningPath('lantern'))).json()) as { milestones: unknown[] };
    expect(lantern.milestones).toEqual([]);
  });

  test('HEAD answers the headers without the body; a matching If-None-Match is a 304', async () => {
    const get = await ask(planningPath('harbor'));
    const etag = get.headers.get('ETag') ?? '';
    const head = await ask(planningPath('harbor'), { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('ETag')).toBe(etag);
    expect(await head.text()).toBe('');
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, '*']) {
      const res = await ask(planningPath('harbor'), { headers: { 'If-None-Match': header } });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe('');
    }
    expect((await ask(planningPath('harbor'), { headers: { 'If-None-Match': '"stale"' } })).status).toBe(200);
  });

  test('an unknown slug is 404 {error: "not-found"}, in every state', async () => {
    for (const state of STUB_STATES) {
      const res = await ask(planningPath('nope'), { state });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not-found' });
    }
    expect((await ask(planningPath('harbor'), { state: 'empty' })).status).toBe(404);
  });

  test('any method but GET or HEAD is 405 with allowForWorkspace', async () => {
    const res = await ask(planningPath('harbor'), { method: 'POST', body: '{}' });
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe(allowForWorkspace('planning'));
    expect(res.headers.get('Allow')).toBe('GET, HEAD');
    expect(await res.json()).toEqual({ error: 'method-not-allowed' });
  });

  test('the unreadable workspace is 409 with the same summary as its dashboard', async () => {
    const res = await ask(planningPath('lantern'), { state: 'unreadable' });
    expect(res.status).toBe(409);
    const dashboard = await ask('/api/workspaces/lantern/dashboard', { state: 'unreadable' });
    expect(await res.json()).toEqual(await dashboard.json());
    expect((await ask(planningPath('harbor'), { state: 'unreadable' })).status).toBe(200);
  });

  test('a foreign Host or a cross-site Origin is 403', async () => {
    const foreign = new Request(`${ORIGIN}${planningPath('harbor')}`, { headers: { Host: 'evil.example' } });
    expect((await call(api, foreign)).status).toBe(403);
    const crossSite = await ask(planningPath('harbor'), { headers: { Origin: 'https://evil.example' } });
    expect(crossSite.status).toBe(403);
    expect(await crossSite.json()).toEqual({ error: 'forbidden' });
  });
});

describe('stub API: GET /api/workspaces/:slug/library/asset?path= (spec 017; formerly …/tech/asset, spec 023 T10)', () => {
  const asset = (ws: string, path: string): string => workspaceRoutes.libraryAsset(ws, path);
  const bytesOf = (tree: string, path: string): Uint8Array<ArrayBuffer> => new Uint8Array(readFileSync(join(FIXTURES, tree, 'specs', path)));

  test('the image tech.md names: its bytes from the fixture tree with evidenceFileHeaders and a strong ETag; HEAD, 304', async () => {
    const res = await ask(asset('harbor', 'tech/overview.png'));
    const bytes = bytesOf('harbor', 'tech/overview.png');
    const etag = `"${new Bun.CryptoHasher('sha256').update(bytes).digest('base64url')}"`;
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    for (const [name, value] of Object.entries({ ...evidenceFileHeaders('image/png'), ETag: etag })) {
      expect({ name, value: res.headers.get(name) }).toEqual({ name, value });
    }
    const head = await ask(asset('harbor', 'tech/overview.png'), { method: 'HEAD' });
    expect([head.status, head.headers.get('ETag'), head.headers.get('Content-Type'), await head.text()]).toEqual([200, etag, 'image/png', '']);
    const revalidated = await ask(asset('harbor', 'tech/overview.png'), { headers: { 'If-None-Match': etag } });
    expect([revalidated.status, await revalidated.text()]).toEqual([304, '']);
  });

  test('a file under specs/ that is no image is refused, as api.ts serves images only', async () => {
    const res = await ask(asset('harbor', 'tech.md'));
    expect({ status: res.status, body: (await res.json()) as unknown }).toEqual({ status: 403, body: { error: 'forbidden' } });
  });

  test('403 for a .. segment, an absolute path, a backslash or a second encoding layer; 404 for no file', async () => {
    for (const path of ['../constitution.md', 'tech/../tech.md', '..', '/etc/hosts', 'tech\\overview.png', '%2e%2e/README.md', '']) {
      const res = await ask(asset('harbor', path));
      expect({ path, status: res.status, body: (await res.json()) as unknown }).toEqual({ path, status: 403, body: { error: 'forbidden' } });
    }
    for (const [ws, path] of [['harbor', 'tech/nothing.png'], ['harbor', 'tech'], ['lantern', 'tech/overview.png']] as const) {
      const res = await ask(asset(ws, path));
      expect({ ws, path, status: res.status, body: (await res.json()) as unknown }).toEqual({ ws, path, status: 404, body: { error: 'not-found' } });
    }
  });

  test('404 unknown slug, 405 with allowForWorkspace, 409 the unreadable summary, 403 cross-site', async () => {
    expect((await ask(asset('nope', 'tech/overview.png'))).status).toBe(404);
    expect((await ask(asset('harbor', 'tech/overview.png'), { state: 'empty' })).status).toBe(404);
    const put = await ask(asset('harbor', 'tech/overview.png'), { method: 'PUT', body: '{}' });
    expect([put.status, put.headers.get('Allow')]).toEqual([405, allowForWorkspace('libraryAsset')]);
    const unreadable = await ask(asset('lantern', 'tech/overview.png'), { state: 'unreadable' });
    const dashboard = await ask('/api/workspaces/lantern/dashboard', { state: 'unreadable' });
    expect([unreadable.status, await unreadable.text()]).toEqual([409, await dashboard.text()]);
    const crossSite = await ask(asset('harbor', 'tech/overview.png'), { headers: { Origin: 'https://evil.example' } });
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: 'forbidden' }]);
  });
});

describe('stub API: the library (spec 017, T3)', () => {
  const TYPES: readonly LibraryDocType[] = ['spec', 'plan', 'tasks', 'design', 'context', 'artifact', 'evidence', 'prototype', 'constitution', 'tech', 'tldr', 'idea'];
  const catalogOf = async (ws: string, init?: Parameters<typeof request>[1]): Promise<LibraryCatalog> =>
    (await (await ask(workspaceRoutes.library(ws), init)).json()) as LibraryCatalog;
  const proto = (file: string): string => prototypeRoute('harbor', '004-retention-policies', 'prototype/board', file);
  const BOARD = join(FIXTURES, 'library', 'specs', '002-tide-board', '.design', 'prototype', 'board');

  test('harbor: every document type, one stale and one missing entry, the counts match the docs', async () => {
    const res = await ask(workspaceRoutes.library('harbor'));
    expect([res.status, res.headers.get('Content-Type'), res.headers.get('Cache-Control')]).toEqual([200, JSON_ANSWER.contentType, JSON_ANSWER.cacheControl]);
    const catalog = (await res.json()) as LibraryCatalog;
    expect(new Set(catalog.docs.map((doc) => doc.type))).toEqual(new Set(TYPES));
    expect(catalog.docs.filter((doc) => doc.state === 'stale').map((doc) => doc.path)).toEqual([STUB_LIBRARY.stale]);
    const missing = catalog.docs.filter((doc) => doc.state === 'missing');
    expect(missing.map((doc) => [doc.path, doc.type, doc.modified])).toEqual([[STUB_LIBRARY.missing.path, STUB_LIBRARY.missing.type, null]]);
    // The stub's missing entry is exactly the one core's readCatalog reports for the fixture tree (ISC-155.2: only
    // plan.md and tasks.md are ever missing).
    // Loaded by a computed path, as the stub loads core, so `tsc -p web/e2e` never walks core's module graph.
    const { readCatalog } = createRequire(import.meta.url)(join(import.meta.dir, '..', '..', 'core', 'src', 'library.ts')) as {
      readCatalog: (root: string) => Promise<LibraryCatalog>;
    };
    const core = await readCatalog(join(FIXTURES, 'harbor'));
    expect(core.docs.filter((doc) => doc.state === 'missing').map((doc) => [doc.path, doc.type])).toEqual([[STUB_LIBRARY.missing.path, STUB_LIBRARY.missing.type]]);
    const at = catalog.docs.findIndex((doc) => doc.path === STUB_LIBRARY.missing.path);
    expect(catalog.docs[at - 1]?.path).toBe(STUB_LIBRARY.missing.after);
    expect([catalog.missing, catalog.stale]).toEqual([1, 1]);
    expect(catalog.docs.filter((doc) => doc.state !== 'missing').every((doc) => typeof doc.modified === 'string')).toBe(true);
    expect(new Set(catalog.docs.map((doc) => doc.path)).size).toBe(catalog.docs.length);
  });

  test('harbor: more than 50 evidence documents in one spec, and a prototype with two pages and a preview', async () => {
    const catalog = await catalogOf('harbor');
    const evidence = catalog.docs.filter((doc) => doc.type === 'evidence' && doc.spec === STUB_LIBRARY.evidence.spec);
    expect(evidence.length).toBe(STUB_LIBRARY.evidence.count + 1);
    expect(evidence.length).toBeGreaterThan(50);
    expect(evidence.map((doc) => doc.path)).toContain(stubEvidencePath(STUB_LIBRARY.evidence.count));
    const prototypes = catalog.docs.filter((doc) => doc.type === 'prototype');
    expect(prototypes.map((doc) => [doc.path, doc.spec, doc.media, doc.pages, doc.preview])).toEqual([
      [STUB_LIBRARY.prototype.path, '004-retention-policies', 'prototype', ['detail.html', 'index.html'], STUB_LIBRARY.prototype.preview],
    ]);
    expect(prototypes.map((doc) => prototypeFolderOf(doc))).toEqual(['prototype/board']);
    expect(catalog.docs.map((doc) => doc.path)).toContain(STUB_LIBRARY.prototype.preview);
  });

  test('group heads: one per active spec in number order, from the goldens; fog lines are the tech golden\'s', async () => {
    for (const ws of ['harbor', 'lantern']) {
      const catalog = await catalogOf(ws);
      const specs = Object.entries(family(ws, 'spec'))
        .filter(([key]) => !key.startsWith('specs/archive/'))
        .map(([, value]) => value as SpecPageModel);
      expect(catalog.groups.map((g) => g.spec)).toEqual(specs.map((s) => s.head.slug).sort());
      for (const group of catalog.groups) {
        const spec = specs.find((s) => s.head.slug === group.spec);
        expect(group).toMatchObject({
          type: spec?.head.type,
          stage: spec?.head.stage,
          claimsClosed: spec?.keyNumbers.claims.closed,
          claimsTotal: spec?.keyNumbers.claims.total,
          tasksDone: spec?.keyNumbers.tasks.landed,
          tasksTotal: spec?.keyNumbers.tasks.total,
        });
      }
      const tech = family(ws, 'tech') as { specs: Array<{ slug: string; fog: string[] }> };
      expect(catalog.fog).toEqual(tech.specs.flatMap((s) => s.fog.map((text) => ({ spec: s.slug, text }))));
      expect(catalog.groups.map((g) => g.fog)).toEqual(catalog.groups.map((g) => tech.specs.find((s) => s.slug === g.spec)?.fog.length ?? 0));
    }
    const harbor = await catalogOf('harbor');
    expect(harbor.fog.length).toBeGreaterThan(0);
    const web = harbor.groups.find((g) => g.spec === '002-web-console');
    expect(web?.goal).toStartWith('A teammate opens the console');
    expect(web?.approach).toStartWith('Serve a static Angular build');
  });

  test('deterministic: two stubs answer the same bytes and tags; HEAD and 304', async () => {
    const other = stubApi();
    for (const ws of ['harbor', 'lantern']) {
      const a = await ask(workspaceRoutes.library(ws));
      const b = await call(other, request(workspaceRoutes.library(ws)));
      expect([b.status, b.headers.get('ETag'), await b.text()]).toEqual([a.status, a.headers.get('ETag'), await a.text()]);
    }
    const etag = (await ask(workspaceRoutes.library('harbor'))).headers.get('ETag') ?? '';
    const head = await ask(workspaceRoutes.library('harbor'), { method: 'HEAD' });
    expect([head.status, head.headers.get('ETag'), await head.text()]).toEqual([200, etag, '']);
    expect((await ask(workspaceRoutes.library('harbor'), { headers: { 'If-None-Match': etag } })).status).toBe(304);
  });

  test('X-Spectant-Stub-Library: empty is a workspace without documents; an unknown value is a 400', async () => {
    expect(await catalogOf('harbor', { headers: { [LIBRARY_HEADER]: 'empty' } })).toEqual(EMPTY_CATALOG);
    const search = await ask(workspaceRoutes.librarySearch('harbor', 'console'), { headers: { [LIBRARY_HEADER]: 'empty' } });
    expect(await search.json()).toEqual({ query: 'console', hits: [] });
    expect((await ask(workspaceRoutes.libraryDoc('harbor', '002-web-console/plan.md'), { headers: { [LIBRARY_HEADER]: 'empty' } })).status).toBe(404);
    expect((await ask(proto('index.html'), { headers: { [LIBRARY_HEADER]: 'empty' } })).status).toBe(404);
    const unknown = await ask(workspaceRoutes.library('harbor'), { headers: { [LIBRARY_HEADER]: 'nope' } });
    expect([unknown.status, ((await unknown.json()) as { error: string }).error]).toEqual([400, 'unknown-stub-library']);
  });

  test('the workspace guards: 404 unknown or in the empty state, 409 unreadable, 405, 403 cross-site', async () => {
    for (const path of [workspaceRoutes.library('nope'), workspaceRoutes.libraryDoc('nope', 'tech.md'), workspaceRoutes.librarySearch('nope', 'x')]) {
      expect((await ask(path)).status).toBe(404);
    }
    expect((await ask(workspaceRoutes.library('harbor'), { state: 'empty' })).status).toBe(404);
    const unreadable = await ask(workspaceRoutes.library('lantern'), { state: 'unreadable' });
    const dashboard = await ask('/api/workspaces/lantern/dashboard', { state: 'unreadable' });
    expect([unreadable.status, await unreadable.text()]).toEqual([409, await dashboard.text()]);
    const post = await ask(workspaceRoutes.librarySearch('harbor', 'x'), { method: 'POST', body: '{}' });
    expect([post.status, post.headers.get('Allow')]).toEqual([405, allowForWorkspace('librarySearch')]);
    const crossSite = await ask(workspaceRoutes.library('harbor'), { headers: { Origin: 'https://evil.example' } });
    expect([crossSite.status, await crossSite.json()]).toEqual([403, { error: 'forbidden' }]);
  });

  test('libraryDoc: a Markdown document of the catalog as a Docs page; 404 for anything the catalog does not list as one', async () => {
    const plan = await ask(workspaceRoutes.libraryDoc('harbor', '002-web-console/plan.md'));
    expect(plan.status).toBe(200);
    expect(((await plan.json()) as DocsPage).html).toContain('Serve a static Angular build');
    const run = (await (await ask(workspaceRoutes.libraryDoc('harbor', stubEvidencePath(7)))).json()) as DocsPage;
    expect(run.html).toContain('Probe run 07');
    const tech = await ask(workspaceRoutes.libraryDoc('harbor', 'tech.md'));
    expect(tech.status).toBe(200);
    for (const path of [STUB_LIBRARY.missing.path, STUB_LIBRARY.prototype.path, STUB_LIBRARY.prototype.preview, 'workflow.md', '../README.md', '%E0%A4%A', '']) {
      const res = await ask(workspaceRoutes.libraryDoc('harbor', path));
      expect({ path, status: res.status, body: (await res.json()) as unknown }).toEqual({ path, status: 404, body: { error: 'not-found' } });
    }
  });

  test('libraryDoc: the reader document carries a TOC, a mermaid figure, a relative .evidence/ image and catalog cross references (T35)', async () => {
    const { reader } = STUB_LIBRARY;
    const catalog = await catalogOf('harbor');
    const entry = catalog.docs.find((doc) => doc.path === reader.path);
    // The catalog entry stays core's: the same title as the file's first heading, an artifact, Markdown.
    expect([entry?.type, entry?.media, entry?.state, entry?.title]).toEqual(['artifact', 'markdown', 'ok', 'T18 — e2e report']);
    const page = (await (await ask(workspaceRoutes.libraryDoc('harbor', reader.path))).json()) as DocsPage;
    expect(page.html).toContain('T18 — e2e report');
    expect(page.toc.map((entry) => [entry.level, entry.text])).toEqual([
      [2, 'Reading path'],
      [2, 'Captured band'],
      [2, 'Related records'],
    ]);
    expect(page.figures.map((figure) => figure.kind)).toEqual(['mermaid', 'image']);
    expect(page.html).toContain('<img src="../.evidence/kpi-band-390.png"');
    expect(page.html).toContain('href="T13-routes.md"');
    expect(page.html).toContain('href="../plan.md"');
    // Every cross reference names a catalog document, and the image is a fixture file the asset route serves.
    for (const xref of reader.xrefs) expect(catalog.docs.find((doc) => doc.path === xref)?.media).toBe('markdown');
    const image = await ask(workspaceRoutes.libraryAsset('harbor', reader.image));
    expect([image.status, image.headers.get('Content-Type')]).toEqual([200, 'image/png']);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array(readFileSync(join(FIXTURES, 'harbor', 'specs', reader.image))));
    // The two words the e2e search group relies on stay out of the appendix.
    expect(reader.appendix.toLowerCase()).not.toMatch(/quota|manifest/u);
  });

  test('librarySearch: the trimmed query and its hits in catalog order with a plain-text snippet; blank is no hit', async () => {
    for (const q of ['', '   ']) {
      expect(await (await ask(workspaceRoutes.librarySearch('harbor', q))).json()).toEqual({ query: '', hits: [] });
    }
    expect(await (await ask('/api/workspaces/harbor/library/search')).json()).toEqual({ query: '', hits: [] });
    const result = (await (await ask(workspaceRoutes.librarySearch('harbor', '  RETENTION  '))).json()) as LibrarySearchResult;
    expect(result.query).toBe('RETENTION');
    expect(result.hits.length).toBeGreaterThan(0);
    const order = (await catalogOf('harbor')).docs.map((doc) => doc.path);
    const positions = result.hits.map((hit) => order.indexOf(hit.path));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    for (const hit of result.hits) {
      expect(hit.snippet.toLowerCase()).toContain('retention');
      expect(hit.snippet).not.toMatch(/<[a-z]/);
    }
    const runs = (await (await ask(workspaceRoutes.librarySearch('harbor', 'probe run 42'))).json()) as LibrarySearchResult;
    expect(runs.hits.map((hit) => hit.path)).toEqual([stubEvidencePath(42)]);
    expect(((await (await ask(workspaceRoutes.librarySearch('harbor', 'zzz-nothing'))).json()) as LibrarySearchResult).hits).toEqual([]);
  });

  test('libraryAsset: the prototype preview as image bytes, with the tech asset\'s headers', async () => {
    const res = await ask(workspaceRoutes.libraryAsset('harbor', STUB_LIBRARY.prototype.preview));
    expect([res.status, res.headers.get('Content-Type')]).toEqual([200, 'image/png']);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array(readFileSync(join(FIXTURES, 'harbor', 'specs', STUB_LIBRARY.prototype.preview))));
    expect((await ask(workspaceRoutes.libraryAsset('harbor', 'tech.md'))).status).toBe(403);
  });

  test('prototype: every page and its local files with PROTOTYPE_CSP, inline; 304; HEAD', async () => {
    const catalog = await catalogOf('harbor');
    const doc = catalog.docs.find((d) => d.type === 'prototype');
    for (const page of doc?.pages ?? []) {
      const res = await ask(proto(page));
      expect([res.status, res.headers.get('Content-Type'), res.headers.get('Content-Security-Policy'), res.headers.get('Content-Disposition')]).toEqual([
        200,
        'text/html; charset=utf-8',
        PROTOTYPE_CSP,
        'inline',
      ]);
      expect(await res.text()).toBe(readFileSync(join(BOARD, page), 'utf8'));
    }
    const files: ReadonlyArray<readonly [string, string]> = [
      ['styles.css', 'text/css; charset=utf-8'],
      ['app.js', 'text/javascript; charset=utf-8'],
      ['img/badge.png', 'image/png'],
    ];
    for (const [file, type] of files) {
      const res = await ask(proto(file));
      expect({ file, status: res.status, type: res.headers.get('Content-Type') }).toEqual({ file, status: 200, type });
    }
    const etag = (await ask(proto('index.html'))).headers.get('ETag') ?? '';
    const revalidated = await ask(proto('index.html'), { headers: { 'If-None-Match': etag } });
    expect([revalidated.status, revalidated.headers.get('Content-Security-Policy')]).toEqual([304, PROTOTYPE_CSP]);
    const head = await ask(proto('index.html'), { method: 'HEAD' });
    expect([head.status, await head.text()]).toEqual([200, '']);
  });

  test('prototype: refusals and misses carry the CSP too: 403, 404, 405, 409', async () => {
    const cases: Array<[string, Parameters<typeof request>[1], number]> = [
      ['/proto/harbor/004-retention-policies/prototype%2Fboard/..%2F..%2Fspec.md', {}, 403],
      ['/proto/harbor/004-retention-policies/prototype%2Fboard/%252e%252e/x', {}, 403],
      [proto('index.html'), { headers: { Origin: 'https://evil.example' } }, 403],
      [proto('nothing.html'), {}, 404],
      [prototypeRoute('harbor', '004-retention-policies', 'prototype', 'index.html'), {}, 404],
      [prototypeRoute('harbor', '002-web-console', 'prototype/board', 'index.html'), {}, 404],
      [prototypeRoute('nope', '004-retention-policies', 'prototype/board', 'index.html'), {}, 404],
      ['/proto/harbor/004-retention-policies/design/index.html', {}, 404],
      ['/proto/harbor', {}, 404],
      [proto('index.html'), { state: 'empty' }, 404],
      [proto('index.html'), { method: 'POST', body: '{}' }, 405],
      [prototypeRoute('lantern', '001-reading-list', 'prototype', 'index.html'), { state: 'unreadable' }, 409],
    ];
    for (const [path, init, status] of cases) {
      const res = await ask(path, init);
      expect({ path, status: res.status, csp: res.headers.get('Content-Security-Policy') }).toEqual({ path, status, csp: PROTOTYPE_CSP });
      if (status === 405) expect(res.headers.get('Allow')).toBe(PROTOTYPE_ALLOW);
    }
  });

  test('prototype: the stub-only offline page (T40) names its external resources, carries the CSP and is no catalog page', async () => {
    const { offline } = STUB_LIBRARY.prototype;
    const res = await ask(proto(offline.file));
    expect([res.status, res.headers.get('Content-Type'), res.headers.get('Content-Security-Policy')]).toEqual([200, 'text/html; charset=utf-8', PROTOTYPE_CSP]);
    const html = await res.text();
    expect(html).toBe(stubOfflinePrototypeHtml());
    for (const url of Object.values(offline.external)) {
      expect(html).toContain(url);
      expect(new URL(url).hostname).toEndWith('.example');
    }
    const catalog = await catalogOf('harbor');
    expect(catalog.docs.find((d) => d.type === 'prototype')?.pages).not.toContain(offline.file);
    expect((await ask(prototypeRoute('harbor', '004-retention-policies', 'prototype', offline.file))).status).toBe(404);
  });

  test('prototype fonts: Origin null gets a font with ACAO *, a foreign Origin 403, Origin null 403 for anything else', async () => {
    // A copy of the fixtures with one font in the board, so the committed tree stays as it is.
    const dir = mkdtempSync(join(tmpdir(), 'spectant-stub-fonts-'));
    try {
      cpSync(FIXTURES, dir, { recursive: true });
      const fonts = join(dir, 'library', 'specs', '002-tide-board', '.design', 'prototype', 'board', 'fonts');
      mkdirSync(fonts, { recursive: true });
      writeFileSync(join(fonts, 'tide.woff2'), new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
      const withFont = stubApi({ fixturesDir: dir });
      const send = (file: string, origin: string): Promise<Response> => call(withFont, request(proto(file), { headers: { Origin: origin } }));

      const font = await send('fonts/tide.woff2', 'null');
      expect([font.status, font.headers.get('Content-Type'), font.headers.get('Access-Control-Allow-Origin'), font.headers.get('Vary')]).toEqual([200, 'font/woff2', '*', 'Origin']);
      expect([font.headers.get('Content-Security-Policy'), font.headers.get('X-Content-Type-Options')]).toEqual([PROTOTYPE_CSP, 'nosniff']);

      const answers: ReadonlyArray<readonly [string, string]> = [
        ['fonts/tide.woff2', 'https://evil.example'],
        ['index.html', 'null'],
        ['styles.css', 'null'],
        ['app.js', 'null'],
        ['fonts/missing.woff2', 'null'],
      ];
      for (const [file, origin] of answers) {
        const res = await send(file, origin);
        expect({ file, origin, status: res.status, acao: res.headers.get('Access-Control-Allow-Origin') }).toEqual({ file, origin, status: 403, acao: null });
        expect([res.headers.get('Content-Security-Policy'), res.headers.get('X-Content-Type-Options')]).toEqual([PROTOTYPE_CSP, 'nosniff']);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('stub API: /api/settings', () => {
  const DEFAULTS = { theme: 'system', language: 'en', refreshSeconds: 30, singleKeyShortcuts: true, railCollapsed: false, notesImportDismissed: false };
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
      if (entry.method !== 'GET' || entry.route === 'evidenceFile') continue;
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
      const res = await ask(`${specRoutes.evidenceFile(WS, '002', '').replace(/\?.*$/, '')}?path=${raw}`);
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

  // Who works a task (T149, ISC-131.1): each fixture's in-flight cards name their agent and sub-agent as core's live.ts
  // does (`workersOf`), so the board and the tasks tab render the chips from the stub as from the server.
  const workers = (frame: LiveFrame): Array<[string, string | null, string | null, boolean | undefined]> =>
    frame.cards.filter((c) => c.agent !== null || c.subagent !== null).map((c) => [c.task, c.agent?.raw ?? null, c.subagent?.raw ?? null, c.stale]);

  test('workers: activity names a:claude:sess-2 on T27 (stale), frontier adds its own agent on T28 (fresh), none names nobody', async () => {
    expect(workers(await live('activity'))).toEqual([['T27', 'a:claude:sess-2', null, true]]);
    expect(workers(await live('frontier'))).toEqual([
      ['T27', 'a:claude:sess-2', null, true],
      ['T28', 'a:claude:stub-002-isc-75', null, false],
    ]);
    expect(workers(await live('none'))).toEqual([]);
  });

  test("claims: harbor's claim lines without their releases; T4 by the sub-agent a:claude:sess-2/T4 under its parent", async () => {
    const frame = await live('claims');
    expect(frame.lockSource).toBe('activity');
    expect(frame.locks.map((l) => [l.claim, l.session, l.since])).toEqual([
      ['ISC-53', 'a:claude:sess-2/T4', '2026-03-06T09:12:00Z'],
      ['ISC-72', 'a:claude:sess-2', '2026-03-08T14:05:00Z'],
      ['ISC-74', 'a:claude:sess-2', '2026-03-08T14:06:00Z'],
    ]);
    // As core/tests/live.test.ts re-opens T4 and T25, all three claims' cards are in flight, every lock stale at STUB_NOW.
    expect(frame.cards.filter((c) => c.state === 'running').map((c) => c.task)).toEqual(['T4', 'T25', 'T27']);
    expect(workers(frame)).toEqual([
      ['T4', 'a:claude:sess-2', 'a:claude:sess-2/T4', true],
      ['T25', 'a:claude:sess-2', null, true],
      ['T27', 'a:claude:sess-2', null, true],
    ]);
    const t4 = frame.cards.find((c) => c.task === 'T4');
    expect(t4?.subagent).toEqual({ raw: 'a:claude:sess-2/T4', kind: 'subagent', id: 'a:claude:sess-2', task: 'T4', legacy: false });
    expect(t4?.elapsedMs).toBe(Date.parse(STUB_NOW) - Date.parse('2026-03-06T09:12:00Z'));
    expect(frame.agents.map((a) => [a.session, a.claims])).toEqual([
      ['a:claude:sess-2/T4', ['ISC-53']],
      ['a:claude:sess-2', ['ISC-72', 'ISC-74']],
    ]);
    const spec = (await (await ask(specRoutes.spec(WS, '002'), { headers: { [LOCKS_HEADER]: 'claims' } })).json()) as SpecPageModel;
    expect(spec.areas.live.agentsWorking).toBe(2);
    expect(await lifeos('claims')).toEqual({ present: false });
    // The log names only spec 002's claims: every other spec stays as its golden.
    expect(workers(await live('claims', WS, '004'))).toEqual([]);
  });

  test('person: the golden lock held by the person u:3f9c0a7d; T27 runs, agent and sub-agent null', async () => {
    const frame = await live('person');
    expect(frame.locks.map((l) => [l.claim, l.session, l.actor.kind])).toEqual([['ISC-74', 'u:3f9c0a7d', 'person']]);
    const t27 = frame.cards.find((c) => c.task === 'T27');
    expect(t27).toMatchObject({ state: 'running', lock: { source: 'activity', session: 'u:3f9c0a7d' }, agent: null, subagent: null });
    expect(workers(frame)).toEqual([]);
    expect(frame.agents.map((a) => a.session)).toEqual(['u:3f9c0a7d']);
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
    expect(await locked.json()).toEqual({ error: 'locked', lock: { source: 'frontier', claim: 'ISC-74', session: 'a:claude:sess-2', actor: { raw: 'a:claude:sess-2', kind: 'agent', id: 'a:claude:sess-2', legacy: false }, since: '2026-03-08T14:06:00Z' } });
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
      ...SPEC_ROUTE_TABLE.filter((e) => e.method === 'GET' && e.route !== 'evidenceFile').map((e) =>
        (specRoutes[e.route] as (ws: string, id: string) => string)(WS, '002'),
      ),
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
    today: () => string;
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

  // The dashboard routes take their model from `loadWorkspace` below; the planning route reads the files itself, so a
  // readable workspace points at its real fixture tree and the unreadable one at a directory that does not exist (the
  // server's `missing`, the stub's unreadable summary). The last segment, `pathTail`, is the fixture name either way.
  const registered = (names: string[], unreadable: string | null): ServerWorkspace[] =>
    names.map((name, position) => ({
      slug: name,
      path: name === unreadable ? join(FIXTURES, 'no-such-dir', name) : join(FIXTURES, name),
      name,
      addedAt: '2026-03-01T00:00:00Z',
      position,
    }));
  const realFor = (names: string[], unreadable: string | null): Handler => {
    const workspaces = registered(names, unreadable);
    return apiModule.dashboardApi({
      // The day the planning goldens are built at (core/tests/helpers/planning-model.ts `PLANNING_NOW`).
      today: () => '2026-03-20',
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

  test.each([...STUB_STATES])('every GET route of WORKSPACE_ROUTE_TABLE, state %s', async (state) => {
    const handler = real?.[state];
    if (!handler) throw new Error('real handlers not loaded');
    // The route with a golden family (`planning`) is compared here, whole file to whole body. The story route,
    // the board query and the allocation (T119) have no family; their parity runs in "stub API board seam matches the real
    // handlers". The tech page's routes went with spec 017 T51.
    // The library routes (spec 017) have no golden and no server handler yet (`LIBRARY_AWAITING_HANDLER` in api.ts);
    // their answers are pinned in "stub API: the library".
    expect(WORKSPACE_ROUTE_TABLE.map((entry) => entry.route)).toEqual([
      'planning',
      'idea',
      'boardQuery',
      'allocate',
      'backlog',
      'library',
      'libraryDoc',
      'librarySearch',
      'libraryAsset',
    ]);
    const golden = WORKSPACE_ROUTE_TABLE.filter((entry) => entry.route in WORKSPACE_GOLDEN_FAMILY);
    expect(golden.map((entry) => entry.route)).toEqual(['planning']);
    for (const entry of golden) {
      const build = workspaceRoutes.planning;
      const cases: Array<[string, RequestInit]> = [
        [build('harbor'), {}],
        [build('lantern'), {}],
        [build('harbor'), { method: 'HEAD' }],
        [build('nope'), {}],
        [`/api/workspaces/%E0%A4%A/${entry.route}`, {}],
        [build('harbor'), { method: 'POST', body: '{}' }],
        [build('harbor'), { headers: { Origin: 'https://evil.example' } }],
      ];
      for (const [path, init] of cases) {
        const stubbed = await snapshot(await call(api, request(path, { ...init, state })));
        // `dashboardApi` declines a slug that does not decode (`matchWorkspacePath` is null); the server then answers its
        // JSON 404 (`server/src/http.ts`), which is what the stub's catch-all sends.
        const req = request(path, init);
        const declined = Response.json({ error: 'not found' }, { status: 404 });
        const served = await snapshot((await handler(req, new URL(req.url))) ?? declined);
        expect({ path, method: init.method ?? 'GET', answer: stubbed }).toEqual({ path, method: init.method ?? 'GET', answer: served });
        const etag = (served[1] as Array<string | null>)[2];
        if (served[0] === 200 && etag) {
          const revalidate = { ...init, headers: { 'If-None-Match': etag } };
          expect((await call(api, request(path, { ...revalidate, state }))).status).toBe(304);
        }
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

describe('stub API: the notes routes (T100, ISC-95)', () => {
  const NOTES = '/api/workspaces/harbor/notes';
  const send = (path: string, method: string, body: unknown, session: string): Promise<Response> =>
    ask(path, { method, body: JSON.stringify(body), session, headers: { 'Content-Type': 'application/json' } });

  test('every session starts with the three harbor 002 notes, one per anchor kind, newest first', async () => {
    const res = await ask(NOTES, { session: 'notes-seed' });
    expect(res.status).toBe(200);
    const notes = (await res.json()) as Array<{ anchor: { kind: string } | null; updated: string }>;
    expect(notes).toEqual(JSON.parse(JSON.stringify(STUB_NOTES)) as typeof notes);
    expect(notes.map((n) => n.anchor?.kind).sort()).toEqual(['claim', 'spec', 'task']);
    expect(notes.map((n) => n.updated)).toEqual([...notes.map((n) => n.updated)].sort().reverse());
    expect(await (await ask('/api/workspaces/lantern/notes', { session: 'notes-seed' })).json()).toEqual([]);
  });

  test('the list query filters as the server does; a bad query is 400 invalid-query', async () => {
    const count = async (query: string): Promise<number> =>
      ((await (await ask(`${NOTES}${query}`, { session: 'notes-query' })).json()) as unknown[]).length;
    expect(await count('?spec=002')).toBe(3);
    expect(await count('?spec=002&claim=ISC-51')).toBe(1);
    expect(await count('?spec=002&task=T1')).toBe(1);
    expect(await count('?spec=003')).toBe(0);
    expect(await count('?unanchored=1')).toBe(0);
    const bad = await ask(`${NOTES}?claim=ISC-51`, { session: 'notes-query' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid-query' });
  });

  test('note-counts answers NoteCounts of the spec', async () => {
    const res = await ask('/api/workspaces/harbor/note-counts?spec=002', { session: 'notes-counts' });
    expect(await res.json()).toEqual({ spec: '002', total: 3, onSpec: 1, claims: { 'ISC-51': 1 }, tasks: { T1: 1 } });
  });

  test('POST 201, PUT replaces the draft whole, DELETE 204; each write is stamped deterministically', async () => {
    const session = 'notes-writes';
    const created = await send(NOTES, 'POST', { body: 'first' }, session);
    expect(created.status).toBe(201);
    const note = (await created.json()) as { id: string; created: string };
    expect(note).toMatchObject({ workspace: 'harbor', anchor: null, title: '', body: 'first', created: '2026-03-08T15:01:00.000Z' });
    const anchor = { kind: 'claim', spec: '002', id: 'ISC-52' };
    const updated = await send(`${NOTES}/${note.id}`, 'PUT', { title: '  Kept  ', body: 'second', anchor }, session);
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ id: note.id, title: 'Kept', body: 'second', anchor, created: note.created, updated: '2026-03-08T15:02:00.000Z' });
    const list = (await (await ask(NOTES, { session })).json()) as Array<{ id: string }>;
    expect(list[0]?.id).toBe(note.id);
    expect(list).toHaveLength(4);
    const removed = await ask(`${NOTES}/${note.id}`, { method: 'DELETE', session });
    expect(removed.status).toBe(204);
    expect(removed.headers.get('Cache-Control')).toBe('no-store');
    expect(await removed.text()).toBe('');
    expect((await ask(`${NOTES}/${note.id}`, { method: 'DELETE', session })).status).toBe(404);
  });

  test('validation mirrors the contract: empty body, two anchors, unknown note or workspace, 405 with Allow, 403', async () => {
    const session = 'notes-validation';
    const cases: Array<[unknown, string]> = [
      [{ body: '   ' }, 'empty-body'],
      [{ body: 'x', anchors: [] }, 'multiple-anchors'],
      [{ body: 'x', anchor: { kind: 'claim', spec: '2' } }, 'invalid-anchor'],
      [{ body: 'x', extra: 1 }, 'invalid-body'],
    ];
    for (const [body, error] of cases) {
      const res = await send(NOTES, 'POST', body, session);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
    }
    expect((await send(`${NOTES}/00000000-0000-4000-8000-00000000abcd`, 'PUT', { body: 'x' }, session)).status).toBe(404);
    expect((await ask('/api/workspaces/nowhere/notes', { session })).status).toBe(404);
    const wrong = await ask(`${NOTES}/${STUB_NOTES[0]?.id ?? ''}`, { session });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('PUT, DELETE');
    expect((await ask(NOTES, { session, headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  test('sessions are isolated and POST /api/__stub/reset restores the seed', async () => {
    await send(NOTES, 'POST', { body: 'mine' }, 'notes-a');
    expect(((await (await ask(NOTES, { session: 'notes-b' })).json()) as unknown[]).length).toBe(3);
    expect(((await (await ask(NOTES, { session: 'notes-a' })).json()) as unknown[]).length).toBe(4);
    expect((await ask('/api/__stub/reset', { method: 'POST', session: 'notes-a' })).status).toBe(204);
    expect(((await (await ask(NOTES, { session: 'notes-a' })).json()) as unknown[]).length).toBe(3);
  });
});

describe('POST /api/__stub/bump (T68)', () => {
  const HARBOR = '/api/workspaces/harbor/dashboard';
  const LANTERN = '/api/workspaces/lantern/dashboard';
  type Kpis = { kpis: { claims: { closed: number } } };
  const closedOf = async (res: Response): Promise<number> => ((await res.json()) as Kpis).kpis.claims.closed;

  test('raises that session’s claims closed by one with a new ETag, and leaves other sessions and workspaces alone', async () => {
    const before = await ask(HARBOR, { session: 'bump-a' });
    const etag = before.headers.get('ETag') ?? '';
    const closed = await closedOf(before);
    const lantern = await closedOf(await ask(LANTERN, { session: 'bump-a' }));

    expect((await ask('/api/__stub/bump?ws=harbor', { method: 'POST', session: 'bump-a' })).status).toBe(204);

    const after = await ask(HARBOR, { session: 'bump-a', headers: { 'If-None-Match': etag } });
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
    expect(await closedOf(after)).toBe(closed + 1);
    expect(await closedOf(await ask(HARBOR, { session: 'bump-b' }))).toBe(closed);
    expect(await closedOf(await ask(LANTERN, { session: 'bump-a' }))).toBe(lantern);

    expect((await ask('/api/__stub/reset', { method: 'POST', session: 'bump-a' })).status).toBe(204);
    expect(await closedOf(await ask(HARBOR, { session: 'bump-a' }))).toBe(closed);
  });

  test('answers 405 for another method and 404 for a workspace the stub does not hold', async () => {
    const wrong = await ask('/api/__stub/bump?ws=harbor');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('POST');
    expect((await ask('/api/__stub/bump?ws=nowhere', { method: 'POST' })).status).toBe(404);
    expect((await ask('/api/__stub/bump', { method: 'POST' })).status).toBe(404);
  });
});

describe('PUT /api/__stub/workflow (T151)', () => {
  const PLANNING = '/api/workspaces/harbor/planning';
  const HARBOR_FEATURE = ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'];
  type Tree = { workflow: { source: string; rows: Array<{ type: string; stages: string[] }> } };
  const featureOf = async (res: Response): Promise<string[]> =>
    ((await res.json()) as Tree).workflow.rows.find((row) => row.type === 'feature')?.stages ?? [];
  const TABLE = [
    '| type | stages | code_review |',
    '|------|--------|-------------|',
    '| feature | plan · review · build · code-review · close · done | spec |',
  ].join('\n');

  test('serves that session’s planning tree with the workflow core parses from the text sent, until a reset', async () => {
    const before = await ask(PLANNING, { session: 'wf-a' });
    const etag = before.headers.get('ETag') ?? '';
    expect(await featureOf(before)).toEqual(HARBOR_FEATURE);

    expect((await ask('/api/__stub/workflow?ws=harbor', { method: 'PUT', session: 'wf-a', body: TABLE })).status).toBe(204);

    const after = await ask(PLANNING, { session: 'wf-a', headers: { 'If-None-Match': etag } });
    expect(after.status).toBe(200);
    expect(after.headers.get('ETag')).not.toBe(etag);
    const tree = (await after.json()) as Tree;
    expect(tree.workflow.source).toBe('file');
    expect(tree.workflow.rows.find((row) => row.type === 'feature')?.stages).toEqual(['plan', 'review', 'build', 'code-review', 'close', 'done']);
    // The types the text leaves out run core's default row, as the real reader does.
    expect(tree.workflow.rows).toHaveLength(7);

    expect(await featureOf(await ask(PLANNING, { session: 'wf-b' }))).toEqual(HARBOR_FEATURE);
    expect(((await (await ask('/api/workspaces/lantern/planning', { session: 'wf-a' })).json()) as Tree).workflow.source).toBe('default');

    expect((await ask('/api/__stub/reset', { method: 'POST', session: 'wf-a' })).status).toBe(204);
    expect(await featureOf(await ask(PLANNING, { session: 'wf-a' }))).toEqual(HARBOR_FEATURE);
  });

  test('answers 405 for another method and 404 for a workspace the stub does not hold', async () => {
    const wrong = await ask('/api/__stub/workflow?ws=harbor');
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('Allow')).toBe('PUT');
    expect((await ask('/api/__stub/workflow?ws=nowhere', { method: 'PUT', body: TABLE })).status).toBe(404);
    expect((await ask('/api/__stub/workflow', { method: 'PUT', body: TABLE })).status).toBe(404);
  });
});

// ---- the Stage-3 board seam (T119, ISC-129) -----------------------------------------------------------------------

type BoardHolder = { id: string; slug: string; stage: string | null; stageSource: string | null; hash: string | null; main: boolean; held: number };
type BoardTree = {
  stageCounts: Record<string, number>;
  ideas: Array<{ slug: string; path: string }>;
  features: Array<{ id: string; holders: BoardHolder[]; ideas: Array<{ slug: string }> }>;
  milestones: Array<{ name: string; specs: BoardHolder[]; ideas: Array<{ slug: string }> }>;
};
const NO_LOCKS = { [LOCKS_HEADER]: 'none' };
const boardTree = async (session: string): Promise<BoardTree> =>
  (await (await ask(workspaceRoutes.planning(WS), { session })).json()) as BoardTree;
const holderIn = (tree: BoardTree, slug: string): BoardHolder | undefined => tree.features.flatMap((f) => f.holders).find((h) => h.slug === slug);
const storyHash = (slug: string): string =>
  new Bun.CryptoHasher('sha256').update(readFileSync(join(FIXTURES, WS, 'specs', 'ideas', `${slug}.md`))).digest('hex');
const move = (id: string, body: unknown, init: Parameters<typeof request>[1] = {}): Promise<Response> =>
  postJson(specRoutes.transition(WS, id), body, init);
const allocate = (slug: string, body: unknown, init: Parameters<typeof request>[1] = {}): Promise<Response> =>
  postJson(workspaceRoutes.allocate(WS, slug), body, init);
const RESET = '/api/__stub/reset';

describe('stub API: the Stage-3 board seam (T119)', () => {
  test('the planning tree is the extended golden: workflow, stages, stageCounts, ideas, per holder stage, source, priority, hash, assignee', async () => {
    const tree = (await (await ask(workspaceRoutes.planning(WS))).json()) as Record<string, unknown>;
    expect(Object.keys(tree)).toEqual(['workflow', 'stages', 'stageCounts', 'features', 'milestones', 'unassignedFeatures', 'ideas', 'recount', 'diagnostics', 'relations', 'backlogHash']);
    const first = (tree as unknown as BoardTree).features.flatMap((f) => f.holders)[0] ?? {};
    for (const key of ['stage', 'stageSource', 'priority', 'hash', 'assignee']) expect(Object.keys(first)).toContain(key);
  });

  test('the spec page carries X-Spectant-Spec-Hash: the planning holder hash, the raw sha256 of spec.md', async () => {
    const raw = new Bun.CryptoHasher('sha256').update(readFileSync(join(FIXTURES, WS, 'specs', '006-partial-push', 'spec.md'))).digest('hex');
    expect((await ask(specRoutes.spec(WS, '006'))).headers.get(SPEC_HASH_HEADER)).toBe(raw);
    expect(holderIn(await boardTree(''), '006-partial-push')?.hash).toBe(raw);
  });

  test('transition 200: the card moves in the session tree (stage, explicit source, new hash, stageCounts); others keep the golden', async () => {
    const session = 't119-move';
    const before = await boardTree(session);
    const from = holderIn(before, '006-partial-push');
    const res = await move('006', { to: 'build', hash: from?.hash }, { session, headers: NO_LOCKS });
    expect(res.status).toBe(200);
    const answer = (await res.json()) as { hash: string };
    expect(answer as unknown).toEqual({
      from: 'review',
      to: 'build',
      hash: answer.hash,
      event: { ts: '2026-03-08T15:00:00.000Z', from: 'review', to: 'build', command: '/spec-review 006', actor: 'a:spectant:app' },
      lockSource: 'none',
    });
    expect(HEX64.test(answer.hash) && answer.hash !== from?.hash).toBe(true);
    const after = await boardTree(session);
    expect(holderIn(after, '006-partial-push')).toMatchObject({ stage: 'build', stageSource: 'explicit', hash: answer.hash });
    expect([after.stageCounts['review'], after.stageCounts['build']]).toEqual([(before.stageCounts['review'] ?? 0) - 1, (before.stageCounts['build'] ?? 0) + 1]);
    const page = await ask(specRoutes.spec(WS, '006'), { session });
    expect(page.headers.get(SPEC_HASH_HEADER)).toBe(answer.hash);
    expect(((await page.json()) as SpecPageModel).head).toMatchObject({ stage: 'build', stageSource: 'explicit' });
    expect(await (await ask(workspaceRoutes.planning(WS), { session: 't119-other' })).text()).toBe(JSON.stringify({ ...(golden(`${WS}.planning`) as object), backlogHash: EMPTY_SHA256 }));
    // The old hash is stale now; the reset restores the golden.
    expect((await move('006', { to: 'code-review', hash: from?.hash }, { session, headers: NO_LOCKS })).status).toBe(409);
    expect((await ask(RESET, { method: 'POST', session })).status).toBe(204);
    expect(holderIn(await boardTree(session), '006-partial-push')).toEqual(from);
  });

  test('transition 409: a hash that is not the holder hash, or X-Spectant-Stub-Write: stale, answers StaleSpec with the current hash', async () => {
    const hash = holderIn(await boardTree(''), '006-partial-push')?.hash ?? '';
    for (const [body, headers] of [
      [{ to: 'build', hash: '0'.repeat(64) }, NO_LOCKS],
      [{ to: 'build', hash }, { ...NO_LOCKS, [WRITE_HEADER]: 'stale' }],
    ] as const) {
      const res = await move('006', body, { session: 't119-409', headers });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'hash-mismatch', files: ['spec.md'], expected: { spec: hash } });
    }
  });

  test('transition 422: a move the workflow row does not list, or no move at all; reason phrase and the spec next command', async () => {
    const session = 't119-422';
    const hash = holderIn(await boardTree(session), '006-partial-push')?.hash ?? '';
    const res = await move('006', { to: 'done', hash }, { session, headers: NO_LOCKS });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'transition-refused', reason: 'the bug workflow lists no move review → done', command: '/spec-review 006' });
    const same = await move('006', { to: 'review', hash }, { session, headers: NO_LOCKS });
    expect(await same.json()).toEqual({ error: 'transition-refused', reason: 'the spec already stands in review', command: '/spec-review 006' });
    expect(holderIn(await boardTree(session), '006-partial-push')?.stage).toBe('review');
  });

  test('transition 423: the spec the lock fixture holds (002 under activity), or X-Spectant-Stub-Write: locked; a grammar lock', async () => {
    const hash = holderIn(await boardTree(''), '002-web-console')?.hash ?? '';
    const res = await move('002', { to: 'blocked', hash }, { session: 't119-423' });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({ error: 'locked', lock: (goldenFor('live') as LiveFrame).locks[0] });
    expect((await move('002', { to: 'blocked', hash }, { session: 't119-423', headers: NO_LOCKS })).status).toBe(200);
    const hash006 = holderIn(await boardTree(''), '006-partial-push')?.hash ?? '';
    const scripted = await move('006', { to: 'build', hash: hash006 }, { headers: { ...NO_LOCKS, [WRITE_HEADER]: 'locked' } });
    expect(scripted.status).toBe(423);
    const { lock } = (await scripted.json()) as { lock: { session: string; actor: unknown } };
    expect(lock.session).toMatch(/^a:claude:stub-006-/u);
    expect(lock.actor).toEqual({ raw: lock.session, kind: 'agent', id: lock.session, legacy: false });
    expect((await move('006', { to: 'nowhere', hash: hash006 })).status).toBe(400);
  });

  test('idea: the IdeaPage of each harbor story with its raw sha256; 404 for an unknown story and for lantern', async () => {
    const listed = golden(`${WS}.planning`)['ideas'] as Array<{ slug: string }>;
    for (const slug of ['console-audit-log', 'registry-webhooks']) {
      const res = await ask(workspaceRoutes.idea(WS, slug));
      expect(res.status).toBe(200);
      const page = (await res.json()) as { idea: unknown; hash: string };
      expect(Object.keys(page)).toEqual(['idea', 'page', 'hash']);
      expect(page.idea).toEqual(listed.find((i) => i.slug === slug));
      expect(page.hash).toBe(storyHash(slug));
    }
    expect((await ask(workspaceRoutes.idea(WS, 'nope'))).status).toBe(404);
    expect((await ask(workspaceRoutes.idea('lantern', 'console-audit-log'))).status).toBe(404);
  });

  test('allocate 200: the story leaves the session tree and its page, the new spec stands in plan; 409, 422, 423, 400 scripted', async () => {
    const session = 't119-allocate';
    const before = await boardTree(session);
    const res = await allocate('console-audit-log', { hash: storyHash('console-audit-log') }, { session });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: '010',
      folder: 'specs/010-console-audit-log/',
      files: ['specs/010-console-audit-log/context.md', 'specs/010-console-audit-log/spec.md', 'specs/010-console-audit-log/events.jsonl'],
      removed: 'specs/ideas/console-audit-log.md',
      lockSource: 'activity',
    });
    const after = await boardTree(session);
    expect(after.ideas.map((i) => i.slug)).toEqual(['registry-webhooks']);
    expect(after.features.flatMap((f) => f.ideas).map((i) => i.slug)).toEqual(['registry-webhooks']);
    expect([after.stageCounts['idea'], after.stageCounts['plan']]).toEqual([(before.stageCounts['idea'] ?? 0) - 1, (before.stageCounts['plan'] ?? 0) + 1]);
    expect(after.features.find((f) => f.id === 'F2')?.holders.find((h) => h.id === '010')).toMatchObject({
      slug: '010-console-audit-log',
      stage: 'plan',
      stageSource: 'explicit',
      main: true,
      held: 0,
    });
    expect((await ask(workspaceRoutes.idea(WS, 'console-audit-log'), { session })).status).toBe(404);
    expect((await allocate('console-audit-log', { hash: storyHash('console-audit-log') }, { session })).status).toBe(404);

    const stale = await allocate('console-audit-log', { hash: '0'.repeat(64) }, { session: 't119-alloc-409' });
    expect([stale.status, await stale.json()]).toEqual([
      409,
      { error: 'hash-mismatch', files: ['specs/ideas/console-audit-log.md'], expected: { idea: storyHash('console-audit-log') } },
    ]);
    const unindexed = await allocate('registry-webhooks', { hash: storyHash('registry-webhooks') }, { session: 't119-alloc-422' });
    expect([unindexed.status, await unindexed.json()]).toEqual([422, { error: 'allocate-refused', reason: 'not-in-index', folder: 'specs/010-registry-webhooks/' }]);
    const locked = await allocate('console-audit-log', { hash: storyHash('console-audit-log') }, { session: 't119-alloc-423', headers: { [WRITE_HEADER]: 'locked' } });
    expect(locked.status).toBe(423);
    expect((await allocate('console-audit-log', { hash: 'x' })).status).toBe(400);
  });

  test('board-query and actors: in memory per session, validated as the server does, cleared by the reset', async () => {
    const session = 't119-mem';
    const bq = workspaceRoutes.boardQuery(WS);
    expect(await (await ask(bq, { session })).json()).toEqual({ query: '' });
    expect(await (await ask(bq, { session, method: 'PUT', body: JSON.stringify({ query: 'stage=build' }) })).json()).toEqual({ query: 'stage=build' });
    expect(await (await ask(bq, { session })).json()).toEqual({ query: 'stage=build' });
    expect(await (await ask(bq, { session: 't119-mem-other' })).json()).toEqual({ query: '' });
    expect((await ask(bq, { session, method: 'PUT', body: JSON.stringify({ query: '?x' }) })).status).toBe(400);
    const people = [
      { id: 'u:3f9c0a7d', displayName: 'Harbor dev', gitIdentities: ['dev@example.test'] },
      { id: 'u:0000000a', displayName: 'Second', gitIdentities: [] },
    ];
    expect(await (await ask(ACTORS_PATH, { session, method: 'PUT', body: JSON.stringify(people) })).json()).toEqual([people[1], people[0]]);
    expect(await (await ask(ACTORS_PATH, { session })).json()).toEqual([people[1], people[0]]);
    const agent = [{ id: 'a:claude:x', displayName: 'x', gitIdentities: [] }];
    expect((await ask(ACTORS_PATH, { session, method: 'PUT', body: JSON.stringify(agent) })).status).toBe(400);
    expect((await ask(RESET, { method: 'POST', session })).status).toBe(204);
    expect(await (await ask(ACTORS_PATH, { session })).json()).toEqual([]);
    expect(await (await ask(bq, { session })).json()).toEqual({ query: '' });
  });

  // Every registered route, every status its contract row names and no other; each 405 names the table's Allow.
  test('the status set of every registered route equals its contract row', async () => {
    const hash006 = holderIn(await boardTree(''), '006-partial-push')?.hash ?? '';
    const tasks = (await ask(specRoutes.tasks(WS, '002'))).headers.get(TASKS_HASH_HEADER) ?? '';
    const reviewed = await specHashes(specRoutes.spec(WS, '006'));
    const evil = { Origin: 'https://evil.example' };
    type Case = [string, Parameters<typeof request>[1]];
    const reads = (build: (ws: string, id: string) => string): Case[] => [
      [build(WS, '002'), {}],
      [build(WS, '002'), { headers: { 'If-None-Match': '*' } }],
      [build(WS, '002'), { headers: evil }],
      [build('nope', '002'), {}],
      [build(WS, '002'), { method: 'POST', body: '{}' }],
      [build('lantern', '001'), { state: 'unreadable' }],
    ];
    const writes = (build: (ws: string) => string, ok: unknown, refused?: unknown): Case[] => [
      [build(WS), { method: 'POST', body: JSON.stringify(ok), headers: NO_LOCKS, session: `t119-status-${build(WS)}` }],
      [build(WS), { method: 'POST', body: '{' }],
      [build(WS), { method: 'POST', body: JSON.stringify(ok), headers: evil }],
      [build('nope'), { method: 'POST', body: JSON.stringify(ok) }],
      [build(WS), { method: 'GET' }],
      [build(WS), { method: 'POST', body: JSON.stringify(ok), headers: { [WRITE_HEADER]: 'stale' } }],
      [build(WS), { method: 'POST', body: JSON.stringify(ok), headers: { [WRITE_HEADER]: 'locked' } }],
      [build('lantern'), { method: 'POST', body: JSON.stringify(ok), state: 'unreadable' }],
      ...(refused === undefined ? [] : ([[build(WS), { method: 'POST', body: JSON.stringify(refused), headers: NO_LOCKS }]] as Case[])),
    ];
    const statusesOf = async (cases: Case[]): Promise<{ statuses: number[]; allow: string[] }> => {
      const seen = new Set<number>();
      const allow = new Set<string>();
      for (const [path, init] of cases) {
        const res = await ask(path, init);
        seen.add(res.status);
        if (res.status === 405) allow.add(res.headers.get('Allow') ?? '');
      }
      return { statuses: [...seen].sort((a, b) => a - b), allow: [...allow] };
    };
    const spec: Record<SpecRouteName, Case[]> = {
      spec: reads(specRoutes.spec),
      timeline: reads(specRoutes.timeline),
      claims: reads(specRoutes.claims),
      tasks: reads(specRoutes.tasks),
      evidenceFile: reads((ws, id) => specRoutes.evidenceFile(ws, id, 'artifacts/T12-dashboard-model.md')),
      frames: reads(specRoutes.frames),
      live: reads(specRoutes.live),
      gateReviewed: writes((ws) => specRoutes.gateReviewed(ws, ws === 'lantern' ? '001' : '006'), { hashes: reviewed }),
      taskCheck: writes((ws) => specRoutes.taskCheck(ws, ws === 'lantern' ? '001' : '002', 'T27'), { checked: true, hash: tasks }),
      transition: writes((ws) => specRoutes.transition(ws, ws === 'lantern' ? '001' : '006'), { to: 'build', hash: hash006 }, { to: 'done', hash: hash006 }),
    };
    for (const entry of SPEC_ROUTE_TABLE) {
      expect({ route: entry.route, ...(await statusesOf(spec[entry.route])) }).toEqual({ route: entry.route, statuses: [...entry.statuses], allow: [allowFor(entry.route)] });
    }
    const ideaHash = storyHash('console-audit-log');
    const workspace: Record<string, Case[]> = {
      planning: reads((ws) => workspaceRoutes.planning(ws)),
      idea: reads((ws) => workspaceRoutes.idea(ws, ws === 'lantern' ? 'x' : 'console-audit-log')),
      boardQuery: [
        [workspaceRoutes.boardQuery(WS), {}],
        [workspaceRoutes.boardQuery(WS), { headers: { 'If-None-Match': '*' } }],
        [workspaceRoutes.boardQuery(WS), { method: 'PUT', body: '[]' }],
        [workspaceRoutes.boardQuery(WS), { headers: evil }],
        [workspaceRoutes.boardQuery('nope'), {}],
        [workspaceRoutes.boardQuery(WS), { method: 'DELETE' }],
        [workspaceRoutes.boardQuery('lantern'), { state: 'unreadable' }],
      ],
      allocate: [
        ...writes((ws) => workspaceRoutes.allocate(ws, 'console-audit-log'), { hash: ideaHash }),
        [workspaceRoutes.allocate(WS, 'registry-webhooks'), { method: 'POST', body: JSON.stringify({ hash: storyHash('registry-webhooks') }) }],
      ],
      // Spec 036: no 423 (the real write reads no lock); harbor has no specs/backlog.md, so the empty text's hash is current.
      backlog: (() => {
        const empty = new Bun.CryptoHasher('sha256').update('').digest('hex');
        const priority = (hash: string, feature = 'F2'): string => JSON.stringify({ op: 'priority', feature, priority: 'P1', hash });
        return [
          [workspaceRoutes.backlog(WS), { method: 'POST', body: priority(empty), session: 't036-backlog-status' }],
          [workspaceRoutes.backlog(WS), { method: 'POST', body: '{' }],
          [workspaceRoutes.backlog(WS), { method: 'POST', body: priority(empty), headers: evil }],
          [workspaceRoutes.backlog('nope'), { method: 'POST', body: priority(empty) }],
          [workspaceRoutes.backlog(WS), { method: 'GET' }],
          [workspaceRoutes.backlog(WS), { method: 'POST', body: priority('0'.repeat(64)) }],
          [workspaceRoutes.backlog('lantern'), { method: 'POST', body: priority(empty), state: 'unreadable' }],
          [workspaceRoutes.backlog(WS), { method: 'POST', body: priority(empty, 'F99') }],
        ] satisfies Case[];
      })(),
      library: reads((ws) => workspaceRoutes.library(ws)),
      libraryDoc: [
        ...reads((ws) => workspaceRoutes.libraryDoc(ws, ws === 'lantern' ? '001-reading-list/plan.md' : '002-web-console/plan.md')),
        [workspaceRoutes.libraryDoc(WS, '002-web-console/design.md'), {}],
      ],
      librarySearch: reads((ws) => workspaceRoutes.librarySearch(ws, 'console')),
      libraryAsset: [
        ...reads((ws) => workspaceRoutes.libraryAsset(ws, 'tech/overview.png')),
        [workspaceRoutes.libraryAsset(WS, '../constitution.md'), {}],
        [workspaceRoutes.libraryAsset(WS, 'tech/nothing.png'), {}],
        [workspaceRoutes.libraryAsset(WS, 'tech/overview.png'), { method: 'HEAD' }],
      ],
    };
    // The table's routes stay pinned; every one of them is served now.
    expect(WORKSPACE_ROUTE_TABLE.map((entry) => entry.route)).toEqual([
      'planning',
      'idea',
      'boardQuery',
      'allocate',
      'backlog',
      'library',
      'libraryDoc',
      'librarySearch',
      'libraryAsset',
    ]);
    for (const entry of WORKSPACE_ROUTE_TABLE) {
      expect({ route: entry.route, ...(await statusesOf(workspace[entry.route] ?? [])) }).toEqual({
        route: entry.route,
        statuses: [...entry.statuses],
        allow: [allowForWorkspace(entry.route)],
      });
    }
    const actors = await statusesOf([
      [ACTORS_PATH, {}],
      [ACTORS_PATH, { headers: { 'If-None-Match': '*' } }],
      [ACTORS_PATH, { method: 'PUT', body: '{}' }],
      [ACTORS_PATH, { headers: evil }],
      [ACTORS_PATH, { method: 'DELETE' }],
    ]);
    expect(actors).toEqual({ statuses: [...ACTORS_STATUSES], allow: [ACTORS_ALLOW] });
  });
});

// ---- the board seam against the real handlers ---------------------------------------------------------------------

describe('stub API board seam matches the real handlers (T119)', () => {
  type BoardApiModule = {
    dashboardApi: (options: {
      registry: { list: () => ServerWorkspace[]; get: (slug: string) => ServerWorkspace | undefined };
      today: () => string;
      db: Database;
    }) => Handler;
    actorsApi: (db: Database) => Handler;
  };
  type SpecRoutesModule = { specRoutesApi: (options: { registry: { get: (slug: string) => ServerWorkspace | undefined } }) => Handler };
  const boardDb = new Database(':memory:', { strict: true });
  let dashboard: Handler | undefined;
  let actors: Handler | undefined;
  let specs: Handler | undefined;

  beforeAll(async () => {
    ((await import(join(SERVER, 'db.ts'))) as DbModule).migrate(boardDb);
    const apiModule = (await import(join(SERVER, 'api.ts'))) as BoardApiModule;
    const routesModule = (await import(join(SERVER, 'spec-routes.ts'))) as SpecRoutesModule;
    const workspaces: ServerWorkspace[] = ['harbor', 'lantern'].map((name, position) => ({
      slug: name,
      path: join(FIXTURES, name),
      name,
      addedAt: '2026-03-01T00:00:00Z',
      position,
    }));
    const registry = { list: () => workspaces, get: (slug: string) => workspaces.find((w) => w.slug === slug) };
    dashboard = apiModule.dashboardApi({ registry, today: () => '2026-03-20', db: boardDb });
    actors = apiModule.actorsApi(boardDb);
    specs = routesModule.specRoutesApi({ registry });
  });
  afterAll(() => boardDb.close());

  /** Sends each step to both, expects the same status, headers and bytes; answers the statuses, so a test sees what it compared. */
  const same = async (real: Handler | undefined, steps: Array<[string, RequestInit]>, session: string): Promise<number[]> => {
    if (!real) throw new Error('real handlers not loaded');
    const statuses: number[] = [];
    for (const [path, init] of steps) {
      const stubbed = await snapshot(await call(api, request(path, { ...init, session })));
      const served = await snapshot(await call(real, request(path, init)));
      expect({ path, method: init.method ?? 'GET', answer: stubbed }).toEqual({ path, method: init.method ?? 'GET', answer: served });
      statuses.push(served[0] as number);
    }
    return statuses;
  };

  test('idea: byte-equal to the real story route on the harbor fixture; 404 and 405 too', async () => {
    const statuses = await same(
      dashboard,
      [
        [workspaceRoutes.idea(WS, 'console-audit-log'), {}],
        [workspaceRoutes.idea(WS, 'registry-webhooks'), {}],
        [workspaceRoutes.idea(WS, 'registry-webhooks'), { method: 'HEAD' }],
        [workspaceRoutes.idea(WS, 'nope'), {}],
        [workspaceRoutes.idea('lantern', 'console-audit-log'), {}],
        [workspaceRoutes.idea(WS, 'console-audit-log'), { method: 'POST', body: '{}' }],
      ],
      't119-parity-idea',
    );
    expect(statuses).toEqual([200, 200, 200, 404, 404, 405]);
  });

  test('board-query and actors: the same sequence of requests gives the same answers', async () => {
    const queries = await same(
      dashboard,
      [
        [workspaceRoutes.boardQuery(WS), {}],
        [workspaceRoutes.boardQuery(WS), { method: 'PUT', body: JSON.stringify({ query: 'stage=build&f=F2' }) }],
        [workspaceRoutes.boardQuery(WS), {}],
        [workspaceRoutes.boardQuery(WS), { method: 'PUT', body: '{' }],
        [workspaceRoutes.boardQuery('nope'), {}],
        [workspaceRoutes.boardQuery(WS), { method: 'DELETE' }],
      ],
      't119-parity-bq',
    );
    expect(queries).toEqual([200, 200, 200, 400, 404, 405]);
    const people = [
      { id: 'u:3f9c0a7d', displayName: 'Harbor dev', gitIdentities: [] },
      { id: 'u:0000000a', displayName: 'B', gitIdentities: ['b@example.test'] },
    ];
    const named = await same(
      actors,
      [
        [ACTORS_PATH, {}],
        [ACTORS_PATH, { method: 'PUT', body: JSON.stringify(people) }],
        [ACTORS_PATH, { method: 'HEAD' }],
        [ACTORS_PATH, { method: 'PUT', body: JSON.stringify([{ id: 'a:claude:x', displayName: 'x', gitIdentities: [] }]) }],
        [ACTORS_PATH, { method: 'POST', body: '[]' }],
      ],
      't119-parity-actors',
    );
    expect(named).toEqual([200, 200, 200, 400, 405]);
  });

  test('the answers that write nothing on the real side: allocate 400/404/409/422/405, transition 400/409/422, the spec hash', async () => {
    const raw006 = holderIn(await boardTree(''), '006-partial-push')?.hash ?? '';
    const allocations = await same(
      dashboard,
      [
        [workspaceRoutes.allocate(WS, 'console-audit-log'), { method: 'POST', body: '{' }],
        [workspaceRoutes.allocate(WS, 'nope'), { method: 'POST', body: JSON.stringify({ hash: '0'.repeat(64) }) }],
        [workspaceRoutes.allocate(WS, 'console-audit-log'), { method: 'POST', body: JSON.stringify({ hash: '0'.repeat(64) }) }],
        [workspaceRoutes.allocate(WS, 'registry-webhooks'), { method: 'POST', body: JSON.stringify({ hash: storyHash('registry-webhooks') }) }],
        [workspaceRoutes.allocate(WS, 'console-audit-log'), { method: 'GET' }],
      ],
      't119-parity-alloc',
    );
    expect(allocations).toEqual([400, 404, 409, 422, 405]);
    const moves = await same(
      specs,
      [
        [specRoutes.transition(WS, '006'), { method: 'POST', body: '{"to":"nowhere"}' }],
        [specRoutes.transition(WS, '006'), { method: 'POST', body: JSON.stringify({ to: 'build', hash: '0'.repeat(64) }) }],
        [specRoutes.transition(WS, '006'), { method: 'POST', body: JSON.stringify({ to: 'done', hash: raw006 }) }],
      ],
      't119-parity-move',
    );
    expect(moves).toEqual([400, 409, 422]);
    if (!specs) throw new Error('real handlers not loaded');
    const served = await call(specs, request(specRoutes.spec(WS, '006')));
    expect((await ask(specRoutes.spec(WS, '006'))).headers.get(SPEC_HASH_HEADER)).toBe(served.headers.get(SPEC_HASH_HEADER));
  });
});

// ---- the worktree overlay (spec 027, T33: ISC-175, ISC-175.1, ISC-179, ISC-181) -----------------------------------

describe('stub API: the worktree overlay via X-Spectant-Stub-Worktrees (spec 027, T33)', () => {
  type Headers = Record<string, string>;
  type Row = { id: string; worktree: Worktree | null; source: string; main: unknown; warnings: unknown[] };
  type Dashboard = { kpis: Json & { warnings: number; attention: number }; specs: Row[]; warningGroups: unknown[] };
  const FOLDERS: Readonly<Record<string, string>> = {
    '004': '004-retention-policies',
    '005': '005-config-format-choice',
    '006': '006-partial-push',
    '007': '007-rotate-mirror-token',
    '008': '008-referrers-support',
  };
  const on: Headers = { [WORKTREES_HEADER]: 'on' };
  const read = async <T>(path: string, headers: Headers = on): Promise<T> => (await (await ask(path, { headers })).json()) as T;
  const dashboard = (headers: Headers = on, ws = WS): Promise<Dashboard> => read<Dashboard>(`/api/workspaces/${ws}/dashboard`, headers);
  const page = (id: string, headers: Headers = on): Promise<SpecPageModel> => read<SpecPageModel>(specRoutes.spec(WS, id), headers);
  const live = (headers: Headers = on, id = '002'): Promise<LiveFrame> => read<LiveFrame>(specRoutes.live(WS, id), headers);
  const timeline = (id: string): Promise<TimelineEntry[]> => read<TimelineEntry[]>(specRoutes.timeline(WS, id));
  const goldenModel = (name = 'harbor'): Dashboard => golden(name) as unknown as Dashboard;
  const rowOf = (model: Dashboard, id: string): Row => {
    const found = model.specs.find((r) => r.id === id);
    if (!found) throw new Error(`no row ${id}`);
    return found;
  };
  const goldenPage = (folder: string): SpecPageModel => familyValue('harbor', 'spec', `specs/${folder}`) as SpecPageModel;
  const goldenTimeline = (folder: string): TimelineEntry[] => familyValue('harbor', 'timeline', `specs/${folder}`) as TimelineEntry[];
  const withoutRun = (card: object): object => Object.fromEntries(Object.entries(card).filter(([key]) => key !== 'run'));
  const MISMATCH: SpecWarning = {
    kind: 'worktree-branch-mismatch',
    text:
      'Worktree .worktrees/003-config-loader is on branch feature/005-config-format-choice, which names spec 005; ' +
      'its path names spec 003, and the path wins.',
    ref: '.worktrees/003-config-loader',
  };

  test('off is the default: absent or "off" serves every golden as it is; an unknown value is a loud 400', async () => {
    for (const headers of [{}, { [WORKTREES_HEADER]: 'off' }] as Headers[]) {
      expect(await dashboard(headers)).toEqual(goldenModel());
      expect(await live(headers)).toEqual(goldenFor('live') as LiveFrame);
      expect(await read<TimelineEntry[]>(specRoutes.timeline(WS, '007'), headers)).toEqual(goldenTimeline('007-rotate-mirror-token'));
    }
    const bad = await ask(`/api/workspaces/${WS}/dashboard`, { headers: { [WORKTREES_HEADER]: 'maybe' } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'unknown-stub-worktrees', worktrees: 'maybe', states: [...WORKTREE_STATES] });
  });

  test('(1) harbor 002: the dirty worktree two commits ahead, alike on its dashboard row and its spec head', async () => {
    const worktree: Worktree = { path: '.worktrees/002-web-console', branch: 'feature/002-web-console', spec: '002', ahead: 2, dirty: true, kind: 'spec' };
    expect(rowOf(await dashboard(), '002').worktree).toEqual(worktree);
    expect((await page('002')).head.worktree).toEqual(worktree);
  });

  test('(2) harbor 009: a clean worktree with nothing ahead', async () => {
    const worktree: Worktree = { path: '.worktrees/009-chunked-upload-limits', branch: 'feature/009-chunked-upload-limits', spec: '009', ahead: 0, dirty: false, kind: 'spec' };
    expect(rowOf(await dashboard(), '009').worktree).toEqual(worktree);
    expect((await page('009')).head.worktree).toEqual(worktree);
  });

  test('(3) harbor 003: the path wins over a branch naming 005, one mismatch warning on row, panel, page and counts', async () => {
    const model = await dashboard();
    const base = goldenModel();
    const row = rowOf(model, '003');
    expect(row.worktree).toEqual({ path: '.worktrees/003-config-loader', branch: 'feature/005-config-format-choice', spec: '003', ahead: 1, dirty: false, kind: 'spec' } satisfies Worktree);
    expect(row.warnings).toEqual([...rowOf(base, '003').warnings, MISMATCH]);
    expect(model.warningGroups).toEqual([...base.warningGroups, { kind: 'worktree-branch-mismatch', items: [{ spec: '003', warning: MISMATCH }] }]);
    expect(model.kpis).toEqual({ ...base.kpis, warnings: base.kpis.warnings + 1, attention: base.kpis.attention + 1 });
    const list = await read<Array<{ slug: string; counts: unknown }>>('/api/workspaces');
    expect(list.find((w) => w.slug === WS)?.counts).toEqual(model.kpis);
    const spec = await page('003');
    expect(spec.head.worktree).toEqual(row.worktree);
    expect(spec.warnings).toEqual([...goldenPage('003-config-loader').warnings, MISMATCH]);
    expect(spec.areas.status.warnings).toBe(goldenPage('003-config-loader').areas.status.warnings + 1);
  });

  test('(4) every other spec, the archived one and lantern included, carries no worktree and reads from main', async () => {
    const model = await dashboard();
    for (const [id, folder] of Object.entries(FOLDERS)) {
      expect(rowOf(model, id)).toEqual(rowOf(goldenModel(), id));
      expect([rowOf(model, id).worktree, rowOf(model, id).source, rowOf(model, id).main]).toEqual([null, 'main', null]);
      expect((await page(id)).head).toEqual(goldenPage(folder).head);
    }
    expect((await page('001')).head).toEqual(goldenPage('archive/001-manifest-sync').head);
    expect(await dashboard(on, 'lantern')).toEqual(goldenModel('lantern'));
  });

  test('(5) harbor 002 is read from its worktree copy: source worktree, the main copy two claims behind', async () => {
    const main: MainCopy = { stage: 'build', progress: { closed: 23, total: 30 } };
    const model = await dashboard();
    const head = (await page('002')).head;
    expect([rowOf(model, '002').source, rowOf(model, '002').main]).toEqual(['worktree', main]);
    expect([head.source, head.main]).toEqual(['worktree', main]);
    for (const id of ['003', '009']) expect([rowOf(model, id).source, rowOf(model, id).main]).toEqual(['main', null]);
  });

  test('(6) harbor 002 live: every run state on a card, the round furthest along first, the golden file untouched', async () => {
    const before = goldenText('harbor.live');
    const base = goldenFor('live') as LiveFrame;
    const frame = await live();
    const runs = Object.fromEntries(frame.cards.filter((c) => c.run).map((c) => [c.task, c.run?.state]));
    expect(runs).toEqual({ T26: 'applied', T27: 'patched', T28: 'applied-open', T29: 'building', T32: 'dispatched' });
    for (const task of ['T26', 'T28']) expect(frame.cards.find((c) => c.task === task)?.run).toEqual(base.cards.find((c) => c.task === task)?.run);
    expect(frame.cards.map(withoutRun)).toEqual(base.cards.map(withoutRun));
    expect(frame.inRound?.round).toBe(base.inRound?.round ?? -1);
    expect(frame.inRound?.cards.map((c) => `${c.task}:${c.run?.state ?? 'none'}`)).toEqual(['T28:applied-open', 'T27:patched', 'T29:building', 'T32:dispatched']);
    const counts = { dispatched: 1, building: 1, patched: 1, 'applied-open': 1 };
    expect([frame.inRound?.total, frame.inRound?.lanes]).toEqual([counts, { web: counts }]);
    expect(frame.needsYou.find((c) => c.task === 'T29')?.run?.state).toBe('building');
    expect((await live({ ...on, [LOCKS_HEADER]: 'none' })).inRound?.cards.length).toBe(4);
    expect(await live(on, '003')).toEqual(familyValue('harbor', 'live', 'specs/003-config-loader') as LiveFrame);
    expect(goldenText('harbor.live')).toBe(before);
  });

  test('(7) POST bump-run moves one task one run event on, for that session only; applied-open stays; reset drops it', async () => {
    const session = 'stub-bump-run';
    const mine: Headers = { ...on, [SESSION_HEADER]: session };
    const bump = (task: string, query = `ws=${WS}&spec=002&task=${task}`): Promise<Response> =>
      ask(`${BUMP_RUN_PATH}?${query}`, { method: 'POST', session });
    const stateOf = (frame: LiveFrame, task: string): string | undefined => frame.cards.find((c) => c.task === task)?.run?.state;
    const etag = async (headers: Headers): Promise<string | null> => (await ask(specRoutes.live(WS, '002'), { headers })).headers.get('ETag');
    expect((await ask(RESET_PATH, { method: 'POST', session })).status).toBe(204);
    const first = await etag(mine);
    expect((await bump('T32')).status).toBe(204);
    expect(await etag(mine)).not.toBe(first);
    const moved = await live(mine);
    expect(moved.cards.find((c) => c.task === 'T32')?.run).toEqual({
      task: 'T32',
      state: 'building',
      session: 'a:claude:sess-2/T32',
      worktree: 'wt-12',
      ts: '2026-03-08T15:01:00Z',
    });
    expect(moved.inRound?.total).toEqual({ building: 2, patched: 1, 'applied-open': 1 });
    expect(stateOf(await live(), 'T32')).toBe('dispatched');
    expect(stateOf(await live({ [SESSION_HEADER]: session }), 'T32')).toBe('dispatched');
    const settled = await etag(mine);
    expect((await bump('T28')).status).toBe(204);
    expect(await etag(mine)).toBe(settled);
    await bump('T32');
    await bump('T32');
    await bump('T32');
    expect(stateOf(await live(mine), 'T32')).toBe('applied-open');
    expect((await ask(RESET_PATH, { method: 'POST', session })).status).toBe(204);
    expect(stateOf(await live(mine), 'T32')).toBe('dispatched');
    const refused = [`ws=nowhere&spec=002&task=T32`, `ws=${WS}&spec=999&task=T32`, `ws=${WS}&spec=002&task=T99`, `ws=${WS}&spec=002&task=T34`, `ws=${WS}&spec=002`];
    for (const query of refused) expect((await bump('', query)).status).toBe(404);
    const wrong = await ask(`${BUMP_RUN_PATH}?ws=${WS}&spec=002&task=T32`, { session });
    expect([wrong.status, wrong.headers.get('Allow')]).toEqual([405, 'POST']);
  });

  test('(8) timeline: 007 merged between two dated entries, 006 removed undated after its newest instant', async () => {
    const merged = await timeline('007');
    expect(merged.filter((e) => e.kind !== 'worktree')).toEqual(goldenTimeline('007-rotate-mirror-token'));
    const entry = merged[3];
    expect(entry).toEqual({
      ts: '2026-03-09T08:45:00Z',
      kind: 'worktree',
      derived: true,
      title: 'Merged into main · feature/007-rotate-mirror-token',
      ref: 'merged',
      id: 'worktree-merged',
      actor: null,
      worktree: { state: 'merged', branch: 'feature/007-rotate-mirror-token', path: '.worktrees/007-rotate-mirror-token', commit: '4f1c2ab' },
    });
    expect(Object.keys(entry ?? {})).toEqual(['ts', 'kind', 'derived', 'title', 'ref', 'id', 'actor', 'worktree']);
    expect([merged[2]?.ts, merged[4]?.ts]).toEqual(['2026-03-09T09:00:00Z', '2026-03-09T08:30:00Z']);
    const removed = await timeline('006');
    expect(removed.filter((e) => e.kind !== 'worktree')).toEqual(goldenTimeline('006-partial-push'));
    expect(removed[2]).toEqual({
      ts: '',
      kind: 'worktree',
      derived: true,
      title: 'Worktree removed · .worktrees/006-partial-push',
      ref: 'removed',
      id: 'worktree-removed',
      actor: null,
      undated: true,
      worktree: { state: 'removed', branch: 'feature/006-partial-push', path: '.worktrees/006-partial-push', commit: null },
    });
    for (const [id, folder] of [['007', '007-rotate-mirror-token'], ['006', '006-partial-push']] as const) {
      expect((await page(id)).areas.status.timelineEntries).toBe(goldenPage(folder).areas.status.timelineEntries + 1);
    }
    expect(await timeline('002')).toEqual(goldenTimeline('002-web-console'));
  });
});

describe('stub API: spec edges via X-Spectant-Stub-Edges (spec 025, T20, ISC-163)', () => {
  type Headers = Record<string, string>;
  type Row = { id: string; slug: string; stage: string; nextReason: string; waits: SpecWait | null; takeable: string[]; warnings: SpecWarning[] };
  type Dashboard = { kpis: Json; specs: Row[] };
  type Holder = { slug: string; stage?: string; waits?: SpecWait | null };
  const as = (edges: string): Headers => ({ [EDGES_HEADER]: edges });
  const read = async <T>(path: string, headers: Headers): Promise<T> => (await (await ask(path, { headers })).json()) as T;
  const dashboard = (headers: Headers): Promise<Dashboard> => read<Dashboard>(`/api/workspaces/${WS}/dashboard`, headers);
  const page = (id: string, headers: Headers): Promise<SpecPageModel> => read<SpecPageModel>(specRoutes.spec(WS, id), headers);
  const claims = (id: string, headers: Headers): Promise<ClaimViewModel> => read<ClaimViewModel>(specRoutes.claims(WS, id), headers);
  const live = (id: string, headers: Headers): Promise<LiveFrame> => read<LiveFrame>(specRoutes.live(WS, id), headers);
  const tasks = (id: string, headers: Headers): Promise<TasksTab> => read<TasksTab>(specRoutes.tasks(WS, id), headers);
  const holders = async (headers: Headers): Promise<Holder[]> => {
    const model = await read<{ features: Json[] }>(`/api/workspaces/${WS}/planning`, headers);
    // Every spec holder of the tree, wherever the planning model nests it (features, milestones).
    const out: Holder[] = [];
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (typeof value === 'object' && value !== null) {
        const v = value as Json;
        if (typeof v['slug'] === 'string' && 'waits' in v) out.push(v as unknown as Holder);
        Object.values(v).forEach(walk);
      }
    };
    walk(model);
    return out;
  };
  const rowOf = (model: Dashboard, id: string): Row => {
    const found = model.specs.find((r) => r.id === id);
    if (!found) throw new Error(`no row ${id}`);
    return found;
  };
  const goldenModel = (): Dashboard => golden('harbor') as unknown as Dashboard;
  const { full, partial, unknown } = STUB_EDGES;
  const FULL: SpecWait = { spec: full.spec, blockers: [full.on], heldTasks: 0, openTasks: 0, full: true };
  const PARTIAL: SpecWait = { spec: partial.spec, blockers: [partial.on], heldTasks: partial.tasks.length, openTasks: 5, full: false };
  const UNKNOWN_EDGE: SpecWarning = {
    kind: 'spec-edge',
    text: `The spec edge (after: ${unknown.on}) on ${unknown.task} names no spec, active or archived; it stays open.`,
    ref: 'tasks.md',
  };
  const OVERLAP: SpecOverlap = { specs: ['002', '004'], paths: ['web/src/app/retention/'], waiting: '002', edge: '(after: 004)' };
  const UNTOUCHED = ['003', '004', '005', '006', '007', '008'];

  test('off is the default: absent or "off" serves the goldens; an unknown value or edges beside worktrees is a loud 400', async () => {
    for (const headers of [{}, as('off')] as Headers[]) {
      expect(await dashboard(headers)).toEqual(goldenModel());
      expect(await live('002', headers)).toEqual(goldenFor('live') as LiveFrame);
      expect(await claims('002', headers)).toEqual(goldenFor('claims') as ClaimViewModel);
    }
    const bad = await ask(`/api/workspaces/${WS}/dashboard`, { headers: as('maybe') });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'unknown-stub-edges', edges: 'maybe', states: [...EDGE_STATES] });
    const both = await ask(`/api/workspaces/${WS}/dashboard`, { headers: { ...as('waiting'), [WORKTREES_HEADER]: 'on' } });
    expect(both.status).toBe(400);
    expect(await both.json()).toEqual({ error: 'stub-edges-with-worktrees', edges: 'waiting', worktrees: 'on' });
  });

  test('the merge state: each blocker on its branch, unmerged under waiting and merged under met', () => {
    expect(stubMergeState('waiting').map((m) => [m.spec, m.branch, m.merged])).toEqual([
      ['002', 'feature/002-web-console', false],
      ['006', 'feature/006-partial-push', false],
    ]);
    expect(stubMergeState('met').every((m) => m.merged)).toBe(true);
  });

  test('waiting, full hold: 009 waits on 002 on its row, board holder and head, stage blocked, its claim held', async () => {
    const headers = as('waiting');
    const row = rowOf(await dashboard(headers), full.spec);
    expect(row.waits).toEqual(FULL);
    expect([row.stage, row.nextReason, row.takeable]).toEqual(['blocked', `waits on ${full.on}`, []]);
    expect((await holders(headers)).filter((h) => h.slug === full.folder).map((h) => h.waits)).toContainEqual(FULL);
    const head = (await page(full.spec, headers)).head;
    expect([head.stage, head.waits]).toEqual(['blocked', FULL]);
    const held = (await claims(full.spec, headers)).claims.find((c) => c.id === 'ISC-131');
    expect([held?.state, held?.waitsOn]).toEqual(['blocked', [full.on]]);
  });

  test('waiting, partial hold: 002 waits on 006 with four of five open tasks, the web tasks held, the stage kept', async () => {
    const headers = as('waiting');
    const row = rowOf(await dashboard(headers), partial.spec);
    expect(row.waits).toEqual(PARTIAL);
    expect(row.stage).toBe(rowOf(goldenModel(), partial.spec).stage);
    expect((await holders(headers)).filter((h) => h.slug === partial.folder).map((h) => h.waits)).toContainEqual(PARTIAL);
    expect((await page(partial.spec, headers)).head.waits).toEqual(PARTIAL);
    const held = (await tasks(partial.spec, headers)).tasks.filter((t) => t.afterSpecs?.includes(partial.on) === true).map((t) => t.id);
    expect(held).toEqual([...partial.tasks]);
    // The tasks answer carries the same hold (core tasks.ts, ISC-162.2): no open one of them is left open or
    // dispatched, each held one reads `waits on 006`; a failed or questioned one keeps its round's word.
    const open = (await tasks(partial.spec, headers)).tasks.filter((t) => held.includes(t.id) && t.state === 'open');
    expect(open.filter((t) => t.status === 'open' || t.status === 'dispatched')).toEqual([]);
    const heldRows = open.filter((t) => t.status === 'held');
    expect(heldRows.length).toBeGreaterThan(0);
    expect(heldRows.map((t) => t.reason)).toEqual(heldRows.map(() => `waits on ${partial.on}`));
    // An open spec-edge hold wins over a carried waiting or dispatched card's round reason (core live.ts); a running,
    // landed or failed card keeps its own state and reason.
    const cards = (await live(partial.spec, headers)).cards.filter((c) => held.includes(c.task));
    expect(cards.map((c) => c.task)).toEqual(held);
    const holdable = cards.filter((c) => c.state === 'waiting' || c.state === 'operatorOpen');
    expect(holdable.length).toBeGreaterThan(0);
    expect(holdable.map((c) => c.reason)).toEqual(holdable.map(() => `waits on ${partial.on}`));
  });

  test('waiting: the unknown 042 is a spec-edge warning on 002, the 002/004 overlap keeps its direction and edge', async () => {
    const warnings = rowOf(await dashboard(as('waiting')), partial.spec).warnings;
    expect(warnings).toContainEqual(UNKNOWN_EDGE);
    expect(warnings.find((w) => w.kind === 'spec-overlap')?.overlap).toEqual(OVERLAP);
    expect((await tasks(unknown.spec, as('waiting'))).tasks.find((t) => t.id === unknown.task)?.afterSpecs).toEqual([unknown.on]);
  });

  test('met: every wait is null, 009 back on build with ISC-131 takeable, no held claim; the diagnostic stays', async () => {
    const headers = as('met');
    const model = await dashboard(headers);
    expect(model.specs.map((r) => r.waits)).toEqual(model.specs.map(() => null));
    expect((await holders(headers)).map((h) => h.waits ?? null)).toEqual((await holders(headers)).map(() => null));
    const base = goldenModel();
    expect(rowOf(model, full.spec)).toEqual(rowOf(base, full.spec));
    expect(rowOf(model, partial.spec)).toEqual({ ...rowOf(base, partial.spec), warnings: [UNKNOWN_EDGE, ...rowOf(base, partial.spec).warnings] });
    for (const id of [full.spec, partial.spec]) {
      expect((await page(id, headers)).head.waits).toBeNull();
      expect((await claims(id, headers)).claims.filter((c) => c.waitsOn !== undefined)).toEqual([]);
      expect((await live(id, headers)).cards.filter((c) => c.reason?.startsWith('waits on') === true)).toEqual([]);
    }
  });

  test('both variants: every spec the edges leave alone is answered as its golden, by core from the fixture tree', async () => {
    const base = goldenModel();
    for (const edges of ['waiting', 'met']) {
      const model = await dashboard(as(edges));
      for (const id of UNTOUCHED) {
        expect(rowOf(model, id)).toEqual(rowOf(base, id));
        const folder = `specs/${rowOf(base, id).slug}`;
        expect(await page(id, as(edges))).toEqual(familyValue(WS, 'spec', folder) as SpecPageModel);
        expect(await claims(id, as(edges))).toEqual(familyValue(WS, 'claim-view', folder) as ClaimViewModel);
        expect(await live(id, as(edges))).toEqual(familyValue(WS, 'live', folder) as LiveFrame);
      }
    }
  });
});

describe('stub API: the near-midnight instant via X-Spectant-Stub-Midnight (spec 006, T4, ISC-114)', () => {
  type Headers = Record<string, string>;
  const on: Headers = { [MIDNIGHT_HEADER]: 'on' };
  const read = async <T>(path: string, headers: Headers = on): Promise<T> => (await (await ask(path, { headers })).json()) as T;
  const { instant, workspace, spec, folder, doc, timeline } = STUB_MIDNIGHT;
  const key = `specs/${folder}`;
  const goldenPage = familyValue(workspace, 'spec', key) as SpecPageModel;
  const goldenTimeline = familyValue(workspace, 'timeline', key) as TimelineEntry[];
  /** The local calendar day and hour of `iso` in `timeZone`, as `Intl` reads them. */
  const local = (iso: string, timeZone: string): { day: string; hour: number } => {
    const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
    const parts = new Map(format.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.get(type) ?? '';
    return { day: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
  };

  test('the instant falls on another day east and west of UTC: the exported zones say which day and hour each shows', () => {
    const utc = local(instant, 'UTC');
    const { east, west } = STUB_MIDNIGHT.zones;
    expect(local(instant, east.timezoneId)).toEqual({ day: east.day, hour: east.hour });
    expect(local(instant, west.timezoneId)).toEqual({ day: west.day, hour: west.hour });
    expect(utc).toEqual({ day: STUB_MIDNIGHT.utc.day, hour: STUB_MIDNIGHT.utc.hour });
    expect(east.day).not.toBe(utc.day);
    expect(west.hour).not.toBe(utc.hour);
    expect(east.day).not.toBe(west.day);
  });

  test('off is the default: absent or "off" serves the goldens as they are; an unknown value or a mix is a loud 400', async () => {
    const catalog = await read<LibraryCatalog>(workspaceRoutes.library(workspace), {});
    for (const headers of [{}, { [MIDNIGHT_HEADER]: 'off' }] as Headers[]) {
      expect(await read<SpecPageModel>(specRoutes.spec(workspace, spec), headers)).toEqual(goldenPage);
      expect(await read<TimelineEntry[]>(specRoutes.timeline(workspace, spec), headers)).toEqual(goldenTimeline);
      expect(await read<LibraryCatalog>(workspaceRoutes.library(workspace), headers)).toEqual(catalog);
    }
    expect(catalog.docs.find((d) => d.path === doc)?.modified).not.toBe(instant);
    const bad = await ask(specRoutes.spec(workspace, spec), { headers: { [MIDNIGHT_HEADER]: 'maybe' } });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'unknown-stub-midnight', midnight: 'maybe', states: [...MIDNIGHT_STATES] });
    for (const overlay of [{ [WORKTREES_HEADER]: 'on' }, { [EDGES_HEADER]: 'waiting' }] as Headers[]) {
      const mixed = await ask(specRoutes.spec(workspace, spec), { headers: { ...on, ...overlay } });
      expect(mixed.status).toBe(400);
      expect(((await mixed.json()) as Json)['error']).toBe('stub-midnight-with-overlay');
    }
  });

  test('on: the reviewed mark, the gate event and the newest round of harbor 002 carry the instant, in every lock fixture', async () => {
    for (const locks of LOCK_STATES) {
      const page = await read<SpecPageModel>(specRoutes.spec(workspace, spec), { ...on, [LOCKS_HEADER]: locks });
      expect(page.gates.reviewed.at).toBe(instant);
      expect(page.gates.reviewed.state).toBe(goldenPage.gates.reviewed.state);
    }
    const entries = await read<TimelineEntry[]>(specRoutes.timeline(workspace, spec));
    expect(entries.map((e) => e.id)).toEqual(goldenTimeline.map((e) => e.id));
    const moved = entries.filter((e) => e.ts === instant);
    expect(moved.map((e) => e.id)).toEqual([...timeline]);
    expect(moved.map((e) => e.kind)).toEqual(['round', 'gate']);
    // Still newest first, so the Status tab's Activity and its round summary show the instant.
    const times = entries.map((e) => e.ts).filter((ts) => ts !== '');
    expect(times).toEqual([...times].sort().reverse());
    const movedIds: ReadonlySet<string> = new Set(timeline);
    const kept = goldenTimeline.filter((e) => !movedIds.has(e.id ?? ''));
    expect(entries.filter((e) => e.ts !== instant)).toEqual(kept);
  });

  test('on: the library document of harbor 002 carries the instant as `modified`, every other document as it was', async () => {
    const before = await read<LibraryCatalog>(workspaceRoutes.library(workspace), {});
    const after = await read<LibraryCatalog>(workspaceRoutes.library(workspace));
    expect(after.docs.find((d) => d.path === doc)?.modified).toBe(instant);
    const blank = (c: LibraryCatalog): unknown[] => c.docs.map((d) => (d.path === doc ? { ...d, modified: null } : d));
    expect(blank(after)).toEqual(blank(before));
    expect({ ...after, docs: [] }).toEqual({ ...before, docs: [] });
    expect((await ask(workspaceRoutes.libraryDoc(workspace, doc), { headers: on })).status).toBe(200);
  });

  test('on: lantern and every other harbor spec serve their goldens; the milestone target stays the calendar day it is', async () => {
    expect(await read<SpecPageModel>(specRoutes.spec(workspace, '003'))).toEqual(familyValue(workspace, 'spec', 'specs/003-config-loader') as SpecPageModel);
    expect(await read<SpecPageModel>(specRoutes.spec('lantern', '001'))).toEqual(familyValue('lantern', 'spec', 'specs/001-reading-list') as SpecPageModel);
    type Milestone = { slug: string; name: string; target: string | null; state: string; specs: unknown[] };
    type Milestones = { milestones: Milestone[] };
    for (const headers of [{}, on] as Headers[]) {
      const planning = await read<Milestones>(workspaceRoutes.planning(STUB_MILESTONE.workspace), headers);
      // The first open milestone some spec names: the one the area menu's summary shows as "next".
      const next = planning.milestones.find((m) => m.specs.length > 0 && m.state !== 'complete');
      expect(next && { slug: next.slug, name: next.name, target: next.target }).toEqual({
        slug: STUB_MILESTONE.slug,
        name: STUB_MILESTONE.name,
        target: STUB_MILESTONE.target,
      });
    }
    // A calendar day, not an instant: misread as one (UTC midnight), the west shows the day before, the east the day.
    expect(STUB_MILESTONE.target).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(local(STUB_MILESTONE.target, STUB_MIDNIGHT.zones.west.timezoneId).day).toBe(STUB_MILESTONE.misreadWest);
    expect(local(STUB_MILESTONE.target, STUB_MIDNIGHT.zones.east.timezoneId).day).toBe(STUB_MILESTONE.target);
  });
});
