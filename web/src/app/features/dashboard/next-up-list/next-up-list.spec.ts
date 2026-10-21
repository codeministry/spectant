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
import { NEXT_UP_SHOWN, NextUpList } from './next-up-list';

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
    expect(entries(primary)).toEqual([...HARBOR.nextUp]);
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

  it('folds every further row with a next command behind "Show all n", in model row order', async () => {
    const root = await render(HARBOR);
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).map((r) => r.id);
    const fold = root.querySelector('[data-show-all]') as HTMLElement;
    expect(fold.textContent).toContain(`Show all ${withCommand.length}`);
    expect(entries(fold)).toEqual(withCommand.filter((id) => !HARBOR.nextUp.includes(id)));
  });

  it('shows no fold when nextUp already holds every row with a next command', async () => {
    const root = await render(LANTERN);
    expect(entries(root)).toEqual([...LANTERN.nextUp]);
    expect(root.querySelector('[data-show-all]')).toBeNull();
  });

  it('ports Next up to next-rows under the section header: id and title, the command below', async () => {
    const root = await render(HARBOR);
    expect(root.querySelector('ui-section-header #next-up')).not.toBeNull();
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).length;
    expect(root.querySelector('ui-section-header [data-next-count]')?.textContent.trim()).toBe(String(withCommand));
    expect(root.querySelector('ui-stage-track')).toBeNull();
    const rows = [...root.querySelectorAll('[data-next-primary] [data-next-row]')];
    expect(rows.length).toBe(HARBOR.nextUp.length);
    for (const [i, id] of HARBOR.nextUp.entries()) {
      const item = rows[i] as HTMLElement;
      expect(item.querySelector('ui-id-chip')?.textContent.trim(), id).toBe(id);
      expect(item.querySelector('a[data-next-link] .title')?.textContent.trim()).toBe(row(id).title);
      expect(item.querySelector('.cmd ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
    }
  });

  it('builds one card of rows: one list, hairline-separated items, no card per entry', async () => {
    const root = await render(HARBOR);
    const cards = root.querySelectorAll('ui-card');
    expect(cards.length).toBe(1);
    const card = cards[0] as HTMLElement;
    expect(card.hasAttribute('data-next-card')).toBe(true);
    expect(card.hasAttribute('data-edge')).toBe(false);
    const items = [...card.querySelectorAll(':scope [data-next-primary] > li')];
    expect(items.map((li) => li.querySelector('[data-next-entry]')?.getAttribute('data-next-entry'))).toEqual([...HARBOR.nextUp]);
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

// T137 · ISC-122.3: every Next up entry, behind "Show all" too, shows the dashboard row's phrase through a compact
// `ui-reason`, with the next command as its chip.
describe('NextUpList reason line (T137, ISC-122.3)', () => {
  it("shows each harbor entry's nextReason verbatim with its command chip", async () => {
    const root = await render(HARBOR);
    const shown = [...root.querySelectorAll<HTMLElement>('[data-next-entry]')];
    expect(shown.length).toBeGreaterThan(0);
    for (const entry of shown) {
      const id = entry.getAttribute('data-next-entry') ?? '';
      const reason = entry.querySelector('ui-reason[data-next-reason]');
      expect(reason?.querySelector('.visually-hidden')?.textContent, id).toBe(row(id).nextReason);
      expect(reason?.hasAttribute('data-compact')).toBe(true);
      expect(reason?.querySelector('ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
      expect(entry.querySelectorAll('ui-command-chip').length).toBe(1);
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
      const guide = el.querySelector('[data-next-guide]') as HTMLElement;
      expect(guide, entry.spec).not.toBeNull();
      expect(el.querySelector('ui-reason')).toBeNull();
      const text = guide.querySelector('[data-next-sentence]')?.textContent ?? '';
      expect(text, entry.spec).toBe(sentence(entry));
      expect(text.startsWith('guidance.')).toBe(false);
      expect(guide.querySelector('.visually-hidden')).toBeNull();
      expect(guide.querySelector('ui-glyph')?.getAttribute('data-shape')).toBe('ring');
      expect(guide.querySelector('.sentence ui-icon')).toBeNull();
      expect(guide.querySelector('ui-command-chip code')?.textContent).toBe(entry.command);
      expect(el.querySelectorAll('ui-command-chip').length).toBe(1);
      expect(el.querySelector('[data-waits-mark]')).toBeNull();
    }
  });

  it('folds the entries of guidance.next past the third behind "Show all n", in guidance order', async () => {
    const extra = GUIDED.specs.filter((r) => !GUIDED.guidance.next.some((e) => e.spec === r.id)).slice(0, 2);
    const template = GUIDED.guidance.next[0];
    const next = [...GUIDED.guidance.next, ...extra.map((r) => ({ ...template, spec: r.id, command: `/spec plan ${r.id}` }))];
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next } });
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual(next.slice(0, NEXT_UP_SHOWN).map((e) => e.spec));
    expect(root.querySelector('[data-next-count]')?.textContent.trim()).toBe(String(next.length));
    expect(entries(root.querySelector('[data-show-all]') as HTMLElement)).toEqual(next.slice(NEXT_UP_SHOWN).map((e) => e.spec));
  });

  it('says nothing is ready to build when guidance.next is empty, even though nextUp names specs', async () => {
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next: [] } });
    expect(GUIDED.nextUp.length).toBeGreaterThan(0);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')).not.toBeNull();
  });
});
