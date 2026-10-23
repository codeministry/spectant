import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import beacon from '../../../../../../core/fixtures/beacon.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { TILE_LIMIT } from '../../../shared/ui/guidance/tiles';
import { WAITING_FRAGMENT, WaitingSection } from './waiting-section';

let entries: readonly GuidanceEntry[] = [];
let titles: Readonly<Record<string, string>> = {};

/** The dashboard route as the page sits on it: the section with the entries of the test. */
@Component({
  selector: 'app-test-host',
  imports: [WaitingSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-waiting-section [entries]="entries" [titles]="titles" workspace="harbor" />`,
})
class TestHost {
  protected readonly entries = entries;
  protected readonly titles = titles;
}

beforeEach(() => {
  titles = {};
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([{ path: 'w/:ws', component: TestHost }])],
  });
});

async function render(list: readonly GuidanceEntry[], url = '/w/harbor'): Promise<HTMLElement> {
  entries = list;
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness);
  return harness.routeNativeElement as HTMLElement;
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 3; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The fold toggle's accessible name: its visually hidden name (the visible text is `aria-hidden`). */
const nameOf = (button: Element | null | undefined): string => text(button?.querySelector('[data-name]'));
const visibleOf = (button: Element | null | undefined): string => text(button?.querySelector('[data-visible]'));
/** The tile's ID: the spec number inside its link. */
const idOf = (tile: Element): string => text(tile.querySelector('[data-tile-id]'));
const HARBOR = harbor.guidance.waits as unknown as readonly GuidanceEntry[];
const BEACON = beacon.guidance.waits as unknown as readonly GuidanceEntry[];

describe('WaitingSection (spec 020 T17, ISC-238; spec 064 T14, ISC-478 flat tiles)', () => {
  /** The tiles standing in the block's list, outside the fold. */
  const standing = (section: Element | null | undefined): Element[] => [...(section?.querySelectorAll('section > ol.tiles > li > ui-flat-tile') ?? [])];

  it('is the #waiting target and shows a single entry as one flat tile with its chip, no fold', async () => {
    const root = await render(BEACON.slice(0, 1));
    const section = root.querySelector('app-waiting-section');
    expect(section?.id).toBe(WAITING_FRAGMENT);
    expect(section?.getAttribute('tabindex')).toBe('-1');
    expect(standing(section)).toHaveLength(1);
    expect(standing(section)[0]?.querySelector('ui-command-chip')).not.toBeNull();
    expect(section?.querySelector('[data-top], [data-row], [data-more], ui-disclosure')).toBeNull();
  });

  it('shows up to TILE_LIMIT entries as tiles without a fold', async () => {
    expect(BEACON.length).toBe(2);
    const root = await render(BEACON);
    const section = root.querySelector('app-waiting-section');
    expect(standing(section).map(idOf)).toEqual(BEACON.map((e) => e.spec));
    expect(section?.querySelector('ui-disclosure')).toBeNull();
  });

  it('shows the header with the count, three equal tiles, then "Show all 4", closed, the rest folded as the same tiles', async () => {
    // Spec 070 (ISC-568): harbor's seven waiting items are four entries, one per spec, the later items folded under it.
    expect(HARBOR.map((e) => e.spec)).toEqual(['006', '002', '005', '004']);
    expect(HARBOR.reduce((n, e) => n + 1 + (e.folded?.length ?? 0), 0)).toBe(7);
    titles = { '002': 'Sync history that explains itself' };
    const root = await render(HARBOR);
    const section = root.querySelector('app-waiting-section');
    expect(section?.getAttribute('data-count')).toBe('4');
    const block = section?.querySelector('ui-waits-block');
    expect(text(block?.querySelector('ui-section-header ui-chip'))).toBe('4');
    expect(block?.querySelector('ui-card[data-top], [data-top], [data-waits-card], [data-reason], [data-more]')).toBeNull();
    const rows = standing(section);
    expect(rows).toHaveLength(TILE_LIMIT);
    expect(rows.map(idOf)).toEqual(HARBOR.slice(0, 3).map((e) => e.spec));
    expect(rows[0]?.querySelector('a.cover')?.getAttribute('href')).toBe(`/w/harbor/s/${HARBOR[0]?.spec ?? ''}`);
    // The spec's title is the main text, from the caller's titles where the entry is a claim or task.
    expect(rows.map((tile) => text(tile.querySelector('.main')))).toEqual([HARBOR[0]?.title, titles['002'], HARBOR[2]?.title]);
    const fold = section?.querySelector('ui-disclosure[data-show-all]');
    const button = fold?.querySelector('button');
    expect(visibleOf(button)).toBe('Show all 4');
    expect(button?.querySelector('[data-visible]')?.getAttribute('aria-hidden')).toBe('true');
    expect(nameOf(button)).toBe('Show all 4 · Waits on you');
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const folded = [...(fold?.querySelectorAll('ol.tiles > li > ui-flat-tile') ?? [])];
    expect(folded.map(idOf)).toEqual(HARBOR.slice(3).map((e) => e.spec));
    // Every harbor entry has a command: four tiles, four copy chips, each tile its own, each command once.
    const commands = [...(section?.querySelectorAll('ui-flat-tile ui-command-chip') ?? [])].map((chip) => text(chip.querySelector('code') ?? chip));
    expect(commands).toHaveLength(4);
    expect(new Set(commands).size).toBe(4);
    expect(document.activeElement).not.toBe(section);
  });

  it('opens the fold on a click, its name unchanged', async () => {
    entries = HARBOR;
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor');
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('app-waiting-section ui-disclosure button')?.click();
    await settle(harness);
    const button = root.querySelector('app-waiting-section ui-disclosure button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(nameOf(button)).toBe('Show all 4 · Waits on you');
  });

  it('reads the German names: "Alle 4 anzeigen · Liegt bei Ihnen"', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await render(HARBOR);
    const button = root.querySelector('app-waiting-section ui-disclosure button');
    expect(visibleOf(button)).toBe('Alle 4 anzeigen');
    expect(nameOf(button)).toBe('Alle 4 anzeigen · Liegt bei Ihnen');
  });

  it('opens the fold and focuses the section when the page is reached over #waiting', async () => {
    const root = await render(HARBOR, '/w/harbor#waiting');
    const section = root.querySelector('app-waiting-section');
    const button = section?.querySelector('ui-disclosure button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(section);
  });

  it('holds the empty sentence when nothing waits', async () => {
    const root = await render([]);
    const section = root.querySelector('app-waiting-section');
    expect(text(section?.querySelector('[data-empty]'))).toBe('Nothing is waiting on you.');
    expect(section?.querySelector('ui-disclosure, ui-card, ui-flat-tile')).toBeNull();
  });
});
