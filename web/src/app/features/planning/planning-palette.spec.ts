import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { PALETTE_SOURCES, type PaletteSource } from '../../core/palette-sources';
import { featuresPaletteSource, milestonesPaletteSource } from './planning-palette';

// T43 · ISC-106: the Features and Milestones palette groups, contributed through `PALETTE_SOURCES` (spec 001's
// group API). The e2e `palette -g levels` (T44) proves them in the palette once 001's T66 renders the groups.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const DASHBOARD = {
  specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }],
  archive: [{ id: '001', title: 'Manifest sync', type: 'feature' }],
};

type Milestone = PlanningBody['milestones'][number];

const milestone = (name: string, target: string | null, state: Milestone['state'], specs: Milestone['specs']): Milestone => ({
  name,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  target,
  description: null,
  closed: 3,
  total: 4,
  state,
  features: [],
  specs,
});

const HOLDER = { id: '002', slug: '002-web-console', title: 'Web console', archived: false, main: true, held: 4, stage: null };

const planning = (milestones: readonly Milestone[]): PlanningBody => ({
  features: [
    { id: 'F0', name: 'Cross-cutting', why: null, closed: 0, total: 4, claims: [], holders: [], unheld: ['ISC-4'] },
    { id: 'F2', name: 'Web console', why: null, closed: 25, total: 30, claims: [], holders: [HOLDER], unheld: [] },
  ],
  milestones,
  recount: { closed: 25, total: 34 },
  diagnostics: [],
});

const NAMED = planning([milestone('Harbor 1.0', '2026-11-30', 'upcoming', [HOLDER]), milestone('Someday', null, 'upcoming', [])]);
const UNNAMED_ONLY = planning([milestone('Someday', '2027-06-01', 'upcoming', [])]);
const STATES = planning([
  milestone('Harbor 0.9', '2026-09-18', 'late', [HOLDER]),
  milestone('Harbor 1.0', '2026-11-30', 'upcoming', [HOLDER]),
  milestone('Archive sweep', '2026-08-01', 'complete', [HOLDER]),
  milestone('Someday', null, 'upcoming', [HOLDER]),
]);

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec'>;

function setUp(plan: ApiResult<PlanningBody>): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: () => Promise.resolve(plan),
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
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: PALETTE_SOURCES, useFactory: featuresPaletteSource, multi: true },
      { provide: PALETTE_SOURCES, useFactory: milestonesPaletteSource, multi: true },
    ],
  });
}

/** One harness per test; `go` moves it on. */
let harness: RouterTestingHarness | null = null;

async function go(url: string): Promise<void> {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
}

async function open(url: string): Promise<readonly PaletteSource[]> {
  await go(url);
  return TestBed.inject(PALETTE_SOURCES);
}

const byId = (sources: readonly PaletteSource[], id: string): PaletteSource => {
  const source = sources.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`no palette source ${id}`);
  return source;
};

describe('planning palette sources', () => {
  beforeEach(() => {
    harness = null;
  });

  it('registers Features (50) and Milestones (55) with their group keys', async () => {
    setUp(ok(NAMED));
    const sources = await open('/w/harbor');
    expect(sources.map((source) => [source.id, source.labelKey, source.order])).toEqual([
      ['features', 'palette.groups.features', 50],
      ['milestones', 'palette.groups.milestones', 55],
    ]);
  });

  it('lists one feature per block in master order, linking to its card with id, name and count', async () => {
    setUp(ok(NAMED));
    const features = byId(await open('/w/harbor'), 'features');
    expect(features.entries().map((entry) => [entry.id, entry.label, entry.chip, entry.meta, entry.link])).toEqual([
      ['feature-F0', 'Cross-cutting', 'F0', '0/4', '/w/harbor/features#F0'],
      ['feature-F2', 'Web console', 'F2', '25/30', '/w/harbor/features#F2'],
    ]);
    expect(features.entries()[1]?.keywords).toContain('epic');
  });

  it('lists only the milestones some spec names, linking to the row by slug, with the date and the state word', async () => {
    setUp(ok(NAMED));
    const milestones = byId(await open('/w/harbor'), 'milestones');
    expect(milestones.entries().map((entry) => [entry.id, entry.label, entry.chip, entry.meta, entry.link])).toEqual([
      ['milestone-harbor-1-0', 'Harbor 1.0', undefined, '2026-11-30 · upcoming', '/w/harbor/milestones#m-harbor-1-0'],
    ]);
  });

  it('translates the state word, shows it alone when undated, and recomputes on a language change', async () => {
    setUp(ok(STATES));
    const milestones = byId(await open('/w/harbor'), 'milestones');
    const metas = (): Array<string | undefined> => milestones.entries().map((entry) => entry.meta);
    expect(metas()).toEqual(['2026-09-18 · late', '2026-11-30 · upcoming', '2026-08-01 · complete', 'upcoming']);

    TestBed.inject(TranslocoService).setActiveLang('de');
    expect(metas()).toEqual(['2026-09-18 · überfällig', '2026-11-30 · bevorstehend', '2026-08-01 · abgeschlossen', 'bevorstehend']);
  });

  it('carries no chip and keeps the state word out of what the filter ranks as an ID', async () => {
    setUp(ok(STATES));
    const milestones = byId(await open('/w/harbor'), 'milestones');
    // palette-ranking.ts ranks the chip and every keyword on the ID tiers: "up" must not hit every upcoming milestone.
    for (const entry of milestones.entries()) {
      expect(entry.chip).toBeUndefined();
      for (const word of ['upcoming', 'late', 'complete']) expect(entry.keywords).not.toContain(word);
    }
  });

  it('is empty, hence absent, while no spec names a milestone, and without a workspace', async () => {
    setUp(ok(UNNAMED_ONLY));
    const sources = await open('/w/harbor');
    expect(byId(sources, 'milestones').entries()).toEqual([]);
    expect(byId(sources, 'features').entries()).toHaveLength(2);

    await go('/');
    expect(byId(sources, 'features').entries()).toEqual([]);
    expect(byId(sources, 'milestones').entries()).toEqual([]);
  });

  it('serialises the link through the router, so a slug the URL grammar cannot take verbatim is encoded', async () => {
    setUp(ok(NAMED));
    const sources = await open('/w/100%25');
    expect(byId(sources, 'features').entries().map((entry) => entry.link)).toEqual(['/w/100%25/features#F0', '/w/100%25/features#F2']);
    expect(byId(sources, 'milestones').entries().map((entry) => entry.link)).toEqual(['/w/100%25/milestones#m-harbor-1-0']);
  });
});
