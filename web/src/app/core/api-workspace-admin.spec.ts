import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { IMAGE_MAX_BYTES, type WorkspaceAdminSummary, workspaceAdminRoutes } from '../../../../server/src/workspace-admin.contract';
import { ApiClient } from './api.service';

describe('ApiClient workspace admin (spec 016, T13, ISC-303)', () => {
  let api: ApiClient;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const summary: WorkspaceAdminSummary = {
    slug: 'harbor',
    name: 'Harbor',
    pathTail: 'harbor',
    readable: true,
    counts: null,
    status: 'empty',
    images: { logo: null, screenshot: null },
  };

  it('adds with POST /api/workspaces and the body as sent, 201 answering ok with the summary', async () => {
    const result = api.addWorkspace({ path: '/x/harbor', name: 'Harbor' });
    const request = http.expectOne(workspaceAdminRoutes.add());
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ path: '/x/harbor', name: 'Harbor' });
    request.flush(summary, { status: 201, statusText: 'Created' });
    expect(await result).toEqual({ kind: 'ok', body: summary });
  });

  it('maps the contract refusals of add to refused with their code, duplicate-path with the slug', async () => {
    const missing = api.addWorkspace({ path: '/nope' });
    http.expectOne(workspaceAdminRoutes.add()).flush({ error: 'not-a-directory' }, { status: 422, statusText: 'Unprocessable' });
    expect(await missing).toEqual({ kind: 'refused', status: 422, body: { error: 'not-a-directory' } });

    const twice = api.addWorkspace({ path: '/x/harbor' });
    http.expectOne(workspaceAdminRoutes.add()).flush({ error: 'duplicate-path', slug: 'harbor' }, { status: 422, statusText: 'Unprocessable' });
    expect(await twice).toEqual({ kind: 'refused', status: 422, body: { error: 'duplicate-path', slug: 'harbor' } });

    const blank = api.addWorkspace({ path: ' ' });
    http.expectOne(workspaceAdminRoutes.add()).flush({ error: 'invalid-path' }, { status: 400, statusText: 'Bad Request' });
    expect(await blank).toEqual({ kind: 'refused', status: 400, body: { error: 'invalid-path' } });
  });

  it('answers a body that fits no contract error, or no answer at all, as error', async () => {
    const odd = api.addWorkspace({ path: '/x' });
    http.expectOne(workspaceAdminRoutes.add()).flush('boom', { status: 500, statusText: 'Server Error' });
    expect(await odd).toEqual({ kind: 'error', status: 500 });

    const dup = api.addWorkspace({ path: '/x' });
    http.expectOne(workspaceAdminRoutes.add()).flush({ error: 'duplicate-path' }, { status: 422, statusText: 'Unprocessable' });
    expect(await dup).toEqual({ kind: 'error', status: 422 });

    const gone = api.addWorkspace({ path: '/x' });
    http.expectOne(workspaceAdminRoutes.add()).error(new ProgressEvent('error'), { status: 0 });
    expect(await gone).toEqual({ kind: 'error', status: 0 });
  });

  it('renames with PATCH /api/workspaces/:ws and only the name', async () => {
    const result = api.renameWorkspace('a b', 'Harbor 2');
    const request = http.expectOne('/api/workspaces/a%20b');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Harbor 2' });
    request.flush({ ...summary, name: 'Harbor 2' });
    expect(await result).toEqual({ kind: 'ok', body: { ...summary, name: 'Harbor 2' } });
  });

  it('rescans with POST …/rescan and no body; an unknown workspace is refused not-found', async () => {
    const result = api.rescanWorkspace('harbor');
    const request = http.expectOne(workspaceAdminRoutes.rescan('harbor'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toBeNull();
    request.flush({ error: 'not-found' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toEqual({ kind: 'refused', status: 404, body: { error: 'not-found' } });
  });

  it('removes with DELETE /api/workspaces/:ws, 204 answering ok with no body', async () => {
    const result = api.removeWorkspace('harbor');
    const request = http.expectOne(workspaceAdminRoutes.remove('harbor'));
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(await result).toEqual({ kind: 'ok', body: null });
  });

  it('uploads an image with PUT …/images/:kind and the raw bytes; 413 and 415 are refused', async () => {
    const file = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' });
    const stored = api.uploadWorkspaceImage('harbor', 'logo', file);
    const request = http.expectOne(workspaceAdminRoutes.image('harbor', 'logo'));
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toBe(file);
    const url = workspaceAdminRoutes.imageUrl('harbor', 'logo', 'abc');
    request.flush({ kind: 'logo', url });
    expect(await stored).toEqual({ kind: 'ok', body: { kind: 'logo', url } });

    const big = api.uploadWorkspaceImage('harbor', 'screenshot', file);
    http
      .expectOne(workspaceAdminRoutes.image('harbor', 'screenshot'))
      .flush({ error: 'too-large', maxBytes: IMAGE_MAX_BYTES }, { status: 413, statusText: 'Too Large' });
    expect(await big).toEqual({ kind: 'refused', status: 413, body: { error: 'too-large', maxBytes: IMAGE_MAX_BYTES } });

    const svg = api.uploadWorkspaceImage('harbor', 'logo', file);
    http.expectOne(workspaceAdminRoutes.image('harbor', 'logo')).flush({ error: 'unsupported-type' }, { status: 415, statusText: 'Unsupported' });
    expect(await svg).toEqual({ kind: 'refused', status: 415, body: { error: 'unsupported-type' } });
  });

  it('builds the image URL with the contract builder, no request', () => {
    expect(api.workspaceImageUrl('a b', 'screenshot', 'v1')).toBe('/api/workspaces/a%20b/images/screenshot?v=v1');
  });
});
