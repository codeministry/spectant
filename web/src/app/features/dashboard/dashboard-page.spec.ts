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

/** The dashboard body the stubbed shell data serves; a test may swap it before rendering. */
const body = signal<unknown>(harbor);

beforeEach(() => {
  body.set(harbor);
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

  it('binds the archived count of the KPIs to the spec list head', async () => {
    // The KPI count, not the length of the archive block the body happens to carry.
    expect(harbor.archive.length).not.toBe(7);
    body.set({ ...harbor, kpis: { ...harbor.kpis, archived: 7 } });
    const { main } = await render('wide');
    expect(main.querySelector('app-spec-table [data-count="archived"]')?.textContent).toContain('7');
  });
});
