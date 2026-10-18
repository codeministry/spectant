import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
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
  for (let i = 0; i < 3; i++) {
    harness.detectChanges();
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return harness.routeNativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const HARBOR = harbor.guidance.waits as unknown as readonly GuidanceEntry[];
const BEACON = beacon.guidance.waits as unknown as readonly GuidanceEntry[];

describe('WaitingSection (spec 020 T17, ISC-238)', () => {
  it('is the #waiting target and lists five entries or fewer whole, a chip on every row, no "+n more"', async () => {
    const root = await render(BEACON);
    const section = root.querySelector('app-waiting-section');
    expect(section?.id).toBe(WAITING_FRAGMENT);
    expect(section?.getAttribute('tabindex')).toBe('-1');
    expect(section?.querySelector('[data-top] ui-command-chip')).not.toBeNull();
    const rows = [...(section?.querySelectorAll('[data-row]') ?? [])];
    expect(rows.length).toBe(BEACON.length - 1);
    for (const row of rows) expect(row.querySelector('ui-command-chip')).not.toBeNull();
    expect(section?.querySelector('[data-more], ui-disclosure')).toBeNull();
  });

  it('folds the entries past the top one and four rows into "Show all n", closed, each folded row with reason and chip', async () => {
    expect(HARBOR.length).toBe(7);
    const root = await render(HARBOR);
    const section = root.querySelector('app-waiting-section');
    expect(section?.getAttribute('data-count')).toBe('7');
    const block = section?.querySelector('ui-waits-block');
    expect(block?.querySelectorAll('[data-row]').length).toBe(4);
    expect(block?.querySelector('[data-more]')).toBeNull();
    const fold = section?.querySelector('ui-disclosure[data-show-all]');
    expect(text(fold?.querySelector('button'))).toContain('Show all 7');
    expect(fold?.querySelector('button')?.getAttribute('aria-expanded')).toBe('false');
    const folded = [...(fold?.querySelectorAll('[data-row]') ?? [])];
    expect(folded.map((row) => text(row.querySelector('.id')))).toEqual(HARBOR.slice(5).map((e) => e.spec));
    for (const row of folded) {
      expect(text(row.querySelector('[data-reason]'))).not.toBe('');
      expect(row.querySelector('ui-command-chip')).not.toBeNull();
    }
    expect(section?.querySelectorAll('ui-command-chip').length).toBe(7);
    expect(document.activeElement).not.toBe(section);
  });

  it('opens "Show all n" and focuses the section when the page is reached over #waiting', async () => {
    const root = await render(HARBOR, '/w/harbor#waiting');
    const section = root.querySelector('app-waiting-section');
    expect(section?.querySelector('ui-disclosure button')?.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(section);
  });

  it('holds the empty sentence when nothing waits', async () => {
    const root = await render([]);
    const section = root.querySelector('app-waiting-section');
    expect(text(section?.querySelector('[data-empty]'))).toBe('Nothing is waiting on you.');
    expect(section?.querySelector('ui-disclosure')).toBeNull();
  });
});
