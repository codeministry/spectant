import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { routes } from '../../app.routes';
import { ApiClient } from '../../core/api.service';
import type { PageTab } from '../shell/page-tabs';
import { ShellState } from '../shell/shell-state.service';
import { TabBar } from './tab-bar';
import { TabBarSlot } from './tab-bar-slot';

/** The strings this spec reads: a page's own tab registry, as `PageTab` lets any page hand the bar one. */
const STUB = {
  en: {
    shell: { tabBar: '{{area}} tabs', pages: { demo: 'Demo' } },
    demo: { tabs: { one: 'One', two: 'Two', three: 'Three', four: 'Four' } },
  },
};

/** Every API call answers the catch-all 404. */
const notServedApi = new Proxy({}, { get: () => () => Promise.resolve({ kind: 'not-found', served: false }) });

function setUp(): void {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: STUB, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: notServedApi }],
  });
}

const IDS = ['one', 'two', 'three', 'four'] as const;
const link = (id: string): string[] => ['/w', 'harbor', 'demo', id];

/** The tab labels without their counts. */
const labels = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.textContent.replace(/\d+/g, '').trim());

@Component({
  selector: 'app-bar-host',
  imports: [TabBar],
  template: `<app-tab-bar [tabs]="tabs" current="three" labelKey="shell.pages.demo" />`,
})
class BarHost {
  readonly tabs: readonly PageTab[] = [
    { id: 'one', labelKey: 'demo.tabs.one', link: link('one') },
    { id: 'two', labelKey: 'demo.tabs.two', link: link('two') },
    { id: 'three', labelKey: 'demo.tabs.three', link: link('three'), sep: true, count: '22' },
    { id: 'four', labelKey: 'demo.tabs.four', link: link('four'), count: '0' },
  ];
}

@Component({
  selector: 'app-slot-host',
  imports: [TabBarSlot],
  template: `<header></header><main><app-tab-bar-slot /></main>`,
})
class SlotHost {}

describe('TabBar with a given tab list', () => {
  it('renders the list as route links, aria-current on the current tab, counts where given', async () => {
    setUp();
    const fixture = TestBed.createComponent(BarHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const links = [...root.querySelectorAll('a')];
    expect(labels(root)).toEqual(['One', 'Two', 'Three', 'Four']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(IDS.map((tab) => `/w/harbor/demo/${tab}`));
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null]);
    expect([...root.querySelectorAll('[data-count]')].map((el) => [el.getAttribute('data-count'), el.textContent.trim()])).toEqual([
      ['three', '22'],
      ['four', '0'],
    ]);
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Demo tabs');
    // Spec 024 (ISC-149): the prototype anatomy, the area eyebrow first and one `tab-sep` before the group it opens.
    expect(root.querySelector('nav > [data-area-eyebrow]')?.textContent.trim()).toBe('Demo');
    expect(root.querySelectorAll('.tab-sep')).toHaveLength(1);
    expect(root.querySelector('.tab-sep + a')?.getAttribute('data-tab')).toBe('three');
    expect(root.querySelector('[data-count]')?.tagName).toBe('SMALL');
  });
});

describe('TabBarSlot off a spec', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders no bar on a workspace page or below a former tech address', async () => {
    for (const url of ['/w/harbor/tech/nope', '/w/harbor/milestones', '/w/harbor', '/w/harbor/library']) {
      setUp();
      await TestBed.inject(Router).navigateByUrl(url);
      TestBed.inject(ShellState).tier.set('wide');
      const fixture = TestBed.createComponent(SlotHost);
      await fixture.whenStable();
      expect((fixture.nativeElement as HTMLElement).querySelector('app-tab-bar'), url).toBeNull();
      TestBed.resetTestingModule();
    }
  });
});
