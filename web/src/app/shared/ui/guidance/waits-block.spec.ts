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
    expect(WAITS[0]?.command).toBe('/spec-review 006');
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
    expect(text(top?.querySelector('ui-command-chip'))).toContain('/spec-review 006');
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
