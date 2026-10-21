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

// Spec 064 (T13, ISC-478): `form` `tiles` sets every entry as the same flat tile (`ui-flat-tile`) on `/` and `/w/<ws>`:
// mark, ID, kind or ref chip, the spec's title as the main text (one line, cut with an ellipsis, the full title in the
// link's `title`), the copy chip where the entry has a command, "waiting n d"; the reason sentence only as the tile's
// accessible description, never visible; no highlighted top card. `TILE_LIMIT` tiles stand, the rest fold (`more`
// `fold`, the dashboard) or a link leads on (`more` `link`, the start).
describe('ui-waits-block form tiles (spec 064, T13, ISC-478)', () => {
  const LONG = 'Keep every spec tile on the workspace dashboard to one calm line, however long the title of its spec may run in the files';
  /** The spec titles the caller passes; the claim entry of 002 shows 002's title, not the claim's text. */
  const TITLES = { '006': LONG, '002': 'Sync history that explains itself' };
  /** Four entries: one with a 120+ character spec title, one without a command, two with a ref. */
  const FOUR: GuidanceEntry[] = [{ ...WAITS[0], title: LONG }, { ...WAITS[1], command: null }, WAITS[2], WAITS[4]];
  const tilesOf = (el: Element): Element[] => [...el.querySelectorAll('ol.tiles > li > ui-flat-tile')];
  /** A tile's visible text: everything but its visually hidden description and the chip's hidden names. */
  const visible = (tile: Element): string => {
    const copy = tile.cloneNode(true) as Element;
    copy.querySelectorAll('.vh, .visually-hidden').forEach((n) => n.remove());
    return text(copy);
  };

  it('four equal tiles: three standing, the fourth behind the fold, no top card', async () => {
    expect(LONG.length).toBeGreaterThan(120);
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    const standing = [...host.querySelectorAll('section > ol.tiles > li > ui-flat-tile')];
    expect(standing).toHaveLength(3);
    const fold = host.querySelector('ui-disclosure[data-show-all]');
    expect(fold).not.toBeNull();
    expect(tilesOf(fold as Element)).toHaveLength(1);
    expect(tilesOf(host)).toHaveLength(4);
    expect(host.querySelector('.top, [data-top], [data-waits-card], ui-card[data-side], ui-priority, [data-reason], ol.rest, ol.entries')).toBeNull();
    // Every tile is built the same: mark (the waiting glyph), ID, main text, meta.
    for (const tile of tilesOf(host)) {
      expect(tile.querySelector('.mark ui-glyph[state="waiting"]')).not.toBeNull();
      expect(tile.querySelector('.id [data-tile-id]')).not.toBeNull();
      expect(tile.querySelector('.main .title')).not.toBeNull();
      expect(text(tile.querySelector('.meta ui-relative-time'))).toMatch(/^waiting \d+ (s|min|h|d)$/);
    }
  });

  it('the main text is the spec title, one line in the ellipsis slot, the full title in the link\'s title', async () => {
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    const tiles = tilesOf(host);
    const titles = tiles.map((tile) => text(tile.querySelector('.main .title')));
    expect(titles).toEqual([LONG, TITLES['002'], TITLES['002'], WAITS[4].title]);
    expect(tiles.map((tile) => tile.querySelector('a.cover')?.getAttribute('title'))).toEqual(titles);
    // The claim's and the task's own text never stand in the tile.
    expect(text(host)).not.toContain(WAITS[1].title);
    expect(text(host)).not.toContain(WAITS[2].title);
    expect(tiles[0].querySelector('a.cover')?.getAttribute('href')).toBe('/w/harbor/s/006');
  });

  it('the reason sentence is no visible text, only the tile\'s accessible description', async () => {
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    for (const tile of tilesOf(host)) {
      const id = tile.querySelector('a.cover')?.getAttribute('aria-describedby') ?? '';
      expect(id).not.toBe('');
      const description = text(tile.querySelector(`[id="${id}"]`));
      expect(description.length).toBeGreaterThan(0);
      expect(visible(tile)).not.toContain(description);
    }
  });

  it('a copy chip only where the entry has a command; a ref chip beside the ID where the entry has a ref', async () => {
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    const tiles = tilesOf(host);
    expect(tiles.map((tile) => tile.querySelector('.aside ui-command-chip') !== null)).toEqual([true, false, true, true]);
    expect(chips(host)).toEqual(['/spec review 006', '/spec implement 002', '/spec review 005']);
    expect(tiles.map((tile) => text(tile.querySelector('.id ui-chip')))).toEqual(['', 'ISC-77', 'T31', '']);
  });

  it('names each tile "<id> <title> · <ref> · waiting <time>", the parts it lacks dropped', async () => {
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    const names = tilesOf(host).map((tile) => tile.querySelector('a.cover')?.getAttribute('aria-label') ?? '');
    expect(names[0]).toMatch(new RegExp(`^006 ${LONG} · waiting \\d+ (s|min|h|d)$`));
    expect(names[1]).toMatch(/^002 Sync history that explains itself · ISC-77 · waiting \d+ (s|min|h|d)$/);
    TestBed.resetTestingModule();
    const undated = await render([{ ...WAITS[4], since: null }], { form: 'tiles' });
    expect(tilesOf(undated)[0].querySelector('a.cover')?.getAttribute('aria-label')).toBe(`005 ${WAITS[4].title}`);
    expect(tilesOf(undated)[0].querySelector('ui-relative-time')).toBeNull();
  });

  it('the fold: "Show all 4" with a chevron, closed, its name naming the list; `open` opens it', async () => {
    const host = await render(FOUR, { form: 'tiles', titles: TITLES });
    const button = host.querySelector('ui-disclosure[data-show-all] button');
    expect(text(button?.querySelector('[data-visible]'))).toBe('Show all 4');
    expect(text(button?.querySelector('[data-name]'))).toBe('Show all 4 · Waits on you');
    expect(button?.querySelector('ui-icon[name="chevron-down"]')).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    TestBed.resetTestingModule();
    const open = await render(FOUR, { form: 'tiles', open: true });
    expect(open.querySelector('ui-disclosure button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('more="link": three tiles, then a link with an arrow to moreLink#moreFragment; three or fewer, neither', async () => {
    const host = await render(FOUR, { form: 'tiles', more: 'link', moreLink: '/w/harbor' }, 'de');
    expect(tilesOf(host)).toHaveLength(3);
    expect(host.querySelector('ui-disclosure')).toBeNull();
    const more = host.querySelector('a[data-more]');
    expect(more?.getAttribute('href')).toBe('/w/harbor#waiting');
    expect(text(more?.querySelector('[data-visible]'))).toBe('Alle 4 anzeigen');
    expect(text(more?.querySelector('[data-name]'))).toBe('Alle 4 anzeigen · Liegt bei Ihnen');
    expect(more?.querySelector('ui-icon[name="arrow-right"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const three = await render(FOUR.slice(0, 3), { form: 'tiles', more: 'link', moreLink: '/w/harbor' });
    expect(tilesOf(three)).toHaveLength(3);
    expect(three.querySelector('a[data-more], ui-disclosure')).toBeNull();
  });

  it('nothing waiting: the sentence with the done glyph, no list', async () => {
    const host = await render([], { form: 'tiles' });
    expect(host.querySelector('ol, ui-flat-tile')).toBeNull();
    expect(text(host.querySelector('[data-empty]'))).toBe(en.guidance.waits.empty);
    expect(host.querySelector('[data-empty] ui-glyph[state="done"]')).not.toBeNull();
  });
});

