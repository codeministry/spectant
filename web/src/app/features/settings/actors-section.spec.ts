import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ActorMapping } from '../../../../../server/src/contracts/spec-routes.contract';
import { ApiClient, type ApiResult, type PutResult } from '../../core/api.service';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ActorsSection } from './actors-section';

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const STORED: readonly ActorMapping[] = [{ id: 'u:0a1b2c3d', displayName: 'Ada Example', gitIdentities: ['ada@example.test'] }];
/** A dashboard naming the stored person and one nobody mapped yet (an assignee and a lock holder). */
const DASHBOARD = {
  specs: [{ id: '001', assignee: { raw: 'u:0a1b2c3d', kind: 'person', id: 'u:0a1b2c3d', legacy: false } }],
  locks: [{ session: 'u:9e8d7c6b' }, { session: 'a:claude:sess-1' }],
};

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'actors' | 'putActors' | 'boardQuery'>;
let puts: Array<readonly ActorMapping[]> = [];

function setUp(stored: readonly ActorMapping[] = STORED): void {
  puts = [];
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok(DASHBOARD)),
    planning: () => Promise.resolve({ kind: 'not-found', served: false }),
    actors: () => Promise.resolve(ok(stored)),
    putActors: (list): Promise<PutResult<readonly ActorMapping[]>> => {
      puts.push(list);
      return Promise.resolve({ kind: 'ok', body: list });
    },
    boardQuery: () => Promise.resolve({ kind: 'not-found', served: false }),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
}

async function render() {
  const fixture = TestBed.createComponent(ActorsSection);
  await fixture.whenStable();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

const row = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-actor-row="${id}"]`);
const field = (root: HTMLElement, id: string, name: 'name' | 'git') =>
  row(root, id)?.querySelector<HTMLInputElement>(`input[data-actor-${name}]`) ?? null;

function type(input: HTMLInputElement | null, value: string): void {
  if (!input) throw new Error('no input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ActorsSection', () => {
  it('renders one row per known person id: the stored list, then the ids the workspace data names, by id', async () => {
    setUp();
    const { root } = await render();
    const ids = [...root.querySelectorAll('[data-actor-row]')].map((r) => r.getAttribute('data-actor-row'));
    expect(ids).toEqual(['u:0a1b2c3d', 'u:9e8d7c6b']);
    expect(field(root, 'u:0a1b2c3d', 'name')?.value).toBe('Ada Example');
    expect(field(root, 'u:0a1b2c3d', 'git')?.value).toBe('ada@example.test');
    expect(row(root, 'u:0a1b2c3d')?.querySelector('ui-actor-chip .chip-label')?.textContent.trim()).toBe('Ada Example');
  });

  it('shows an unmapped id raw, in mono, with empty fields', async () => {
    setUp();
    const { root } = await render();
    const chip = row(root, 'u:9e8d7c6b')?.querySelector('ui-actor-chip .chip-label');
    expect(chip?.textContent.trim()).toBe('u:9e8d7c6b');
    expect(chip?.classList.contains('mono')).toBe(true);
    expect(field(root, 'u:9e8d7c6b', 'name')?.value).toBe('');
  });

  it('an edit and save sends the whole list through putActors, identities as an array, blank names left out', async () => {
    setUp();
    const { fixture, root } = await render();
    type(field(root, 'u:9e8d7c6b', 'name'), 'Bo Example');
    type(field(root, 'u:9e8d7c6b', 'git'), 'bo@example.test, bo@work.example.test');
    type(field(root, 'u:0a1b2c3d', 'git'), 'ada@example.test,ada@work.example.test');
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[data-actors-save]')?.click();
    await fixture.whenStable();
    expect(puts).toEqual([
      [
        { id: 'u:0a1b2c3d', displayName: 'Ada Example', gitIdentities: ['ada@example.test', 'ada@work.example.test'] },
        { id: 'u:9e8d7c6b', displayName: 'Bo Example', gitIdentities: ['bo@example.test', 'bo@work.example.test'] },
      ],
    ]);
    expect(root.querySelector('[data-actors-status]')?.getAttribute('data-state')).toBe('saved');
  });

  it('clearing a stored name drops that mapping from the list it sends', async () => {
    setUp();
    const { fixture, root } = await render();
    type(field(root, 'u:0a1b2c3d', 'name'), '');
    await fixture.whenStable();
    root.querySelector<HTMLButtonElement>('[data-actors-save]')?.click();
    await fixture.whenStable();
    expect(puts).toEqual([[]]);
  });
});
