import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import empty from '../../../../../../core/fixtures/empty-master.golden.json';
import guided from '../../../../../../core/fixtures/guidance.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardView as DashboardModel, DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { NextUpList } from './next-up-list';

const HARBOR = harbor as unknown as DashboardModel;
const LANTERN = lantern as unknown as DashboardModel;
const EMPTY = empty as unknown as DashboardModel;

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

async function render(model: Pick<DashboardModel, 'specs' | 'nextUp'>): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(NextUpList);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('ids', model.nextUp);
  fixture.componentRef.setInput('ws', 'harbor');
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const entries = (root: Element): string[] =>
  [...root.querySelectorAll(':scope [data-next-entry]')].map((e) => e.getAttribute('data-next-entry') ?? '');
const row = (id: string): DashboardSpecRow => HARBOR.specs.find((r) => r.id === id) as DashboardSpecRow;

describe('NextUpList', () => {
  it("lists the model's nextUp ids in order, each with its next command and a preview link", async () => {
    const root = await render(HARBOR);
    const primary = root.querySelector('[data-next-primary]') as HTMLElement;
    expect(entries(primary).slice(0, HARBOR.nextUp.length)).toEqual([...HARBOR.nextUp]);
    for (const id of HARBOR.nextUp) {
      const entry = primary.querySelector(`[data-next-entry="${id}"]`) as HTMLElement;
      expect(entry.querySelector('ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
      expect(entry.querySelector('a[data-next-link]')?.getAttribute('href')).toBe(`/?sel=spec:${id}`);
      expect(entry.textContent).toContain(row(id).title);
    }
  });

  it('carries a focusable "Next up" heading with the id the g n sequence lands on', async () => {
    const root = await render(HARBOR);
    const heading = root.querySelector('#next-up') as HTMLElement;
    expect(heading.textContent.trim()).toBe('Next up');
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  // Spec 068 (T7, ISC-542): the further rows stand in the same list, right after the nextUp ids, with no fold.
  it('lists every further row with a next command after the nextUp ids, in model row order, in the one list', async () => {
    const root = await render(HARBOR);
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).map((r) => r.id);
    expect(root.querySelector('[data-show-all]')).toBeNull();
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual([
      ...HARBOR.nextUp,
      ...withCommand.filter((id) => !HARBOR.nextUp.includes(id)),
    ]);
  });

  it('lists exactly nextUp when it already holds every row with a next command', async () => {
    const root = await render(LANTERN);
    expect(entries(root)).toEqual([...LANTERN.nextUp]);
    expect(root.querySelector('[data-show-all]')).toBeNull();
  });

  // Spec 068 (ISC-546): the rows are the spec list's, so id, title and command sit in their cells.
  it('ports Next up to rows under the section header: id and title, the command in its cell', async () => {
    const root = await render(HARBOR);
    expect(root.querySelector('ui-section-header #next-up')).not.toBeNull();
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).length;
    expect(root.querySelector('ui-section-header [data-next-count]')?.textContent.trim()).toBe(String(withCommand));
    const rows = [...root.querySelectorAll('[data-next-primary] [data-next-row]')];
    expect(rows.length).toBe(withCommand);
    for (const [i, id] of HARBOR.nextUp.entries()) {
      const item = rows[i] as HTMLElement;
      expect(item.querySelector('[data-cell="id"] .rnum')?.textContent.trim(), id).toBe(id);
      expect(item.querySelector('a[data-next-link]')?.textContent.trim()).toBe(row(id).title);
      expect(item.querySelector('[data-cell="command"] ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
    }
  });

  it('builds one card of rows: one list, hairline-separated items, no card per entry', async () => {
    const root = await render(HARBOR);
    const cards = root.querySelectorAll('ui-card');
    expect(cards.length).toBe(1);
    const card = cards[0] as HTMLElement;
    expect(card.hasAttribute('data-next-card')).toBe(true);
    expect(card.hasAttribute('data-edge')).toBe(false);
    expect(card.querySelectorAll('ol').length).toBe(1);
    const items = [...card.querySelectorAll(':scope [data-next-primary] > li')];
    expect(items.map((li) => li.querySelector('[data-next-entry]')?.getAttribute('data-next-entry'))).toEqual(entries(root));
    expect(items.length).toBe(HARBOR.specs.filter((r) => r.nextCommand !== null).length);
    // The hairline between rows is the list's own rule (the card has no padding of its own).
    const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const hairline = sheets.split('}').find((rule) => rule.includes('+ li') && rule.includes('border-block-start: 1px solid var(--line)'));
    expect(hairline?.trim()).toMatch(/^\.entries\S*\s*>\s*li\S*\s*\+\s*li\S*\s*\{/);
  });

  it('says nothing is ready to build when nextUp is empty, without a fog link when no spec waits on fog', async () => {
    const root = await render(EMPTY);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')?.textContent).toContain('Nothing ready to build');
    expect(root.querySelector('[data-next-fog]')).toBeNull();
  });

  it('links the specs that wait on fog to the fog filter on /w/:ws/specs when nothing is ready (ISC-395)', async () => {
    const waiting = HARBOR.specs.filter((r) => r.fog > 0).map((r) => ({ ...r, nextCommand: null }));
    expect(waiting.length).toBeGreaterThan(0);
    const root = await render({ specs: waiting, nextUp: [] });
    const link = root.querySelector('a[data-next-fog]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/w/harbor/specs?phase=fog');
    expect(link.textContent.trim()).toBe(waiting.length === 1 ? '1 spec waits on fog' : `${waiting.length} specs wait on fog`);
  });
});

// T137 · ISC-122.3: every Next up entry carries the dashboard row's phrase, with the next
// command as its chip. Spec 068 (T10, ISC-545): the phrase is the row link's description, no visible line.
describe('NextUpList reason line (T137, ISC-122.3)', () => {
  it("describes each harbor entry's link with its nextReason verbatim, beside its command chip", async () => {
    const root = await render(HARBOR);
    const shown = [...root.querySelectorAll<HTMLElement>('[data-next-entry]')];
    expect(shown.length).toBeGreaterThan(0);
    for (const entry of shown) {
      const id = entry.getAttribute('data-next-entry') ?? '';
      const item = entry.closest('li') as HTMLElement;
      const reason = item.querySelector<HTMLElement>(`#next-why-${id}[data-next-reason]`);
      expect(reason?.textContent, id).toBe(row(id).nextReason);
      expect(reason?.hidden).toBe(true);
      expect(item.querySelector('a[data-next-link]')?.getAttribute('aria-describedby')).toBe(`next-why-${id}`);
      expect(entry.querySelector('[data-cell="command"] ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
      expect(item.querySelectorAll('ui-command-chip').length).toBe(1);
    }
  });
});

// Spec 020 · T25 · ISC-240: with guidance, Next up holds `guidance.next` only, in its order, each entry with its
// catalogue sentence in full (no clamp), the ring of "open" instead of the hourglass, the entry's command as its chip
// and no "Waits on you" mark; the specs that wait on you are not in it.
describe('NextUpList reads guidance.next (spec 020, T25, ISC-240)', () => {
  const GUIDED = guided as unknown as DashboardModel & { guidance: Guidance };

  async function renderGuided(model: DashboardModel & { guidance: Guidance }): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(NextUpList);
    fixture.componentRef.setInput('specs', model.specs);
    fixture.componentRef.setInput('ids', model.nextUp);
    fixture.componentRef.setInput('guidance', model.guidance);
    // Spec 068: the rows read the workspace for their waits chips, so the required `ws` must be set here too.
    fixture.componentRef.setInput('ws', 'harbor');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const sentence = (entry: GuidanceEntry): string =>
    entry.reason.key === 'phrase'
      ? entry.reason.phrase
      : TestBed.inject(TranslocoService).translate(`guidance.reason.${entry.reason.key}`, entry.reason.values);

  it("lists guidance.next in its order with the whole sentence, the ring and the entry's chip, no mark", async () => {
    const root = await renderGuided(GUIDED);
    const next = GUIDED.guidance.next.filter((e) => e.item === 'spec');
    expect(next.length).toBeGreaterThan(0);
    expect(entries(root)).toEqual(next.map((e) => e.spec));
    for (const id of GUIDED.guidance.waits.map((e) => e.spec)) {
      if (!next.some((e) => e.spec === id)) expect(root.querySelector(`[data-next-entry="${id}"]`), id).toBeNull();
    }
    for (const entry of next) {
      const el = root.querySelector(`[data-next-entry="${entry.spec}"]`) as HTMLElement;
      const item = el.closest('li') as HTMLElement;
      // Spec 068 (T10, ISC-545): the sentence is the row link's hidden description, the ring stands in the mark cell.
      const guide = item.querySelector('[data-next-guide]') as HTMLElement;
      expect(guide, entry.spec).not.toBeNull();
      expect(item.querySelector('ui-reason')).toBeNull();
      const text = guide.textContent;
      expect(text, entry.spec).toBe(sentence(entry));
      expect(text.startsWith('guidance.')).toBe(false);
      expect(item.querySelector('a[data-next-link]')?.getAttribute('aria-describedby')).toBe(guide.id);
      expect(el.querySelector('[data-cell="mark"] ui-glyph')?.getAttribute('data-shape')).toBe('ring');
      expect(el.querySelector('[data-cell="command"] ui-command-chip code')?.textContent).toBe(entry.command);
      expect(item.querySelectorAll('ui-command-chip').length).toBe(1);
      expect(el.querySelector('[data-waits-mark]')).toBeNull();
    }
  });

  // Spec 068 (T7, ISC-542): past the third, the entries of guidance.next stand in the same list, no fold.
  it('lists every entry of guidance.next, past the third too, in guidance order in the one list', async () => {
    const extra = GUIDED.specs.filter((r) => !GUIDED.guidance.next.some((e) => e.spec === r.id)).slice(0, 2);
    const template = GUIDED.guidance.next[0];
    const next = [...GUIDED.guidance.next, ...extra.map((r) => ({ ...template, spec: r.id, command: `/spec plan ${r.id}` }))];
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next } });
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual(next.map((e) => e.spec));
    expect(root.querySelector('[data-next-count]')?.textContent.trim()).toBe(String(next.length));
    expect(root.querySelector('[data-show-all]')).toBeNull();
  });

  it('says nothing is ready to build when guidance.next is empty, even though nextUp names specs', async () => {
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next: [] } });
    expect(GUIDED.nextUp.length).toBeGreaterThan(0);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')).not.toBeNull();
  });
});

// Spec 068 (T1, T2, T10; ISC-546, ISC-545): Next up renders the spec list's row component under its column headings,
// each entry an `app-spec-row` whose last cell, `command`, holds the copy chip.
describe('NextUpList rows of the spec list (spec 068, ISC-546)', () => {
  it('renders every entry as app-spec-row with the copy chip in its command cell, under the column headings', async () => {
    const root = await render(HARBOR);
    const ids = entries(root);
    expect(ids.length).toBeGreaterThan(0);
    expect(root.querySelector('app-spec-table-head [data-cell="command"]')).not.toBeNull();
    for (const id of ids) {
      const item = root.querySelector(`[data-next-entry="${id}"]`) as HTMLElement;
      const specRow = item.closest('app-spec-row') ?? item.querySelector('app-spec-row');
      expect(specRow, id).not.toBeNull();
      expect(specRow?.querySelector('[data-cell="command"] ui-command-chip code')?.textContent, id).toBe(row(id).nextCommand);
    }
    expect(root.querySelector('app-next-up-entry')).toBeNull();
  });
});

// Spec 068 (T7, ISC-542): without the fold Next up keeps its content: the ids, their order, the header's count, the
// empty state and the fog link, for 0, 1, 3 and 9 entries, with and without guidance.
describe('NextUpList keeps its content (spec 068, T7, ISC-542)', () => {
  const GUIDED = guided as unknown as DashboardModel & { guidance: Guidance };
  const template = GUIDED.guidance.next[0];

  async function renderWith(specs: readonly DashboardSpecRow[], nextUp: readonly string[], guidance?: Guidance): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(NextUpList);
    fixture.componentRef.setInput('specs', specs);
    fixture.componentRef.setInput('ids', nextUp);
    if (guidance) fixture.componentRef.setInput('guidance', guidance);
    fixture.componentRef.setInput('ws', 'harbor');
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  function expectContent(root: HTMLElement, ids: readonly string[]): void {
    expect(root.querySelector('[data-show-all]')).toBeNull();
    expect(root.querySelector('ui-disclosure')).toBeNull();
    const count = root.querySelector('[data-next-count]');
    if (ids.length === 0) {
      expect(root.querySelector('[data-next-primary]')).toBeNull();
      expect(count).toBeNull();
      expect(root.querySelector('[data-next-empty]')?.textContent).toContain('Nothing ready to build');
      return;
    }
    expect(root.querySelector('[data-next-empty]')).toBeNull();
    expect(root.querySelectorAll('[data-next-primary]').length).toBe(1);
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual([...ids]);
    expect(root.querySelectorAll('app-spec-row[data-next-row]').length).toBe(ids.length);
    expect(count?.textContent.trim()).toBe(String(ids.length));
  }

  for (const n of [0, 1, 3, 9]) {
    it(`without guidance, ${n} entries: nextUp in its order, then the further rows with a command in row order`, async () => {
      const withCommand = GUIDED.specs.filter((r) => r.nextCommand !== null).slice(0, n);
      expect(withCommand.length).toBe(n);
      const specs = [...GUIDED.specs.filter((r) => r.nextCommand === null), ...withCommand];
      const nextUp = withCommand.slice(0, 3).map((r) => r.id).reverse();
      const rest = withCommand.map((r) => r.id).filter((id) => !nextUp.includes(id));
      expectContent(await renderWith(specs, nextUp), [...nextUp, ...rest]);
    });

    it(`with guidance, ${n} entries: guidance.next in its order, nextUp ignored`, async () => {
      const next = [...GUIDED.specs].reverse().slice(0, n).map((r) => ({ ...template, spec: r.id, command: `/spec plan ${r.id}` }));
      expect(next.length).toBe(n);
      expectContent(await renderWith(GUIDED.specs, GUIDED.nextUp, { ...GUIDED.guidance, next }), next.map((e) => e.spec));
    });
  }

  it('links the fog-waiting specs when nothing is ready, with and without guidance, and drops the link once entries stand', async () => {
    const fogged = GUIDED.specs.slice(0, 2).map((r) => ({ ...r, fog: 1, nextCommand: null }));
    const specs = [...fogged, ...GUIDED.specs.slice(2).map((r) => ({ ...r, nextCommand: null }))];
    for (const guidance of [undefined, { ...GUIDED.guidance, next: [] }]) {
      const root = await renderWith(specs, [], guidance);
      expectContent(root, []);
      const link = root.querySelector('a[data-next-fog]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('/w/harbor/specs?phase=fog');
      expect(link.textContent.trim()).toBe('2 specs wait on fog');
    }
    const ready = [...fogged, { ...GUIDED.specs[2], nextCommand: '/spec plan 999' }];
    const root = await renderWith(ready, []);
    expectContent(root, [ready[2]?.id ?? '']);
    expect(root.querySelector('[data-next-fog]')).toBeNull();
  });
});

// Spec 068 (T8, ISC-543): Next up shows every entry directly; no "Show all n" fold, no entry behind a cap.
describe('NextUpList without a fold (spec 068, T8, ISC-543)', () => {
  const GUIDED = guided as unknown as DashboardModel & { guidance: Guidance };

  it('renders 9 entries as 9 visible rows, with no [data-show-all] and no ui-disclosure', async () => {
    const template = GUIDED.guidance.next[0];
    const next = GUIDED.specs.slice(0, 9).map((r) => ({ ...template, spec: r.id, command: `/spec plan ${r.id}` }));
    expect(next.length).toBe(9);
    const fixture = TestBed.createComponent(NextUpList);
    fixture.componentRef.setInput('specs', GUIDED.specs);
    fixture.componentRef.setInput('ids', GUIDED.nextUp);
    fixture.componentRef.setInput('guidance', { ...GUIDED.guidance, next });
    fixture.componentRef.setInput('ws', 'harbor');
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-show-all]')).toBeNull();
    expect(root.querySelector('ui-disclosure')).toBeNull();
    const rows = [...root.querySelectorAll<HTMLElement>('app-spec-row[data-next-row]')];
    expect(rows.length).toBe(9);
    for (const el of rows) {
      expect(el.closest('[hidden]'), el.getAttribute('data-next-entry') ?? '').toBeNull();
      expect(el.closest('details:not([open])')).toBeNull();
    }
    expect(root.querySelectorAll('[data-next-primary]').length).toBe(1);
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual(next.map((e) => e.spec));
  });
});
