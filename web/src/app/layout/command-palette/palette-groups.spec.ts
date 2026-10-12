import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { PALETTE_SOURCES, type PaletteSource } from '../../core/palette-sources';
import { IDEAS_ORDER, isIdea, providePaletteGroups } from './palette-groups';

// T117 · ISC-124.2: spec 008's palette entries — "Open board" and "Help" among the actions, and the Ideas group listing
// the open workspace's stories with the idea chip, leading to their read-only page.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const PLANNING: PlanningBody = {
  workflow: { rows: [], source: 'default', diagnostics: [] },
  stages: ['idea', 'plan', 'build', 'done'],
  stageCounts: { idea: 2 },
  ideas: [
    { slug: 'board-swimlanes', title: 'Swimlanes on the board', type: 'feature', feature: 'F2', milestone: null, priority: 'P2', path: 'specs/ideas/board-swimlanes.md' },
    { slug: 'registry-webhooks', title: 'Webhooks for the registry', type: null, feature: null, milestone: null, priority: 'P3', path: 'specs/ideas/registry-webhooks.md' },
  ],
  features: [],
  milestones: [],
  recount: { closed: 0, total: 0 },
  diagnostics: [],
};

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

beforeEach(() => {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok({ specs: [], archive: [] })),
    planning: () => Promise.resolve(ok(PLANNING)),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }, ...providePaletteGroups()],
  });
});

async function open(url: string): Promise<readonly PaletteSource[]> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  return TestBed.inject(PALETTE_SOURCES);
}

const byId = (sources: readonly PaletteSource[], id: string): PaletteSource => {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`no palette source ${id}`);
  return source;
};

describe('spec 008 palette entries (T117, ISC-124.2)', () => {
  it('lists the stories of the open workspace as the Ideas group, with the idea chip, leading to their page', async () => {
    const ideas = byId(await open('/w/harbor/board'), 'ideas');
    expect(ideas.labelKey).toBe('palette.groups.ideas');
    expect(ideas.order).toBe(IDEAS_ORDER);
    const entries = ideas.entries();
    expect(entries.map((entry) => [entry.label, entry.chip, entry.meta, entry.link])).toEqual([
      ['Swimlanes on the board', 'board-swimlanes', 'F2', ['/w', 'harbor', 'ideas', 'board-swimlanes']],
      ['Webhooks for the registry', 'registry-webhooks', undefined, ['/w', 'harbor', 'ideas', 'registry-webhooks']],
    ]);
    expect(entries.every(isIdea)).toBe(true);
    expect(entries[0]?.keywords).toEqual(expect.arrayContaining(['board-swimlanes', 'Swimlanes on the board', 'F2']));
  });

  it('has no Ideas group outside a workspace', async () => {
    expect(byId(await open('/'), 'ideas').entries()).toEqual([]);
  });

  it('offers Open board in a workspace and Help everywhere, as navigating actions', async () => {
    const inWorkspace = byId(await open('/w/harbor'), 'actions').entries();
    const board = inWorkspace.find((entry) => entry.id === 'action/open-board');
    expect(board?.label).toBe('Open board');
    expect(board?.link).toEqual(['/w', 'harbor', 'board']);
    expect(inWorkspace.find((entry) => entry.id === 'action/help')).toMatchObject({ label: 'Help', link: ['/help'] });
    // Both navigate (Enter follows the link and remembers it), neither runs a command.
    expect(inWorkspace.filter((entry) => entry.id === 'action/open-board' || entry.id === 'action/help').some((entry) => 'run' in entry)).toBe(false);
  });

  it('keeps Help and drops Open board outside a workspace', async () => {
    const outside = byId(await open('/'), 'actions').entries();
    expect(outside.some((entry) => entry.id === 'action/open-board')).toBe(false);
    expect(outside.some((entry) => entry.id === 'action/help')).toBe(true);
  });
});
