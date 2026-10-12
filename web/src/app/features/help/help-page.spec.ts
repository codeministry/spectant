import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Workflow, WorkflowRow } from '../../../../../core/src/files';
import { GLOSSARY } from '../../../../../core/src/glossary';
import { DEFAULT_WORKFLOW } from '../../../../../core/src/stage';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { HelpPage } from './help-page';

@Component({ selector: 'app-stub', template: '' })
class Stub {}

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });

/** Harbor's workflow file: the feature row moves review before tasks (`core/fixtures/harbor/specs/workflow.md`). */
const HARBOR_FEATURE: WorkflowRow = {
  type: 'feature',
  stages: ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'],
  codeReview: 'spec',
};
const HARBOR: Workflow = { rows: DEFAULT_WORKFLOW.map((row) => (row.type === 'feature' ? HARBOR_FEATURE : row)), source: 'file', diagnostics: [] };
const LANTERN: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };
const WORKFLOWS: Readonly<Record<string, Workflow>> = { harbor: HARBOR, lantern: LANTERN };

let planningCalls: string[] = [];
let render: ReturnType<typeof vi.fn<MermaidApi['render']>>;

function setUp(): void {
  planningCalls = [];
  render = vi.fn<MermaidApi['render']>((id) => Promise.resolve({ svg: `<svg data-icon-exempt data-drawn="${id}"></svg>` }));
  const entry = (slug: string) => ({ slug, name: slug, pathTail: slug, readable: true, counts: null });
  const api: Partial<ApiClient> = {
    workspaces: () => Promise.resolve(ok([entry('harbor'), entry('lantern')])),
    dashboard: () => Promise.resolve({ kind: 'not-found', served: false }),
    planning: (ws: string) => {
      planningCalls.push(ws);
      return Promise.resolve(
        Object.hasOwn(WORKFLOWS, ws) ? ok({ workflow: WORKFLOWS[ws] } as unknown as PlanningBody) : { kind: 'not-found', served: true },
      );
    },
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve({ kind: 'not-found', served: false }),
  };
  const mermaid: MermaidApi = { initialize: () => undefined, render };
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
        { path: 'help', component: HelpPage },
        { path: 'w/:ws', component: Stub },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
      { provide: MERMAID_LOADER, useValue: () => Promise.resolve(mermaid) },
    ],
  });
}

/** Opens `/help`, after `/w/<from>` when given (the last workspace route), and waits for the page to settle. */
async function open(from: string | null, url = '/help') {
  TestBed.inject(ShellState); // The shell holds it from the start in the app; here the stub routes would not.
  const harness = await RouterTestingHarness.create();
  if (from !== null) await harness.navigateByUrl(`/w/${from}`);
  await harness.navigateByUrl(url);
  await settle(harness);
  return { harness, root: harness.routeNativeElement as HTMLElement };
}

async function settle(harness: RouterTestingHarness): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
}

const text = (element: Element | null | undefined): string => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
const glossaryRows = (root: HTMLElement) => [...root.querySelectorAll('table[data-glossary] tbody tr')];
const cells = (row: Element) => [...row.querySelectorAll('th, td')].map(text);
const source = (root: HTMLElement) => text(root.querySelector('[data-workflow-source]'));
const figure = (root: HTMLElement, type: string) => root.querySelector<HTMLElement>(`figure[data-workflow-figure="${type}"]`);
const diagramText = (root: HTMLElement, type: string) => figure(root, type)?.querySelector('pre[data-diagram-source]')?.textContent ?? '';

describe('HelpPage glossary (ISC-116)', () => {
  it('renders the thirteen rows of GLOSSARY in English, verbatim: term, common term, German, definition', async () => {
    setUp();
    const { root } = await open(null);
    const headers = [...root.querySelectorAll('table[data-glossary] thead th')].map(text);
    expect(headers).toEqual(['Spectant term', 'Common term', 'German', 'Definition']);
    const rows = glossaryRows(root);
    expect(rows).toHaveLength(13);
    expect(rows.map(cells)).toEqual(GLOSSARY.map((row) => [row.term, row.common, row.german, row.definition.replace(/`/g, '')]));
    expect(rows[2]?.id).toBe('term-claim');
    expect(rows[2]?.querySelector('td[lang="de"]')).not.toBeNull();
    expect(rows[2]?.querySelector('code')?.textContent).toBe('- [ ] ISC-<n>:');
  });

  it('shows the German terms when the language is German', async () => {
    setUp();
    TestBed.inject(TranslocoService).setActiveLang('de');
    const { root } = await open(null);
    const headers = [...root.querySelectorAll('table[data-glossary] thead th')].map(text);
    expect(headers).toEqual(['Spectant-Begriff', 'Gängiger Begriff', 'Deutsch', 'Definition']);
    const terms = glossaryRows(root).map((row) => cells(row)[0]);
    expect(terms).toEqual(GLOSSARY.map((row) => row.german));
    expect(cells(glossaryRows(root)[2])[1]).toBe('Akzeptanzkriterium');
  });
});

describe('HelpPage workflows (ISC-116, ISC-123)', () => {
  it('preselects the workspace of the last /w/:ws route and names its source', async () => {
    setUp();
    const { root } = await open('harbor');
    expect(root.querySelector<HTMLSelectElement>('select[data-workflow-workspace]')?.value).toBe('harbor');
    expect(source(root)).toBe('from specs/workflow.md');
    expect(planningCalls).toContain('harbor');
  });

  it('changes the workflow source with the select, through the URL', async () => {
    setUp();
    const { harness, root } = await open('harbor');
    const select = root.querySelector<HTMLSelectElement>('select[data-workflow-workspace]') as HTMLSelectElement;
    select.value = 'lantern';
    select.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(TestBed.inject(ShellState).route().ws).toBeNull();
    expect(source(root)).toBe('default table');
    select.value = '';
    select.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(source(root)).toBe('Default table: no workspace is open.');
  });

  it('shows the default table with its caption without a workspace', async () => {
    setUp();
    const { root } = await open(null);
    expect(root.querySelector<HTMLSelectElement>('select[data-workflow-workspace]')?.value).toBe('');
    expect(source(root)).toBe('Default table: no workspace is open.');
    expect(planningCalls).toEqual([]);
    expect(diagramText(root, 'feature')).toContain('s_tasks --> s_review');
  });

  it('draws one figure per spec type with a caption, through the mocked mermaid chunk', async () => {
    setUp();
    const { root } = await open('harbor');
    const types = [...root.querySelectorAll('figure[data-workflow-figure]')].map((f) => f.getAttribute('data-workflow-figure'));
    expect(types).toEqual(['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore']);
    expect(text(figure(root, 'feature')?.querySelector('figcaption'))).toContain('Workflow of the type feature');
    // Harbor's deviating feature row, left to right at the wide tier.
    expect(diagramText(root, 'feature')).toContain('direction LR');
    expect(diagramText(root, 'feature')).toContain('s_review --> s_tasks');
    expect(text(figure(root, 'feature')?.querySelector('[data-workflow-origin]'))).toBe('custom');
    expect(text(figure(root, 'bug')?.querySelector('[data-workflow-origin]'))).toBe('default');
    expect(render.mock.calls.map(([, source]) => source)).toContain(diagramText(root, 'feature'));
    expect(figure(root, 'feature')?.querySelector('[data-diagram] svg[data-drawn]')).not.toBeNull();
  });

  it('redraws top to bottom when the shell leaves the wide tier', async () => {
    setUp();
    const { harness, root } = await open('harbor');
    TestBed.inject(ShellState).tier.set('compact');
    await settle(harness);
    expect(diagramText(root, 'feature')).toContain('direction TB');
    expect(render.mock.calls.at(-1)?.[1]).toContain('direction TB');
  });
});
