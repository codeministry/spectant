import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import { describe, expect, it } from 'vitest';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import de from '../../../../i18n/de.json';
import { UiWaitsBlock } from './waits-block';

// T14 · ISC-238: the block "Waits on you" over core's own `guidance.waits` (harbor's golden, seven entries): the top
// entry highlighted with its chip, at most `limit` more as links with their reason, "+n more" with the right n, the
// empty sentence without a card, and the chips on every row only under `chips`.
const WAITS = (harbor as unknown as { guidance: { waits: GuidanceEntry[] } }).guidance.waits;

async function render(entries: readonly GuidanceEntry[], inputs: Record<string, unknown> = {}, lang: 'en' | 'de' = 'en') {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: lang },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
  });
  TestBed.inject(TranslocoService).setActiveLang(lang);
  const fixture = TestBed.createComponent(UiWaitsBlock);
  fixture.componentRef.setInput('entries', entries);
  fixture.componentRef.setInput('workspace', 'harbor');
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const chips = (el: Element): string[] => [...el.querySelectorAll('ui-command-chip')].map((c) => text(c.querySelector('code') ?? c));

describe('ui-waits-block (T14, ISC-238)', () => {
  it('reads harbor golden: seven waiting entries, the top one a review', () => {
    expect(WAITS).toHaveLength(7);
    expect(WAITS[0]?.command).toBe('/spec review 006');
  });

  it('highlights the top entry: ID link, title, priority, sentence, chip and "waiting n d"', async () => {
    const host = await render(WAITS, { moreLink: '/w/harbor' });
    const top = host.querySelector('ui-card[data-top]');
    expect(top).not.toBeNull();
    expect(top?.hasAttribute('data-side')).toBe(true);
    const top0 = WAITS[0];
    expect(top?.querySelector('a.id')?.getAttribute('href')).toBe('/w/harbor/s/006');
    expect(text(top?.querySelector('.title'))).toBe(top0.title);
    expect(top?.querySelector('ui-priority')).not.toBeNull();
    const sentence = text(top?.querySelector('[data-reason]'));
    expect(sentence).not.toBe(top0.reason.phrase);
    expect(sentence.length).toBeGreaterThan(0);
    expect(chips(top as Element)).toHaveLength(1);
    expect(text(top?.querySelector('ui-command-chip'))).toContain('/spec review 006');
    expect(top?.querySelector('ui-relative-time time')?.getAttribute('datetime')).toBe(new Date(top0.since as string).toISOString());
    expect(text(top?.querySelector('ui-relative-time'))).toMatch(/^waiting \d+ (s|min|h|d)$/);
    expect(text(host.querySelector('ui-chip[variant="count"]'))).toBe('7');
    expect(host.querySelector('ui-icon[name="user-round"]')).not.toBeNull();
    expect(host.querySelector('ui-icon[name="hourglass"]')).toBeNull();
  });

  it('lists at most `limit` more as spec links with their reason and no chip, then "+n more" with the right n', async () => {
    const host = await render(WAITS, { moreLink: '/w/harbor' });
    const rows = [...host.querySelectorAll('[data-row]')];
    expect(rows).toHaveLength(4);
    rows.forEach((row, i) => {
      const entry = WAITS[i + 1];
      expect(row.querySelector('a.row')?.getAttribute('href')).toBe(`/w/harbor/s/${entry.spec}`);
      expect(text(row.querySelector('[data-reason]')).length).toBeGreaterThan(0);
      expect(row.querySelector('ui-command-chip')).toBeNull();
    });
    const more = host.querySelector('a[data-more]');
    expect(text(more)).toBe('+2 more');
    expect(more?.getAttribute('href')).toBe('/w/harbor#waiting');
  });

  it('a smaller limit lists fewer rows and counts the rest; null lists all and shows no "+n more"', async () => {
    const two = await render(WAITS, { limit: 2, moreLink: '/w/harbor' });
    expect(two.querySelectorAll('[data-row]')).toHaveLength(2);
    expect(text(two.querySelector('a[data-more]'))).toBe('+4 more');
    TestBed.resetTestingModule();
    const all = await render(WAITS, { limit: null, moreLink: '/w/harbor' });
    expect(all.querySelectorAll('[data-row]')).toHaveLength(6);
    expect(all.querySelector('a[data-more]')).toBeNull();
  });

  it('five or fewer entries show no "+n more"; one entry is the top card alone', async () => {
    const five = await render(WAITS.slice(0, 5), { moreLink: '/w/harbor' });
    expect(five.querySelectorAll('[data-row]')).toHaveLength(4);
    expect(five.querySelector('a[data-more]')).toBeNull();
    TestBed.resetTestingModule();
    const one = await render(WAITS.slice(0, 1), { moreLink: '/w/harbor' });
    expect(one.querySelector('ui-card[data-top]')).not.toBeNull();
    expect(one.querySelectorAll('[data-row]')).toHaveLength(0);
    expect(one.querySelector('ol')).toBeNull();
  });

  it('chips on: every row carries its own copy chip', async () => {
    const host = await render(WAITS, { limit: null, chips: true });
    const rows = [...host.querySelectorAll('[data-row]')];
    expect(rows).toHaveLength(6);
    rows.forEach((row, i) => expect(text(row.querySelector('ui-command-chip'))).toContain((WAITS[i + 1]).command as string));
  });

  it('a non-spec entry shows its ref beside the spec ID', async () => {
    const host = await render(WAITS, { limit: null });
    const claim = [...host.querySelectorAll('[data-row]')].find((row) => text(row).includes('ISC-77'));
    expect(claim).toBeDefined();
  });

  it('nothing waiting: one sentence, no card and no list', async () => {
    const host = await render([]);
    expect(host.querySelector('ui-card')).toBeNull();
    expect(host.querySelector('ol')).toBeNull();
    expect(text(host.querySelector('[data-empty]'))).toBe(en.guidance.waits.empty);
    expect(text(host.querySelector('ui-chip[variant="count"]'))).toBe('0');
  });

  it('German: the label, the empty sentence and "+n weitere" from the de catalogue', async () => {
    const host = await render(WAITS, { moreLink: '/w/harbor' }, 'de');
    expect(text(host.querySelector('h3'))).toBe(de.guidance.waits.label);
    expect(text(host.querySelector('a[data-more]'))).toBe('+2 weitere');
    TestBed.resetTestingModule();
    const empty = await render([], {}, 'de');
    expect(text(empty.querySelector('[data-empty]'))).toBe(de.guidance.waits.empty);
  });
});

// Spec 058 (T14, ISC-392): the heading level is an input. The spec page keeps the default level 3; the dashboard, where
// the block is a sibling of Next up and Warnings under the page's h1, passes 2.
describe('ui-waits-block heading level (spec 058, T14)', () => {
  it('heads the block with an h3 by default, the section named by it', async () => {
    const host = await render(WAITS);
    const heading = host.querySelector('ui-section-header h3');
    expect(heading).not.toBeNull();
    expect(host.querySelector('ui-section-header h2')).toBeNull();
    expect(heading?.id).toBe('waits-heading');
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe('waits-heading');
  });

  it('heads the block with an h2 when the caller passes level 2, entries and empty alike', async () => {
    const host = await render(WAITS, { level: 2 });
    expect(host.querySelector('ui-section-header h2')?.id).toBe('waits-heading');
    expect(host.querySelector('ui-section-header h3')).toBeNull();
    TestBed.resetTestingModule();
    const empty = await render([], { level: 2 });
    expect(empty.querySelector('ui-section-header h2')).not.toBeNull();
    expect(empty.querySelector('ui-section-header h3')).toBeNull();
  });
});

// Spec 058 (T40, T46, ISC-401, ISC-399): `form` `card-rows` sets every entry as a row in one card like Next up's card
// form, three standing and the rest behind "Show all n" at the card's bottom (the dashboard); the default `stack` keeps
// the highlighted card (the start and the spec page).
describe('ui-waits-block form (spec 058, T40, T46)', () => {
  const rowsOf = (el: Element | null | undefined): Element[] => [...(el?.querySelectorAll(':scope > ol.entries > li') ?? [])];

  it('card-rows: one unpadded card of rows, the first three standing with ID link, reason and copy chip', async () => {
    const host = await render(WAITS, { form: 'card-rows', chips: true });
    const cards = host.querySelectorAll('ui-card');
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.hasAttribute('data-waits-card')).toBe(true);
    expect(card.hasAttribute('data-top')).toBe(false);
    const standing = rowsOf(card);
    expect(standing).toHaveLength(3);
    // The first entry stays [data-top] (e2e suites read it); the others are [data-row].
    expect(standing.map((li) => li.hasAttribute('data-top'))).toEqual([true, false, false]);
    expect(standing.map((li) => li.hasAttribute('data-row'))).toEqual([false, true, true]);
    const top = standing[0];
    expect(top.querySelector('a.row')?.getAttribute('href')).toBe('/w/harbor/s/006');
    expect(text(top.querySelector('.id'))).toBe('006');
    expect(text(top.querySelector('[data-reason]')).length).toBeGreaterThan(0);
    expect(chips(top)).toEqual(['/spec review 006']);
    expect(host.querySelector('ui-card .title, ui-priority, ui-relative-time, [data-more]')).toBeNull();
  });

  it('card-rows: the rest fold behind "Show all 7" at the bottom of the card, every row with reason and chip', async () => {
    const host = await render(WAITS, { form: 'card-rows' });
    const card = host.querySelector('ui-card[data-waits-card]');
    const fold = card?.querySelector(':scope > ui-disclosure[data-show-all]');
    expect(fold).not.toBeNull();
    expect(card?.lastElementChild).toBe(fold);
    const button = fold?.querySelector('button');
    expect(text(button?.querySelector('[data-visible]'))).toBe('Show all 7');
    expect(button?.querySelector('[data-visible]')?.getAttribute('aria-hidden')).toBe('true');
    expect(text(button?.querySelector('[data-name]'))).toBe('Show all 7 · Waits on you');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const folded = rowsOf(fold?.querySelector('.content'));
    expect(folded).toHaveLength(4);
    expect(folded.every((li) => li.hasAttribute('data-row') && text(li.querySelector('[data-reason]')) !== '')).toBe(true);
    // Every entry once, in core's order, each with its chip.
    expect([...host.querySelectorAll('[data-top], [data-row]')].map((li) => text(li.querySelector('.id')))).toEqual(WAITS.map((e) => e.spec));
    expect(chips(host)).toEqual(WAITS.flatMap((e) => (e.command ? [e.command] : [])));
  });

  it('card-rows: three entries or fewer stand without a fold; German names the fold', async () => {
    const short = await render(WAITS.slice(0, 3), { form: 'card-rows' });
    expect(rowsOf(short.querySelector('ui-card'))).toHaveLength(3);
    expect(short.querySelector('ui-disclosure')).toBeNull();
    TestBed.resetTestingModule();
    const de = await render(WAITS, { form: 'card-rows' }, 'de');
    expect(text(de.querySelector('[data-show-all] [data-visible]'))).toBe('Alle 7 anzeigen');
    expect(text(de.querySelector('[data-show-all] [data-name]'))).toBe('Alle 7 anzeigen · Liegt bei Ihnen');
  });

  it('card-rows: the top chip keeps the stack form\'s accessible names', async () => {
    const row = await render(WAITS, { form: 'card-rows' });
    const rowChip = row.querySelector('[data-top] ui-command-chip')?.innerHTML;
    TestBed.resetTestingModule();
    const card = await render(WAITS);
    expect(rowChip).toBe(card.querySelector('[data-top] ui-command-chip')?.innerHTML);
  });

  it('stack is the default: the top entry stays the highlighted card', async () => {
    const host = await render(WAITS);
    expect(host.querySelector('ui-card[data-top]')).not.toBeNull();
    expect(host.querySelector('[data-waits-card], ui-disclosure')).toBeNull();
  });
});
