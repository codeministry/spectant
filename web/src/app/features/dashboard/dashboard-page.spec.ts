import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { RefreshService } from '../../core/refresh.service';
import { RailSlot } from '../../layout/shell/rail-slot';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';
import { DashboardPage } from './dashboard-page';

/** The shell's main column and rail as `shell.html` places them: main first, the rail's slot after it. */
@Component({
  selector: 'app-test-shell',
  imports: [DashboardPage, RailSlot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main data-test-main><app-dashboard-page /></main>
    <aside data-test-rail>
      @if (rail()) {
        <app-rail-slot />
      }
    </aside>
  `,
})
class TestShell {
  /** False stands for the shell's collapsed strip (and zen), where no rail slot renders. */
  readonly rail = signal(true);
}

/** The page's four reading parts (design.md § Across viewports: the DOM order every tier shares). */
const PARTS = ['app-kpi-band', 'app-brief', 'app-next-up-list', 'app-spec-table'] as const;

/**
 * The order a screen reader reads the parts of `root` in: document order, with an element's `aria-owns` children read
 * at the owner's place and skipped at their own (the accessibility tree's reparenting).
 */
function readingOrder(root: HTMLElement): string[] {
  const doc = root.ownerDocument;
  const owned = new Set([...doc.querySelectorAll('[aria-owns]')].flatMap((owner) => (owner.getAttribute('aria-owns') ?? '').split(/\s+/)).filter(Boolean));
  const order: string[] = [];
  const walk = (node: Element): void => {
    const tag = node.tagName.toLowerCase();
    if ((PARTS as readonly string[]).includes(tag)) order.push(tag);
    for (const child of node.children) if (!owned.has(child.id)) walk(child);
    for (const id of (node.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean)) {
      const target = doc.getElementById(id);
      if (target) walk(target);
    }
  };
  walk(root);
  return order;
}

/** Harbor's body with its TL;DR fresh or stale (the golden's own brief is stale), or with no TL;DR at all. */
const withBrief = (stale: boolean | null): unknown => ({ ...harbor, brief: stale === null ? null : { ...harbor.brief, stale } });
const fresh = withBrief(false);

/** The dashboard body the stubbed shell data serves; a test may swap it before rendering. */
const body = signal<unknown>(fresh);

beforeEach(() => {
  body.set(fresh);
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([]),
      {
        provide: ShellData,
        useValue: {
          workspaceMissing: () => false,
          workspaceUnavailable: () => false,
          workspaceList: () => [],
          dashboard: { value: () => ({ kind: 'ok', body: body() }) },
        },
      },
      { provide: RefreshService, useValue: { changedKpis: signal(new Set()), changedRows: signal(new Set()) } },
    ],
  });
});

async function render(tier: Tier) {
  TestBed.inject(ShellState).tier.set(tier);
  const fixture = TestBed.createComponent(TestShell);
  await fixture.whenStable();
  await fixture.whenStable();
  const root = fixture.nativeElement as HTMLElement;
  return {
    root,
    main: root.querySelector('[data-test-main]') as HTMLElement,
    rail: root.querySelector('[data-test-rail]') as HTMLElement,
  };
}

describe('DashboardPage dashboard order', () => {
  for (const tier of ['compact', 'medium'] as const) {
    it(`reads KPI band, TL;DR, Next up, then the spec list in the main column at ${tier}`, async () => {
      const { root, main, rail } = await render(tier);
      expect(readingOrder(root)).toEqual([...PARTS]);
      expect(readingOrder(main)).toEqual([...PARTS]);
      expect(root.querySelectorAll('app-next-up-list')).toHaveLength(1);
      expect(rail.querySelector('app-next-up-list')).toBeNull();
    });
  }

  it('reads Next up between TL;DR and the spec list at wide while it stands visually in the rail, one accessible copy', async () => {
    const { root, main, rail } = await render('wide');
    // Visually in the rail: its one rendered copy is the rail block after Waits on you.
    const lists = root.querySelectorAll('app-next-up-list');
    expect(lists).toHaveLength(1);
    const next = lists[0] as HTMLElement;
    expect(rail.contains(next)).toBe(true);
    expect(next.getAttribute('data-form')).toBe('rail');
    expect(next.closest('[aria-hidden="true"], [inert]')).toBeNull();
    // Read in the main column's order: the main column owns it between the TL;DR and the spec list.
    expect(main.querySelector(`[aria-owns~="${next.id}"]`)).not.toBeNull();
    expect(readingOrder(main)).toEqual([...PARTS]);
    expect(readingOrder(root)).toEqual([...PARTS]);
  });

  it('owns nothing at wide while the rail renders no Next up block (collapsed strip), so no reference dangles', async () => {
    TestBed.inject(ShellState).tier.set('wide');
    const fixture = TestBed.createComponent(TestShell);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-context-rail')?.getAttribute('aria-owns')).toBeTruthy();
    fixture.componentInstance.rail.set(false);
    await fixture.whenStable();
    await fixture.whenStable();
    expect(root.querySelector('app-next-up-list')).toBeNull();
    expect(root.querySelector('app-context-rail')?.hasAttribute('aria-owns')).toBe(false);
  });

  for (const tier of ['compact', 'medium', 'wide'] as const) {
    it(`dashboard order: a stale brief stands behind the spec list at ${tier}`, async () => {
      body.set(withBrief(true));
      const { root, main } = await render(tier);
      expect(readingOrder(root)).toEqual(['app-kpi-band', 'app-next-up-list', 'app-spec-table', 'app-brief']);
      expect(readingOrder(main)).toEqual(['app-kpi-band', 'app-next-up-list', 'app-spec-table', 'app-brief']);
      // Right after the spec list's "Show all n", before the backlog and the warnings; one copy only.
      expect(main.querySelectorAll('app-brief')).toHaveLength(1);
      expect(main.querySelector('app-spec-table')?.nextElementSibling?.tagName.toLowerCase()).toBe('app-brief');
      expect(main.querySelector('app-brief')?.hasAttribute('data-stale')).toBe(true);
    });

    it(`dashboard order: a fresh brief stays second, right after the KPI band at ${tier}`, async () => {
      body.set(withBrief(false));
      const { root, main } = await render(tier);
      expect(readingOrder(root)).toEqual([...PARTS]);
      expect(main.querySelectorAll('app-brief')).toHaveLength(1);
      expect(main.querySelector('app-kpi-band')?.nextElementSibling?.tagName.toLowerCase()).toBe('app-brief');
      expect(main.querySelector('app-brief')?.hasAttribute('data-stale')).toBe(false);
    });

    it(`dashboard order: no brief renders no TL;DR card in either place at ${tier}`, async () => {
      body.set(withBrief(null));
      const { root } = await render(tier);
      expect(root.querySelector('app-brief')).toBeNull();
      expect(readingOrder(root)).toEqual(['app-kpi-band', 'app-next-up-list', 'app-spec-table']);
    });
  }

  /** The main column's direct children in DOM order, by tag. */
  const children = (main: HTMLElement): string[] => [...(main.querySelector('app-dashboard-page')?.children ?? [])].map((el) => el.tagName.toLowerCase());

  it('dashboard order: at compact #waiting follows the spec list, before the warnings, and the head links to it', async () => {
    const { main } = await render('compact');
    const order = children(main);
    expect(main.querySelectorAll('app-waiting-section')).toHaveLength(1);
    expect(order.indexOf('app-waiting-section')).toBe(order.indexOf('app-spec-table') + 1);
    expect(order.indexOf('app-waiting-section')).toBeLessThan(order.indexOf('app-warnings-panel'));
    expect(order.indexOf('app-waiting-section')).toBeGreaterThan(order.indexOf('app-kpi-band'));
    const link = main.querySelector('ui-page-head [data-waits-link]');
    // The test shell routes no workspace slug; the fragment is the target.
    expect(link?.getAttribute('href')).toMatch(/^\/w\/[^#]*#waiting$/);
    expect(link?.querySelector('ui-chip')?.textContent.trim()).toBe(String(harbor.guidance.waits.length));
    expect(link?.querySelector('.visually-hidden')?.textContent.trim()).toBe(`Waits on you · ${String(harbor.guidance.waits.length)} entries, go to the list`);
  });

  it('dashboard order: at compact a stale brief keeps its place right after the list, #waiting after it', async () => {
    body.set(withBrief(true));
    const { main } = await render('compact');
    const order = children(main);
    expect(order.slice(order.indexOf('app-spec-table'), order.indexOf('app-spec-table') + 3)).toEqual(['app-spec-table', 'app-brief', 'app-waiting-section']);
  });

  it('dashboard order: at medium #waiting stays before the KPI band (spec 020) and the head has no link', async () => {
    const { main } = await render('medium');
    const order = children(main);
    expect(order.indexOf('app-waiting-section')).toBe(order.indexOf('app-kpi-band') - 1);
    expect(main.querySelectorAll('app-waiting-section')).toHaveLength(1);
    expect(main.querySelector('[data-waits-link]')).toBeNull();
  });

  it('dashboard order: at wide #waiting is the rail block only and the head has no link', async () => {
    const { main, rail } = await render('wide');
    expect(main.querySelector('app-waiting-section')).toBeNull();
    expect(rail.querySelectorAll('app-waiting-section')).toHaveLength(1);
    expect(main.querySelector('[data-waits-link]')).toBeNull();
  });

  it('binds the archived count of the KPIs to the spec list head', async () => {
    // The KPI count, not the length of the archive block the body happens to carry.
    expect(harbor.archive.length).not.toBe(7);
    body.set({ ...harbor, kpis: { ...harbor.kpis, archived: 7 } });
    const { main } = await render('wide');
    expect(main.querySelector('app-spec-table [data-count="archived"]')?.textContent).toContain('7');
  });
});
