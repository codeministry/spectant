import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { TimelineEntry } from '../../../../../../../core/src/files';
import golden from '../../../../../../../core/fixtures/harbor.timeline.golden.json';
import { CATALOGUES, LANGS } from '../../../../../i18n/catalogues';
import { ApiClient, type ApiResult } from '../../../../core/api.service';
import { TimelineTab } from './timeline-tab';

const TIMELINES = golden as unknown as Record<string, readonly TimelineEntry[]>;
/** What the stub serves for `/w/harbor/s/002/timeline`: 3 rounds, 4 recorded stage entries, 1 gate, 1 decision. */
const HARBOR_002 = TIMELINES['specs/002-web-console'] ?? [];
/** Spec 004's strand: its stages are derived from the files, three of them undated. */
const HARBOR_004 = TIMELINES['specs/004-retention-policies'] ?? [];
/** The local day of an ISO `ts`, as the tab groups by it. */
const localDay = (ts: string): string => new Date(ts).toDateString();

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

  it('groups entries by local day', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    const groups = [...root.querySelectorAll<HTMLElement>('[data-day]')];
    expect(HARBOR_002.every((entry) => entry.ts !== '')).toBe(true);
    expect(groups).toHaveLength(new Set(HARBOR_002.map((entry) => localDay(entry.ts))).size);
    const round1Group = groups.find((group) => group.querySelector('[data-id="round-1"]'));
    const ids = [...(round1Group?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])].map((el) => el.dataset['id']);
    const round1 = HARBOR_002.find((entry) => entry.id === 'round-1');
    expect(ids).toEqual(HARBOR_002.filter((entry) => localDay(entry.ts) === localDay(round1?.ts ?? '')).map((entry) => entry.id));
  });

  it('puts an undated stage entry in the group of the entry before it', async () => {
    setUp(HARBOR_004);
    const root = await open('/w/harbor/s/004/timeline');
    const groupOf = (id: string) => root.querySelector(`[data-id="${id}"]`)?.closest('[data-day]');
    const undated = HARBOR_004.filter((entry) => entry.ts === '');
    expect(undated.map((entry) => entry.id)).toEqual(['stage-code-review', 'stage-review', 'stage-tasks']);
    for (const entry of undated) {
      const index = HARBOR_004.indexOf(entry);
      expect(index).toBeGreaterThan(0);
      expect(groupOf(entry.id ?? '')).toBe(groupOf(HARBOR_004.at(index - 1)?.id ?? ''));
    }
    expect(root.querySelector('[data-id="stage-review"] .time')?.textContent).toContain('date unknown');
  });

  it('marks every derived stage entry with a derived chip and a dashed marker (ISC-36)', async () => {
    setUp(HARBOR_004);
    const root = await open('/w/harbor/s/004/timeline');
    const derived = HARBOR_004.filter((entry) => entry.derived).length;
    expect(derived).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-derived-chip]')).toHaveLength(derived);
    expect(root.querySelectorAll('.marker[data-derived]')).toHaveLength(derived);
    expect(root.querySelector('[data-id="gate-reviewed"] [data-derived-chip]')).toBeNull();
  });

  it('marks no recorded stage entry as derived', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    expect(HARBOR_002.filter((entry) => entry.kind === 'stage' && entry.derived)).toEqual([]);
    expect(root.querySelectorAll('[data-derived-chip]')).toHaveLength(0);
    expect(root.querySelectorAll('.marker[data-derived]')).toHaveLength(0);
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

/** Spec 027 (ISC-175.1): the worktree entries core derives from git, as the stub's overlay serves them for 007 and 006. */
const MERGED: TimelineEntry = {
  ts: '2026-03-09T08:45:00Z',
  kind: 'worktree',
  derived: true,
  title: 'Merged into main · feature/007-rotate-mirror-token',
  ref: 'merged',
  id: 'worktree-merged',
  actor: null,
  worktree: { state: 'merged', branch: 'feature/007-rotate-mirror-token', path: '.worktrees/007-rotate-mirror-token', commit: '4f1c2ab' },
};
const REMOVED: TimelineEntry = {
  ts: '',
  kind: 'worktree',
  derived: true,
  title: 'Worktree removed · .worktrees/006-partial-push',
  ref: 'removed',
  id: 'worktree-removed',
  actor: null,
  undated: true,
  worktree: { state: 'removed', branch: 'feature/006-partial-push', path: '.worktrees/006-partial-push', commit: null },
};
/** Harbor 002's strand with the removed entry after its newest entry and the merged one at the end. */
const WITH_WORKTREES: readonly TimelineEntry[] = [HARBOR_002[0], REMOVED, ...HARBOR_002.slice(1), MERGED];
const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('TimelineTab worktree entries (spec 027, ISC-175.1)', () => {
  afterEach(() => {
    harness = null;
  });

  it('shows no Worktree pill while the strand holds no worktree entry', async () => {
    setUp();
    const root = await open('/w/harbor/s/002/timeline');
    expect(chip(root, 'worktree')).toBeNull();
  });

  it('adds the Worktree pill at the end of the row, counting the worktree entries, and filters by it', async () => {
    setUp(WITH_WORKTREES);
    const root = await open('/w/harbor/s/002/timeline');
    const pills = [...root.querySelectorAll<HTMLElement>('[data-filter]')];
    expect(pills.at(-1)?.dataset['filter']).toBe('worktree');
    expect(text(pills.at(-1))).toBe('Worktree 2');
    expect(chip(root, 'worktree')?.querySelector('.dot')?.getAttribute('style')).toContain('--marker: var(--muted)');

    chip(root, 'worktree')?.click();
    await harness?.fixture.whenStable();
    expect(entries(root).map((el) => el.dataset['id'])).toEqual(['worktree-removed', 'worktree-merged']);
    expect(TestBed.inject(Router).url).toContain('kinds=worktree');
  });

  it('words a merged entry from its fields: title with the branch in mono, the subline with the short commit', async () => {
    setUp(WITH_WORKTREES);
    const root = await open('/w/harbor/s/002/timeline');
    const merged = root.querySelector<HTMLElement>('[data-id="worktree-merged"]');
    expect(merged?.dataset['kind']).toBe('worktree');
    expect(text(merged?.querySelector('.title [data-worktree-title]'))).toBe('Merged into main');
    expect(text(merged?.querySelector('.title .mono[data-worktree-ref]'))).toBe('feature/007-rotate-mirror-token');
    expect(text(merged?.querySelector('.meta'))).toContain('Worktree · derived from git, commit 4f1c2ab');
    expect(text(merged?.querySelector('.meta .mono[data-worktree-commit]'))).toBe('4f1c2ab');
    expect(merged?.querySelector('time')?.getAttribute('datetime')).toBe(MERGED.ts);
  });

  it('marks both entries derived: dashed marker with the git-merge or folder-x glyph, derived chip, no chevron', async () => {
    setUp(WITH_WORKTREES);
    const root = await open('/w/harbor/s/002/timeline');
    for (const [id, glyph] of [
      ['worktree-merged', 'git-merge'],
      ['worktree-removed', 'folder-x'],
    ] as const) {
      const row = root.querySelector<HTMLElement>(`[data-id="${id}"]`);
      expect(row?.querySelector('.marker')?.hasAttribute('data-derived'), id).toBe(true);
      expect(row?.querySelector('.marker ui-icon')?.getAttribute('data-icon'), id).toBe(glyph);
      expect(row?.querySelector('[data-derived-chip]'), id).not.toBeNull();
      expect(row?.querySelector('ui-disclosure, button[aria-expanded]'), id).toBeNull();
    }
  });

  it('words a removed entry undated: "no date" in the time column, the path in mono, in the group of the entry before it', async () => {
    setUp(WITH_WORKTREES);
    const root = await open('/w/harbor/s/002/timeline');
    const removed = root.querySelector<HTMLElement>('[data-id="worktree-removed"]');
    expect(text(removed?.querySelector('.title [data-worktree-title]'))).toBe('Worktree removed');
    expect(text(removed?.querySelector('.title .mono[data-worktree-ref]'))).toBe('.worktrees/006-partial-push');
    expect(text(removed?.querySelector('.time [data-no-date]'))).toBe('no date');
    expect(removed?.querySelector('.time time')).toBeNull();
    expect(text(removed?.querySelector('.meta'))).not.toContain('commit');
    const groupOf = (id: string) => root.querySelector(`[data-id="${id}"]`)?.closest('[data-day]');
    expect(groupOf('worktree-removed')).toBe(groupOf(HARBOR_002[0]?.id ?? ''));
  });

  it('words both entries in German', async () => {
    setUp(WITH_WORKTREES);
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await open('/w/harbor/s/002/timeline');
    expect(text(root.querySelector('[data-id="worktree-merged"] [data-worktree-title]'))).toBe('Gemerged in main');
    expect(text(root.querySelector('[data-id="worktree-merged"] .meta'))).toContain('Worktree · aus git abgeleitet, Commit 4f1c2ab');
    expect(text(root.querySelector('[data-id="worktree-removed"] [data-worktree-title]'))).toBe('Worktree entfernt');
    expect(text(root.querySelector('[data-id="worktree-removed"] [data-no-date]'))).toBe('ohne Datum');
  });
});
