import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ClaimView, ClaimViewModel } from '../../../../../../../core/src/files';
import golden from '../../../../../../../core/fixtures/harbor.claim-view.golden.json';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult } from '../../../../core/api.service';
import { SPEC_AREA_ROUTES } from '../../spec-area.routes';

const HARBOR_002 = (golden as unknown as Record<string, ClaimViewModel>)['specs/002-web-console'];

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

/** A claim cloned from the golden's first one, with `patch` over it. */
function claim(patch: Partial<ClaimView> & Pick<ClaimView, 'id'>): ClaimView {
  const base = HARBOR_002.claims[0];
  return { ...base, probe: base.probe ? { ...base.probe, isc: patch.id } : null, ...patch };
}

/** One claim per glyph state, both non-normal kinds, a fog line and a claim outside every feature. */
const SYNTHETIC: ClaimViewModel = {
  claims: [
    claim({ id: 'ISC-1', state: 'open', feature: 'F1', verification: null }),
    claim({ id: 'ISC-2', state: 'takeable', feature: 'F1', kind: 'anti', verification: null }),
    claim({
      id: 'ISC-3',
      state: 'taken',
      feature: 'F1',
      kind: 'antecedent',
      verification: null,
      lock: { source: 'activity', session: 'spec-002-ISC-3', since: '2026-09-01T09:50:00Z' },
    }),
    claim({ id: 'ISC-4', state: 'blocked', feature: 'F1', edges: ['ISC-1', 'ISC-2'], blockedBy: ['ISC-1'], verification: null }),
    claim({ id: 'ISC-5', state: 'closed', feature: 'F1', verification: 'screenshot `.evidence/isc-5/list.png` passed', noteCount: 2 }),
    claim({ id: 'ISC-6', state: 'dropped', feature: null, verification: null, dropped: { note: 'see Decisions 2026-09-24' } }),
  ],
  features: [{ id: 'F1', title: 'Registry', why: 'a teammate sees what was mirrored.', claims: ['ISC-1', 'ISC-2', 'ISC-3', 'ISC-4', 'ISC-5'] }],
  fog: [{ text: 'Which retention applies to tags?', resolves: 'a decision with ops', sinceRound: 3, marks: [], line: 90 }],
  counts: { all: 6, open: 4, takeable: 1, taken: 1, blocked: 1, closed: 1, dropped: 1, normal: 4, anti: 1, antecedent: 1 },
};

function setUp(model: ClaimViewModel): void {
  const api: Pick<ApiClient, 'workspaces' | 'dashboard' | 'spec' | 'claims'> = {
    workspaces: () => Promise.resolve(ok([])),
    dashboard: () => Promise.resolve({ kind: 'not-found', served: false }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    claims: () => Promise.resolve(ok(model)),
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
      provideRouter([{ path: 'w/:ws/s/:id', children: SPEC_AREA_ROUTES }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
    ],
  });
}

async function open(url: string): Promise<{ harness: RouterTestingHarness; root: HTMLElement }> {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

/** Lets the resource resolve and the view render. */
async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    harness.detectChanges();
    await harness.fixture.whenStable();
  }
}

const cards = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-claim]')];
const card = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-claim="${id}"]`);

const KEYS = { state: ['all', 'open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'], kind: ['all', 'anti', 'antecedent'] } as const;

/** The chip of `key` in the filter group `group`, by its place in the row (the chips carry no key attribute). */
function chipOf(root: HTMLElement, group: keyof typeof KEYS, key: string): HTMLButtonElement | null {
  const index = (KEYS[group] as readonly string[]).indexOf(key);
  return root.querySelectorAll<HTMLButtonElement>(`[data-filter="${group}"] button`)[index] ?? null;
}

/** The count shown on the chip of `key` in the filter group `group`. */
function chipCount(root: HTMLElement, group: keyof typeof KEYS, key: string): number {
  const chip = chipOf(root, group, key);
  if (!chip) throw new Error(`no ${group} chip ${key}`);
  return Number(chip.querySelector('.count')?.textContent.trim());
}

describe('ClaimsTab (ISC-81)', () => {
  describe('against the harbor 002 golden', () => {
    beforeEach(() => setUp(HARBOR_002));

    it('renders one card per claim of the golden, in file order', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      expect(root.tagName).toBe('APP-CLAIMS-TAB');
      expect(cards(root).map((c) => c.dataset['claim'])).toEqual(HARBOR_002.claims.map((c) => c.id));
    });

    it('shows filter chip counts equal to the golden counts', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const { counts } = HARBOR_002;
      for (const key of ['open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'] as const) {
        expect(chipCount(root, 'state', key), key).toBe(counts[key]);
      }
      expect(chipCount(root, 'state', 'all')).toBe(counts.all);
      expect(chipCount(root, 'kind', 'anti')).toBe(counts.anti);
      expect(chipCount(root, 'kind', 'antecedent')).toBe(counts.antecedent);
      // Every state's cards equal its count.
      for (const key of ['takeable', 'taken', 'blocked', 'closed', 'dropped'] as const) {
        expect(cards(root).filter((c) => c.dataset['state'] === key).length, key).toBe(counts[key]);
      }
    });

    it('narrows to the takeable claims from ?state=takeable and names the result', async () => {
      const { root } = await open('/w/harbor/s/002/claims?state=takeable');
      expect(cards(root)).toHaveLength(HARBOR_002.counts.takeable);
      expect(cards(root).every((c) => c.dataset['state'] === 'takeable')).toBe(true);
      expect(root.querySelector('[data-result]')?.textContent.trim()).toBe(`${String(HARBOR_002.counts.takeable)} of ${String(HARBOR_002.counts.all)}`);
    });

    it('writes the chosen state into the URL', async () => {
      const { harness, root } = await open('/w/harbor/s/002/claims');
      chipOf(root, 'state', 'blocked')?.click();
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/claims?state=blocked');
      expect(cards(root).map((c) => c.dataset['claim'])).toEqual(['ISC-78']);
    });

    it('searches id and text from ?q=', async () => {
      const byId = await open('/w/harbor/s/002/claims?q=isc-78');
      expect(cards(byId.root).map((c) => c.dataset['claim'])).toEqual(['ISC-78']);
    });

    it('searches the claim text and writes the query into the URL', async () => {
      const { harness, root } = await open('/w/harbor/s/002/claims');
      const input = root.querySelector<HTMLInputElement>('input[type="search"]');
      if (!input) throw new Error('no search field');
      input.value = 'theme switch is reachable';
      input.dispatchEvent(new Event('input'));
      await settle(harness);
      expect(TestBed.inject(Router).url).toBe('/w/harbor/s/002/claims?q=theme%20switch%20is%20reachable');
      expect(cards(root).map((c) => c.dataset['claim'])).toEqual(['ISC-78']);
    });

    it('groups the cards under their feature heading with the Why line', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const groups = [...root.querySelectorAll<HTMLElement>('[data-feature]')];
      expect(groups.map((g) => g.dataset['feature'])).toEqual(['F2']);
      expect(groups[0]?.querySelector('ui-section-header')?.textContent).toContain('F2');
      expect(groups[0]?.querySelector('ui-section-header')?.textContent).toContain('Web console');
      expect(groups[0]?.querySelector('.why')?.textContent).toContain('Why:');
      expect(groups[0]?.querySelectorAll('[data-claim]')).toHaveLength(30);
    });

    it('renders the probe row and the blocked-by edge', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const blocked = card(root, 'ISC-78');
      expect(blocked?.querySelector('.probe')?.textContent).toContain('theme-switch: keyboard reach and focus ring');
      expect(blocked?.querySelector('.probe')?.textContent).toContain('all reachable');
      const edge = blocked?.querySelector<HTMLAnchorElement>('a[data-edge="ISC-77"]');
      expect(edge?.textContent.trim()).toBe('blocked by ISC-77');
      expect(edge?.getAttribute('href')).toBe('/w/harbor/s/002/claims#claim-ISC-77');
    });
  });

  describe('every glyph state (synthetic model)', () => {
    beforeEach(() => setUp(SYNTHETIC));

    it('draws a glyph per state, blocked with its chip and taken with its session', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const glyph = (id: string) => card(root, id)?.querySelector('.glyph')?.textContent.trim();
      expect(glyph('ISC-1')).toBe('○');
      expect(glyph('ISC-2')).toBe('◐');
      expect(glyph('ISC-4')).toBe('○');
      expect(glyph('ISC-5')).toBe('●');
      expect(glyph('ISC-6')).toBe('⛔');
      expect(card(root, 'ISC-4')?.querySelector('[data-chip="blocked"]')).not.toBeNull();
      const taken = card(root, 'ISC-3');
      expect(taken?.querySelector('[data-chip="lock"]')).not.toBeNull();
      expect(taken?.querySelector('[data-session]')?.textContent).toContain('spec-002-ISC-3');
      expect(taken?.querySelector('ui-relative-time time')?.getAttribute('datetime')).toBe('2026-09-01T09:50:00.000Z');
    });

    it('shows the kind chip and filters by kind from ?kind=', async () => {
      const { root } = await open('/w/harbor/s/002/claims?kind=anti');
      expect(cards(root).map((c) => c.dataset['claim'])).toEqual(['ISC-2']);
      expect(card(root, 'ISC-2')?.querySelector('[data-chip="kind"]')?.textContent.trim()).toBe('Anti');
    });

    it('strikes a dropped claim and links it to Decisions', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const dropped = card(root, 'ISC-6');
      expect(dropped?.querySelector('s.text')).not.toBeNull();
      expect(dropped?.querySelector('a[data-link="decisions"]')?.getAttribute('href')).toBe('/w/harbor/s/002/decisions');
    });

    it('links a verification line that names a file into Evidence, and shows the note count', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const closed = card(root, 'ISC-5');
      expect(closed?.querySelector('a[data-link="evidence"]')?.getAttribute('href')).toBe('/w/harbor/s/002/evidence#isc-5/list.png');
      expect(closed?.querySelector('a[data-link="notes"]')?.textContent).toContain('2');
      expect(card(root, 'ISC-1')?.querySelector('a[data-link="notes"]')).toBeNull();
    });

    it('lists the claims outside every feature in their own group', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const loose = root.querySelector('[data-feature="none"]');
      expect(loose?.querySelectorAll('[data-claim]')).toHaveLength(1);
    });

    it('ends with the fog list', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const fog = root.querySelector('[data-fog]');
      expect(fog?.textContent).toContain('Which retention applies to tags?');
      expect(fog?.textContent).toContain('a decision with ops');
      expect(fog?.textContent).toContain('since Round 3');
    });

    it('highlights and focuses the card a #claim- deep link names', async () => {
      const { root } = await open('/w/harbor/s/002/claims#claim-ISC-4');
      const target = card(root, 'ISC-4');
      expect(target?.id).toBe('claim-ISC-4');
      expect(target?.classList.contains('is-target')).toBe(true);
      expect(document.activeElement).toBe(target);
    });

    it('puts every card in one roving list with a single tab stop', async () => {
      const { root } = await open('/w/harbor/s/002/claims');
      const stops = cards(root).filter((c) => c.tabIndex === 0);
      expect(stops).toHaveLength(1);
    });
  });
});
