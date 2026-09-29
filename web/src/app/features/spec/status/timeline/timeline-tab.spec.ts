import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { TimelineEntry } from '../../../../../../../core/src/files';
import golden from '../../../../../../../core/fixtures/harbor.timeline.golden.json';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult } from '../../../../core/api.service';
import { TimelineTab } from './timeline-tab';

/** What the stub serves for `/w/harbor/s/002/timeline`: 3 rounds, 4 derived stage entries, 1 gate, 1 decision. */
const HARBOR_002 = (golden as unknown as Record<string, readonly TimelineEntry[]>)['specs/002-web-console'] ?? [];

type FakeApi = Pick<ApiClient, 'timeline'>;
const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

let harness: RouterTestingHarness | null = null;

function setUp(entries: readonly TimelineEntry[] = HARBOR_002): void {
  const api: FakeApi = { timeline: () => Promise.resolve(ok(entries)) };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: 'w/:ws/s/:id/timeline', component: TimelineTab, data: { area: 'status', tab: 'timeline' } }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
    ],
  });
}

async function open(url: string): Promise<HTMLElement> {
  harness ??= await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  // The resource resolves after the first render; one more pass paints the entries.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await harness.fixture.whenStable();
  return harness.fixture.nativeElement as HTMLElement;
}

const entries = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('[data-entry]')];
const ofKind = (root: HTMLElement, kind: string) => entries(root).filter((el) => el.dataset['kind'] === kind);
const chip = (root: HTMLElement, kind: string) => root.querySelector<HTMLButtonElement>(`[data-filter="${kind}"]`);

describe('TimelineTab (T55, ISC-80, ISC-36)', () => {
  afterEach(() => {
    harness = null;
  });

  it('renders one entry per golden entry, counted per kind', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    expect(entries(root)).toHaveLength(HARBOR_002.length);
    expect(ofKind(root, 'round')).toHaveLength(3);
    expect(ofKind(root, 'stage')).toHaveLength(4);
    expect(ofKind(root, 'gate')).toHaveLength(1);
    expect(ofKind(root, 'decision')).toHaveLength(1);
    // Newest first: the list keeps the API's order.
    expect(entries(root)[0]?.dataset['id']).toBe('round-3');
  });

  it('narrows to the pressed sources and keeps them in the URL query', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    const round = chip(root, 'round');
    expect(round?.getAttribute('aria-pressed')).toBe('false');
    round?.click();
    await harness?.fixture.whenStable();
    expect(round?.getAttribute('aria-pressed')).toBe('true');
    expect(entries(root)).toHaveLength(3);
    expect(TestBed.inject(Router).url).toContain('kinds=round');

    chip(root, 'gate')?.click();
    await harness?.fixture.whenStable();
    expect(entries(root)).toHaveLength(4);
    expect(decodeURIComponent(TestBed.inject(Router).url)).toContain('kinds=round,gate');
  });

  it('reads the filter from the query on load', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline?kinds=gate,decision');
    expect(entries(root)).toHaveLength(2);
    expect(chip(root, 'gate')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('groups entries by local day; undated stage entries join the group before them', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    const groups = [...root.querySelectorAll<HTMLElement>('[data-day]')];
    expect(groups).toHaveLength(4);
    const round1Group = groups.find((group) => group.querySelector('[data-id="round-1"]'));
    const ids = [...(round1Group?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])].map((el) => el.dataset['id']);
    expect(ids).toEqual(['round-1', 'stage-review', 'stage-tasks']);
    expect(root.querySelector('[data-id="stage-review"] .time')?.textContent).toContain('date unknown');
  });

  it('marks every derived stage entry with a derived chip and a dashed marker (ISC-36)', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    const derived = root.querySelectorAll('[data-derived-chip]');
    expect(derived).toHaveLength(HARBOR_002.filter((entry) => entry.derived).length);
    expect(root.querySelectorAll('.marker[data-derived]')).toHaveLength(4);
    expect(root.querySelector('[data-id="round-3"] [data-derived-chip]')).toBeNull();
  });

  it('expands a round entry on Enter into its body lines and an Open board link', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    const round3 = root.querySelector<HTMLElement>('[data-id="round-3"]');
    const summary = round3?.querySelector<HTMLButtonElement>('ui-disclosure button[aria-expanded]');
    expect(summary?.getAttribute('aria-expanded')).toBe('false');
    round3?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await harness?.fixture.whenStable();
    expect(summary?.getAttribute('aria-expanded')).toBe('true');
    const lines = [...(round3?.querySelectorAll('.body-line') ?? [])].map((line) => line.textContent.trim());
    expect(lines[0]).toBe('- Dispatched: T12, T13, T14, T17, T19, T21, T24, T25, T26, T27');
    expect(round3?.querySelector('a[data-open-board]')?.getAttribute('href')).toBe('/w/harbor/s/002/board');

    summary?.click();
    await harness?.fixture.whenStable();
    expect(summary?.getAttribute('aria-expanded')).toBe('false');
  });

  it('highlights and opens the entry a #t/<id> deep link names', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline#t/round-2');
    const round2 = root.querySelector<HTMLElement>('[data-id="round-2"]');
    expect(round2?.hasAttribute('data-highlighted')).toBe(true);
    expect(round2?.querySelector('ui-disclosure button')?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelectorAll('[data-highlighted]')).toHaveLength(1);
  });

  it('shows the empty state when the spec has no events', async () => {
    setUp([]);
    const root = await open('/w/harbor/s/002/timeline');
    expect(entries(root)).toHaveLength(0);
    expect(root.querySelector('ui-empty-state')?.textContent).toContain('No events yet');
  });
});
