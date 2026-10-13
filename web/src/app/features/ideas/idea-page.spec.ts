import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harborPlanning from '../../../../../core/fixtures/harbor.planning.golden.json';
import type { IdeaRef } from '../../../../../core/src/files';
import { renderDocsMarkdown } from '../../../../../core/src/markdown-docs';
import type { IdeaPage as IdeaPageBody } from '../../../../../server/src/spec-routes.contract';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { routes } from '../../app.routes';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import type { Tier } from '../../layout/shell/tier';

// T131 · ISC-124.2: the story page renders one `specs/ideas/` file read-only: the frontmatter as chips, the title as
// the heading, the body through the Docs tab's renderer, the file path and the hash as a muted hint, and no write
// control. The page is the stub's shape: the planning golden's `IdeaRef` and core's `renderDocsMarkdown` of the story.

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

/** The harbor fixture story `core/fixtures/harbor/specs/ideas/console-audit-log.md`, as the stub reads it. */
const STORY = [
  '---',
  'type: feature',
  'feature: F2',
  'milestone: Harbor 2.0',
  'priority: P3',
  'status: idea',
  '---',
  '/spec',
  '',
  '## Type',
  'feature',
  '',
  '## Goal (one sentence)',
  'Every change made in the web console is written to an audit log a teammate can read back.',
  '',
  '## In',
  '- One audit line per console write: time, actor, setting, old and new value',
  '',
  '| Probe | Kind |',
  '|-------|------|',
  '| A console write appends exactly one audit line | bun-test |',
  '',
].join('\n');

const PLANNING = harborPlanning as unknown as PlanningBody;
const REF = PLANNING.ideas.find((idea) => idea.slug === 'console-audit-log') as IdeaRef;
const HASH = `a1b2c3d4${'e'.repeat(56)}`;
const BODY: IdeaPageBody = { idea: REF, page: renderDocsMarkdown(STORY), hash: HASH };

const DASHBOARD = { specs: [{ id: '002', title: 'Web console', type: 'feature', stage: 'build' }] };

type FakeApi = Pick<ApiClient, 'workspaces' | 'dashboard' | 'planning' | 'spec' | 'idea'>;

function setUp(idea: (ws: string, slug: string) => Promise<ApiResult<IdeaPageBody>>): void {
  const api: FakeApi = {
    workspaces: () => Promise.resolve(ok([{ slug: 'harbor', name: 'harbor', pathTail: 'harbor', readable: true, counts: null }])),
    dashboard: (ws) => Promise.resolve(ws === 'harbor' ? ok(DASHBOARD) : { kind: 'not-found', served: true }),
    planning: (ws) => Promise.resolve(ws === 'harbor' ? ok(PLANNING) : { kind: 'not-found', served: true }),
    spec: () => Promise.resolve({ kind: 'not-found', served: false }),
    idea,
  };
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({ langs: CATALOGUES, translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' }, preloadLangs: true }),
    ],
    providers: [provideRouter(routes), provideHttpClient(), provideHttpClientTesting(), { provide: ApiClient, useValue: api }],
  });
}

const stub = (ws: string, slug: string): Promise<ApiResult<IdeaPageBody>> =>
  Promise.resolve(ws === 'harbor' && slug === 'console-audit-log' ? ok(BODY) : { kind: 'not-found', served: true });

async function open(url: string, tier: Tier = 'wide'): Promise<HTMLElement> {
  TestBed.inject(ShellState).tier.set(tier);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  for (let i = 0; i < 4; i += 1) {
    await harness.fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  harness.fixture.detectChanges();
  return harness.fixture.nativeElement as HTMLElement;
}

const text = (el: Element | null | undefined): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('IdeaPage (T131, ISC-124.2)', () => {
  it('renders harbor console-audit-log read-only: chips, heading, rendered body, file hint, no write control', async () => {
    setUp(stub);
    const root = await open('/w/harbor/ideas/console-audit-log');
    const page = root.querySelector('app-idea-page') as HTMLElement;
    expect(page).not.toBeNull();
    expect(root.querySelector('app-not-found')).toBeNull();

    const h1 = page.querySelector('h1#idea');
    expect(h1?.getAttribute('tabindex')).toBe('-1');
    expect(text(h1)).toBe(REF.slug);
    expect(text(page.querySelector('[data-idea-goal] blockquote'))).toBe(REF.title);

    const chips = page.querySelector('[data-idea-chips]') as HTMLElement;
    expect(chips.querySelector('[data-idea-chip="type"] ui-type-glyph')?.getAttribute('data-type')).toBe('feature');
    expect(text(chips.querySelector('[data-idea-chip="type"]'))).toContain('feature');
    expect(text(chips.querySelector('[data-idea-chip="feature"]'))).toContain('F2');
    expect(text(chips.querySelector('[data-idea-chip="milestone"]'))).toContain('Harbor 2.0');
    expect(chips.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P3');
    expect(text(chips.querySelector('[data-idea-chip="stage"]'))).toContain('Idea');

    const prose = page.querySelector('.docs-prose') as HTMLElement;
    const goal = BODY.page.toc.find((entry) => entry.text === 'Goal (one sentence)');
    expect(prose.querySelector(`h2[id="${goal?.anchor ?? ''}"]`)?.textContent).toBe('Goal (one sentence)');
    expect(prose.querySelector('ul li')?.textContent).toContain('One audit line per console write');
    expect(prose.querySelector('div.mdtable')?.getAttribute('role')).toBe('region');
    const links = [...page.querySelectorAll('nav.docs-toc a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual(BODY.page.toc.map((entry) => `#${entry.anchor}`));

    const source = page.querySelector('[data-idea-source]');
    expect(text(source)).toContain('specs/ideas/console-audit-log.md');
    expect(text(source)).toContain('a1b2c3d4');
    expect(text(source)).not.toContain(HASH);

    expect(page.querySelector('form, input, textarea, select, button, [contenteditable]')).toBeNull();
  });

  it('links “Show relations” to the detail sidebar on the idea: ?sel=idea:<slug>, the object named (spec 026, T28)', async () => {
    setUp(stub);
    const root = await open('/w/harbor/ideas/console-audit-log');
    const link = root.querySelector<HTMLAnchorElement>('a[data-show-relations]');
    expect(link?.getAttribute('data-ref')).toBe('idea:console-audit-log');
    expect(link?.getAttribute('href')).toBe('/w/harbor/ideas/console-audit-log?sel=idea:console-audit-log');
    expect(text(link)).toBe('Show relations');
  });

  it('keeps the TOC as the Docs tab does below wide: a disclosure, still no form element', async () => {
    setUp(stub);
    const root = await open('/w/harbor/ideas/console-audit-log', 'medium');
    const page = root.querySelector('app-idea-page') as HTMLElement;
    expect(page.querySelector('nav.docs-toc')).toBeNull();
    expect(text(page.querySelector('ui-disclosure.docs-toc-fold'))).toContain('On this page');
    expect(page.querySelector('form, input, textarea, select, [contenteditable]')).toBeNull();
  });

  it('renders not-found for an unknown slug', async () => {
    setUp(stub);
    const root = await open('/w/harbor/ideas/nope');
    expect(root.querySelector('app-not-found')).not.toBeNull();
    expect(root.querySelector('[data-idea-chips]')).toBeNull();
  });

  it('renders not-found when the story route answers 404 although the tree still lists the slug', async () => {
    setUp(() => Promise.resolve({ kind: 'not-found', served: true }));
    const root = await open('/w/harbor/ideas/console-audit-log');
    expect(root.querySelector('app-not-found')).not.toBeNull();
  });

  it('shows the loading skeleton while the story loads', async () => {
    setUp(() => new Promise<ApiResult<IdeaPageBody>>(() => undefined));
    // A pending resource keeps the app unstable, so this view is settled by ticks, not by whenStable.
    const harness = await RouterTestingHarness.create();
    void harness.navigateByUrl('/w/harbor/ideas/console-audit-log');
    for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    harness.fixture.detectChanges();
    const root = harness.fixture.nativeElement as HTMLElement;
    expect(root.querySelector('app-idea-page [role="status"]')?.getAttribute('aria-label')).toBe('Loading story');
  });

  it('shows the error notice when the story route fails', async () => {
    setUp(() => Promise.resolve({ kind: 'error', status: 500 }));
    const root = await open('/w/harbor/ideas/console-audit-log');
    expect(text(root.querySelector('app-idea-page [data-idea-error]'))).toBe('This story could not be loaded.');
  });
});
