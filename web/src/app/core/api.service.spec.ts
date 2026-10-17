import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { DocsPage, LibraryCatalog } from '../../../../core/src/files';
import type { ActorMapping, IdeaPage, LibrarySearchResult } from '../../../../server/src/spec-routes.contract';
import { ApiClient, type PlanningBody, planningUrl } from './api.service';

const PLANNING_URL = '/api/workspaces/harbor/planning';

describe('ApiClient.planning', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // The body is opaque to the client: it is served as it is, so a stand-in typed as the contract's body is enough.
  const body = { features: [] } as unknown as PlanningBody;

  it('reads /api/workspaces/:ws/planning, the contract builder', () => {
    expect(planningUrl('harbor')).toBe(PLANNING_URL);
    expect(planningUrl('a b')).toBe('/api/workspaces/a%20b/planning');
    void api.planning('harbor');
    http.expectOne(PLANNING_URL).flush(body);
  });

  it('answers a 200 as ok with the body and the ETag', async () => {
    const result = api.planning('harbor');
    http.expectOne(PLANNING_URL).flush(body, { headers: { ETag: '"p1"' } });
    expect(await result).toEqual({ kind: 'ok', body, etag: '"p1"', notModified: false });
  });

  it('replays the cached body on a 304, flagged notModified', async () => {
    const first = api.planning('harbor');
    http.expectOne(PLANNING_URL).flush(body, { headers: { ETag: '"p1"' } });
    await first;

    const second = api.planning('harbor');
    const request = http.expectOne(PLANNING_URL);
    expect(request.request.headers.get('If-None-Match')).toBe('"p1"');
    request.flush(null, { status: 304, statusText: 'Not Modified', headers: new HttpHeaders() });
    expect(await second).toEqual({ kind: 'ok', body, etag: '"p1"', notModified: true });
  });

  it('maps a contract 404 to not-found, served', async () => {
    const result = api.planning('harbor');
    http.expectOne(PLANNING_URL).flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toEqual({ kind: 'not-found', served: true });
  });

  it('maps the unreadable workspace 409 to unavailable with its summary', async () => {
    const summary = { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: false, error: 'missing', counts: null };
    const result = api.planning('harbor');
    http.expectOne(PLANNING_URL).flush(summary, { status: 409, statusText: 'Conflict' });
    expect(await result).toEqual({ kind: 'unavailable', body: summary });
  });
});

// ─── Spec 008 (T111, ISC-130): the transition, the allocation, the story page, the actor names, the board query ──

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const VIEWER = 'u:3f9c0a7d';
const LOCK = { source: 'activity', claim: 'ISC-1', session: 'round-1', actor: null, since: '2026-10-12T10:00:00.000Z' };

describe('ApiClient spec 008 routes', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('transition', () => {
    const URL = '/api/workspaces/harbor/specs/003/transition';
    const event = { ts: '2026-10-12T10:00:00.000Z', from: 'tasks', to: 'review', command: 'board', actor: VIEWER };
    const written = { from: 'tasks', to: 'review', hash: HEX_B, event, lockSource: 'none' };

    it('POSTs {to, hash} to the contract route and answers the validated 200', async () => {
      const result = api.transition('harbor', '003', 'review', HEX_A);
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ to: 'review', hash: HEX_A });
      request.flush(written);
      expect(await result).toEqual({ kind: 'answer', answer: { status: 200, body: written } });
    });

    it('answers the 409, the 422 and the 423 as typed answers', async () => {
      const stale = { error: 'hash-mismatch', files: ['spec.md'], expected: { spec: HEX_B } };
      const conflict = api.transition('harbor', '003', 'review', HEX_A);
      http.expectOne(URL).flush(stale, { status: 409, statusText: 'Conflict' });
      expect(await conflict).toEqual({ kind: 'answer', answer: { status: 409, body: stale } });

      const refusal = { error: 'transition-refused', reason: 'build needs a fresh reviewed mark', command: '/spec-review 003' };
      const refused = api.transition('harbor', '003', 'build', HEX_A);
      http.expectOne(URL).flush(refusal, { status: 422, statusText: 'Unprocessable Entity' });
      expect(await refused).toEqual({ kind: 'answer', answer: { status: 422, body: refusal } });

      const lockedBody = { error: 'locked', lock: LOCK };
      const locked = api.transition('harbor', '003', 'review', HEX_A);
      http.expectOne(URL).flush(lockedBody, { status: 423, statusText: 'Locked' });
      expect(await locked).toEqual({ kind: 'answer', answer: { status: 423, body: lockedBody } });
    });

    it('answers a body that does not fit its status, a 404 and a network failure as error', async () => {
      const unfit = api.transition('harbor', '003', 'review', HEX_A);
      http.expectOne(URL).flush({ ...written, to: 'build' });
      expect(await unfit).toEqual({ kind: 'error', status: 200 });

      const missing = api.transition('harbor', '003', 'review', HEX_A);
      http.expectOne(URL).flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
      expect(await missing).toEqual({ kind: 'error', status: 404 });

      const offline = api.transition('harbor', '003', 'review', HEX_A);
      http.expectOne(URL).error(new ProgressEvent('error'));
      expect(await offline).toEqual({ kind: 'error', status: 0 });
    });
  });

  describe('allocate', () => {
    const URL = '/api/workspaces/harbor/ideas/tide-tables/allocate';
    const allocated = {
      id: '007',
      folder: 'specs/007-tide-tables/',
      files: ['specs/007-tide-tables/context.md', 'specs/007-tide-tables/spec.md', 'specs/007-tide-tables/events.jsonl'],
      removed: 'specs/ideas/tide-tables.md',
      lockSource: 'none',
    };

    it('POSTs {hash} to the contract route and answers the validated 200', async () => {
      const result = api.allocate('harbor', 'tide-tables', HEX_A);
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ hash: HEX_A });
      request.flush(allocated);
      expect(await result).toEqual({ kind: 'answer', answer: { status: 200, body: allocated } });
    });

    it('answers the 409 and the 422 as typed answers, an unfit 200 as error', async () => {
      const stale = { error: 'hash-mismatch', files: ['specs/ideas/tide-tables.md'], expected: { idea: HEX_B } };
      const conflict = api.allocate('harbor', 'tide-tables', HEX_A);
      http.expectOne(URL).flush(stale, { status: 409, statusText: 'Conflict' });
      expect(await conflict).toEqual({ kind: 'answer', answer: { status: 409, body: stale } });

      const refusal = { error: 'allocate-refused', reason: 'not-in-index', folder: 'specs/007-tide-tables/' };
      const refused = api.allocate('harbor', 'tide-tables', HEX_A);
      http.expectOne(URL).flush(refusal, { status: 422, statusText: 'Unprocessable Entity' });
      expect(await refused).toEqual({ kind: 'answer', answer: { status: 422, body: refusal } });

      const unfit = api.allocate('harbor', 'tide-tables', HEX_A);
      http.expectOne(URL).flush({ ...allocated, id: '008' });
      expect(await unfit).toEqual({ kind: 'error', status: 200 });
    });
  });

  describe('idea', () => {
    const URL = '/api/workspaces/harbor/ideas/tide-tables';
    const page = { idea: { slug: 'tide-tables' }, page: { html: '<p>x</p>' }, hash: HEX_A } as unknown as IdeaPage;

    it('GETs the story page and replays it on a 304 from the ETag cache', async () => {
      const first = api.idea('harbor', 'tide-tables');
      http.expectOne(URL).flush(page, { headers: { ETag: '"i1"' } });
      expect(await first).toEqual({ kind: 'ok', body: page, etag: '"i1"', notModified: false });

      const second = api.idea('harbor', 'tide-tables');
      const request = http.expectOne(URL);
      expect(request.request.headers.get('If-None-Match')).toBe('"i1"');
      request.flush(null, { status: 304, statusText: 'Not Modified' });
      expect(await second).toEqual({ kind: 'ok', body: page, etag: '"i1"', notModified: true });
    });

    it('maps the contract 404 of an unknown story to not-found, served', async () => {
      const result = api.idea('harbor', 'nope');
      http.expectOne('/api/workspaces/harbor/ideas/nope').flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
      expect(await result).toEqual({ kind: 'not-found', served: true });
    });
  });

  describe('actors', () => {
    const URL = '/api/actors';
    const list: readonly ActorMapping[] = [{ id: 'u:3f9c0a7d', displayName: 'Harbour Master', gitIdentities: ['master@harbor.test'] }];

    it('GETs the whole mapping with its ETag', async () => {
      const result = api.actors();
      http.expectOne(URL).flush(list, { headers: { ETag: '"a1"' } });
      expect(await result).toEqual({ kind: 'ok', body: list, etag: '"a1"', notModified: false });
    });

    it('PUTs the whole list and answers the list as stored; a 400 and an unfit body are errors', async () => {
      const saved = api.putActors(list);
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual(list);
      request.flush(list);
      expect(await saved).toEqual({ kind: 'ok', body: list });

      const invalid = api.putActors(list);
      http.expectOne(URL).flush({ error: 'invalid-body' }, { status: 400, statusText: 'Bad Request' });
      expect(await invalid).toEqual({ kind: 'error', status: 400, error: 'invalid-body' });

      const unfit = api.putActors(list);
      http.expectOne(URL).flush([{ id: 'u:3f9c0a7d' }]);
      expect(await unfit).toEqual({ kind: 'error', status: 200, error: null });
    });
  });

  describe('board query', () => {
    const URL = '/api/workspaces/harbor/board-query';

    it('GETs the remembered query of the workspace', async () => {
      const result = api.boardQuery('harbor');
      http.expectOne(URL).flush({ query: 'feature=F1' }, { headers: { ETag: '"q1"' } });
      expect(await result).toEqual({ kind: 'ok', body: { query: 'feature=F1' }, etag: '"q1"', notModified: false });
    });

    it('PUTs {query} and answers the stored query; an unknown workspace is a 404 error', async () => {
      const saved = api.putBoardQuery('harbor', 'group=feature&col=build');
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ query: 'group=feature&col=build' });
      request.flush({ query: 'group=feature&col=build' });
      expect(await saved).toEqual({ kind: 'ok', body: { query: 'group=feature&col=build' } });

      const missing = api.putBoardQuery('nowhere', '');
      http.expectOne('/api/workspaces/nowhere/board-query').flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
      expect(await missing).toEqual({ kind: 'error', status: 404, error: 'not-found' });
    });
  });

  describe('spec hash', () => {
    it('keeps X-Spectant-Spec-Hash of the last spec read, which the transition sends', async () => {
      expect(api.specHash('harbor', '003')).toBeNull();
      const result = api.spec('harbor', '003');
      http.expectOne('/api/workspaces/harbor/specs/003').flush({}, { headers: { 'X-Spectant-Spec-Hash': HEX_A } });
      await result;
      expect(api.specHash('harbor', '003')).toBe(HEX_A);
    });
  });

  // T13 · ISC-195: the backlog write of spec 036, `POST …/:ws/backlog` with the op and the raw hash of
  // `specs/backlog.md` in the body (no header), every answer typed through the contract's `writeAnswerOf`.
  describe('backlog', () => {
    const URL = '/api/workspaces/harbor/backlog';
    const event = { ts: '2026-10-17T10:00:00.000Z', actor: VIEWER, kind: 'move', feature: 'F2', from: 3, to: 1 };
    const written = { hash: HEX_B, event };

    it('POSTs the move with its hash in the body and answers the validated 200', async () => {
      const result = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_A);
      const request = http.expectOne(URL);
      expect(request.request.method).toBe('POST');
      expect(request.request.body).toEqual({ op: 'move', feature: 'F2', before: 'F1', hash: HEX_A });
      expect(request.request.headers.keys()).toEqual([]);
      request.flush(written);
      expect(await result).toEqual({ kind: 'answer', answer: { status: 200, body: written } });
    });

    it('POSTs a priority and a move to the end (before null) the same way', async () => {
      const priority = api.backlog('harbor', { op: 'priority', feature: 'F2', priority: 'P1' }, HEX_A);
      const first = http.expectOne(URL);
      expect(first.request.body).toEqual({ op: 'priority', feature: 'F2', priority: 'P1', hash: HEX_A });
      const set = { hash: HEX_B, event: { ...event, kind: 'priority', from: 'P3', to: 'P1' } };
      first.flush(set);
      expect(await priority).toEqual({ kind: 'answer', answer: { status: 200, body: set } });

      const last = api.backlog('harbor', { op: 'move', feature: 'F2', before: null }, HEX_B);
      const second = http.expectOne(URL);
      expect(second.request.body).toEqual({ op: 'move', feature: 'F2', before: null, hash: HEX_B });
      second.flush(written);
      await last;
    });

    it('answers the 409 StaleBacklog and the 422 BacklogRefused as typed answers, never cached or retried', async () => {
      const stale = { error: 'hash-mismatch', files: ['specs/backlog.md'], expected: { backlog: HEX_B } };
      const conflict = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_A);
      http.expectOne(URL).flush(stale, { status: 409, statusText: 'Conflict' });
      expect(await conflict).toEqual({ kind: 'answer', answer: { status: 409, body: stale } });

      const refusal = { error: 'backlog-refused', reason: 'F2 already stands there: nothing to move' };
      const refused = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_B);
      http.expectOne(URL).flush(refusal, { status: 422, statusText: 'Unprocessable Entity' });
      expect(await refused).toEqual({ kind: 'answer', answer: { status: 422, body: refusal } });

      const again = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_B);
      http.expectOne(URL).flush(written);
      expect(await again).toEqual({ kind: 'answer', answer: { status: 200, body: written } });
    });

    it('answers a body that does not fit, a 423 and a network failure as error', async () => {
      const unfit = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_A);
      http.expectOne(URL).flush({ hash: 'nope', event });
      expect(await unfit).toEqual({ kind: 'error', status: 200 });

      const locked = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_A);
      http.expectOne(URL).flush({ error: 'locked', lock: LOCK }, { status: 423, statusText: 'Locked' });
      expect(await locked).toEqual({ kind: 'error', status: 423 });

      const offline = api.backlog('harbor', { op: 'move', feature: 'F2', before: 'F1' }, HEX_A);
      http.expectOne(URL).error(new ProgressEvent('error'));
      expect(await offline).toEqual({ kind: 'error', status: 0 });
    });
  });
});

describe('ApiClient library routes (spec 017, T25, ISC-156)', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const URL = '/api/workspaces/harbor/library';
  const catalog: LibraryCatalog = { docs: [], groups: [], fog: [], missing: 0, stale: 0 };

  it('GETs the catalog from the contract builder and replays it on a 304', async () => {
    const first = api.library('harbor');
    http.expectOne(URL).flush(catalog, { headers: { ETag: '"c1"' } });
    expect(await first).toEqual({ kind: 'ok', body: catalog, etag: '"c1"', notModified: false });

    const second = api.library('harbor');
    const request = http.expectOne(URL);
    expect(request.request.headers.get('If-None-Match')).toBe('"c1"');
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    expect(await second).toEqual({ kind: 'ok', body: catalog, etag: '"c1"', notModified: true });
  });

  it('maps the contract 404 to not-found and the unreadable workspace 409 to unavailable', async () => {
    const missing = api.library('a b');
    http.expectOne('/api/workspaces/a%20b/library').flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await missing).toEqual({ kind: 'not-found', served: true });

    const summary = { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: false, error: 'missing', counts: null };
    const unavailable = api.library('harbor');
    http.expectOne(URL).flush(summary, { status: 409, statusText: 'Conflict' });
    expect(await unavailable).toEqual({ kind: 'unavailable', body: summary });
  });

  it('GETs one document by its catalog path, encoded once, and maps an unlisted path to not-found', async () => {
    const page = { html: '<h1>Plan</h1>' } as unknown as DocsPage;
    const read = api.libraryDoc('harbor', '017-workspace-library/plan.md');
    http.expectOne(`${URL}/doc?path=017-workspace-library%2Fplan.md`).flush(page);
    expect(await read).toEqual({ kind: 'ok', body: page, etag: null, notModified: false });

    const unlisted = api.libraryDoc('harbor', '../secret.md');
    http.expectOne(`${URL}/doc?path=..%2Fsecret.md`).flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await unlisted).toEqual({ kind: 'not-found', served: true });
  });

  it('GETs the search with q encoded once, and answers an empty query without a request', async () => {
    const result: LibrarySearchResult = { query: 'a&b', hits: [{ path: 'tech.md', snippet: '… a&b …' }] };
    const search = api.librarySearch('harbor', 'a&b');
    http.expectOne(`${URL}/search?q=a%26b`).flush(result);
    expect(await search).toEqual({ kind: 'ok', body: result, etag: null, notModified: false });

    expect(await api.librarySearch('harbor', '   ')).toEqual({ kind: 'ok', body: { query: '', hits: [] }, etag: null, notModified: false });
  });

  it('builds the asset and prototype URLs without a request; a non-prototype has none', () => {
    expect(api.libraryAssetUrl('harbor', '.tech/a b.png')).toBe(`${URL}/asset?path=.tech%2Fa%20b.png`);
    const root = { path: '017-x/.design/prototype', spec: '017-x', type: 'prototype' as const };
    expect(api.prototypeUrl('harbor', root, 'index.html')).toBe('/proto/harbor/017-x/prototype/index.html');
    const nested = { path: '017-x/.design/prototype/board', spec: '017-x', type: 'prototype' as const };
    expect(api.prototypeUrl('a b', nested, 'pages/two page.html')).toBe('/proto/a%20b/017-x/prototype%2Fboard/pages/two%20page.html');
    expect(api.prototypeUrl('harbor', { path: '017-x/plan.md', spec: '017-x', type: 'plan' }, 'index.html')).toBeNull();
    // archived (spec 034, ISC-187.1): the path lies below archive/, the route names the spec folder.
    const archived = { path: 'archive/001-x/.design/prototype', spec: '001-x', type: 'prototype' as const, archived: true as const };
    expect(api.prototypeUrl('harbor', archived, 'index.html')).toBe('/proto/harbor/001-x/prototype/index.html');
  });
});
