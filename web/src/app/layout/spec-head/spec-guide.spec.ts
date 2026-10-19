import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import type { Guidance, SpecPageModel } from '../../../../../core/src/files';
import specGolden from '../../../../../core/fixtures/harbor.spec.golden.json';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import en from '../../../i18n/en.json';
import { ApiClient, type ApiResult } from '../../core/api.service';
import { LockSourceService } from '../../core/lock-source.service';
import type { ShellRouteData } from '../shell/areas';
import { ShellState } from '../shell/shell-state.service';
import type { Tier } from '../shell/tier';
import { guideCardShown, SpecGuideCard, specGuide } from './spec-guide';

// T21 · ISC-239: the compact guide card under the spec head (design.md § Viewport-übergreifend): below 1120 px on every
// tab but the dashboard and Status, from 1120 px only where no spec rail stands (live, Library); the spec's sentence
// through `guidanceReason`, its chip, and "+n waiting" to the dashboard's `#waiting`. Harbor 002's golden slice: the
// spec itself in `next` (stage.build.0), three entries waiting (ISC-77 manual, T31 operator, the question on T29).

const SPEC002 = (specGolden as unknown as Record<string, SpecPageModel>)['specs/002-web-console'];
const GUIDANCE = SPEC002.guidance as Guidance;
const BUILD_SENTENCE = en.guidance.reason.stage.build['0'];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

const TABS: ReadonlyArray<[string, ShellRouteData]> = [
  ['', { area: 'dashboard' }],
  ['status', { area: 'status', tab: 'status' }],
  ['timeline', { area: 'status', tab: 'timeline' }],
  ['claims', { area: 'data', tab: 'claims' }],
  ['tasks', { area: 'data', tab: 'tasks' }],
  ['board', { area: 'live', tab: 'board' }],
  ['notes', { area: 'notes', tab: 'notes' }],
];
const routes: Routes = TABS.map(([tab, data]) => ({ path: tab ? `w/:ws/s/:id/${tab}` : 'w/:ws/s/:id', component: SpecGuideCard, data }));

function setUp(body: SpecPageModel = SPEC002): void {
  const api = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: () => Promise.resolve(ok({ specs: [], archive: [] })),
    planning: () => Promise.resolve({ kind: 'not-found', served: false } as const),
    spec: () => Promise.resolve(ok(body)),
    reviewedHashes: () => null,
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true }),
    ],
    providers: [
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: LockSourceService, useValue: { connect: () => undefined } },
    ],
  });
}

async function open(url: string, tier: Tier): Promise<HTMLElement> {
  const harness = await RouterTestingHarness.create();
  TestBed.inject(ShellState).tier.set(tier);
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();

describe('specGuide (T20, T21, ISC-239)', () => {
  it('takes the spec entry as the next step and lists every other waiting entry once', () => {
    const guide = specGuide(GUIDANCE, SPEC002);
    expect(guide.entry?.item).toBe('spec');
    expect(guide.waiting).toBe(false);
    expect(guide.others.map((e) => e.ref)).toEqual(['ISC-77', 'T31', 'T29']);
    expect(guide.command).toBe('/spec implement 002');
  });

  it('marks a spec that itself waits on you and never lists it twice', () => {
    const own = { ...GUIDANCE.next[0], command: '/spec review 002' };
    const guide = specGuide({ waits: [own, ...GUIDANCE.waits], next: [] }, SPEC002);
    expect(guide.entry).toBe(own);
    expect(guide.waiting).toBe(true);
    expect(guide.others).toHaveLength(3);
    expect(guide.command).toBe('/spec review 002');
  });

  it("falls back to the model's next command and first reason without guidance", () => {
    const guide = specGuide(undefined, SPEC002);
    expect(guide.entry).toBeNull();
    expect(guide.others).toEqual([]);
    expect(guide.command).toBe(SPEC002.next.command);
    expect(guide.phrase).toBe(SPEC002.next.reasons[0]);
  });
});

describe('guideCardShown (T21, ISC-239)', () => {
  it('stands below 1120 px on every tab but the dashboard and Status', () => {
    for (const tier of ['compact', 'medium'] as const) {
      expect(guideCardShown(tier, 'dashboard', null)).toBe(false);
      expect(guideCardShown(tier, 'status', 'status')).toBe(false);
      for (const [area, tab] of [['status', 'timeline'], ['data', 'claims'], ['data', 'tasks'], ['live', 'board'], ['library', 'library'], ['notes', 'notes']] as const) {
        expect(guideCardShown(tier, area, tab)).toBe(true);
      }
    }
  });

  it('from 1120 px stands only where no spec rail is the guidance spot (live, Library)', () => {
    for (const [area, tab] of [['status', 'status'], ['status', 'timeline'], ['data', 'claims'], ['data', 'tasks'], ['notes', 'notes']] as const) {
      expect(guideCardShown('wide', area, tab)).toBe(false);
    }
    expect(guideCardShown('wide', 'dashboard', null)).toBe(false);
    expect(guideCardShown('wide', 'live', 'board')).toBe(true);
    expect(guideCardShown('wide', 'live', 'matrix')).toBe(true);
    expect(guideCardShown('wide', 'library', 'library')).toBe(true);
  });
});

describe('app-spec-guide (T21, ISC-239)', () => {
  it('shows the sentence, the chip and "+n waiting" to the dashboard below 1120 px', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/claims', 'medium');
    const card = root.querySelector('[data-spec-guide]');
    expect(card).not.toBeNull();
    expect(text(card?.querySelector('[data-guide-reason]'))).toBe(BUILD_SENTENCE);
    expect(text(card?.querySelector('[data-guide-command] code') ?? card?.querySelector('[data-guide-command]'))).toContain('/spec implement 002');
    expect(card?.querySelectorAll('ui-command-chip')).toHaveLength(1);
    expect(card?.querySelector('[data-guide-marker]')).toBeNull();
    const waiting = card?.querySelector('a[data-guide-waiting]');
    expect(text(waiting)).toBe('+3 waiting');
    expect(waiting?.getAttribute('href')).toBe('/w/harbor/s/002#waiting');
  });

  it('is absent on the dashboard and on Status below 1120 px, and on rail tabs from 1120 px', async () => {
    for (const [url, tier] of [
      ['/w/harbor/s/002', 'medium'],
      ['/w/harbor/s/002/status', 'compact'],
      ['/w/harbor/s/002/claims', 'wide'],
      ['/w/harbor/s/002/notes', 'wide'],
    ] as const) {
      TestBed.resetTestingModule();
      setUp();
      const root = await open(url, tier);
      expect(root.querySelector('[data-spec-guide]'), `${url} at ${tier}`).toBeNull();
    }
  });

  it('stands on the live board from 1120 px, where no spec rail leads', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/board', 'wide');
    expect(text(root.querySelector('[data-guide-reason]'))).toBe(BUILD_SENTENCE);
  });

  it('carries the marker when the spec itself waits, and no "+n waiting" without other entries', async () => {
    const own = { ...GUIDANCE.next[0], command: '/spec review 002', reason: { key: 'stage.review.0', values: { state: 'stale' }, phrase: 'the reviewed mark is stale' } };
    setUp({ ...SPEC002, guidance: { waits: [own], next: [] } });
    const root = await open('/w/harbor/s/002/tasks', 'compact');
    expect(text(root.querySelector('[data-guide-marker]'))).toBe(en.guidance.marker);
    expect(text(root.querySelector('[data-guide-reason]'))).toContain(en.guidance.value.state.stale);
    expect(root.querySelector('[data-guide-waiting]')).toBeNull();
  });
});
