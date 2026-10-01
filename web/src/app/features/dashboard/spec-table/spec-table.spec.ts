import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
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
    // T69: a row's first activation previews it (`?spec=<id>`); only the previewed row links to the spec page.
    expect(first.getAttribute('href')).toMatch(/[?&]spec=002$/);
    expect(text(first.querySelector('.rid'))).toBe('002');
    expect(text(first.querySelector('.rtitle .t'))).toBe('Spec 002');
    expect(text(first.querySelector('.rtitle .d'))).toBe('Serves the dashboard.');
    expect(first.querySelector('.rtrack .agent-dot')?.getAttribute('aria-label')).toContain('spec-002-ISC-1');
    expect(first.querySelector('.rtrack ui-stage-track')).not.toBeNull();
    expect(text(first.querySelector('.rtrack ui-chip'))).toBe('building');
    expect(first.querySelector('.rmeter ui-meter')).not.toBeNull();
    expect(text(first.querySelector('.rmeter .frac'))).toBe('25/30');
    expect(second.querySelector('.rtitle .d')).toBeNull();
    expect(second.querySelector('.agent-dot')).toBeNull();
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
