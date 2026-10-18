import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import { type Stage, WAITING_STAGES } from '../../../../../../core/src/stage';
import { SpecTable } from './spec-table';
import { DEFAULT_QUERY, type ListQuery, readArchiveRows, readSpecRows } from './spec-table-model';

/** A dashboard row as the server sends it (`DashboardSpecRow`), only the fields that matter overridden. */
function wire(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `${id}-slug`,
    title: `Spec ${id}`,
    type: 'feature',
    phase: 'scoping',
    stage: 'review',
    progress: { closed: 0, total: 4 },
    nextCommand: `/spec-review ${id}`,
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
    wire('002', { phase: 'building', stage: 'build', progress: { closed: 25, total: 30 }, goal: 'Serves the dashboard.', taken: [LOCK] }),
    wire('003'),
  ],
  archive: [{ id: '001', slug: '001-manifest-sync', title: 'Manifest sync', type: 'feature' }],
};

const text = (el: Element | null | undefined): string => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';

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

  async function render(query: ListQuery = DEFAULT_QUERY, live: { changed?: ReadonlySet<string>; pending?: readonly string[] } = {}) {
    const fixture = TestBed.createComponent(SpecTable);
    fixture.componentRef.setInput('ws', 'harbor');
    fixture.componentRef.setInput('rows', readSpecRows(BODY));
    fixture.componentRef.setInput('archive', readArchiveRows(BODY));
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
    expect(text(host.querySelector('.t-head .meta'))).toBe('2 · 1 archived');
    expect(host.querySelectorAll('.t-head [data-filter="phase"] button')).toHaveLength(3);
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
    expect(text(rowA.querySelector('.rtrack ui-chip'))).toBe('building');
    expect(rowA.querySelector('.rmeter ui-meter')).not.toBeNull();
    expect(text(rowA.querySelector('.rmeter .frac'))).toBe('25/30');
    expect(rowB.querySelector('.rtitle .d')).toBeNull();
    expect(rowB.querySelector('.agent-dot')).toBeNull();
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

  it('closes with the archived footer "1 archived spec 001 manifest-sync" under #archive', async () => {
    const { host } = await render();
    const foot = host.querySelector('#archive');
    expect(foot?.classList.contains('t-foot')).toBe(true);
    // The parts sit in a flex row with an 8 px gap, so the text nodes carry no spaces between them.
    expect(text(foot?.querySelector(':scope > span'))).toBe('1 archived spec');
    expect(text(foot?.querySelector('a[data-archived-row="001"]'))).toBe('001 manifest-sync');
    expect(foot?.querySelector('a[data-archived-row="001"]')?.getAttribute('href')).toBe('/w/harbor/s/001');
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

  // spec 024 (principal 2026-10-13, "Hybrid"): only a waiting spec's row carries its reason, without the command chip,
  // which moved to the rail (design B23/B24); ISC-122.3's phrase is unchanged.
  it("puts a waiting row's nextReason verbatim in ui-reason outside the row link, and no reason in any other row", async () => {
    const host = await renderHarbor();
    let waiting = 0;
    for (const spec of GOLDEN.specs) {
      const reason = host.querySelector<HTMLElement>(`ui-reason[data-reason="${spec.id}"]`);
      if (!WAITING_STAGES.has(spec.stage as Stage)) {
        expect(reason, spec.id).toBeNull();
        continue;
      }
      waiting += 1;
      expect(reason, spec.id).not.toBeNull();
      expect(reason?.hasAttribute('data-compact')).toBe(true);
      expect(reason?.querySelector('.visually-hidden')?.textContent).toBe(spec.nextReason);
      expect(reason?.closest('a')).toBeNull();
      expect(reason?.parentElement).toBe(rowOf(host, spec.id).closest('li'));
      expect(reason?.querySelector('ui-command-chip')).toBeNull();
    }
    expect(waiting).toBeGreaterThan(0);
  });

  // Spec 020 · T26 · ISC-240: with guidance, a row whose spec waits on you reads "mark · sentence · chip", a row whose
  // spec is next "ring · sentence · chip"; the mark is the visible word, never on a Next row or any other row.
  it('marks exactly the rows in "Waits on you" and gives every row with an entry its whole sentence and chip', async () => {
    const guidance = (harbor as unknown as { guidance: Guidance }).guidance;
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
    const marked = [...host.querySelectorAll('[data-waits-mark]')].map((m) => m.closest('[data-reason]')?.getAttribute('data-reason'));
    expect(marked.sort()).toEqual(waits.map((e) => e.spec).sort());
    for (const [entry, kind] of [...waits.map((e) => [e, 'waits'] as const), ...next.map((e) => [e, 'next'] as const)]) {
      const guide = host.querySelector<HTMLElement>(`app-spec-row-guide[data-reason="${entry.spec}"]`);
      expect(guide, entry.spec).not.toBeNull();
      expect(guide?.getAttribute('data-guide')).toBe(kind);
      expect(guide?.parentElement).toBe(rowOf(host, entry.spec).closest('li'));
      expect(guide?.closest('a')).toBeNull();
      expect(text(guide?.querySelector('[data-waits-mark]') ?? null)).toBe(kind === 'waits' ? 'Waits on you' : '');
      expect(guide?.querySelector('ui-glyph')?.getAttribute('data-shape') ?? null).toBe(kind === 'next' ? 'ring' : null);
      const sentence = text(guide?.querySelector('[data-guide-sentence]') ?? null);
      expect(sentence.length, entry.spec).toBeGreaterThan(0);
      expect(sentence.startsWith('guidance.')).toBe(false);
      expect(guide?.querySelector('ui-command-chip code')?.textContent).toBe(entry.command);
      expect(host.querySelector(`ui-reason[data-reason="${entry.spec}"]`)).toBeNull();
    }
    const guided = new Set([...waits, ...next].map((e) => e.spec));
    for (const spec of GOLDEN.specs.filter((s) => !guided.has(s.id))) {
      expect(host.querySelector(`app-spec-row-guide[data-reason="${spec.id}"]`), spec.id).toBeNull();
    }
  });
});

// Spec 025, T24 · ISC-163 (design.md § Spec-Liste): the row is no single link; its title is the row link, and a waiting
// spec's "waits on NNN" chip stands behind the title as its own link to the blocker, never inside the row link and
// without the partial meta; the hooks of the row link stay (data-spec-row, data-ref, roving tab stop).
describe('SpecTable waits chip (T24, ISC-163)', () => {
  const WAITS = { spec: '003', blockers: ['002'], heldTasks: 2, openTasks: 3, full: false };

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
    expect(chip?.getAttribute('aria-label')).toBe('Waits on spec 002, Spec 002, 2 of 3 open tasks');
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
