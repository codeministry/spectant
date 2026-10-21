import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap, provideRouter, Router } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { type Density, SETTINGS_URL, SettingsService } from '../../../core/settings.service';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import { type Stage, WAITING_STAGES } from '../../../../../../core/src/stage';
import { guidanceEntryOf } from '../../../core/model/guidance-entry';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { SpecTable } from './spec-table';
import { DEFAULT_QUERY, type ListQuery, parseListQuery, readArchiveRows, readListCounts, readSpecRows, type SpecListCounts } from './spec-table-model';

/** A dashboard row as the server sends it (`DashboardSpecRow`), only the fields that matter overridden. */
function wire(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `${id}-slug`,
    title: `Spec ${id}`,
    type: 'feature',
    phase: 'scoping',
    stageGroup: 'scoping',
    stage: 'review',
    progress: { closed: 0, total: 4 },
    nextCommand: `/spec review ${id}`,
    takeable: [],
    taken: [],
    warnings: [],
    fog: 0,
    goal: '',
    ...over,
  };
}

const LOCK = { id: 'ISC-1', session: 'spec-002-ISC-1', since: '2026-09-30T10:00:00Z', source: 'activity' };
const BODY = {
  specs: [
    wire('002', { phase: 'building', stageGroup: 'building', stage: 'build', progress: { closed: 25, total: 30 }, goal: 'Serves the dashboard.', taken: [LOCK] }),
    wire('003'),
  ],
  archive: [{ id: '001', slug: '001-manifest-sync', title: 'Manifest sync', type: 'feature' }],
  kpis: { specs: 2, stageGroups: { scoping: 1, building: 1, complete: 0 }, specsWithFog: 0, byType: { feature: 2 } },
};

const text = (el: Element | null | undefined): string => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';

/**
 * The open workspace's favourites as the list reads them (spec 052, T18): the folder set behind `isFavorite`, flipped
 * by `toggleFavorite`, which records each call. Every block of this file gets it, since each row now asks `ShellData`
 * for its star; the real service has its own spec and the e2e group `toggle` runs both together.
 */
class FakeShellData {
  readonly favoriteIds = signal<ReadonlySet<string>>(new Set());
  readonly toggled: string[] = [];
  isFavorite(spec: string): boolean {
    return this.favoriteIds().has(spec);
  }
  toggleFavorite(spec: string): Promise<boolean> {
    this.toggled.push(spec);
    const ids = new Set(this.favoriteIds());
    if (!ids.delete(spec)) ids.add(spec);
    this.favoriteIds.set(ids);
    return Promise.resolve(true);
  }
}

beforeEach(() => {
  TestBed.configureTestingModule({ providers: [{ provide: ShellData, useClass: FakeShellData }] });
});

describe('SpecTable (prototype port, T89)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function render(query: ListQuery = DEFAULT_QUERY, live: { changed?: ReadonlySet<string>; pending?: readonly string[] } = {}, counts: SpecListCounts | null = readListCounts(BODY)) {
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(BODY));
    fixture.componentRef.setInput('archive', readArchiveRows(BODY));
    fixture.componentRef.setInput('counts', counts);
    fixture.componentRef.setInput('query', query);
    if (live.changed) fixture.componentRef.setInput('changed', live.changed);
    if (live.pending) fixture.componentRef.setInput('pending', live.pending);
    const emitted: ListQuery[] = [];
    fixture.componentInstance.queryChange.subscribe((next) => emitted.push(next));
    let shown = 0;
    fixture.componentInstance.showPending.subscribe(() => (shown += 1));
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement, emitted, shown: () => shown };
  }

  it('heads the panel "Specs n · k archived" with the #specs heading and the phase chips', async () => {
    const { host } = await render();
    const heading = host.querySelector('.t-head h2#specs');
    expect(text(heading)).toBe('Specs');
    expect(heading?.getAttribute('tabindex')).toBe('-1');
    // Spec 021 (T25): the counters are chips now, the archived count among them (was the meta text "2 · 1 archived").
    expect([...host.querySelectorAll('.t-head [data-counts] ui-chip')].map(text)).toEqual(['2 specs', '1 archived spec']);
    expect(host.querySelectorAll('.t-head [data-filter="phase"] button')).toHaveLength(3);
  });

  // Spec 021 · T83 (ISC-255): the chips carry the model's counts, the stage-group split the Specs tile shows, and the
  // type counts `kpis.byType`; the panel counts no rows itself, so served numbers no grouping of the rows gives stand.
  it('shows the served chip counts, never a count of its rows (ISC-255)', async () => {
    const served = { specs: 9, stageGroups: { scoping: 7, building: 0, complete: 2 }, specsWithFog: 3, byType: { bug: 5, feature: 4 } };
    const { host } = await render(DEFAULT_QUERY, {}, served);
    const chips = (filter: string) => [...host.querySelectorAll(`.t-head [data-filter="${filter}"] button`)].map(text);
    expect(chips('phase')).toEqual(['All 9', 'scoping 7', 'complete 2', 'fog 3']);
    expect(chips('type')).toEqual(['All 9', 'bug 5', 'feature 4']);
  });

  it('shows no filter chips without the model counts', async () => {
    const { host } = await render(DEFAULT_QUERY, {}, null);
    expect(host.querySelectorAll('.t-head [data-filter] button')).toHaveLength(0);
  });

  it('sorts through a popover menu (Stage / ID / Progress), not a native select', async () => {
    const { host, emitted } = await render();
    expect(host.querySelector('select')).toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>('button[data-control="sort"]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.getAttribute('aria-controls')).toBeTruthy();
    const items = [...host.querySelectorAll<HTMLButtonElement>('ui-popover [data-sort]')];
    expect(items.map((item) => item.dataset['sort'])).toEqual(['stage', 'id', 'progress']);
    expect(items[0]?.getAttribute('aria-pressed')).toBe('true');
    items[1]?.click();
    expect(emitted).toEqual([{ ...DEFAULT_QUERY, sort: 'id' }]);
  });

  it('draws the phase strip as one segment per active spec, toned by its phase', async () => {
    const { host } = await render();
    const strip = host.querySelector('.phase-strip');
    expect(strip?.getAttribute('role')).toBe('img');
    expect(strip?.querySelectorAll('i')).toHaveLength(2);
  });

  it('renders a row as id | title + description | agent dot, mini track, phase chip | meter + a/b', async () => {
    const { host } = await render();
    const [first, second] = [...host.querySelectorAll<HTMLAnchorElement>('[data-spec-row]')];
    // T69, spec 026 T27: a row's first activation selects it for the detail sidebar (`?sel=spec:<id>`); only the
    // selected row links to the spec page. The row names its object for the sidebar's focus return. Spec 025 (T24):
    // the link is the row's title, stretched over the row; the cells around it belong to the row's `li`.
    const [rowA, rowB] = [first, second].map((link) => link.closest('li') as HTMLElement);
    expect(first.getAttribute('href')).toMatch(/[?&]sel=spec:002$/);
    expect(first.getAttribute('data-ref')).toBe('spec:002');
    expect(text(rowA.querySelector('.rid'))).toBe('002');
    expect(text(first)).toBe('Spec 002');
    expect(text(rowA.querySelector('.rtitle .d'))).toBe('Serves the dashboard.');
    expect(rowA.querySelector('.rtrack .agent-dot')?.getAttribute('aria-label')).toContain('spec-002-ISC-1');
    expect(rowA.querySelector('.rtrack ui-stage-track')).not.toBeNull();
    expect(text(rowA.querySelector('.rtrack ui-chip.phase'))).toBe('building');
    expect(rowA.querySelector('.rmeter ui-meter')).not.toBeNull();
    expect(text(rowA.querySelector('.rmeter .frac'))).toBe('25/30');
    expect(rowB.querySelector('.rtitle .d')).toBeNull();
    expect(rowB.querySelector('.agent-dot')).toBeNull();
  });

  // Spec 021 · T73 · ISC-246.1 (design § P3 heights): at wide the row is one line, the description inline behind the
  // title in the same cell, then mark, agent dot, priority, mini track, phase, then meter + a/b; nothing under the row.
  it('lays the wide row out as one line: id | title · description | mark, agent, priority, track, phase | meter (T73)', async () => {
    const { host } = await render();
    const [rowA, rowB] = [...host.querySelectorAll<HTMLElement>('[data-spec-row]')].map((link) => link.closest('li') as HTMLElement);
    const cells = (el: Element | null) => [...(el?.children ?? [])].map((c) => (c.classList.length > 0 ? c.classList[0] : c.tagName.toLowerCase()));
    // Spec 052 (T17): the favorite star's cell closes the row.
    expect(cells(rowA.querySelector('app-spec-row'))).toEqual(['rid', 'rtitle', 'rtrack', 'rmeter', 'rstar']);
    expect(cells(rowA.querySelector('.rtitle'))).toEqual(['tline', 'd']);
    expect(rowA.querySelector('.tline [data-spec-row]')).not.toBeNull();
    expect(cells(rowA.querySelector('.rtrack'))).toEqual(['ragent', 'rprio', 'ui-stage-track', 'phase']);
    expect(rowA.querySelector('app-spec-row')?.hasAttribute('data-desc')).toBe(true);
    expect(rowB.querySelector('app-spec-row')?.hasAttribute('data-desc')).toBe(false);
    expect(rowA.querySelector('app-spec-row')?.hasAttribute('data-mark')).toBe(false);
    for (const row of [rowA, rowB]) {
      expect([...row.children].filter((c) => !c.classList.contains('row-more')).map((c) => c.tagName.toLowerCase())).toEqual(['app-spec-row']);
    }
  });

  // Spec 021 · T80: the sort control follows the counter chips in the DOM (and so in focus order), before the filters.
  it('puts the sort control right behind the counter chips, before the filter chips (T80)', async () => {
    const { host } = await render();
    const head = host.querySelector('.t-head') as HTMLElement;
    // The host follows the counters; its trigger button alone carries `data-control="sort"` (one hook for e2e).
    const sort = head.querySelector('ui-sort-menu.sort') as HTMLElement;
    expect(sort.querySelectorAll('[data-control="sort"]')).toHaveLength(1);
    expect(sort.previousElementSibling?.hasAttribute('data-counts')).toBe(true);
    const filter = head.querySelector('ui-filter-chips[data-filter="phase"]') as HTMLElement;
    expect(sort.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Spec 050: "Show archived" is the last of the filters, after the type chips, so the phase chips keep head line 1.
    const toggle = head.querySelector('[data-control="archived"]') as HTMLElement;
    const lastFilter = [...head.querySelectorAll('ui-filter-chips')].at(-1) as HTMLElement;
    expect(lastFilter.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('a row on stage blocked keeps its track at Build, marks the segment blocked and says "Blocked"; the phase chip stays (spec 025)', async () => {
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows({ specs: [wire('009', { phase: 'building', stage: 'blocked' })], archive: [] }));
    fixture.componentRef.setInput('archive', []);
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    await fixture.whenStable();
    const row = (fixture.nativeElement as HTMLElement).querySelector('[data-spec-row="009"]')?.closest('li') as HTMLElement;
    const track = row.querySelector('.rtrack ui-stage-track');
    expect([...(track?.querySelectorAll('.bar') ?? [])].map((bar) => bar.getAttribute('data-state'))).toEqual(['done', 'done', 'done', 'blocked', 'pending']);
    expect(text(track?.querySelector('[data-blocked]'))).toBe('Blocked');
    expect(track?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Stage 4 of 5: Build · Blocked');
    expect(text(row.querySelector('.rtrack ui-chip'))).toBe('building');
  });

  it('a row on any other stage has no blocked segment and no word (spec 025)', async () => {
    const { host } = await render();
    expect(host.querySelector('.rtrack [data-blocked]')).toBeNull();
    expect(host.querySelector('.rtrack .bar[data-state="blocked"]')).toBeNull();
  });

  it('marks the row the sidebar shows with data-selected="row" and links it to the spec page (spec 026, T27)', async () => {
    const { fixture, host } = await render();
    fixture.componentRef.setInput('preview', '002');
    await fixture.whenStable();
    const first = host.querySelector<HTMLAnchorElement>('[data-spec-row="002"]');
    expect(first?.getAttribute('data-selected')).toBe('row');
    expect(first?.getAttribute('href')).toBe('/w/harbor/s/002');
  });

  it('keeps one tab stop on the rows and marks the first as selected', async () => {
    const { host } = await render();
    const rows = [...host.querySelectorAll<HTMLElement>('[data-spec-row]')];
    expect(rows.map((row) => row.getAttribute('tabindex'))).toEqual(['0', '-1']);
    expect(rows[0]?.hasAttribute('data-selected')).toBe(true);
  });

  describe('live update marks (design.md § Live update, ISC-62.1)', () => {
    it('dots a changed row and keeps the dot across a refresh that changed nothing, until the row is hovered', async () => {
      const { fixture, host } = await render(DEFAULT_QUERY, { changed: new Set(['003']) });
      const row = (id: string) => host.querySelector<HTMLElement>(`[data-spec-row="${id}"]`);
      expect(row('003')?.hasAttribute('data-changed')).toBe(true);
      expect(row('002')?.hasAttribute('data-changed')).toBe(false);

      fixture.componentRef.setInput('changed', new Set());
      await fixture.whenStable();
      expect(row('003')?.hasAttribute('data-changed')).toBe(true);

      row('003')?.dispatchEvent(new Event('pointerenter'));
      await fixture.whenStable();
      expect(row('003')?.hasAttribute('data-changed')).toBe(false);
    });

    it('clears a row dot when the row takes focus', async () => {
      const { fixture, host } = await render(DEFAULT_QUERY, { changed: new Set(['002']) });
      const row = host.querySelector<HTMLElement>('[data-spec-row="002"]');
      row?.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await fixture.whenStable();
      expect(row?.hasAttribute('data-changed')).toBe(false);
    });

    it('offers held-back new specs as a "n new specs · show" pill that asks the page to apply them', async () => {
      const { host, shown } = await render(DEFAULT_QUERY, { pending: ['004', '005'] });
      const pill = host.querySelector<HTMLButtonElement>('button[data-pending]');
      expect(text(pill)).toBe('2 new specs · show');
      pill?.click();
      expect(shown()).toBe(1);
    });

    it('keeps the pill slot but renders no pill while nothing is held back', async () => {
      const { host } = await render();
      expect(host.querySelector('.pending-slot')).not.toBeNull();
      expect(host.querySelector('button[data-pending]')).toBeNull();
    });
  });
});

// T136 · ISC-118 and T137 · ISC-122.3 against the harbor dashboard golden: the type glyph before the number,
// `ui-priority` before the stage track (006 P1, 002 P2, every other row P3), and `ui-reason` under every row with the
// golden's `nextReason` verbatim and its `nextCommand` as the chip, outside the row link.
describe('SpecTable rows on the harbor golden (T136, T137)', () => {
  const GOLDEN = harbor as unknown as { specs: ReadonlyArray<{ id: string; type: string; stage: string; nextReason: string; nextCommand: string | null }> };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderHarbor(): Promise<HTMLElement> {
    // Spec 021 (T25): harbor lists more rows than the fold shows; these pins read every row, so the list is open.
    await TestBed.inject(Router).navigateByUrl('/?open=specs');
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(harbor));
    fixture.componentRef.setInput('archive', readArchiveRows(harbor));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }
  const rowOf = (host: HTMLElement, id: string): HTMLElement => {
    const found = host.querySelector<HTMLElement>(`[data-spec-row="${id}"]`)?.closest('li');
    if (!found) throw new Error(`no row ${id}`);
    return found;
  };

  it('draws the type glyph before the number and the priority before the stage track: 006 P1, 002 P2, others P3', async () => {
    const host = await renderHarbor();
    expect(GOLDEN.specs.length).toBeGreaterThan(2);
    for (const spec of GOLDEN.specs) {
      const row = rowOf(host, spec.id);
      const rid = row.querySelector('.rid') as HTMLElement;
      expect(rid.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe(spec.type);
      expect(rid.querySelector('ui-type-glyph + .rnum, .rglyph + .rnum')?.textContent.trim()).toBe(spec.id);
      const priority = row.querySelector('.rtrack ui-priority');
      const level = spec.id === '006' ? 'P1' : spec.id === '002' ? 'P2' : 'P3';
      expect(priority?.getAttribute('data-level'), spec.id).toBe(level);
      expect(priority?.hasAttribute('data-unmarked')).toBe(false);
      expect(priority?.nextElementSibling?.tagName.toLowerCase()).toBe('ui-stage-track');
    }
  });

  // spec 024 (principal 2026-10-13, "Hybrid"): only a waiting spec's row carries its reason, without the command chip;
  // ISC-122.3's phrase is unchanged. Spec 021 (R1): the phrase is the row link's description, no visible line.
  it("makes a waiting row's nextReason verbatim the row link's description, no line of its own, and no reason elsewhere", async () => {
    const host = await renderHarbor();
    let waiting = 0;
    expect(host.querySelector('ui-reason, app-spec-row-guide, ui-command-chip')).toBeNull();
    for (const spec of GOLDEN.specs) {
      const link = host.querySelector<HTMLElement>(`[data-spec-row="${spec.id}"]`);
      const reason = host.querySelector<HTMLElement>(`#why-${spec.id}`);
      if (!WAITING_STAGES.has(spec.stage as Stage)) {
        expect(reason, spec.id).toBeNull();
        expect(link?.getAttribute('aria-describedby') ?? '').not.toContain('why-');
        continue;
      }
      waiting += 1;
      expect(reason?.textContent, spec.id).toBe(spec.nextReason);
      expect(reason?.hidden).toBe(true);
      expect(reason?.closest('a')).toBeNull();
      expect(reason?.parentElement).toBe(rowOf(host, spec.id));
      expect(link?.getAttribute('aria-describedby')?.split(' ')).toContain(`why-${spec.id}`);
      expect(link?.getAttribute('title')).toContain(spec.nextReason);
    }
    expect(waiting).toBeGreaterThan(0);
  });

  // Spec 020 · T26 · ISC-240, refined by spec 021 (R1, T73): with guidance, a row whose spec waits on you carries the
  // visible mark "Waits on you" in its line, a row whose spec is next the open ring; the entry's sentence is the row
  // link's description and tooltip. No guide row, no command chip in the list; no mark on any other row.
  it('marks exactly the rows in "Waits on you" in their line and makes every entry\'s sentence the row link\'s description', async () => {
    const guidance = (harbor as unknown as { guidance: Guidance }).guidance;
    // Spec 021 (T25): every harbor row in view, past the fold's first 10.
    await TestBed.inject(Router).navigateByUrl('/?open=specs');
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(harbor));
    fixture.componentRef.setInput('archive', readArchiveRows(harbor));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    fixture.componentRef.setInput('guidance', guidance);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const own = (list: readonly GuidanceEntry[]) => list.filter((e) => e.item === 'spec');
    const waits = own(guidance.waits);
    const next = own(guidance.next);
    expect(waits.length).toBeGreaterThan(0);
    expect(next.length).toBeGreaterThan(0);
    expect(host.querySelector('app-spec-row-guide, ui-reason, ui-command-chip')).toBeNull();
    const marked = [...host.querySelectorAll('[data-waits-mark]')].map((m) => m.closest('li')?.querySelector('[data-spec-row]')?.getAttribute('data-spec-row'));
    expect(marked.sort()).toEqual(waits.map((e) => e.spec).sort());
    for (const [entry, kind] of [...waits.map((e) => [e, 'waits'] as const), ...next.map((e) => [e, 'next'] as const)]) {
      const li = rowOf(host, entry.spec);
      const row = li.querySelector<HTMLElement>('app-spec-row');
      const link = li.querySelector<HTMLElement>('[data-spec-row]');
      expect(row?.getAttribute('data-mark'), entry.spec).toBe(kind);
      // The mark leads the track cell, in the row's one line; outside the row link.
      const mark = row?.querySelector('.rtrack > .rmark');
      expect(mark?.parentElement?.firstElementChild).toBe(mark);
      expect(mark?.closest('a')).toBeNull();
      expect(text(row?.querySelector('[data-waits-mark]') ?? null)).toBe(kind === 'waits' ? 'Waits on you' : '');
      expect(row?.querySelector('[data-next-mark] ui-glyph')?.getAttribute('data-shape') ?? null).toBe(kind === 'next' ? 'ring' : null);
      const why = li.querySelector<HTMLElement>(`#why-${entry.spec}`);
      expect(why?.hidden, entry.spec).toBe(true);
      expect(why?.getAttribute('data-guide')).toBe(kind);
      const sentence = text(why);
      expect(sentence.length, entry.spec).toBeGreaterThan(0);
      expect(sentence.startsWith('guidance.')).toBe(false);
      const described = link?.getAttribute('aria-describedby')?.split(' ') ?? [];
      expect(described.slice(0, kind === 'waits' ? 2 : 1)).toEqual(kind === 'waits' ? [`mark-${entry.spec}`, `why-${entry.spec}`] : [`why-${entry.spec}`]);
      expect(link?.getAttribute('title')).toContain(sentence);
    }
    const guided = new Set([...waits, ...next].map((e) => e.spec));
    for (const spec of GOLDEN.specs.filter((s) => !guided.has(s.id))) {
      expect(rowOf(host, spec.id).querySelector('app-spec-row')?.hasAttribute('data-mark'), spec.id).toBe(false);
      expect(rowOf(host, spec.id).querySelector('.rmark'), spec.id).toBeNull();
    }
  });

  // Spec 021 · T74 (design § P3 heights): below 640 px of list the row's two lines are `id | title | a/b` over the mark
  // (or, without guidance, the description) · phase · priority. The host attributes the 640 px query reads: a marked
  // row hides its description there, so line 2 starts with the mark; the meter bar and the track are the query's to hide.
  it('gives the compact row its two lines: the a/b in the meter cell, mark or description, phase and priority below (T74)', async () => {
    const guidance = (harbor as unknown as { guidance: Guidance }).guidance;
    await TestBed.inject(Router).navigateByUrl('/?open=specs');
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(harbor));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    fixture.componentRef.setInput('guidance', guidance);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const waiting = guidance.waits.find((e) => e.item === 'spec');
    const plain = GOLDEN.specs.find((s) => !guidanceEntryOf(guidance, s.id));
    expect(waiting && plain).toBeTruthy();
    for (const id of [waiting?.spec ?? '', plain?.id ?? '']) {
      const row = rowOf(host, id).querySelector('app-spec-row') as HTMLElement;
      // Line 1: id, title (the row link), a/b.
      expect(row.querySelector('.rid .rnum')?.textContent.trim()).toBe(id);
      expect(row.querySelector('.tline [data-spec-row]')).not.toBeNull();
      expect(row.querySelector('.rmeter .frac')?.textContent).toMatch(/^\d+\/\d+$/);
      // Line 2: phase and priority in the track cell, the mark first on a marked row.
      expect(row.querySelector('.rtrack .phase')).not.toBeNull();
      expect(row.querySelector('.rtrack .rprio')).not.toBeNull();
    }
    const marked = rowOf(host, waiting?.spec ?? '').querySelector('app-spec-row') as HTMLElement;
    expect(marked.getAttribute('data-mark')).toBe('waits');
    expect(marked.querySelector('.rtrack')?.firstElementChild?.hasAttribute('data-waits-mark')).toBe(true);
    expect(rowOf(host, plain?.id ?? '').querySelector('app-spec-row')?.hasAttribute('data-mark')).toBe(false);
  });
});

// Spec 025, T24 · ISC-163 (design.md § Spec-Liste): the row is no single link; its title is the row link, and a waiting
// spec's "waits on NNN" chip stands behind the title as its own link to the blocker, never inside the row link and
// without the partial meta; the hooks of the row link stay (data-spec-row, data-ref, roving tab stop).
describe('SpecTable waits chip (T24, ISC-163)', () => {
  const WAITS = { spec: '003', blockers: ['002'], heldTasks: 2, readyTasks: 1, openTasks: 3, full: false };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderWaits(): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows({ specs: [wire('002'), wire('003', { waits: WAITS })] }));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  it('reads the row waits through, null when nothing holds', () => {
    const [free, held] = readSpecRows({ specs: [wire('002', { waits: null }), wire('003', { waits: WAITS })] });
    expect(free.waits).toBeNull();
    expect(held.waits?.blockers).toEqual(['002']);
  });

  it('puts the chip behind the title as its own link, outside the row link, with no meta', async () => {
    const host = await renderWaits();
    const link = host.querySelector<HTMLAnchorElement>('a.row-link[data-spec-row="003"]');
    expect(link?.getAttribute('data-ref')).toBe('spec:003');
    expect(link?.querySelector('a, ui-waits-chip')).toBeNull();
    const chip = host.querySelector<HTMLAnchorElement>('ui-waits-chip[data-row-waits] a[data-waits]');
    expect(chip?.closest('a.row-link')).toBeNull();
    expect(chip?.closest('li')).toBe(link?.closest('li'));
    expect(link?.parentElement).toBe(chip?.closest('ui-waits-chip')?.parentElement);
    expect(text(chip)).toBe('waits on 002');
    expect(chip?.getAttribute('href')).toBe('/w/harbor/s/002');
    expect(chip?.getAttribute('aria-label')).toBe('Waits on spec 002, Spec 002, 2 waiting · 1 open');
    expect(host.querySelector('[data-waits-meta]')).toBeNull();
    // Keyboard order: the row link, then its chip.
    const order = [...host.querySelectorAll('a')].filter((a) => a === link || a === chip);
    expect(order).toEqual([link, chip]);
  });

  it('names the row link by its number and title and shows no chip on a row nothing holds', async () => {
    const host = await renderWaits();
    const link = host.querySelector<HTMLAnchorElement>('a.row-link[data-spec-row="002"]');
    const named = (link?.getAttribute('aria-labelledby') ?? '').split(' ').map((id) => text(host.querySelector(`[id="${id}"]`)));
    expect(named.join(' ')).toBe('002 Spec 002');
    expect(link?.closest('li')?.querySelector('ui-waits-chip')).toBeNull();
    expect(host.querySelectorAll('a.row-link a')).toHaveLength(0);
  });
});

// Spec 021 (T25, ISC-246): the dashboard's spec list shows its head with the counters and its first 10 rows (5 until 2026-10-20); the rest
// stand behind "show all N", whose open state is `?open=specs`, so a reload keeps it.
describe('SpecTable fold (spec 021, T25)', () => {
  const MANY = {
    specs: Array.from({ length: 22 }, (_, i) => wire(String(i + 2).padStart(3, '0'), i % 2 === 0 ? { phase: 'building', stageGroup: 'building', stage: 'build' } : {})),
    archive: Array.from({ length: 17 }, (_, i) => ({ id: `1${String(i).padStart(2, '0')}`, slug: `1${String(i).padStart(2, '0')}-old`, title: 'Old', type: 'feature' })),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderMany(url = '/', query: ListQuery = DEFAULT_QUERY, body: Record<string, unknown> = MANY) {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(body));
    fixture.componentRef.setInput('archive', readArchiveRows(body));
    fixture.componentRef.setInput('query', query);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const rowIds = () => [...host.querySelectorAll<HTMLElement>('[data-spec-row]')].map((row) => row.dataset['specRow']);
    const fold = () => host.querySelector<HTMLElement>('ui-disclosure[data-fold="specs"]');
    const toggle = () => fold()?.querySelector<HTMLButtonElement>('button[aria-expanded]') ?? null;
    return { fixture, host, router, rowIds, fold, toggle };
  }

  it('heads the list with the counters as one wrapping chip row, the archived count among them', async () => {
    const { host } = await renderMany();
    const chips = [...host.querySelectorAll<HTMLElement>('.t-head [data-counts] ui-chip')];
    expect(chips.map(text)).toEqual(['22 specs', '17 archived specs']);
    expect(chips.map((chip) => chip.dataset['count'])).toEqual(['active', 'archived']);
    expect(host.querySelector('.t-head .meta')).toBeNull();
  });

  it('counts the archive from the KPI model when the page passes it', async () => {
    const { fixture, host } = await renderMany();
    fixture.componentRef.setInput('archivedCount', 1);
    await fixture.whenStable();
    expect(text(host.querySelector('[data-count="archived"]'))).toBe('1 archived spec');
  });

  it('shows the first 10 rows and folds the rest behind "Show all 22 specs", closed', async () => {
    const { rowIds, fold, toggle } = await renderMany();
    expect(rowIds()).toEqual(['002', '003', '004', '005', '006', '007', '008', '009', '010', '011']);
    expect(fold()?.hasAttribute('data-open')).toBe(false);
    expect(text(toggle())).toBe('Show all 22 specs');
    expect(toggle()?.getAttribute('aria-expanded')).toBe('false');
    expect(fold()?.querySelector('[data-spec-row]')).toBeNull();
  });

  it('opens on "show all N", writes `?open=specs` and keeps focus on the toggle', async () => {
    const { fixture, router, rowIds, fold, toggle } = await renderMany('/?sel=spec:002');
    toggle()?.focus();
    toggle()?.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?sel=spec:002&open=specs');
    expect(fold()?.hasAttribute('data-open')).toBe(true);
    expect(toggle()?.getAttribute('aria-expanded')).toBe('true');
    expect(rowIds()).toHaveLength(22);
    expect(fold()?.querySelectorAll('[data-spec-row]')).toHaveLength(12);
    expect(fold()?.querySelector('ol.rows-rest')?.getAttribute('start')).toBe('11');
    expect(document.activeElement).toBe(toggle());

    toggle()?.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?sel=spec:002');
    expect(rowIds()).toHaveLength(10);
  });

  it('a reload with `?open=specs` shows the whole list', async () => {
    const { rowIds, fold } = await renderMany('/?open=specs');
    expect(fold()?.hasAttribute('data-open')).toBe(true);
    expect(rowIds()).toHaveLength(22);
  });

  it('keeps one roving list over both parts: ↓ from row 10 lands on row 11; the toggle keeps its own arrow keys', async () => {
    const { fixture, host, toggle } = await renderMany('/?open=specs');
    const row = (id: string) => host.querySelector<HTMLElement>(`[data-spec-row="${id}"]`);
    row('011')?.focus();
    row('011')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(row('012'));
    expect(row('012')?.tabIndex).toBe(0);

    toggle()?.focus();
    toggle()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(document.activeElement).toBe(toggle());
  });

  it('caps a filtered list the same way and counts its rows; no fold for 10 rows or fewer', async () => {
    const building = await renderMany('/', { ...DEFAULT_QUERY, phase: 'building' });
    expect(building.rowIds()).toHaveLength(10);
    expect(text(building.toggle())).toBe('Show all 11 specs');

    const few = await renderMany('/', DEFAULT_QUERY, { specs: MANY.specs.slice(0, 10), archive: [] });
    expect(few.rowIds()).toHaveLength(10);
    expect(few.fold()).toBeNull();
  });

  it('reads the fold in German', async () => {
    const { fixture, toggle, host } = await renderMany();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(text(toggle())).toBe('Alle 22 Specs zeigen');
    expect(text(host.querySelector('[data-count="archived"]'))).toBe('17 archivierte Specs');
  });
});

describe('SpecTable names (spec 021, T32, ISC-248)', () => {
  const TYPED = {
    specs: [wire('002', { goal: 'Serves the dashboard.' }), wire('003', { type: 'bug' }), wire('004')],
    archive: [],
    kpis: { specs: 3, stageGroups: { scoping: 3, building: 0, complete: 0 }, specsWithFog: 0, byType: { bug: 1, feature: 2 } },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderTyped() {
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(TYPED));
    fixture.componentRef.setInput('archive', readArchiveRows(TYPED));
    fixture.componentRef.setInput('counts', readListCounts(TYPED));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }
  const allChip = (host: HTMLElement, group: string) => host.querySelector<HTMLButtonElement>(`[data-filter="${group}"] button`);

  it('names the two "all" chips by their group, so no two chips share a name', async () => {
    const { host } = await renderTyped();
    expect(text(allChip(host, 'phase'))).toBe('All 3');
    expect(allChip(host, 'phase')?.getAttribute('aria-label')).toBe('All 3 stages');
    expect(text(allChip(host, 'type'))).toBe('All 3');
    expect(allChip(host, 'type')?.getAttribute('aria-label')).toBe('All 3 types');
    const named = [...host.querySelectorAll<HTMLButtonElement>('[data-filter] button')].map((b) => b.getAttribute('aria-label') ?? text(b));
    expect(new Set(named).size).toBe(named.length);
  });

  it('names the chips in German too', async () => {
    const { fixture, host } = await renderTyped();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(allChip(host, 'phase')?.getAttribute('aria-label')).toBe('Alle 3 Stages');
    expect(allChip(host, 'type')?.getAttribute('aria-label')).toBe('Alle 3 Typen');
  });

  it('names a row\'s "More…" by its spec once the description overflows, visible text first (label in name)', async () => {
    const { fixture, host } = await renderTyped();
    expect(host.querySelector('[data-more]')).toBeNull();
    (fixture.componentInstance as unknown as { setOverflow(id: string, overflows: boolean): void }).setOverflow('002', true);
    await fixture.whenStable();
    const more = host.querySelector<HTMLButtonElement>('[data-more="002"]');
    expect(text(more)).toBe('More…');
    expect(more?.getAttribute('aria-label')).toBe('More… 002 Spec 002');
    more?.click();
    await fixture.whenStable();
    expect(text(more)).toBe('Less');
    expect(more?.getAttribute('aria-label')).toBe('Less 002 Spec 002');
  });
});

// Spec 021 (T48, ISC-254): the row density comes from the stored setting; `?density=` overrides it for this view only
// and never writes the setting. Compact drops the description: the title stands alone at wide, and line 2 of the
// compact tier carries only mark, phase and priority.
describe('SpecTable density (spec 021, T48, ISC-254)', () => {
  async function renderWith(url: string, stored: Density) {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      // The fake again: a test that resets the module mid-way loses the file's `beforeEach` provider (spec 052, T18).
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ShellData, useClass: FakeShellData }],
    });
    const http = TestBed.inject(HttpTestingController);
    const settings = TestBed.inject(SettingsService);
    const loaded = settings.load();
    http.expectOne((r) => r.method === 'GET' && r.url === SETTINGS_URL).flush({ density: stored });
    await loaded;
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(BODY));
    fixture.componentRef.setInput('archive', readArchiveRows(BODY));
    fixture.componentRef.setInput('counts', readListCounts(BODY));
    fixture.componentRef.setInput('query', DEFAULT_QUERY);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const row = (id: string) => host.querySelector<HTMLElement>(`app-spec-row:has([data-spec-row="${id}"])`);
    const writes = () => http.match((r) => r.url === SETTINGS_URL && r.method !== 'GET');
    return { row, writes, settings };
  }

  it('a comfortable setting shows the description where it differs from the title', async () => {
    const { row, writes } = await renderWith('/', 'comfortable');
    expect(row('002')?.getAttribute('data-density')).toBe('comfortable');
    expect(text(row('002')?.querySelector('.d'))).toBe('Serves the dashboard.');
    expect(row('002')?.hasAttribute('data-desc')).toBe(true);
    expect(row('002')?.querySelector('a.row-link')?.getAttribute('aria-describedby')).toContain('desc-002');
    expect(row('003')?.querySelector('.d')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('a compact setting drops the description: the title stands alone and the link names no description', async () => {
    const { row, writes } = await renderWith('/', 'compact');
    const compact = row('002');
    expect(compact?.getAttribute('data-density')).toBe('compact');
    expect(compact?.querySelector('.d')).toBeNull();
    expect(compact?.hasAttribute('data-desc')).toBe(false);
    expect(compact?.querySelector('a.row-link')?.getAttribute('aria-describedby') ?? '').not.toContain('desc-002');
    expect(text(compact?.querySelector('a.row-link'))).toBe('Spec 002');
    // Only the description leaves: agent dot, phase chip, priority, track and a/b stay.
    expect(compact?.querySelector('.rtrack .agent-dot')).not.toBeNull();
    expect(text(compact?.querySelector('.rtrack ui-chip.phase'))).toBe('building');
    expect(compact?.querySelector('.rtrack ui-priority')).not.toBeNull();
    expect(text(compact?.querySelector('.rmeter .frac'))).toBe('25/30');
    expect(writes()).toEqual([]);
  });

  it('?density=compact overrides a comfortable setting for this view and writes no setting', async () => {
    const { row, writes, settings } = await renderWith('/?density=compact', 'comfortable');
    expect(row('002')?.getAttribute('data-density')).toBe('compact');
    expect(row('002')?.querySelector('.d')).toBeNull();
    expect(settings.settings().density).toBe('comfortable');
    expect(writes()).toEqual([]);
  });

  it('?density=comfortable overrides a compact setting; an unknown value falls back to the setting', async () => {
    const first = await renderWith('/?density=comfortable', 'compact');
    expect(first.row('002')?.getAttribute('data-density')).toBe('comfortable');
    expect(text(first.row('002')?.querySelector('.d'))).toBe('Serves the dashboard.');
    TestBed.resetTestingModule();
    const second = await renderWith('/?density=dense', 'compact');
    expect(second.row('002')?.getAttribute('data-density')).toBe('compact');
    expect(second.writes()).toEqual([]);
  });
});

// Spec 050 (T4, ISC-287): "Show archived" in the list's head. Off by default and only there with an archive; on, the
// archived specs are rows of the one list under every active row, each with the archive chip and none of an active
// row's priority, stage track or phase chip, and their link selects, then opens the spec like any other row.
describe('archived toggle (spec 050, ISC-287)', () => {
  const ARCHIVED = {
    specs: [
      wire('002', { phase: 'building', stageGroup: 'building', stage: 'build', progress: { closed: 25, total: 30 }, goal: 'Serves the dashboard.' }),
      wire('003'),
    ],
    archive: [
      { id: '001', slug: '001-manifest-sync', title: 'Manifest sync', type: 'feature', claims: { closed: 6, total: 6 }, goal: 'Syncs the manifest.', archived: '2026-09-12' },
      { id: '004', slug: '004-old-export', title: 'Old export', type: 'feature', claims: { closed: 3, total: 4 }, goal: '', archived: null },
    ],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderArchive(query: ListQuery = DEFAULT_QUERY, body: Record<string, unknown> = ARCHIVED) {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/');
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(body));
    fixture.componentRef.setInput('archive', readArchiveRows(body));
    fixture.componentRef.setInput('query', query);
    const emitted: ListQuery[] = [];
    fixture.componentInstance.queryChange.subscribe((next) => emitted.push(next));
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const toggle = () => host.querySelector<HTMLButtonElement>('button[data-control="archived"]');
    const archivedLinks = () => [...host.querySelectorAll<HTMLAnchorElement>('.row-link[data-archived-row]')];
    const rowIds = () => [...host.querySelectorAll<HTMLElement>('.row-link[data-spec-row]')].map((link) => link.dataset['specRow']);
    return { fixture, host, router, emitted, toggle, archivedLinks, rowIds };
  }

  it('renders no toggle without an archive', async () => {
    const { toggle, archivedLinks } = await renderArchive(DEFAULT_QUERY, { specs: ARCHIVED.specs, archive: [] });
    expect(toggle()).toBeNull();
    expect(archivedLinks()).toHaveLength(0);
  });

  it('is off by default: aria-pressed="false" and no archived row; a click asks for archived: true', async () => {
    const { fixture, toggle, archivedLinks, rowIds, emitted } = await renderArchive();
    expect(text(toggle())).toBe('Show archived');
    expect(toggle()?.getAttribute('aria-pressed')).toBe('false');
    expect(archivedLinks()).toHaveLength(0);
    expect(rowIds()).toEqual(['002', '003']);
    toggle()?.click();
    await fixture.whenStable();
    expect(emitted).toEqual([{ ...DEFAULT_QUERY, archived: true }]);
  });

  it('reads "Archivierte zeigen" in German', async () => {
    const { fixture, toggle } = await renderArchive();
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(text(toggle())).toBe('Archivierte zeigen');
  });

  it('on, lists every archived spec as a row under all active ones, each with the chip and no priority, track or phase', async () => {
    const { fixture, host, toggle, archivedLinks, rowIds, emitted } = await renderArchive({ ...DEFAULT_QUERY, archived: true });
    expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    const archivedIds = archivedLinks().map((link) => link.dataset['archivedRow']);
    expect([...archivedIds].sort()).toEqual(['001', '004']);
    // One list, DOM order: the active rows first, then the archived block.
    const ids = rowIds();
    expect(ids.slice(0, 2)).toEqual(['002', '003']);
    expect([...ids.slice(2)].sort()).toEqual(['001', '004']);
    for (const link of archivedLinks()) {
      const row = link.closest('app-spec-row') as HTMLElement;
      expect(row.hasAttribute('data-archived')).toBe(true);
      expect(text(row.querySelector('[data-archived-chip]'))).toBe('Archived');
      expect(row.querySelector('ui-priority')).toBeNull();
      expect(row.querySelector('ui-stage-track')).toBeNull();
      expect(row.querySelector('ui-chip.phase')).toBeNull();
    }
    // The active rows keep theirs and carry no archive mark.
    for (const id of ['002', '003']) {
      const row = host.querySelector(`.row-link[data-spec-row="${id}"]`)?.closest('app-spec-row') as HTMLElement;
      expect(row.hasAttribute('data-archived')).toBe(false);
      expect(row.querySelector('[data-archived-chip]')).toBeNull();
      expect(row.querySelector('ui-stage-track')).not.toBeNull();
    }
    expect(host.querySelectorAll('app-spec-row[data-archived]')).toHaveLength(2);
    toggle()?.click();
    await fixture.whenStable();
    expect(emitted).toEqual([{ ...DEFAULT_QUERY, archived: false }]);
  });

  it('a reload with `?archived=1` shows them: the URL the page parses turns the toggle on', async () => {
    const { fixture, router, toggle, archivedLinks } = await renderArchive();
    expect(archivedLinks()).toHaveLength(0);
    // The dashboard page parses its query params with `parseListQuery`; feed it the reloaded URL's map.
    const reloaded = parseListQuery(router.parseUrl('/w/harbor?archived=1').queryParamMap);
    expect(reloaded).toEqual({ ...DEFAULT_QUERY, archived: true });
    expect(parseListQuery(convertToParamMap({ archived: '1' }))).toEqual(reloaded);
    fixture.componentRef.setInput('query', reloaded);
    await fixture.whenStable();
    expect(toggle()?.getAttribute('aria-pressed')).toBe('true');
    expect(archivedLinks().map((link) => link.dataset['archivedRow']).sort()).toEqual(['001', '004']);
    // Without the parameter the reload is off again.
    expect(parseListQuery(convertToParamMap({}))).toEqual(DEFAULT_QUERY);
  });

  it('an archived row selects first (`?sel=spec:<id>`), then links to the spec page like an active row', async () => {
    const { fixture, host, router } = await renderArchive({ ...DEFAULT_QUERY, archived: true });
    const link = () => host.querySelector<HTMLAnchorElement>('.row-link[data-archived-row="001"]');
    expect(link()?.getAttribute('data-ref')).toBe('spec:001');
    expect(link()?.getAttribute('href')).toMatch(/[?&]sel=spec:001$/);
    link()?.click();
    await fixture.whenStable();
    expect(router.url).toBe('/?sel=spec:001');
    fixture.componentRef.setInput('preview', '001');
    await fixture.whenStable();
    expect(link()?.getAttribute('data-selected')).toBe('row');
    expect(link()?.getAttribute('href')).toBe('/w/harbor/s/001');
  });
});

describe('archived rows under filters and the fold (spec 050, ISC-288)', () => {
  const pad = (n: number): string => String(n).padStart(3, '0');
  const PHASES = [
    { phase: 'building', stageGroup: 'building', stage: 'build' },
    { phase: 'scoping', stageGroup: 'scoping', stage: 'review' },
    { phase: 'complete', stageGroup: 'complete', stage: 'done' },
  ];
  // 22 active specs on the even IDs 002–044: phases in turn, every third a bug, fog and takeable on some, mixed ratios.
  const ACTIVE = Array.from({ length: 22 }, (_, i) =>
    wire(pad(2 * (i + 1)), {
      ...PHASES[i % 3],
      type: i % 3 === 0 ? 'bug' : 'feature',
      progress: { closed: i % 4, total: 4 },
      fog: i % 5 === 0 ? 1 : 0,
      takeable: i % 4 === 1 ? ['ISC-1'] : [],
    }),
  );
  // 17 archived specs on the odd IDs 001–033, out of order, so an ID sort over both blocks would interleave them.
  const ARCHIVED_IDS = [17, 5, 29, 1, 23, 11, 33, 9, 21, 3, 27, 15, 31, 7, 19, 25, 13];
  const ARCHIVE = ARCHIVED_IDS.map((n, i) => ({
    id: pad(n),
    slug: `${pad(n)}-old`,
    title: `Old ${pad(n)}`,
    type: i % 4 === 0 ? 'bug' : 'feature',
    claims: { closed: i % 5, total: 4 },
    goal: '',
    archived: '2026-09-01',
  }));
  const BODY_050 = { specs: ACTIVE, archive: ARCHIVE };
  const ON: ListQuery = { ...DEFAULT_QUERY, archived: true };

  const ids = (rows: ReadonlyArray<Record<string, unknown>>): string[] => rows.map((row) => String(row['id']));
  const activeOf = (keep: (row: Record<string, unknown>) => boolean): string[] => ids(ACTIVE.filter(keep));
  const ratioOf = (row: (typeof ARCHIVE)[number]): number => row.claims.closed / row.claims.total;
  const archivedDesc = (rows = ARCHIVE): string[] => ids([...rows].sort((a, b) => b.id.localeCompare(a.id)));
  const archivedBugs = archivedDesc(ARCHIVE.filter((row) => row.type === 'bug'));
  const activeBugs = activeOf((row) => row['type'] === 'bug');

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  /** Renders the table under `query`; `?open=specs` (the default) opens the fold so every listed row is in the DOM. */
  async function render(query: ListQuery, url = '/?open=specs') {
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(BODY_050));
    fixture.componentRef.setInput('archive', readArchiveRows(BODY_050));
    fixture.componentRef.setInput('query', query);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const rowIds = () => [...host.querySelectorAll<HTMLElement>('.row-link[data-spec-row]')].map((link) => link.dataset['specRow'] ?? '');
    const archivedIds = () => [...host.querySelectorAll<HTMLElement>('.row-link[data-archived-row]')].map((link) => link.dataset['archivedRow'] ?? '');
    const fold = () => host.querySelector<HTMLElement>('ui-disclosure[data-fold="specs"]');
    const summary = () => host.querySelector<HTMLElement>('[data-show-all]');
    const suffix = () => host.querySelector<HTMLElement>('[data-fold-archived]');
    return { fixture, rowIds, archivedIds, fold, summary, suffix };
  }

  it('the type filter reaches the archived rows: only the bugs of both blocks, the archived ones after the active', async () => {
    const { rowIds, archivedIds } = await render({ ...ON, type: 'bug' });
    expect(activeBugs).toHaveLength(8);
    expect(archivedBugs).toEqual(['031', '023', '021', '017', '013']);
    expect(rowIds()).toEqual([...activeBugs, ...archivedBugs]);
    expect(archivedIds()).toEqual(archivedBugs);
  });

  it('every phase chip, fog and takeable hide every archived row and leave the active rows they match', async () => {
    const cases: Array<{ query: ListQuery; active: string[] }> = [
      ...['scoping', 'building', 'complete'].map((phase) => ({ query: { ...ON, phase }, active: activeOf((row) => row['stageGroup'] === phase) })),
      { query: { ...ON, phase: 'fog' }, active: activeOf((row) => Number(row['fog']) > 0) },
      { query: { ...ON, takeable: true }, active: activeOf((row) => Array.isArray(row['takeable']) && row['takeable'].length > 0) },
    ];
    for (const { query, active } of cases) {
      const { rowIds, archivedIds, suffix } = await render(query);
      expect(active.length).toBeGreaterThan(0);
      expect(rowIds()).toEqual(active);
      expect(archivedIds()).toEqual([]);
      expect(suffix()).toBeNull();
    }
  });

  it('the sort orders the archive block on its own, always after every active row', async () => {
    const activeIds = ids(ACTIVE);
    const byId = await render({ ...ON, sort: 'id' });
    expect(byId.rowIds()).toEqual([...activeIds, ...ids([...ARCHIVE].sort((a, b) => a.id.localeCompare(b.id)))]);
    expect(byId.archivedIds().slice(0, 3)).toEqual(['001', '003', '005']);

    const byStage = await render({ ...ON, sort: 'stage' });
    expect(byStage.rowIds()).toEqual([...activeIds, ...archivedDesc()]);
    expect(byStage.archivedIds().slice(0, 3)).toEqual(['033', '031', '029']);

    const byProgress = await render({ ...ON, sort: 'progress' });
    const closedOf = (row: Record<string, unknown>): number => (row['progress'] as { closed: number }).closed;
    const activeByRatio = ids([...ACTIVE].sort((a, b) => closedOf(b) - closedOf(a)));
    const archivedByRatio = ids([...ARCHIVE].sort((a, b) => ratioOf(b) - ratioOf(a) || b.id.localeCompare(a.id)));
    expect(byProgress.rowIds()).toEqual([...activeByRatio, ...archivedByRatio]);
    // The three 4/4 specs lead the block, their tie broken by ID descending.
    expect(byProgress.archivedIds().slice(0, 3)).toEqual(['023', '019', '003']);
  });

  it('the fold counts the archived rows: 10 before it, the other 29 inside, "Show all 39 specs · 17 archived"', async () => {
    const closed = await render(ON, '/');
    expect(closed.rowIds()).toEqual(ids(ACTIVE.slice(0, 10)));
    expect(text(closed.summary())).toBe('Show all 39 specs · 17 archived');
    expect(text(closed.suffix())).toBe('· 17 archived');

    const open = await render(ON);
    expect(open.rowIds()).toHaveLength(39);
    expect(open.fold()?.querySelectorAll('.row-link[data-spec-row]')).toHaveLength(29);
    expect(open.fold()?.querySelectorAll('.row-link[data-archived-row]')).toHaveLength(17);
  });

  it('under a type filter that leaves fewer than 10 active rows, archived rows move up into the first 10', async () => {
    const { rowIds, archivedIds, summary, suffix } = await render({ ...ON, type: 'bug' }, '/');
    expect(rowIds()).toEqual([...activeBugs, '031', '023']);
    expect(archivedIds()).toEqual(['031', '023']);
    expect(text(summary())).toBe('Show all 13 specs · 5 archived');
    expect(text(suffix())).toBe('· 5 archived');
  });

  it('with the switch off the fold counts the active rows only and names no archive', async () => {
    const { rowIds, archivedIds, summary, suffix } = await render(DEFAULT_QUERY, '/');
    expect(rowIds()).toHaveLength(10);
    expect(archivedIds()).toEqual([]);
    expect(text(summary())).toBe('Show all 22 specs');
    expect(suffix()).toBeNull();
  });

  it('reads the fold in German: "Alle 39 Specs zeigen · 17 archiviert"', async () => {
    const { fixture, summary } = await render(ON, '/');
    TestBed.inject(TranslocoService).setActiveLang('de');
    await fixture.whenStable();
    expect(text(summary())).toBe('Alle 39 Specs zeigen · 17 archiviert');
  });
});

describe('toggle off shows no archived spec (spec 050, ISC-289)', () => {
  const ACTIVE = [
    wire('002', { phase: 'building', stageGroup: 'building', stage: 'build', progress: { closed: 25, total: 30 }, goal: 'Serves the dashboard.' }),
    wire('003', { type: 'bug' }),
  ];
  const ARCHIVE = [
    { id: '001', slug: '001-manifest-sync', title: 'Manifest sync', type: 'feature', claims: { closed: 6, total: 6 }, goal: 'Syncs the manifest.', archived: '2026-09-12' },
    { id: '004', slug: '004-old-export', title: 'Old export', type: 'bug', claims: { closed: 3, total: 4 }, goal: '', archived: null },
  ];
  const ARCHIVED_IDS = ARCHIVE.map((row) => row.id);

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  /** Renders the table with the fold open (`?open=specs`), so a row behind it would be in the DOM too. */
  async function render(query: ListQuery = DEFAULT_QUERY, body: Record<string, unknown> = { specs: ACTIVE, archive: ARCHIVE }) {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?open=specs');
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(body));
    fixture.componentRef.setInput('archive', readArchiveRows(body));
    fixture.componentRef.setInput('query', query);
    await fixture.whenStable();
    return { fixture, host: fixture.nativeElement as HTMLElement };
  }

  /** Every forbidden trace of an archived spec in the panel: a list row, a row host, the old footer, a link to its page. */
  function expectNoArchived(host: HTMLElement): void {
    expect(host.querySelectorAll('.row-link[data-archived-row]')).toHaveLength(0);
    expect(host.querySelectorAll('app-spec-row[data-archived]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-archived-chip]')).toHaveLength(0);
    expect(host.querySelectorAll('[data-fold="archive"]')).toHaveLength(0);
    expect(host.querySelectorAll('#archive, .t-foot')).toHaveLength(0);
    for (const id of ARCHIVED_IDS) {
      expect(host.querySelectorAll(`a[href*="/s/${id}"], a[href*="spec:${id}"], [data-spec-row="${id}"], [data-ref="spec:${id}"]`)).toHaveLength(0);
    }
  }

  it('the default query lists the active rows only, names no archived spec anywhere and keeps "2 archived specs" in the head', async () => {
    const { host } = await render();
    expect(DEFAULT_QUERY.archived).toBe(false);
    expectNoArchived(host);
    expect([...host.querySelectorAll<HTMLElement>('.row-link[data-spec-row]')].map((link) => link.dataset['specRow'])).toEqual(['002', '003']);
    expect(text(host.querySelector('[data-count="archived"]'))).toBe('2 archived specs');
    expect(host.querySelector('button[data-control="archived"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('stays without archived rows under every sort and under a type filter that an archived spec matches', async () => {
    const queries: ListQuery[] = [
      ...(['id', 'stage', 'next', 'progress'] as const).map((sort) => ({ ...DEFAULT_QUERY, sort })),
      { ...DEFAULT_QUERY, type: 'feature' },
      { ...DEFAULT_QUERY, type: 'bug', sort: 'id' },
    ];
    for (const query of queries) {
      const { host } = await render(query);
      expectNoArchived(host);
      expect(host.querySelectorAll('.row-link[data-spec-row]').length).toBeGreaterThan(0);
      expect(text(host.querySelector('[data-count="archived"]'))).toBe('2 archived specs');
    }
  });

  it('the singular counter reads "1 archived spec"', async () => {
    const { host } = await render(DEFAULT_QUERY, { specs: ACTIVE, archive: ARCHIVE.slice(0, 1) });
    expectNoArchived(host);
    expect(text(host.querySelector('[data-count="archived"]'))).toBe('1 archived spec');
  });

  it('no active spec, an archive and the switch off: "No active spec · K archived", no row and no footer', async () => {
    for (const archive of [ARCHIVE, ARCHIVE.slice(0, 1)]) {
      const { host } = await render(DEFAULT_QUERY, { specs: [], archive });
      expectNoArchived(host);
      expect(host.querySelectorAll('.row-link')).toHaveLength(0);
      expect(text(host.querySelector('p.empty[data-empty="active"]'))).toBe(`No active spec · ${archive.length} archived`);
      expect(text(host.querySelector('[data-count="archived"]'))).toBe(archive.length === 1 ? '1 archived spec' : `${archive.length} archived specs`);
    }
  });

  it('no active spec and no archive: the old "No specs yet", no active-empty line', async () => {
    const { host } = await render(DEFAULT_QUERY, { specs: [], archive: [] });
    expect(text(host.querySelector('p.empty'))).toBe('No specs yet');
    expect(host.querySelector('[data-empty="active"]')).toBeNull();
    expect(text(host.querySelector('[data-count="archived"]'))).toBe('0 archived specs');
  });
});

describe('favorite stars in the spec list (spec 052, T18, ISC-300)', () => {
  const STARRED = {
    specs: [wire('002', { slug: '002-web-console', title: 'Web console' }), wire('003'), wire('005')],
    archive: [{ id: '001', slug: '001-manifest-sync', title: 'Manifest sync', type: 'feature' }],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        TranslocoTestingModule.forRoot({
          langs: CATALOGUES,
          translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true },
          preloadLangs: true,
        }),
      ],
      providers: [provideRouter([])],
    });
  });

  async function renderStars(url = '/', query: ListQuery = DEFAULT_QUERY, body: Record<string, unknown> = STARRED) {
    await TestBed.inject(Router).navigateByUrl(url);
    const shell = TestBed.inject(ShellData) as unknown as FakeShellData;
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(body));
    fixture.componentRef.setInput('archive', readArchiveRows(body));
    fixture.componentRef.setInput('query', query);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const item = (id: string) => host.querySelector<HTMLElement>(`.row-link[data-spec-row="${id}"]`)?.closest('li') ?? null;
    const star = (id: string) => item(id)?.querySelector<HTMLButtonElement>('button[ui-star-toggle]') ?? null;
    const link = (id: string) => host.querySelector<HTMLAnchorElement>(`.row-link[data-spec-row="${id}"]`);
    const starredRows = () =>
      [...host.querySelectorAll<HTMLElement>('.row-link[data-spec-row]')].filter((row) => star(row.dataset['specRow'] ?? '') !== null).map((row) => row.dataset['specRow']);
    return { fixture, host, shell, star, link, starredRows };
  }

  it('gives every active row one star named by its id and title, and no archived row one', async () => {
    const { host, star, starredRows } = await renderStars('/', { ...DEFAULT_QUERY, archived: true });
    expect(host.querySelectorAll('.row-link[data-spec-row]')).toHaveLength(4);
    expect(starredRows()).toEqual(['002', '003', '005']);
    expect(host.querySelectorAll('button[ui-star-toggle]')).toHaveLength(3);
    expect(star('001')).toBeNull();
    expect(star('002')?.getAttribute('aria-label')).toBe('Favorite: 002 Web console');
    expect(star('003')?.getAttribute('aria-label')).toBe('Favorite: 003 Spec 003');
    // Outside the row link: a control inside a link is a nested interactive element.
    expect(star('002')?.closest('a')).toBeNull();
  });

  it('presses the star of a favourite folder and follows the set without a re-render of the rows', async () => {
    const { fixture, shell, star } = await renderStars();
    expect(['002', '003', '005'].map((id) => star(id)?.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
    // The folder name, never the row id: a stored `002` stars nothing.
    shell.favoriteIds.set(new Set(['002', '003-slug']));
    await fixture.whenStable();
    expect(['002', '003', '005'].map((id) => star(id)?.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(star('003')?.getAttribute('title')).toBe('Remove from favorites');
    expect(star('002')?.getAttribute('title')).toBe('Add to favorites');
  });

  it("a click toggles the row's spec folder through ShellData and shows the new state", async () => {
    const { fixture, shell, star } = await renderStars();
    star('002')?.click();
    await fixture.whenStable();
    expect(shell.toggled).toEqual(['002-web-console']);
    expect(star('002')?.getAttribute('aria-pressed')).toBe('true');
    star('002')?.click();
    await fixture.whenStable();
    expect(shell.toggled).toEqual(['002-web-console', '002-web-console']);
    expect(star('002')?.getAttribute('aria-pressed')).toBe('false');
  });

  it("keeps one tab stop per row: the star mirrors its row link's tabindex, and focusing it makes its row active", async () => {
    const { fixture, star, link } = await renderStars();
    expect(['002', '003', '005'].map((id) => star(id)?.tabIndex)).toEqual([0, -1, -1]);
    link('003')?.focus();
    await fixture.whenStable();
    expect(['002', '003', '005'].map((id) => star(id)?.tabIndex)).toEqual([-1, 0, -1]);
    star('005')?.focus();
    await fixture.whenStable();
    expect(['002', '003', '005'].map((id) => link(id)?.tabIndex)).toEqual([-1, -1, 0]);
    expect(fixture.componentInstance.selectedId()).toBe('005');
  });

  it('stars the rows behind "Show all N" once the fold is open', async () => {
    const many = { specs: Array.from({ length: 12 }, (_, i) => wire(String(i + 2).padStart(3, '0'))), archive: [] };
    const { fixture, shell, star, starredRows } = await renderStars('/?open=specs', DEFAULT_QUERY, many);
    expect(starredRows()).toHaveLength(12);
    star('013')?.click();
    await fixture.whenStable();
    expect(shell.toggled).toEqual(['013-slug']);
    expect(star('013')?.getAttribute('aria-pressed')).toBe('true');
  });
});
