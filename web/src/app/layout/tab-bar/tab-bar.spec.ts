import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { routes } from '../../app.routes';
import { withTechPage } from '../../features/tech/tech-page.testing';
import { ApiClient } from '../../core/api.service';
import { TECH_TABS, TechTabCounts, techTabs } from '../shell/page-tabs';
import { ShellState } from '../shell/shell-state.service';
import { TabBar } from './tab-bar';
import { TabBarSlot } from './tab-bar-slot';

/** The strings this spec reads; the catalogue task adds the real ones (`tech.tabs.*`, `shell.pages.tech`). */
const STUB = {
  en: {
    shell: { tabBar: '{{area}} tabs', pages: { tech: 'Tech' } },
    tech: { tabs: { overview: 'Overview', architecture: 'Architecture', status: 'Status', specs: 'Specs', open: 'Open' } },
  },
};

/** Every API call answers the catch-all 404: the slot's tech branch reads nothing from the spec model. */
const notServedApi = new Proxy({}, { get: () => () => Promise.resolve({ kind: 'not-found', served: false }) });

function setUp(): void {
  TestBed.configureTestingModule({
    imports: [TranslocoTestingModule.forRoot({ langs: STUB, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })],
    providers: [provideRouter(withTechPage(routes)), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: notServedApi }],
  });
}

/** The tab labels without their counts. */
const labels = (root: Element) => [...root.querySelectorAll('a')].map((a) => a.textContent.replace(/\d+/g, '').trim());

@Component({
  selector: 'app-bar-host',
  imports: [TabBar],
  template: `<app-tab-bar [tabs]="tabs" current="status" labelKey="shell.pages.tech" />`,
})
class BarHost {
  readonly tabs = techTabs('harbor', { status: 22, open: 0 });
}

@Component({
  selector: 'app-slot-host',
  imports: [TabBarSlot],
  template: `<header></header><main><app-tab-bar-slot /></main>`,
})
class SlotHost {}

describe('techTabs (page-tabs registry)', () => {
  it('lists the five tech tabs in order with their label keys and links', () => {
    expect(TECH_TABS).toEqual(['overview', 'architecture', 'status', 'specs', 'open']);
    expect(techTabs('harbor')).toEqual([
      { id: 'overview', labelKey: 'tech.tabs.overview', link: ['/w', 'harbor', 'tech', 'overview'] },
      { id: 'architecture', labelKey: 'tech.tabs.architecture', link: ['/w', 'harbor', 'tech', 'architecture'] },
      { id: 'status', labelKey: 'tech.tabs.status', link: ['/w', 'harbor', 'tech', 'status'], sep: true },
      { id: 'specs', labelKey: 'tech.tabs.specs', link: ['/w', 'harbor', 'tech', 'specs'] },
      { id: 'open', labelKey: 'tech.tabs.open', link: ['/w', 'harbor', 'tech', 'open'] },
    ]);
  });

  it('carries a count only where one is given, zero included', () => {
    const counts = Object.fromEntries(techTabs('harbor', { status: 22, open: 0 }).map((tab) => [tab.id, tab.count]));
    expect(counts).toEqual({ overview: undefined, architecture: undefined, status: '22', specs: undefined, open: '0' });
  });
});

describe('TabBar with a given tab list', () => {
  it('renders the list as route links, aria-current on the current tab, counts where given', async () => {
    setUp();
    const fixture = TestBed.createComponent(BarHost);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const links = [...root.querySelectorAll('a')];
    expect(labels(root)).toEqual(['Overview', 'Architecture', 'Status', 'Specs', 'Open']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(TECH_TABS.map((tab) => `/w/harbor/tech/${tab}`));
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual([null, null, 'page', null, null]);
    expect([...root.querySelectorAll('[data-count]')].map((el) => [el.getAttribute('data-count'), el.textContent.trim()])).toEqual([
      ['status', '22'],
      ['open', '0'],
    ]);
    expect(root.querySelector('nav')?.getAttribute('aria-label')).toBe('Tech tabs');
    // Spec 024 (ISC-149): the prototype anatomy, the area eyebrow first and one `tab-sep` before the live group.
    expect(root.querySelector('nav > [data-area-eyebrow]')?.textContent.trim()).toBe('Tech');
    expect(root.querySelectorAll('.tab-sep')).toHaveLength(1);
    expect(root.querySelector('.tab-sep + a')?.getAttribute('data-tab')).toBe('status');
    expect(root.querySelector('[data-count]')?.tagName).toBe('SMALL');
  });
});

describe('TabBarSlot on the tech page', () => {
  async function at(url: string, tier: 'compact' | 'medium' | 'wide') {
    setUp();
    const state = TestBed.inject(ShellState);
    await TestBed.inject(Router).navigateByUrl(url);
    state.tier.set(tier);
    const fixture = TestBed.createComponent(SlotHost);
    await fixture.whenStable();
    return { root: fixture.nativeElement as HTMLElement, fixture };
  }

  afterEach(() => TestBed.resetTestingModule());

  // Spec 024 (ISC-149): the prototype tab bar under the header on every width, never in the header.
  it('renders the tech tabs in the page at compact, never in the header', async () => {
    const { root } = await at('/w/harbor/tech/architecture', 'compact');
    expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
    expect(root.querySelector('header app-tab-bar')).toBeNull();
    const main = root.querySelector('main app-tab-bar');
    expect(labels(main as Element)).toEqual(['Overview', 'Architecture', 'Status', 'Specs', 'Open']);
    expect(main?.querySelector('[aria-current="page"]')?.getAttribute('data-tab')).toBe('architecture');
  });

  for (const tier of ['medium', 'wide'] as const) {
    it(`renders the tech tabs under the page head at ${tier}`, async () => {
      const { root } = await at('/w/harbor/tech/open', tier);
      expect(root.querySelectorAll('app-tab-bar')).toHaveLength(1);
      expect(root.querySelector('header app-tab-bar')).toBeNull();
      const main = root.querySelector('main app-tab-bar');
      expect(main?.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe('/w/harbor/tech/open');
    });
  }

  it('shows the counts the page puts into TechTabCounts', async () => {
    const { root, fixture } = await at('/w/harbor/tech/status', 'wide');
    expect(root.querySelector('[data-count]')).toBeNull();
    TestBed.inject(TechTabCounts).counts.set({ status: 22, specs: 22, open: 32 });
    await fixture.whenStable();
    expect([...root.querySelectorAll('[data-count]')].map((el) => el.textContent.trim())).toEqual(['22', '22', '32']);
  });

  it('renders no bar on an unknown tech tab or another workspace page', async () => {
    for (const url of ['/w/harbor/tech/nope', '/w/harbor/milestones', '/w/harbor']) {
      const { root } = await at(url, 'wide');
      expect(root.querySelector('app-tab-bar'), url).toBeNull();
      TestBed.resetTestingModule();
    }
  });
});
