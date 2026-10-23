import { HttpHeaders, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { STATUS_PATH, type StatusResponse } from '../../../../server/src/contracts/status.contract';
import { ApiClient } from './api.service';

describe('ApiClient status (spec 071, T16, ISC-593)', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const body: StatusResponse = {
    kpis: { repos: 1, listed: 1, claimsClosed: 2, claimsTotal: 5 },
    workspaces: [
      {
        slug: 'harbor',
        pathTail: 'harbor',
        readable: true,
        error: null,
        specs: [
          {
            id: '001',
            slug: '001-dock',
            title: 'Dock',
            stage: 'build',
            claims: { closed: 2, total: 5 },
            closedAt: null,
            state: 'running',
            archived: false,
            nextCommand: '/spec implement 001',
          },
        ],
      },
    ],
  };

  it('GETs the contract path /api/status and answers a 200 as ok with the body and the ETag', async () => {
    expect(STATUS_PATH).toBe('/api/status');
    const result = api.status();
    const request = http.expectOne(STATUS_PATH);
    expect(request.request.method).toBe('GET');
    request.flush(body, { headers: { ETag: '"s1"' } });
    expect(await result).toEqual({ kind: 'ok', body, etag: '"s1"', notModified: false });
  });

  it('sends If-None-Match on the next read and replays the cached body on a 304', async () => {
    const first = api.status();
    http.expectOne(STATUS_PATH).flush(body, { headers: { ETag: '"s1"' } });
    await first;

    const second = api.status();
    const request = http.expectOne(STATUS_PATH);
    expect(request.request.headers.get('If-None-Match')).toBe('"s1"');
    request.flush(null, { status: 304, statusText: 'Not Modified', headers: new HttpHeaders() });
    expect(await second).toEqual({ kind: 'ok', body, etag: '"s1"', notModified: true });
  });

  it('maps a 403 to an error with its status, never a throw', async () => {
    const result = api.status();
    http.expectOne(STATUS_PATH).flush({ error: 'forbidden' }, { status: 403, statusText: 'Forbidden' });
    expect(await result).toEqual({ kind: 'error', status: 403 });
  });
});
