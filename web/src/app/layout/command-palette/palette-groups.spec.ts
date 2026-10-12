import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ClaimGlyphState, ClaimViewModel } from '../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { PALETTE_SOURCES, type PaletteSource } from '../../core/palette-sources';
import { CLAIMS_ORDER, IDEAS_ORDER, isClaim, isIdea, providePaletteGroups, TECH_ORDER } from './palette-groups';
import { PaletteIndex } from './palette-index';
import { CLAIMS_GROUP, RANK, rankEntries } from './palette-ranking';

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

  it('has no Tech group outside a workspace', async () => {
    expect(byId(await open('/'), 'tech').entries()).toEqual([]);
  });

  it('keeps Help and drops Open board outside a workspace', async () => {
    const outside = byId(await open('/'), 'actions').entries();
    expect(outside.some((entry) => entry.id === 'action/open-board')).toBe(false);
    expect(outside.some((entry) => entry.id === 'action/help')).toBe(true);
  });
});

// T21 · ISC-134.2: spec 023's tech page in the palette, the page and one entry per tab for the open workspace.
describe('spec 023 palette entries (T21, ISC-134.2)', () => {
  it('lists Tech and Tech · <Tab> for each of the five tabs, leading to the page and to each tab', async () => {
    const tech = byId(await open('/w/harbor'), 'tech');
    expect(tech.labelKey).toBe('tech.title');
    expect(tech.order).toBe(TECH_ORDER);
    expect(tech.entries().map((entry) => [entry.id, entry.label, entry.link])).toEqual([
      ['tech/harbor', 'Tech', ['/w', 'harbor', 'tech']],
      ['tech/harbor/overview', 'Tech · Overview', ['/w', 'harbor', 'tech', 'overview']],
      ['tech/harbor/architecture', 'Tech · Architecture', ['/w', 'harbor', 'tech', 'architecture']],
      ['tech/harbor/status', 'Tech · Status', ['/w', 'harbor', 'tech', 'status']],
      ['tech/harbor/specs', 'Tech · Specs', ['/w', 'harbor', 'tech', 'specs']],
      ['tech/harbor/open', 'Tech · Open', ['/w', 'harbor', 'tech', 'open']],
    ]);
    // Every entry navigates (Enter follows the link and Recent remembers it); none runs a command.
    expect(tech.entries().some((entry) => 'run' in entry)).toBe(false);
  });

  it('finds Tech · Architecture first for the query "arch"', async () => {
    const tech = byId(await open('/w/harbor/tech/overview'), 'tech');
    const ranked = rankEntries(tech.entries(), 'arch');
    expect(ranked[0]?.entry.label).toBe('Tech · Architecture');
    expect(ranked[0]?.entry.link).toEqual(['/w', 'harbor', 'tech', 'architecture']);
    expect(ranked.filter((hit) => hit.rank === RANK.idPrefix).map((hit) => hit.entry.label)).toEqual(['Tech · Architecture']);
  });
});

// 019 T4 · ISC-139: the Claims group lists every claim of the readable workspaces, its ISC as the chip, leading to the
// claim card's anchor on the claims tab, with the status as a word and the accessible name from `palette.claimHit`.
describe('spec 019 Claims group (T4, ISC-139)', () => {
  const claimsBody = (claims: ReadonlyArray<{ id: string; text: string; state: ClaimGlyphState }>): ClaimViewModel =>
    ({ claims }) as unknown as ClaimViewModel;

  beforeEach(() => {
    const api: Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'claims'> = {
      workspaces: () =>
        Promise.resolve(
          ok([
            { slug: 'harbor', name: 'Harbor', pathTail: 'harbor', readable: true, counts: null },
            { slug: 'lantern', name: 'Lantern', pathTail: 'lantern', readable: true, counts: null },
          ]),
        ),
      dashboard: (ws: string) => Promise.resolve(ok({ specs: [{ id: ws === 'harbor' ? '007' : '002', title: 'A spec' }], archive: [] })),
      planning: () => Promise.resolve(ok(PLANNING)),
      spec: () => Promise.resolve({ kind: 'not-found', served: false }),
      claims: (ws: string) =>
        Promise.resolve(
          ok(
            ws === 'harbor'
              ? claimsBody([
                  { id: 'ISC-126', text: 'The rotated token is used\n  without a restart.', state: 'taken' },
                  { id: 'ISC-126.1', text: 'The old token is revoked.', state: 'open' },
                ])
              : claimsBody([{ id: 'ISC-12', text: 'A lantern claim.', state: 'closed' }]),
          ),
        ),
    };
    TestBed.overrideProvider(ApiClient, { useValue: api });
  });

  async function claimsAt(url: string, count: number): Promise<PaletteSource> {
    const sources = await open(url);
    const claims = byId(sources, CLAIMS_GROUP);
    TestBed.inject(PaletteIndex).want();
    for (let i = 0; i < 20 && claims.entries().length < count; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return claims;
  }

  it('sits before Next up under the heading key palette.groups.claims', async () => {
    const sources = await open('/w/harbor');
    const claims = byId(sources, CLAIMS_GROUP);
    expect(claims.labelKey).toBe('palette.groups.claims');
    expect(claims.order).toBe(CLAIMS_ORDER);
    expect(CLAIMS_ORDER).toBeLessThan(byId(sources, 'nextUp').order);
  });

  it('lists the claims of the open workspace and of every other readable one, each leading to its card', async () => {
    const entries = (await claimsAt('/w/harbor', 3)).entries();
    expect(entries.map((entry) => [entry.id, entry.chip, entry.label, entry.meta, entry.link])).toEqual([
      ['claim:harbor:ISC-126', 'ISC-126', 'The rotated token is used without a restart.', 'Harbor · 007', '/w/harbor/s/007/claims#claim-ISC-126'],
      ['claim:harbor:ISC-126.1', 'ISC-126.1', 'The old token is revoked.', 'Harbor · 007', '/w/harbor/s/007/claims#claim-ISC-126.1'],
      ['claim:lantern:ISC-12', 'ISC-12', 'A lantern claim.', 'Lantern · 002', '/w/lantern/s/002/claims#claim-ISC-12'],
    ]);
    const first = entries.find(isClaim);
    if (first === undefined) throw new Error('not a claim entry');
    expect(first.keywords).toEqual(['126', 'taken']);
    expect(first.claim.statusWord).toBe('taken');
    expect(first.claim.accessibleName).toBe('ISC-126, The rotated token is used without a restart., spec 007, workspace Harbor, taken');
    // Every claim navigates (Enter follows the link and Recent remembers it); none runs a command.
    expect(entries.some((entry) => 'run' in entry)).toBe(false);
  });

  it('lists every readable workspace\'s claims with no workspace open', async () => {
    const entries = (await claimsAt('/', 3)).entries();
    expect(entries.map((entry) => entry.id).sort()).toEqual(['claim:harbor:ISC-126', 'claim:harbor:ISC-126.1', 'claim:lantern:ISC-12']);
  });
});
