import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient, type ApiResult, type WorkspaceAdminResult, type WorkspaceListEntry } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import { ShellData } from './shell-data.service';
import { ShellState } from './shell-state.service';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const entry = (slug: string): WorkspaceListEntry => ({ slug, name: slug, pathTail: slug, readable: true, counts: null });

function setUp(write: () => Promise<WorkspaceAdminResult<'add'>>) {
  let lists = 0;
  const registry: WorkspaceListEntry[] = [entry('harbor')];
  const api = {
    workspaces: () => {
      lists += 1;
      return Promise.resolve(ok([...registry]));
    },
    actors: () => Promise.resolve(ok([])),
    addWorkspace: async () => {
      const result = await write();
      if (result.kind === 'ok') registry.push(entry(result.body.slug));
      return result;
    },
    renameWorkspace: write,
    rescanWorkspace: write,
    removeWorkspace: () => Promise.resolve({ kind: 'ok', body: null }),
    uploadWorkspaceImage: () => Promise.resolve({ kind: 'ok', body: { kind: 'logo', url: '/x' } }),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ApiClient, useValue: api },
      { provide: ShellState, useValue: { ws: signal<string | null>(null), specId: signal<string | null>(null) } },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
  return { data: TestBed.inject(ShellData), lists: () => lists };
}

async function settle(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  TestBed.tick();
}

const summary = (slug: string) =>
  ({ slug, name: slug, pathTail: slug, readable: true, counts: null, status: 'empty', images: { logo: null, screenshot: null } }) as const;

describe('ShellData workspace writes (spec 016, T13, ISC-303)', () => {
  it('reloads the workspace list after an accepted add, so the header menu lists the new entry', async () => {
    const { data, lists } = setUp(() => Promise.resolve({ kind: 'ok', body: summary('quay') }));
    await settle();
    expect(data.workspaceList().map((row) => row.slug)).toEqual(['harbor']);
    const before = lists();

    const result = await data.addWorkspace({ path: '/x/quay' });
    await settle();
    expect(result.kind).toBe('ok');
    expect(lists()).toBe(before + 1);
    expect(data.workspaceList().map((row) => row.slug)).toEqual(['harbor', 'quay']);
  });

  it('reloads after every accepted write: rename, rescan, remove, upload', async () => {
    const { data, lists } = setUp(() => Promise.resolve({ kind: 'ok', body: summary('harbor') }));
    await settle();
    const before = lists();
    await data.renameWorkspace('harbor', 'Harbor');
    await data.rescanWorkspace('harbor');
    await data.removeWorkspace('harbor');
    await data.uploadWorkspaceImage('harbor', 'logo', new Blob([]));
    await settle();
    expect(lists()).toBeGreaterThan(before);
  });

  it('leaves the list alone after a refused write', async () => {
    const { data, lists } = setUp(() => Promise.resolve({ kind: 'refused', status: 422, body: { error: 'not-a-directory' } }));
    await settle();
    const before = lists();
    const result = await data.addWorkspace({ path: '/nope' });
    await settle();
    expect(result).toEqual({ kind: 'refused', status: 422, body: { error: 'not-a-directory' } });
    expect(lists()).toBe(before);
  });
});
