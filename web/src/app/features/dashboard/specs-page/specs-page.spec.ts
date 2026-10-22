import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { ApiClient } from '../../../core/api.service';
import { RefreshService } from '../../../layout/shell/refresh.service';
import { RailSlot } from '../../../layout/shell/rail-slot';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { SpecsPage } from './specs-page';

@Component({ template: '' })
class Blank {}

/** The planning index the detail sidebar looks a selection up in: each harbor story as its `idea:<slug>` entry. */
const RELATIONS = Object.fromEntries(
  harbor.ideas.list.map((idea) => [
    `idea:${idea.slug}`,
    { ref: `idea:${idea.slug}`, type: 'idea', id: idea.slug, title: idea.title, closed: 0, total: 0, parents: [], children: [], blockers: [] },
  ]),
);

/** The dashboard's own blocks, none of which belongs on the Specs page (spec 058, ISC-391). */
const DASHBOARD_BLOCKS = ['app-kpi-band', 'app-brief', 'app-waiting-section', 'app-next-up-list', 'app-warnings-panel', 'app-context-rail'];

const missing = signal(false);
/** The body the page reads; harbor's golden unless a test swaps it. */
const body = signal<unknown>(harbor);

/**
 * Harbor with a lock on 002 and 005 (spec 064, T5, ISC-465): the golden's rows carry `taken: []`, the activity locks
 * reach them only through the live source, so the test gives two rows a holder as core's `taken` would.
 */
const WORKING = ['002', '005'];
const harborWorking = {
  ...harbor,
  specs: harbor.specs.map((spec) =>
    WORKING.includes(spec.id) ? { ...spec, taken: [{ id: 'ISC-1', session: `a:claude:sess-${spec.id}`, since: '2026-10-21T09:00:00Z', source: 'activity' }] } : spec,
  ),
};

beforeEach(() => {
  missing.set(false);
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
      provideRouter([
        { path: 'w/:ws/specs', component: SpecsPage, data: { page: 'specs' } },
        { path: 'w/:ws/ideas/:slug', component: Blank },
      ]),
      {
        provide: ShellData,
        useValue: {
          workspaceMissing: () => missing(),
          workspaceUnavailable: () => false,
          workspaceList: () => [{ slug: 'harbor', pathTail: 'code/harbor' }],
          wsImages: () => ({ logo: null, screenshot: null }),
          // The not-found page names the workspace and, on a spec route, the nearest specs.
          workspaceName: (slug: string) => slug,
          specMissing: () => false,
          specRows: () => [],
          dashboard: { value: () => ({ kind: 'ok', body: body() }) },
          isFavorite: () => false,
          toggleFavorite: () => Promise.resolve(false),
          // Spec 064 (T53): each idea row reads and writes its own star through ShellData.
          isIdeaFavorite: () => false,
          toggleIdeaFavorite: () => Promise.resolve(false),
          planningModel: () => ({ relations: RELATIONS }),
          ideas: () => [],
        },
      },
      { provide: ApiClient, useValue: { activityHash: () => null } },
      { provide: RefreshService, useValue: { changedKpis: signal(new Set()), changedRows: signal(new Set()) } },
    ],
  });
});

async function render(url: string) {
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await harness.fixture.whenStable();
  const root = harness.routeNativeElement as HTMLElement;
  return { harness, root };
}

/** The spec ids the list shows, once each, sorted. */
const rowIds = (root: HTMLElement): string[] => [...new Set([...root.querySelectorAll('[data-spec-row]')].map((el) => el.getAttribute('data-spec-row') ?? ''))].sort();
const text = (el: Element | null | undefined): string | undefined => el?.textContent.replace(/\s+/g, ' ').trim();

describe('SpecsPage (spec 058, T6, ISC-391)', () => {
  it('names Specs with the active and archived counts in the eyebrow, and "Specs · <ws>" in the h1', async () => {
    const { root } = await render('/w/harbor/specs');
    expect(text(root.querySelector('ui-page-head [data-page-eyebrow]'))).toBe(`harbor · Specs · ${String(harbor.specs.length)} active · ${String(harbor.kpis.archived)} archived`);
    expect(text(root.querySelector('ui-page-head h1'))).toBe('Specs · harbor');
    expect(root.querySelector('ui-page-head ui-ws-badge.page-mark')).not.toBeNull();
    expect(root.querySelector('[data-waits-link]')).toBeNull();
  });

  it('lists the specs filtered by ?stage=build, then the backlog and the footnote, and no dashboard block', async () => {
    const { root } = await render('/w/harbor/specs?stage=build');
    const building = harbor.specs.filter((spec) => spec.stage === 'build').map((spec) => spec.id);
    expect(building.length).toBeGreaterThan(0);
    expect(building.length).toBeLessThan(harbor.specs.length);
    expect(rowIds(root)).toEqual(building.sort());
    expect([...root.children].map((el) => el.tagName.toLowerCase())).toEqual(['ui-page-head', 'app-spec-table', 'p']);
    expect(root.querySelector('p.footer-note')?.textContent).toContain('code/harbor');
    for (const block of DASHBOARD_BLOCKS) expect(root.querySelector(block), block).toBeNull();
  });

  it('lists the stories as rows of the spec list under no heading, linked to their pages, and no ideas panel (spec 064, T42, T49; ISC-491)', async () => {
    const { root } = await render('/w/harbor/specs');
    const list = root.querySelector('app-spec-table .row-lists ol.rows');
    expect(root.querySelector('app-spec-table #ideas-group-heading, app-spec-table [data-ideas-group], app-spec-table .row-lists h3')).toBeNull();
    const rows = [...root.querySelectorAll('app-spec-table app-idea-row')];
    expect(rows).toHaveLength(harbor.ideas.list.length);
    for (const row of rows) expect(row.parentElement?.parentElement).toBe(list);
    const hrefs = rows.map((row) => row.querySelector('a.link')?.getAttribute('href'));
    expect(hrefs).toEqual(harbor.ideas.list.map((idea) => `/w/harbor/ideas/${idea.slug}`));
    expect(root.querySelector('[data-ideas]')).toBeNull();
    expect(root.querySelector('app-ideas-panel')).toBeNull();
  });

  it('lists every active spec without a filter', async () => {
    const { root } = await render('/w/harbor/specs');
    expect(rowIds(root)).toEqual(harbor.specs.map((spec) => spec.id).sort());
  });

  it('writes the list query into the URL', async () => {
    const { harness } = await render('/w/harbor/specs');
    const page = harness.routeDebugElement?.componentInstance as { setQuery: (query: unknown) => void };
    page.setQuery({ stage: ['plan', 'tasks', 'review'], type: null, sort: 'stage', takeable: false, working: false, archived: false });
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('stage=plan,tasks,review');
  });

  it('lists exactly the specs with an agent on ?working=1 and drops the param when the filter resets (spec 064, T5, ISC-465)', async () => {
    body.set(harborWorking);
    const { root, harness } = await render('/w/harbor/specs?working=1');
    expect(rowIds(root)).toEqual([...WORKING].sort());
    const page = harness.routeDebugElement?.componentInstance as { query: () => { working: boolean }; setQuery: (query: unknown) => void };
    expect(page.query().working).toBe(true);
    page.setQuery({ ...page.query(), working: false });
    await harness.fixture.whenStable();
    const router = TestBed.inject(Router);
    expect(router.parseUrl(router.url).queryParamMap.has('working')).toBe(false);
    expect(rowIds(root)).toEqual(harbor.specs.map((spec) => spec.id).sort());
  });

  it('writes ?working=1 into the URL like takeable (spec 064, T5, ISC-465)', async () => {
    const { harness } = await render('/w/harbor/specs');
    const page = harness.routeDebugElement?.componentInstance as { query: () => object; setQuery: (query: unknown) => void };
    page.setQuery({ ...page.query(), working: true });
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toContain('working=1');
  });

  it('renders not-found for an unknown workspace', async () => {
    missing.set(true);
    const { root } = await render('/w/nope/specs');
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(root.querySelector('app-spec-table')).toBeNull();
  });

  it('takes the selection: the previewed spec and ] stepping to its neighbour (T8, ISC-393)', async () => {
    const { root, harness } = await render('/w/harbor/specs?sel=spec:004');
    const selection = TestBed.inject(DetailSelection);
    expect(selection.selected()).toBe('spec:004');
    const page = harness.routeDebugElement?.componentInstance as { preview: () => { id: string } | null; neighbours: () => { prev: string | null; next: string | null } };
    expect(page.preview()?.id).toBe('004');
    const { next } = page.neighbours();
    expect(next).not.toBeNull();
    root.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }));
    await harness.fixture.whenStable();
    expect(selection.selected()).toBe(`spec:${String(next)}`);
  });
});

/** A third story beside harbor's two (spec 064): placed in one milestone, no feature, no state. */
const THIRD_IDEA = { slug: 'sync-dry-run', title: 'A dry run shows what a sync would change.', feature: null, milestone: 'Harbor 2.0', priority: 'P1' };
const THREE_IDEAS = [...harbor.ideas.list, THIRD_IDEA];
const harborThreeIdeas = { ...harbor, ideas: { count: THREE_IDEAS.length, list: THREE_IDEAS } };

describe('SpecsPage · an idea row selects like a spec row (spec 064, T40, ISC-484)', () => {
  const SLUG = harbor.ideas.list[1].slug;
  const ideaLink = (root: HTMLElement, slug = SLUG) => root.querySelector<HTMLAnchorElement>(`app-idea-row[data-idea="${slug}"] a.link`);
  const sel = (): string | null => {
    const router = TestBed.inject(Router);
    return router.parseUrl(router.url).queryParamMap.get('sel');
  };

  it('a first click selects the idea (?sel=idea:<slug>, other params kept) with the row look; a second opens its page', async () => {
    body.set(harborThreeIdeas);
    const { root, harness } = await render('/w/harbor/specs?sort=stage');
    const router = TestBed.inject(Router);
    expect(ideaLink(root)?.getAttribute('href')).toBe(`/w/harbor/ideas/${SLUG}`);
    expect(ideaLink(root)?.getAttribute('data-ref')).toBe(`idea:${SLUG}`);
    expect(ideaLink(root)?.hasAttribute('data-selected')).toBe(false);

    ideaLink(root)?.click();
    await harness.fixture.whenStable();
    expect(router.url.startsWith('/w/harbor/specs?')).toBe(true);
    expect(sel()).toBe(`idea:${SLUG}`);
    expect(router.parseUrl(router.url).queryParamMap.get('sort')).toBe('stage');
    expect(ideaLink(root)?.getAttribute('data-selected')).toBe('row');
    expect(ideaLink(root)?.getAttribute('aria-expanded')).toBe('true');
    expect(ideaLink(root, THIRD_IDEA.slug)?.hasAttribute('data-selected')).toBe(false);

    ideaLink(root)?.click();
    await harness.fixture.whenStable();
    expect(router.url).toBe(`/w/harbor/ideas/${SLUG}`);
  });

  it('Enter on the row link selects it as a click does; a click on another idea moves the selection', async () => {
    const { root, harness } = await render('/w/harbor/specs');
    const link = ideaLink(root);
    link?.focus();
    // A link's activation by Enter is a click with button 0 and no modifier.
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    await harness.fixture.whenStable();
    expect(sel()).toBe(`idea:${SLUG}`);
    const other = harbor.ideas.list[0].slug;
    ideaLink(root, other)?.click();
    await harness.fixture.whenStable();
    expect(sel()).toBe(`idea:${other}`);
    expect(ideaLink(root)?.hasAttribute('data-selected')).toBe(false);
    expect(ideaLink(root, other)?.getAttribute('data-selected')).toBe('row');
  });

  it('Shift, Ctrl, Cmd and Alt clicks keep the link’s native behaviour: no selection, the default not prevented', async () => {
    const { root, harness } = await render('/w/harbor/specs');
    const prevented: boolean[] = [];
    // Records the link's verdict, then stops the DOM's own navigation of the test document.
    const record = (event: Event): void => {
      prevented.push(event.defaultPrevented);
      event.preventDefault();
    };
    root.ownerDocument.addEventListener('click', record);
    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey', 'altKey'] as const) {
      ideaLink(root)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, [modifier]: true }));
      await harness.fixture.whenStable();
    }
    root.ownerDocument.removeEventListener('click', record);
    expect(prevented).toEqual([false, false, false, false]);
    expect(sel()).toBeNull();
    expect(TestBed.inject(Router).url).toBe('/w/harbor/specs');
  });

  it('with ?sel=idea:<slug> the Specs page docks the detail sidebar for that idea (ISC-171 for ideas on the Specs page)', async () => {
    const { root } = await render(`/w/harbor/specs?sel=idea:${SLUG}`);
    expect(ideaLink(root)?.getAttribute('data-selected')).toBe('row');
    const rail = TestBed.createComponent(RailSlot);
    rail.autoDetectChanges();
    await rail.whenStable();
    const sidebar = (rail.nativeElement as HTMLElement).querySelector('app-detail-sidebar');
    expect(sidebar?.getAttribute('data-presentation')).toBe('docked');
    expect(sidebar?.querySelector('[data-part="type"]')?.getAttribute('data-type')).toBe('idea');
    expect(text(sidebar?.querySelector('h2[data-part="title"]'))).toBe(harbor.ideas.list[1].title);
  });
});

describe('SpecsPage · anti: an idea is no active spec (spec 064, T43, T70, ISC-511, ISC-512)', () => {
  /** Two active specs (004 building, 005 scoping), both worked by an agent, the model's counts for those two, three stories. */
  const TWO = ['004', '005'];
  const twoSpecs = {
    ...harbor,
    specs: harbor.specs
      .filter((spec) => TWO.includes(spec.id))
      .map((spec) => ({ ...spec, taken: [{ id: 'ISC-1', session: `a:claude:sess-${spec.id}`, since: '2026-10-21T09:00:00Z', source: 'activity' }] })),
    kpis: { ...harbor.kpis, specs: 2, building: 1, scoping: 1, stageGroups: { scoping: 1, building: 1, complete: 0 }, specsWithFog: 0, byType: { feature: 1, spike: 1 } },
    // The model's per-stage counts for those two (004 code-review, 005 review), the stage chips' numbers (T62).
    stageCounts: { ...harbor.stageCounts, tasks: 0, review: 1, build: 0, 'code-review': 1, 'close-pending': 0, done: 0 },
    ideas: { count: THREE_IDEAS.length, list: THREE_IDEAS },
  };
  /** The last number in a chip's text, its count. */
  const countOf = (el: Element): number => Number(/(\d+)\D*$/.exec(text(el) ?? '')?.[1] ?? Number.NaN);

  it('counts 2 active specs in the eyebrow, the h1 and the active counter, with 3 idea rows listed (ISC-511)', async () => {
    body.set(twoSpecs);
    const { root } = await render('/w/harbor/specs');
    expect(root.querySelectorAll('app-idea-row')).toHaveLength(3);
    expect(rowIds(root)).toEqual(TWO);
    expect(text(root.querySelector('ui-page-head [data-page-eyebrow]'))).toBe(`harbor · Specs · 2 active · ${String(harbor.kpis.archived)} archived`);
    expect(text(root.querySelector('ui-page-head h1'))).toBe('Specs · harbor');
    expect(countOf(root.querySelector('[data-count="active"]') as Element)).toBe(2);
  });

  it('counts the 2 specs and the 3 ideas in the chip All, only their specs in the stage chips, the ideas in Idea (ISC-512)', async () => {
    body.set(twoSpecs);
    const { root } = await render('/w/harbor/specs');
    const chips = [...root.querySelectorAll('.t-head [data-filter="stage"] button')];
    const all = chips.find((chip) => text(chip)?.startsWith('All'));
    expect(all && countOf(all)).toBe(5);
    const idea = chips.find((chip) => text(chip)?.startsWith('Idea'));
    expect(idea && countOf(idea)).toBe(3);
    const stages = chips.filter((chip) => chip !== all && chip !== idea);
    expect(stages.map((chip) => text(chip))).toEqual(['Review 1', 'Code review 1']);
  });

  it('carries no spec trait in an idea row: no stage track, claim progress, command chip or agent dot', async () => {
    body.set(twoSpecs);
    const { root } = await render('/w/harbor/specs');
    // The spec rows carry each trait, so the selectors below name what an idea row leaves out.
    const specRow = root.querySelector('app-spec-row');
    for (const trait of ['ui-stage-track', '.rmeter', 'ui-agent-dot']) expect(specRow?.querySelector(trait), trait).not.toBeNull();
    const ideaRows = [...root.querySelectorAll('app-idea-row')];
    expect(ideaRows).toHaveLength(3);
    for (const row of ideaRows) {
      for (const trait of ['ui-stage-track', '.rmeter', 'ui-meter', '.frac', 'ui-command-chip', 'ui-agent-dot', 'ui-actor-chip']) {
        expect(row.querySelector(trait), `${String(row.getAttribute('data-idea'))} ${trait}`).toBeNull();
      }
    }
  });
});
