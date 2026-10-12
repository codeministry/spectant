import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { TechModel } from '../../../../core/src/files';
import type { ActorMapping, IdeaPage } from '../../../../server/src/spec-routes.contract';
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
});

describe('ApiClient tech routes (spec 023, T9, ISC-134.1)', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const URL = '/api/workspaces/harbor/tech';
  // Served as it is: a stand-in typed as the contract's body is enough.
  const model = { pages: null, diagnostics: [], specs: [] } as unknown as TechModel;

  it('GETs /api/workspaces/:ws/tech from the contract builder and replays it on a 304', async () => {
    const first = api.tech('harbor');
    http.expectOne(URL).flush(model, { headers: { ETag: '"t1"' } });
    expect(await first).toEqual({ kind: 'ok', body: model, etag: '"t1"', notModified: false });

    const second = api.tech('harbor');
    const request = http.expectOne(URL);
    expect(request.request.headers.get('If-None-Match')).toBe('"t1"');
    request.flush(null, { status: 304, statusText: 'Not Modified' });
    expect(await second).toEqual({ kind: 'ok', body: model, etag: '"t1"', notModified: true });
  });

  it('encodes the workspace once and maps the contract 404 to not-found, served', async () => {
    const result = api.tech('a b');
    http.expectOne('/api/workspaces/a%20b/tech').flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toEqual({ kind: 'not-found', served: true });
  });

  it('maps the unreadable workspace 409 to unavailable and any other failure to error', async () => {
    const summary = { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: false, error: 'missing', counts: null };
    const unavailable = api.tech('harbor');
    http.expectOne(URL).flush(summary, { status: 409, statusText: 'Conflict' });
    expect(await unavailable).toEqual({ kind: 'unavailable', body: summary });

    const failed = api.tech('harbor');
    http.expectOne(URL).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(await failed).toEqual({ kind: 'error', status: 500 });
  });

  it('builds the asset URL from the contract, the path relative to specs/ encoded once, without a request', () => {
    expect(api.techAssetUrl('harbor', '.tech/architecture.png')).toBe('/api/workspaces/harbor/tech/asset?path=.tech%2Farchitecture.png');
    expect(api.techAssetUrl('a b', 'img/a b.svg')).toBe('/api/workspaces/a%20b/tech/asset?path=img%2Fa%20b.svg');
  });
});
