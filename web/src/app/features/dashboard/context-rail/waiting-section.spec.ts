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

describe('WaitingSection (spec 020 T17, ISC-238; spec 021 ISC-246.1 short form)', () => {
  it('is the #waiting target and shows a single entry whole with its chip, no fold', async () => {
    const root = await render(BEACON.slice(0, 1));
    const section = root.querySelector('app-waiting-section');
    expect(section?.id).toBe(WAITING_FRAGMENT);
    expect(section?.getAttribute('tabindex')).toBe('-1');
    expect(section?.querySelector('[data-top] ui-command-chip')).not.toBeNull();
    expect(section?.querySelectorAll('[data-row]').length).toBe(0);
    expect(section?.querySelector('[data-more], ui-disclosure')).toBeNull();
  });

  it('folds every entry past the top one from two entries on: "+1 more"', async () => {
    expect(BEACON.length).toBe(2);
    const root = await render(BEACON);
    const section = root.querySelector('app-waiting-section');
    expect(section?.querySelector('ui-waits-block')?.querySelectorAll('[data-row]').length).toBe(0);
    const button = section?.querySelector('ui-disclosure[data-show-all] button');
    expect(visibleOf(button)).toBe('+1 more');
    expect(nameOf(button)).toBe('+1 more · Waits on you, show all 2');
  });

  it('shows the header with the count, the top card whole and "+6 more" directly below, closed, the rest folded with reason and chip', async () => {
    expect(HARBOR.length).toBe(7);
    const root = await render(HARBOR);
    const section = root.querySelector('app-waiting-section');
    expect(section?.getAttribute('data-count')).toBe('7');
    const block = section?.querySelector('ui-waits-block');
    expect(text(block?.querySelector('ui-section-header ui-chip'))).toBe('7');
    // The top entry whole: spec, the reason never shortened, the copy chip.
    const top = block?.querySelector('[data-top]');
    expect(text(top?.querySelector('a.id'))).toBe(HARBOR[0]?.spec);
    expect(text(top?.querySelector('[data-reason]')).length).toBeGreaterThan(0);
    expect(top?.querySelector('ui-command-chip')).not.toBeNull();
    expect(block?.querySelectorAll('[data-row]').length).toBe(0);
    expect(block?.querySelector('[data-more]')).toBeNull();
    // The fold right below the block.
    const fold = section?.querySelector('ui-disclosure[data-show-all]');
    expect(block?.nextElementSibling).toBe(fold);
    const button = fold?.querySelector('button');
    expect(visibleOf(button)).toBe('+6 more');
    expect(button?.querySelector('[data-visible]')?.getAttribute('aria-hidden')).toBe('true');
    expect(nameOf(button)).toBe('+6 more · Waits on you, show all 7');
    expect(nameOf(button).startsWith(visibleOf(button))).toBe(true);
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    const folded = [...(fold?.querySelectorAll('[data-row]') ?? [])];
    expect(folded.map((row) => text(row.querySelector('.id')))).toEqual(HARBOR.slice(1).map((e) => e.spec));
    for (const row of folded) {
      expect(text(row.querySelector('[data-reason]'))).not.toBe('');
      expect(row.querySelector('ui-command-chip')).not.toBeNull();
    }
    expect(section?.querySelectorAll('ui-command-chip').length).toBe(7);
    expect(document.activeElement).not.toBe(section);
  });

  it('names the toggle by its state once open: "Show fewer · Waits on you, only the top entry"', async () => {
    entries = HARBOR;
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/w/harbor');
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    root.querySelector<HTMLButtonElement>('app-waiting-section ui-disclosure button')?.click();
    await settle(harness);
    const button = root.querySelector('app-waiting-section ui-disclosure button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(visibleOf(button)).toBe('Show fewer');
    expect(nameOf(button)).toBe('Show fewer · Waits on you, only the top entry');
    expect(nameOf(button).startsWith(visibleOf(button))).toBe(true);
  });

  it('reads the German names: "+6 weitere · Liegt bei Ihnen, alle 7 zeigen"', async () => {
    TestBed.inject(TranslocoService).setActiveLang('de');
    const root = await render(HARBOR);
    const button = root.querySelector('app-waiting-section ui-disclosure button');
    expect(visibleOf(button)).toBe('+6 weitere');
    expect(nameOf(button)).toBe('+6 weitere · Liegt bei Ihnen, alle 7 zeigen');
  });

  it('opens the fold and focuses the section when the page is reached over #waiting', async () => {
    const root = await render(HARBOR, '/w/harbor#waiting');
    const section = root.querySelector('app-waiting-section');
    const button = section?.querySelector('ui-disclosure button');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(nameOf(button)).toBe('Show fewer · Waits on you, only the top entry');
    expect(document.activeElement).toBe(section);
  });

  it('holds the empty sentence when nothing waits', async () => {
    const root = await render([]);
    const section = root.querySelector('app-waiting-section');
    expect(text(section?.querySelector('[data-empty]'))).toBe('Nothing is waiting on you.');
    expect(section?.querySelector('ui-disclosure')).toBeNull();
  });
});
