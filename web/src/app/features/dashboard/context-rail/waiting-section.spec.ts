import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import beacon from '../../../../../../core/fixtures/beacon.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import type { GuidanceEntry } from '../../../../../../core/src/files';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { WAITING_FRAGMENT, WaitingSection } from './waiting-section';

let entries: readonly GuidanceEntry[] = [];

/** The dashboard route as the page sits on it: the section with the entries of the test. */
@Component({
  selector: 'app-test-host',
  imports: [WaitingSection],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-waiting-section [entries]="entries" workspace="harbor" />`,
})
class TestHost {
  protected readonly entries = entries;
}

beforeEach(() => {
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
const HARBOR = harbor.guidance.waits as unknown as readonly GuidanceEntry[];
const BEACON = beacon.guidance.waits as unknown as readonly GuidanceEntry[];

describe('WaitingSection (spec 020 T17, ISC-238; spec 058 T46, ISC-399 card rows)', () => {
  /** The rows standing in the card, outside the fold. */
  const standing = (section: Element | null | undefined): Element[] => [...(section?.querySelectorAll('ui-card[data-waits-card] > ol.entries > li') ?? [])];

  it('is the #waiting target and shows a single entry as the one row of its card with its chip, no fold', async () => {
    const root = await render(BEACON.slice(0, 1));
    const section = root.querySelector('app-waiting-section');
    expect(section?.id).toBe(WAITING_FRAGMENT);
    expect(section?.getAttribute('tabindex')).toBe('-1');
    expect(standing(section)).toHaveLength(1);
    expect(section?.querySelector('ui-card [data-top] ui-command-chip')).not.toBeNull();
    expect(section?.querySelectorAll('[data-row]').length).toBe(0);
    expect(section?.querySelector('[data-more], ui-disclosure')).toBeNull();
  });

  it('shows up to three entries as rows without a fold', async () => {
    expect(BEACON.length).toBe(2);
    const root = await render(BEACON);
    const section = root.querySelector('app-waiting-section');
    expect(standing(section).map((li) => text(li.querySelector('.id')))).toEqual(BEACON.map((e) => e.spec));
    expect(section?.querySelector('ui-disclosure')).toBeNull();
  });

  it('shows the header with the count and one card: three rows, then "Show all 7" at its bottom, closed, the rest folded with reason and chip', async () => {
    expect(HARBOR.length).toBe(7);
    const root = await render(HARBOR);
    const section = root.querySelector('app-waiting-section');
    expect(section?.getAttribute('data-count')).toBe('7');
    const block = section?.querySelector('ui-waits-block');
    expect(text(block?.querySelector('ui-section-header ui-chip'))).toBe('7');
    const cards = block?.querySelectorAll('ui-card');
    expect(cards?.length).toBe(1);
    // Three rows stand, the first one [data-top]: spec link, the reason never shortened, the copy chip.
    const rows = standing(section);
    expect(rows.map((li) => text(li.querySelector('.id')))).toEqual(HARBOR.slice(0, 3).map((e) => e.spec));
    const top = rows[0];
    expect(top.hasAttribute('data-top')).toBe(true);
    expect(block?.querySelectorAll('[data-top]').length).toBe(1);
    expect(top.querySelector('a.row')?.getAttribute('href')).toBe(`/w/harbor/s/${HARBOR[0]?.spec ?? ''}`);
    for (const row of rows) {
      expect(text(row.querySelector('[data-reason]'))).not.toBe('');
      expect(row.querySelector('ui-command-chip')).not.toBeNull();
    }
    expect(block?.querySelector('[data-more]')).toBeNull();
    // The fold closes the card.
    const fold = section?.querySelector('ui-disclosure[data-show-all]');
    expect(cards?.[0]?.lastElementChild).toBe(fold);
    const button = fold?.querySelector('button');
    expect(visibleOf(button)).toBe('Show all 7');
    expect(button?.querySelector('[data-visible]')?.getAttribute('aria-hidden')).toBe('true');
    expect(nameOf(button)).toBe('Show all 7 · Waits on you');
    expect(nameOf(button).startsWith(visibleOf(button))).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const folded = [...(fold?.querySelectorAll('[data-row]') ?? [])];
    expect(folded.map((row) => text(row.querySelector('.id')))).toEqual(HARBOR.slice(3).map((e) => e.spec));
    for (const row of folded) {
      expect(text(row.querySelector('[data-reason]'))).not.toBe('');
      expect(row.querySelector('ui-command-chip')).not.toBeNull();
    }
    expect(section?.querySelectorAll('ui-command-chip').length).toBe(7);
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
    expect(nameOf(button)).toBe('Show all 7 · Waits on you');
  });

  it('reads the German names: "Alle 7 anzeigen · Liegt bei Ihnen"', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await render(HARBOR);
    const button = root.querySelector('app-waiting-section ui-disclosure button');
    expect(visibleOf(button)).toBe('Alle 7 anzeigen');
    expect(nameOf(button)).toBe('Alle 7 anzeigen · Liegt bei Ihnen');
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
    expect(section?.querySelector('ui-disclosure, ui-card')).toBeNull();
  });
});
