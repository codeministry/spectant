import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTransloco, type Translation, type TranslocoLoader, TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Workflow, WorkflowRow } from '../../../../../core/src/files';
import { GLOSSARY } from '../../../../../core/src/glossary';
import { DEFAULT_WORKFLOW } from '../../../../../core/src/stage';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { CATALOGUES, isLang, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
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

/** A catalogue loader that answers only when the test releases it: the cold first load, the catalogue after the first render. */
class HeldLoader implements TranslocoLoader {
  static pending: Array<() => void> = [];
  getTranslation(lang: string): Promise<Translation> {
    return new Promise((resolve, reject) => {
      HeldLoader.pending.push(() => (isLang(lang) ? resolve(CATALOGUES[lang]) : reject(new Error(lang))));
    });
  }
}
const release = (): void => {
  for (const answer of HeldLoader.pending.splice(0)) answer();
};

/** `held`: the catalogue comes through `HeldLoader`, late; otherwise it is preloaded as in every other spec. */
function setUp(held = false): void {
  planningCalls = [];
  HeldLoader.pending = [];
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
  TestBed.configureTestingModule({
    imports: held
      ? []
      : [
          TranslocoTestingModule.forRoot({
            langs: CATALOGUES,
            translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
            preloadLangs: true,
          }),
        ],
    providers: [
      ...(held
        ? [provideTransloco({ config: { availableLangs: [...LANGS], defaultLang: 'en', reRenderOnLangChange: true }, loader: HeldLoader })]
        : []),
      provideRouter([
        { path: 'help', component: HelpPage },
        { path: 'w/:ws', component: Stub },
      ]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ApiClient, useValue: api },
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
/** The stage nodes a figure draws; the optional steps, which are no stage, have their own helper. */
const nodesOf = (root: HTMLElement, type: string) => [...(figure(root, type)?.querySelectorAll('[data-diagram] g[data-stage]:not([data-optional])') ?? [])];
const optionalOf = (root: HTMLElement, type: string) => [...(figure(root, type)?.querySelectorAll('[data-diagram] g[data-stage][data-optional]') ?? [])];
/** The stages a figure draws, in drawing order: the main line, then the detours. */
const drawnStages = (root: HTMLElement, type: string) => nodesOf(root, type).map((g) => g.getAttribute('data-stage') ?? '');
const nodeLabels = (root: HTMLElement, type: string) => nodesOf(root, type).map(text);
const gateLabels = (root: HTMLElement, type: string) => [...(figure(root, type)?.querySelectorAll('[data-diagram] g[data-gate-note]') ?? [])].map(text);
const ariaLabel = (root: HTMLElement, type: string) => figure(root, type)?.querySelector('[data-diagram] svg[role="img"]')?.getAttribute('aria-label') ?? '';
/** A catalogue key in the page text: what the figures showed before T161 when the catalogue came late. */
const KEY_TEXT = /\bstages\.|help\.workflow\./;

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
    // Close-pending only under `code_review: feature`: the default per-spec review never reaches it.
    expect(drawnStages(root, 'feature')).toEqual(['plan', 'tasks', 'review', 'build', 'code-review', 'close', 'done', 'blocked']);
    expect(optionalOf(root, 'feature').map(text)).toEqual(['Design (optional)']);
  });

  it('draws the optional steps of the picked type: none for a spike, design and a voluntary review for a chore', async () => {
    setUp();
    expect(optionalOf((await open(null, '/help?type=spike')).root, 'spike')).toHaveLength(0);
    TestBed.resetTestingModule();
    setUp();
    const { root } = await open(null, '/help?type=chore');
    // Chore runs without a code review: it shows as the voluntary step between build and done.
    expect(optionalOf(root, 'chore').map((g) => g.getAttribute('data-stage'))).toEqual(['design', 'code-review']);
    expect([...(figure(root, 'chore')?.querySelectorAll('.as-text [data-optional-move]') ?? [])].map(text)).toEqual([
      'optional: Design → Review (/spec-design, UI specs only; moves no stage)',
      'optional: Build → Code review → Done (/spec-code-review; moves no stage)',
    ]);
  });

  it('draws the figure of one spec type, feature by default, picked by the type select through ?type=', async () => {
    setUp();
    const { harness, root } = await open('harbor');
    const select = root.querySelector<HTMLSelectElement>('select[data-workflow-type]') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore']);
    expect(select.value).toBe('feature');
    // Beside the workspace select, in the head.
    expect(select.closest('.selects')?.querySelector('select[data-workflow-workspace]')).not.toBeNull();
    expect([...root.querySelectorAll('figure[data-workflow-figure]')].map((f) => f.getAttribute('data-workflow-figure'))).toEqual(['feature']);
    select.value = 'bug';
    select.dispatchEvent(new Event('change'));
    await settle(harness);
    expect(TestBed.inject(Router).url).toBe('/help?type=bug');
    expect([...root.querySelectorAll('figure[data-workflow-figure]')].map((f) => f.getAttribute('data-workflow-figure'))).toEqual(['bug']);
    expect(text(figure(root, 'bug')?.querySelector('[data-workflow-origin]'))).toBe('default');
  });

  it('draws the figure inline as svg with a caption, rendered without a render run', async () => {
    setUp();
    const { root } = await open('harbor');
    expect(text(figure(root, 'feature')?.querySelector('figcaption'))).toContain('Workflow of the type feature');
    // Harbor's deviating feature row: review before tasks on the main line.
    expect(drawnStages(root, 'feature').slice(0, 7)).toEqual(['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done']);
    expect(text(figure(root, 'feature')?.querySelector('[data-workflow-origin]'))).toBe('custom');
    expect(root.querySelectorAll('figure[data-workflow-figure] [data-diagram][data-rendered] svg[role="img"]')).toHaveLength(1);
    // The legend once, in the section above the figures (T162), never inside a figure.
    expect(root.querySelectorAll('[data-workflow-legend]')).toHaveLength(1);
    expect(figure(root, 'feature')?.querySelector('[data-workflow-legend]')).toBeNull();
    expect(ariaLabel(root, 'feature')).toBe(
      'Workflow diagram of the type feature, its stages in order: Plan, Review, Tasks, Build, Code review, Close, Done. ' +
        'Detours: Blocked. Optional steps: Design (optional). Fixed gates: Build (gate · reviewed mark), Done (gate · every claim closed).',
    );
  });

  it('stays left to right when the shell leaves the wide tier', async () => {
    setUp();
    const { harness, root } = await open('harbor');
    const before = drawnStages(root, 'feature');
    TestBed.inject(ShellState).tier.set('compact');
    await settle(harness);
    expect(drawnStages(root, 'feature')).toEqual(before);
    const tops = [...(figure(root, 'feature')?.querySelectorAll('g[data-stage]:not([data-detour]) rect.box') ?? [])].map((r) => r.getAttribute('y'));
    // Seven stages and the design pass that leads them, all on one line.
    expect(tops).toHaveLength(8);
    expect(new Set(tops).size).toBe(1);
  });
});

describe('HelpPage workflow labels (T161, ISC-133.1)', () => {
  interface Words {
    readonly stages: Readonly<Record<string, string>>;
    readonly help: { readonly workflow: { readonly gateReviewed: string; readonly gateClosed: string } };
  }
  const en = CATALOGUES.en as unknown as Words;
  const de = CATALOGUES.de as unknown as Words;

  it('shows catalogue words, never catalogue keys, when the catalogue arrives after the first render', async () => {
    setUp(true);
    TestBed.inject(ShellState);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/help');
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    // Before the catalogue: no figure is drawn, so no key can show.
    expect(HeldLoader.pending.length).toBeGreaterThan(0);
    expect(root.querySelectorAll('figure[data-workflow-figure] g[data-stage]')).toHaveLength(0);

    release();
    await settle(harness);
    expect(nodesOf(root, 'feature').length).toBeGreaterThan(0);
    expect(nodeLabels(root, 'feature')).toEqual(drawnStages(root, 'feature').map((stage) => en.stages[stage]));
    expect(gateLabels(root, 'feature')).toEqual([en.help.workflow.gateReviewed, en.help.workflow.gateClosed]);
    expect(ariaLabel(root, 'feature')).toContain('Plan, Tasks, Review');
    expect(root.textContent).not.toMatch(KEY_TEXT);
  });

  it('redraws in the new language once its catalogue has arrived, and never shows a key in between', async () => {
    setUp(true);
    TestBed.inject(ShellState);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/help?type=chore');
    release();
    await settle(harness);
    const root = harness.routeNativeElement as HTMLElement;
    const chore = ['review', 'build', 'done', 'blocked'];
    expect(nodeLabels(root, 'chore')).toEqual(chore.map((stage) => en.stages[stage]));

    TestBed.inject(TranslocoService).setActiveLang('de');
    await settle(harness);
    expect(root.textContent).not.toMatch(KEY_TEXT);
    release();
    await settle(harness);
    expect(nodeLabels(root, 'chore')).toEqual(chore.map((stage) => de.stages[stage]));
    expect(gateLabels(root, 'chore')).toEqual([de.help.workflow.gateReviewed, de.help.workflow.gateClosed]);
    expect(root.textContent).not.toMatch(KEY_TEXT);
  });
});
