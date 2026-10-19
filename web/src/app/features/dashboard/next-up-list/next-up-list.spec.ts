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

async function render(model: Pick<DashboardModel, 'specs' | 'nextUp'>, form?: 'card' | 'rail'): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(NextUpList);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('ids', model.nextUp);
  if (form) fixture.componentRef.setInput('form', form);
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

  // Spec 021 (T79, P3 heights): the rail drops the labelled stage track; the stage moves into the title link's
  // accessible name, after the visible title (label in name), and the takeable chip stays.
  it('names each rail entry with its stage instead of a labelled stage track, and keeps the takeable chip', async () => {
    let chips = 0;
    let rail: HTMLElement | null = null;
    for (const model of [HARBOR, LANTERN]) {
      rail = await render(model, 'rail');
      expect(rail.querySelector('ui-stage-track')).toBeNull();
      for (const id of model.nextUp) {
        const entry = rail.querySelector(`[data-next-primary] [data-next-entry="${id}"]`) as HTMLElement;
        const spec = model.specs.find((r) => r.id === id) as DashboardSpecRow;
        const link = entry.querySelector('a[data-next-link]') as HTMLElement;
        const name = link.textContent.replace(/\s+/g, ' ').trim();
        expect(name, id).toMatch(new RegExp(`^${spec.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, Stage \\d of 5: \\S`));
        expect(link.querySelector('.title')?.textContent.trim()).toBe(spec.title);
        expect(link.querySelector('[data-next-stage]')?.classList).toContain('visually-hidden');
        const takeable = entry.querySelector('[data-next-takeable]');
        const first = spec.takeable[0];
        if (first) {
          chips += 1;
          expect(takeable?.textContent.trim()).toBe(`takeable ${first}`);
          expect(takeable?.parentElement?.hasAttribute('data-next-foot')).toBe(true);
        } else expect(takeable).toBeNull();
      }
    }
    expect(chips).toBeGreaterThan(0);
    expect(rail?.getAttribute('data-form')).toBe('rail');

    const card = await render(HARBOR, 'card');
    expect(card.querySelector('[data-next-primary] ui-stage-track')).toBeNull();
    expect(card.querySelector('[data-next-stage]')).toBeNull();
    expect(card.getAttribute('data-form')).toBe('card');
  });

  it('builds the rail as one card of rows under the eyebrow: one list, hairline-separated items, no card per entry', async () => {
    const root = await render(HARBOR, 'rail');
    const eyebrow = root.querySelector('[data-next-eyebrow]') as HTMLElement;
    expect(eyebrow.querySelector('#next-up')?.classList).toContain('type-eyebrow');
    const withCommand = HARBOR.specs.filter((r) => r.nextCommand !== null).length;
    expect(eyebrow.querySelector('[data-next-count]')?.textContent.trim()).toBe(String(withCommand));
    expect(root.querySelector('ui-section-header')).toBeNull();
    const cards = root.querySelectorAll('ui-card');
    expect(cards.length).toBe(1);
    const card = cards[0] as HTMLElement;
    expect(card.hasAttribute('data-next-card')).toBe(true);
    expect(card.hasAttribute('data-edge')).toBe(false);
    const items = [...card.querySelectorAll(':scope [data-next-primary] > li')];
    expect(items.map((li) => li.querySelector('[data-next-entry]')?.getAttribute('data-next-entry'))).toEqual([...HARBOR.nextUp]);
    for (const id of HARBOR.nextUp) {
      const item = card.querySelector(`[data-next-entry="${id}"] [data-next-row]`) as HTMLElement;
      expect(item, id).not.toBeNull();
      const title = item.querySelector('h3') as HTMLElement;
      expect(title.querySelector('ui-id-chip')?.textContent.trim()).toBe(id);
      expect(title.querySelector('a[data-next-link] .title')?.textContent.trim()).toBe(row(id).title);
      expect(item.querySelector('[data-next-foot] ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
    }
    // The hairline between rows is the list's own rule, the same in both forms (the card has no padding of its own).
    const sheets = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    const hairline = sheets.split('}').find((rule) => rule.includes('+ li') && rule.includes('border-block-start: 1px solid var(--line)'));
    expect(hairline?.trim()).toMatch(/^\.entries\S*\s*>\s*li\S*\s*\+\s*li\S*\s*\{/);
  });

  it('ports the card form to next-rows under the section header: id and title, the command below', async () => {
    const root = await render(HARBOR, 'card');
    expect(root.querySelector('ui-section-header #next-up')).not.toBeNull();
    const rows = [...root.querySelectorAll('[data-next-primary] [data-next-row]')];
    expect(rows.length).toBe(HARBOR.nextUp.length);
    expect(rows[0]?.querySelector('ui-id-chip')?.textContent.trim()).toBe(HARBOR.nextUp[0]);
  });

  it('says nothing is ready to build when nextUp is empty, without a fog link when no spec waits on fog', async () => {
    const root = await render(EMPTY);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')?.textContent).toContain('Nothing ready to build');
    expect(root.querySelector('[data-next-fog]')).toBeNull();
  });

  it('links the specs that wait on fog to the fog filter when nothing is ready', async () => {
    const waiting = HARBOR.specs.filter((r) => r.fog > 0).map((r) => ({ ...r, nextCommand: null }));
    expect(waiting.length).toBeGreaterThan(0);
    const root = await render({ specs: waiting, nextUp: [] });
    const link = root.querySelector('a[data-next-fog]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/?phase=fog');
    expect(link.textContent.trim()).toBe(waiting.length === 1 ? '1 spec waits on fog' : `${waiting.length} specs wait on fog`);
  });
});

// T137 · ISC-122.3: every Next up entry, in both forms and behind "Show all", shows the dashboard row's phrase
// through `ui-reason` (compact in the card form), with the next command as its chip.
describe('NextUpList reason line (T137, ISC-122.3)', () => {
  for (const form of ['card', 'rail'] as const) {
    it(`shows each harbor entry's nextReason verbatim with its command chip (${form})`, async () => {
      const root = await render(HARBOR, form);
      const shown = [...root.querySelectorAll<HTMLElement>('[data-next-entry]')];
      expect(shown.length).toBeGreaterThan(0);
      for (const entry of shown) {
        const id = entry.getAttribute('data-next-entry') ?? '';
        const reason = entry.querySelector('ui-reason[data-next-reason]');
        expect(reason?.querySelector('.visually-hidden')?.textContent, id).toBe(row(id).nextReason);
        expect(reason?.hasAttribute('data-compact')).toBe(form === 'card');
        expect(reason?.querySelector('ui-command-chip code')?.textContent).toBe(row(id).nextCommand);
        expect(entry.querySelectorAll('ui-command-chip').length).toBe(1);
      }
    });
  }
});

// Spec 020 · T25 · ISC-240: with guidance, Next up holds `guidance.next` only, in its order, each entry with its
// catalogue sentence in full (no clamp), the ring of "open" instead of the hourglass, the entry's command as its chip
// and no "Waits on you" mark; the specs that wait on you are not in it.
describe('NextUpList reads guidance.next (spec 020, T25, ISC-240)', () => {
  const GUIDED = guided as unknown as DashboardModel & { guidance: Guidance };

  async function renderGuided(model: DashboardModel & { guidance: Guidance }, form: 'card' | 'rail'): Promise<HTMLElement> {
    const fixture = TestBed.createComponent(NextUpList);
    fixture.componentRef.setInput('specs', model.specs);
    fixture.componentRef.setInput('ids', model.nextUp);
    fixture.componentRef.setInput('guidance', model.guidance);
    fixture.componentRef.setInput('form', form);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const sentence = (entry: GuidanceEntry): string =>
    entry.reason.key === 'phrase'
      ? entry.reason.phrase
      : TestBed.inject(TranslocoService).translate(`guidance.reason.${entry.reason.key}`, entry.reason.values);

  for (const form of ['card', 'rail'] as const) {
    it(`lists guidance.next in its order with the whole sentence, the ring and the entry's chip, no mark (${form})`, async () => {
      const root = await renderGuided(GUIDED, form);
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
  }

  it('folds the entries of guidance.next past the third behind "Show all n", in guidance order', async () => {
    const extra = GUIDED.specs.filter((r) => !GUIDED.guidance.next.some((e) => e.spec === r.id)).slice(0, 2);
    const template = GUIDED.guidance.next[0];
    const next = [...GUIDED.guidance.next, ...extra.map((r) => ({ ...template, spec: r.id, command: `/spec plan ${r.id}` }))];
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next } }, 'card');
    expect(entries(root.querySelector('[data-next-primary]') as HTMLElement)).toEqual(next.slice(0, NEXT_UP_SHOWN).map((e) => e.spec));
    expect(root.querySelector('[data-next-count]')?.textContent.trim()).toBe(String(next.length));
    expect(entries(root.querySelector('[data-show-all]') as HTMLElement)).toEqual(next.slice(NEXT_UP_SHOWN).map((e) => e.spec));
  });

  it('says nothing is ready to build when guidance.next is empty, even though nextUp names specs', async () => {
    const root = await renderGuided({ ...GUIDED, guidance: { ...GUIDED.guidance, next: [] } }, 'rail');
    expect(GUIDED.nextUp.length).toBeGreaterThan(0);
    expect(entries(root)).toEqual([]);
    expect(root.querySelector('[data-next-empty]')).not.toBeNull();
  });
});
