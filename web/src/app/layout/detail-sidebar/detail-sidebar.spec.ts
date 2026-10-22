import { Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ItemStateInfo } from '../../../../../core/src/files';
import type { Relation, RelationIndex, RelationRef } from '../../../../../core/src/relations';
import { ApiClient } from '../../core/api.service';
import { RefreshService } from '../shell/refresh.service';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { RailSlot } from '../shell/rail-slot';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { DOCK_MIN, TIER_MEDIUM_MIN, TIER_WIDE_MIN, tierFor } from '../shell/tier';
import { DetailSidebar } from './detail-sidebar';
import { DetailSelection, parseSel, presentationFor, refSelector, selectedLook, sidebarParents } from './selection';

const rel = (ref: RelationRef, title: string, extra: Partial<Relation> = {}): Relation => {
  const [type, ...rest] = ref.split(':');
  return { ref, type: type as Relation['type'], id: rest.join(':'), title, closed: 0, total: 0, parents: [], children: [], blockers: [], ...extra };
};

const CLAIMS = Array.from({ length: 7 }, (_, i) => `claim:ISC-${i + 1}` as const);
const INDEX: RelationIndex = Object.fromEntries(
  [
    rel('milestone:v1-0', 'Version 1.0', { closed: 3, total: 10, children: ['feature:F25'] }),
    rel('feature:F25', 'Unified planning', { closed: 2, total: 7, parents: ['milestone:v1-0'], children: ['spec:025', ...CLAIMS] }),
    rel('feature:F7', 'Side feature', { children: ['spec:025'] }),
    rel('spec:025', 'Spec edges', { closed: 2, total: 7, stage: 'build', parents: ['feature:F25', 'feature:F7'], children: CLAIMS, blockers: ['spec:024'] }),
    rel('spec:024', 'Shell', { stage: 'review' }),
    rel('spec:003', 'Old pages', { archived: true }),
    ...CLAIMS.map((ref, i) => rel(ref, `Claim ${i + 1}`, { total: 1, closed: i < 2 ? 1 : 0, parents: ['spec:025', 'feature:F25'] })),
    rel('idea:graph-zoom', 'Graph zoom'),
  ].map((entry) => [entry.ref, entry]),
);

@Component({ template: '' })
class Blank {}

@Component({ selector: 'app-dock-host', template: '' })
class DockHost {
  constructor() {
    inject(DetailSelection).dock(inject(DestroyRef));
  }
}

/** The shell container's width as `ShellState.width` holds it, and the tier it yields (820 is medium). */
const width = signal(820);
const tier = computed(() => tierFor(width()));

/** The dashboard as `ShellData.dashboard.value()` serves it; a test sets a row's `state` (spec 040, T62). */
const dashboard = signal<unknown>(undefined);
const ideas = signal<ReadonlyArray<{ readonly slug: string; readonly state?: ItemStateInfo }>>([]);
/** The favourite sets `ShellData` holds (spec 067, T25): the star reads them, a click only calls the toggles. */
const favSpecs = signal<ReadonlySet<string>>(new Set());
const favIdeas = signal<ReadonlySet<string>>(new Set());
const toggleFavorite = vi.fn<(spec: string) => Promise<boolean>>(() => Promise.resolve(true));
const toggleIdeaFavorite = vi.fn<(slug: string) => Promise<boolean>>(() => Promise.resolve(true));

function setup(): void {
  width.set(820);
  dashboard.set(undefined);
  ideas.set([]);
  favSpecs.set(new Set());
  favIdeas.set(new Set());
  toggleFavorite.mockClear();
  toggleIdeaFavorite.mockClear();
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: ShellState, useValue: { width, tier, ws: signal('harbor') } },
      {
        provide: ShellData,
        useValue: {
          planningModel: signal({ relations: INDEX }),
          dashboard: { value: dashboard },
          ideas,
          specRows: () => [{ id: '025', slug: '025-spec-edges', title: 'Spec edges', type: null, stage: 'build', priority: null }],
          isFavorite: (spec: string) => favSpecs().has(spec),
          isIdeaFavorite: (slug: string) => favIdeas().has(slug),
          toggleFavorite,
          toggleIdeaFavorite,
        },
      },
      { provide: ApiClient, useValue: { activityHash: () => null, releaseRun: vi.fn() } },
      { provide: RefreshService, useValue: { refresh: vi.fn() } },
    ],
  });
}

async function go(url: string): Promise<void> {
  await TestBed.inject(Router).navigateByUrl(url);
}

async function render(slot: 'rail' | 'float' = 'float') {
  const fixture = TestBed.createComponent(DetailSidebar);
  fixture.componentRef.setInput('slot', slot);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  return fixture;
}

const hostOf = (fixture: { nativeElement: unknown }): HTMLElement => fixture.nativeElement as HTMLElement;
const q = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector);
const qa = (root: HTMLElement, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];

describe('detail sidebar · selection contract', () => {
  it('parses ?sel= into a relation ref and refuses anything else', () => {
    expect(parseSel('spec:025')).toBe('spec:025');
    expect(parseSel('claim:ISC-100.1')).toBe('claim:ISC-100.1');
    expect(parseSel('milestone:v1-0')).toBe('milestone:v1-0');
    expect(parseSel('idea:graph-zoom')).toBe('idea:graph-zoom');
    expect(parseSel(null)).toBeNull();
    expect(parseSel('')).toBeNull();
    expect(parseSel('spec:')).toBeNull();
    expect(parseSel('story:x')).toBeNull();
    expect(parseSel('025')).toBeNull();
  });

  // Spec 067 (ISC-524): docked only from DOCK_MIN on, so the main column keeps 704 px beside the 480 px sidebar.
  it('picks the presentation from the container width and whether the page docks', () => {
    expect(DOCK_MIN).toBe(1280);
    expect(DOCK_MIN).toBeGreaterThan(TIER_WIDE_MIN);
    expect(presentationFor(1440, true)).toBe('docked');
    expect(presentationFor(DOCK_MIN, true)).toBe('docked');
    expect(presentationFor(DOCK_MIN - 1, true)).toBe('floating');
    expect(presentationFor(TIER_WIDE_MIN, true)).toBe('floating');
    expect(presentationFor(1440, false)).toBe('floating');
    expect(presentationFor(TIER_WIDE_MIN, false)).toBe('floating');
    expect(presentationFor(TIER_WIDE_MIN - 1, true)).toBe('overlay');
    expect(presentationFor(820, false)).toBe('overlay');
    expect(presentationFor(TIER_MEDIUM_MIN, true)).toBe('overlay');
    expect(presentationFor(TIER_MEDIUM_MIN - 1, true)).toBe('sheet');
    expect(presentationFor(390, false)).toBe('sheet');
  });

  it('adds the main feature’s milestone to a spec’s and a claim’s parents, once', () => {
    expect(sidebarParents(INDEX, INDEX['spec:025'])).toEqual(['feature:F25', 'feature:F7', 'milestone:v1-0']);
    expect(sidebarParents(INDEX, INDEX['claim:ISC-1'])).toEqual(['spec:025', 'feature:F25', 'milestone:v1-0']);
    expect(sidebarParents(INDEX, INDEX['feature:F25'])).toEqual(['milestone:v1-0']);
    expect(sidebarParents(INDEX, INDEX['milestone:v1-0'])).toEqual([]);
  });

  it('names the views’ objects by data-ref and marks the selected one by data-selected', () => {
    expect(refSelector('claim:ISC-1')).toBe('[data-ref="claim:ISC-1"]');
    setup();
    const selection = TestBed.inject(DetailSelection);
    expect(selectedLook(selection, 'spec:025', 'row')).toBeNull();
  });
});

describe('DetailSidebar', () => {
  beforeEach(setup);

  it('renders nothing without ?sel= or with a ref the index does not hold', async () => {
    await go('/w/harbor');
    const fixture = await render();
    expect(q(hostOf(fixture), '[data-part="title"]')).toBeNull();
    await go('/w/harbor?sel=spec:999');
    await fixture.whenStable();
    expect(q(hostOf(fixture), '[data-part="title"]')).toBeNull();
  });

  it('shows the header: neutral type chip, mono id, title, progress and the spec’s stage', async () => {
    await go('/w/harbor?sel=spec:025');
    const fixture = await render();
    const host: HTMLElement = hostOf(fixture);
    expect(host.getAttribute('data-presentation')).toBe('overlay');
    expect(q(host, '[data-part="type"]')?.getAttribute('data-type')).toBe('spec');
    expect(q(host, '[data-part="type"]')?.textContent).toContain('Spec');
    expect(q(host, '[data-part="type"] ui-icon')?.getAttribute('data-icon')).toBe('file-text');
    expect(q(host, '[data-part="id"]')?.textContent.trim()).toBe('025');
    expect(q(host, 'h2[data-part="title"]')?.textContent.trim()).toBe('Spec edges');
    expect(q(host, '[data-part="progress"]')?.textContent).toMatch(/2\s*\/\s*7/);
    expect(q(host, '[data-part="stage"]')?.textContent).toContain('Build');
    expect(q(host, 'aside')?.getAttribute('role')).toBe('complementary');
  });

  it('lists parents, children capped at five with “+N more”, and open blockers, each a link that selects', async () => {
    await go('/w/harbor?sel=spec:025');
    const fixture = await render();
    const host: HTMLElement = hostOf(fixture);
    const sections = qa(host, 'section[data-section]').map((s) => s.getAttribute('data-section'));
    expect(sections).toEqual(['parents', 'blockers', 'children']);

    const parents = qa(host, 'section[data-section="parents"] a[data-sel]').map((a) => a.getAttribute('data-sel'));
    expect(parents).toEqual(['feature:F25', 'feature:F7', 'milestone:v1-0']);
    expect(q(host, 'section[data-section="parents"] [data-count]')?.textContent.trim()).toBe('3');

    const children = () => qa(host, 'section[data-section="children"] a[data-sel]');
    expect(children()).toHaveLength(5);
    expect(q(host, 'section[data-section="children"] [data-count]')?.textContent.trim()).toBe('7');
    const more = q(host, 'button[data-more]');
    expect(more?.textContent).toContain('+2 more');
    more?.click();
    await fixture.whenStable();
    expect(children()).toHaveLength(7);
    expect(q(host, 'button[data-more]')).toBeNull();

    const blocker = q(host, 'section[data-section="blockers"] a[data-sel="spec:024"]');
    expect(blocker?.hasAttribute('data-blocker')).toBe(true);
    expect(blocker?.querySelector('ui-icon[data-icon="clock"]')).not.toBeNull();

    const href = q(host, 'a[data-sel="feature:F25"]')?.getAttribute('href') ?? '';
    expect(decodeURIComponent(href)).toContain('sel=feature:F25');
    q(host, 'a[data-sel="feature:F25"]')?.click();
    await fixture.whenStable();
    expect(decodeURIComponent(TestBed.inject(Router).url)).toContain('sel=feature:F25');
    expect(q(host, 'h2[data-part="title"]')?.textContent.trim()).toBe('Unified planning');
  });

  it('keeps other query params when selecting and closing', async () => {
    await go('/w/harbor/planning?m=v1-0&sel=spec:025');
    const fixture = await render();
    q(hostOf(fixture), 'a[data-sel="spec:024"]')?.click();
    await fixture.whenStable();
    expect(decodeURIComponent(TestBed.inject(Router).url)).toBe('/w/harbor/planning?m=v1-0&sel=spec:024');
    q(hostOf(fixture), 'button[data-close]')?.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/w/harbor/planning?m=v1-0');
  });

  it('opens the spec page from a spec and from a claim', async () => {
    await go('/w/harbor?sel=claim:ISC-3');
    const fixture = await render();
    expect(q(hostOf(fixture), 'a[data-open-spec]')?.getAttribute('href')).toBe('/w/harbor/s/025');
    await go('/w/harbor?sel=feature:F25');
    await fixture.whenStable();
    expect(q(hostOf(fixture), 'a[data-open-spec]')).toBeNull();
  });

  it('opens the idea page from an idea and keeps it off a spec (ISC-486)', async () => {
    await go('/w/harbor/specs?sel=idea:graph-zoom');
    const fixture = await render();
    const open = q(hostOf(fixture), 'a[data-open-idea]');
    expect(open?.getAttribute('href')).toBe('/w/harbor/ideas/graph-zoom');
    expect(open?.textContent.trim()).toBe('Open idea');
    expect(q(hostOf(fixture), 'a[data-open-spec]')).toBeNull();
    await go('/w/harbor/specs?sel=spec:025');
    await fixture.whenStable();
    expect(q(hostOf(fixture), 'a[data-open-spec]')?.getAttribute('href')).toBe('/w/harbor/s/025');
    expect(q(hostOf(fixture), 'a[data-open-idea]')).toBeNull();
  });

  it('shows an archived spec with the archived chip and an idea with its own type', async () => {
    await go('/w/harbor?sel=spec:003');
    const fixture = await render();
    expect(q(hostOf(fixture), '[data-part="archived"]')).not.toBeNull();
    await go('/w/harbor?sel=idea:graph-zoom');
    await fixture.whenStable();
    expect(q(hostOf(fixture), '[data-part="type"]')?.getAttribute('data-type')).toBe('idea');
    expect(q(hostOf(fixture), '[data-part="progress"]')?.textContent).toContain('No claims yet');
  });

  it('closes on Escape, drops ?sel= and returns focus to the selected object', async () => {
    const object = document.createElement('button');
    object.setAttribute('data-ref', 'spec:025');
    document.body.append(object);
    try {
      await go('/w/harbor?sel=spec:025');
      const fixture = await render();
      q(hostOf(fixture), 'h2[data-part="title"]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      expect(TestBed.inject(Router).url).toBe('/w/harbor');
      expect(q(hostOf(fixture), '[data-part="title"]')).toBeNull();
      expect(document.activeElement).toBe(object);
    } finally {
      object.remove();
    }
  });

  it('is one component in two slots: docked in the rail at wide when the page docks, floating otherwise', async () => {
    width.set(1440);
    await go('/w/harbor?sel=feature:F25');
    const float = await render('float');
    expect(hostOf(float).getAttribute('data-presentation')).toBe('floating');
    expect(q(hostOf(float), 'h2[data-part="title"]')).not.toBeNull();

    const dock = TestBed.createComponent(DockHost);
    dock.detectChanges();
    await float.whenStable();
    expect(q(hostOf(float), 'h2[data-part="title"]')).toBeNull();

    const rail = TestBed.createComponent(RailSlot);
    rail.autoDetectChanges();
    await rail.whenStable();
    const docked = q(hostOf(rail), 'app-detail-sidebar');
    expect(docked?.getAttribute('data-presentation')).toBe('docked');
    expect(q(hostOf(rail), 'h2[data-part="title"]')?.textContent.trim()).toBe('Unified planning');

    dock.destroy();
    await float.whenStable();
    expect(q(hostOf(float), 'h2[data-part="title"]')).not.toBeNull();
  });

  // Spec 067 (ISC-524): between the wide tier and DOCK_MIN a docking page's selection floats, the rail keeps its blocks.
  it('floats on a docking page below DOCK_MIN', async () => {
    width.set(DOCK_MIN - 1);
    await go('/w/harbor?sel=feature:F25');
    const float = await render('float');
    const dock = TestBed.createComponent(DockHost);
    dock.detectChanges();
    await float.whenStable();
    expect(TestBed.inject(DetailSelection).docked()).toBe(true);
    expect(hostOf(float).getAttribute('data-presentation')).toBe('floating');
    expect(q(hostOf(float), 'h2[data-part="title"]')).not.toBeNull();

    width.set(DOCK_MIN);
    await float.whenStable();
    expect(q(hostOf(float), 'h2[data-part="title"]')).toBeNull();
    dock.destroy();
  });

  // Spec 040, T62 · ISC-226: a spec or story whose run is open shows its state line with "Release run".
  it('shows a running spec’s state line with "Release run", and nothing for a spec without a run', async () => {
    const running: ItemStateInfo = {
      kind: 'spec',
      id: '025',
      state: 'running',
      stage: 'build',
      run: { run: 'r-1', command: '/spec implement 025', session: 'a:claude:s1', actor: { raw: 'a:claude:s1', kind: 'agent', id: 'a:claude:s1', legacy: false }, since: '2026-10-17T14:02:00Z', elapsedMs: 180_000, openRuns: 1, source: 'run' },
    };
    dashboard.set({ kind: 'ok', body: { specs: [{ id: '025', slug: '025-spec-edges', state: running }] } });
    await go('/w/harbor?sel=spec:025');
    const fixture = await render();
    const host = hostOf(fixture);
    expect(q(host, '[data-section="run"] ui-item-state')?.getAttribute('data-state')).toBe('running');
    expect(q(host, '[data-section="run"] [data-release]')?.textContent).toContain('Release run');
    dashboard.set({ kind: 'ok', body: { specs: [{ id: '025', slug: '025-spec-edges', state: { ...running, state: 'open', run: undefined } }] } });
    await fixture.whenStable();
    expect(q(host, '[data-section="run"]')).toBeNull();
    expect(q(host, '[data-release]')).toBeNull();
  });

  it('is a modal bottom sheet below 640', async () => {
    width.set(390);
    await go('/w/harbor?sel=milestone:v1-0');
    const fixture = await render();
    const host: HTMLElement = hostOf(fixture);
    expect(host.getAttribute('data-presentation')).toBe('sheet');
    const sheet = q(host, 'ui-sheet');
    expect(sheet?.getAttribute('data-tier')).toBe('compact');
    expect(sheet?.hasAttribute('data-flush')).toBe(true);
    expect(q(host, 'dialog h2[data-part="title"]')?.textContent.trim()).toBe('Version 1.0');
  });

  // Spec 067, T14 · ISC-527: the title wraps in full; a link row's title stops at two lines and carries the full title.
  it('shows the full title without a clamp and gives every link row its full title in `title`', async () => {
    await go('/w/harbor?sel=spec:025');
    const fixture = await render();
    const host = hostOf(fixture);
    const title = q(host, 'h2[data-part="title"]');
    expect(title?.getAttribute('style')).toBeNull();
    const style = title ? getComputedStyle(title) : null;
    expect(style?.getPropertyValue('-webkit-line-clamp')).toBe('');
    expect(style?.getPropertyValue('line-clamp')).toBe('');
    expect(style?.getPropertyValue('text-overflow')).not.toBe('ellipsis');
    expect(style?.getPropertyValue('overflow-wrap')).toBe('anywhere');
    expect(style?.getPropertyValue('hyphens')).toBe('auto');

    const rows = qa(host, 'a[data-sel]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const entry = INDEX[row.getAttribute('data-sel') as RelationRef];
      expect(row.querySelector('.lt')?.getAttribute('title')).toBe(entry.title);
    }
    const lt = rows[0].querySelector<HTMLElement>('.lt');
    expect(lt ? getComputedStyle(lt).getPropertyValue('white-space') : '').not.toBe('nowrap');
  });

  it('sets a claim’s text as the title, marked by its type', async () => {
    await go('/w/harbor?sel=claim:ISC-1');
    const fixture = await render();
    expect(q(hostOf(fixture), 'h2[data-part="title"]')?.getAttribute('data-type')).toBe('claim');
  });

  // Spec 067, T25 · ISC-532: the star in the head of a spec and an idea, between the id and the close button.
  it('carries the star for a spec and an idea, after the id and before close, following the favourites', async () => {
    favSpecs.set(new Set(['025-spec-edges']));
    await go('/w/harbor?sel=spec:025');
    const fixture = await render();
    const host = hostOf(fixture);
    const star = () => q(host, '.head button[ui-star-toggle]');
    const parts = [...(q(host, '.head')?.children ?? [])].map((el) => el.getAttribute('data-part') ?? el.className.split(' ')[0]);
    expect(parts.slice(-3, -2)).toEqual(['grow']);
    expect(q(host, '.head')?.children[3]).toBe(star());
    expect(q(host, '.head')?.children[4]?.hasAttribute('data-close')).toBe(true);
    expect(star()?.getAttribute('aria-pressed')).toBe('true');
    expect(star()?.getAttribute('aria-label')).toBe('Favorite: 025 Spec edges');
    favSpecs.set(new Set());
    await fixture.whenStable();
    expect(star()?.getAttribute('aria-pressed')).toBe('false');
    star()?.click();
    expect(toggleFavorite).toHaveBeenCalledWith('025-spec-edges');

    await go('/w/harbor?sel=idea:graph-zoom');
    await fixture.whenStable();
    expect(star()?.getAttribute('aria-pressed')).toBe('false');
    favIdeas.set(new Set(['graph-zoom']));
    await fixture.whenStable();
    expect(star()?.getAttribute('aria-pressed')).toBe('true');
    star()?.click();
    expect(toggleIdeaFavorite).toHaveBeenCalledWith('graph-zoom');

    for (const ref of ['feature:F25', 'milestone:v1-0', 'claim:ISC-1', 'spec:003']) {
      await go(`/w/harbor?sel=${ref}`);
      await fixture.whenStable();
      expect(q(host, '[data-part="title"]')?.textContent.trim()).toBe(INDEX[ref as RelationRef].title);
      expect(star()).toBeNull();
    }
  });
});
