import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
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
