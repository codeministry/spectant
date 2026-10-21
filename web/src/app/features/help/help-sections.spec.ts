import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Workflow } from '../../../../../core/src/files';
import { CLAIMLESS_RULE, DEFAULT_WORKFLOW, STAGE_RULES, WORKFLOW_TYPES } from '../../../../../core/src/stage';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { keyLabel, SHORTCUTS } from '../../layout/shell/keyboard-bindings';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { CARD_EDGE } from '../../shared/ui/stage-edge';
import { HelpPage } from './help-page';
import { HELP_COMMAND_ROWS, HELP_COMMANDS, HELP_SECTIONS, LEGEND, LIFECYCLE, STAGE_CHAIN } from './help-sections';

/** The command core's stage table names for a stage (`STAGE_RULES[].next`); the help shows it as it is. */
const nextOf = (stage: string): string =>
  STAGE_RULES.find((rule) => rule.stage === stage && rule.next !== null && rule !== CLAIMLESS_RULE)?.next ?? `no command for ${stage}`;

@Component({ selector: 'app-stub', template: '' })
class Stub {}

const ok = <T>(body: T): ApiResult<T> => ({ kind: 'ok', body, etag: null, notModified: false });
const LANTERN: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };

function setUp(): void {
  const entry = (slug: string) => ({ slug, name: slug, pathTail: slug, readable: true, counts: null });
  const api: Partial<ApiClient> = {
    workspaces: () => Promise.resolve(ok([entry('harbor'), entry('lantern')])),
    dashboard: () => Promise.resolve({ kind: 'not-found', served: false }),
    planning: () => Promise.resolve(ok({ workflow: LANTERN } as unknown as PlanningBody)),
    actors: () => Promise.resolve(ok([])),
    boardQuery: () => Promise.resolve({ kind: 'not-found', served: false }),
  };
  const mermaid: MermaidApi = { initialize: () => undefined, render: (id) => Promise.resolve({ svg: `<svg data-icon-exempt data-drawn="${id}"></svg>` }) };
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

async function open(url = '/help') {
  TestBed.inject(ShellState);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  for (let i = 0; i < 4; i++) {
    await harness.fixture.whenStable();
    harness.detectChanges();
  }
  const root = harness.routeNativeElement as HTMLElement;
  return { harness, root };
}

const text = (element: Element | null | undefined): string => element?.textContent.replace(/\s+/g, ' ').trim() ?? '';
const en = CATALOGUES.en as unknown as { help: { commands: { list: Record<string, string> } } };

describe('HelpPage sections (T162, ISC-133.1)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the page head, the nav and the seven sections in nav order, each labelled by its focusable h2', async () => {
    setUp();
    const { root } = await open();
    expect(text(root.querySelector('.head h1'))).toBe('Help');
    // spec 024: the page head shows "· v<version>" beside the h1.
    expect(text(root.querySelector('.head [data-help-version]'))).toMatch(/^· v\d+\.\d+\.\d+/);

    const sections = [...root.querySelectorAll<HTMLElement>(':scope > section[aria-labelledby]')];
    expect(sections.map((s) => s.id)).toEqual(['about', 'moves', 'workflows', 'commands', 'glossary', 'start', 'keys']);
    expect(sections.map((s) => s.id)).toEqual(HELP_SECTIONS.map((s) => s.id));
    for (const [i, section] of sections.entries()) {
      const heading = root.querySelector(`#${section.getAttribute('aria-labelledby') ?? ''}`);
      expect(heading?.tagName).toBe('H2');
      expect(heading?.getAttribute('tabindex')).toBe('-1');
      expect(section.contains(heading)).toBe(true);
      expect(heading?.id).toBe(HELP_SECTIONS[i]?.heading);
    }
    expect(text(root.querySelector('#help-about'))).toBe('About');
    expect(text(root.querySelector('#about p'))).toContain('The files are the only source of truth');

    const nav = root.querySelector('app-help-nav');
    // spec 024: the page head sits above the anchor pills.
    expect(nav?.compareDocumentPosition(root.querySelector('.head') as Element)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect([...root.querySelectorAll('a[data-help-chip]')].map((a) => a.getAttribute('data-help-chip'))).toEqual(HELP_SECTIONS.map((s) => s.id));
  });

  it('keeps ?ws= on the chip links', async () => {
    setUp();
    const { root } = await open('/help?ws=harbor');
    const chip = root.querySelector('a[data-help-chip="commands"]');
    expect(chip?.getAttribute('href')).toBe('/help?ws=harbor#commands');
  });

  it('shows every step of the lifecycle in order, the optional ones dashed and named so, a chevron between each two', async () => {
    setUp();
    const { root } = await open();
    const stages = [...root.querySelectorAll('#moves ol[data-stage-chain] > li')];
    expect(stages.map((li) => li.getAttribute('data-stage'))).toEqual(['idea', 'design', 'plan', 'tasks', 'review', 'build', 'code-review', 'close', 'done', 'archive']);
    expect(STAGE_CHAIN).toEqual(LIFECYCLE.flatMap((band) => band.nodes));
    // Every stage of the default feature row stands in the chain, in its order.
    const feature = DEFAULT_WORKFLOW.find((row) => row.type === 'feature')?.stages ?? [];
    expect(STAGE_CHAIN.map((n) => n.stage).filter((s) => (feature as readonly string[]).includes(s))).toEqual([...feature]);
    expect(stages.map((li) => text(li.querySelector('.pill')))).toEqual([
      'Idea',
      'Design (optional)',
      'Plan',
      'Tasks',
      'Review',
      'Build',
      'Code review (optional)',
      'Close',
      'Done',
      'Archive (optional)',
    ]);
    expect(stages.filter((li) => li.hasAttribute('data-optional')).map((li) => li.getAttribute('data-stage'))).toEqual(['design', 'code-review', 'archive']);
    expect(root.querySelectorAll('#moves ol[data-stage-chain] ui-icon.chevron')).toHaveLength(9);
    expect(stages.at(-1)?.querySelector('ui-icon')).toBeNull();
    expect(root.querySelector('#moves ol[data-stage-chain]')?.getAttribute('aria-label')).toBe('The steps of a feature in order; dashed ones are optional');
  });

  it('draws the lifecycle in two bands of five, the optional steps dotted with the pill that says when they apply', async () => {
    setUp();
    const { root } = await open();
    const bands = [...root.querySelectorAll('[data-lifecycle] .wf-band')];
    expect(bands.map((b) => b.querySelectorAll('.wf-node').length)).toEqual([5, 5]);
    const optional = [...root.querySelectorAll('[data-lifecycle] .wf-node[data-optional]')];
    expect(optional.map((n) => n.getAttribute('data-lifecycle-stage'))).toEqual(['design', 'code-review', 'archive']);
    // The design pass and the archive are the plugin's own steps; the code review's command is core's stage table's.
    expect(optional.map((n) => text(n.querySelector('code')))).toEqual(['/spec plan', nextOf('code-review'), '/spec done NNN archive']);
    expect(text(optional[1]?.querySelector('[data-optional-pill]'))).toBe('optional · as specs/workflow.md says');
    // The code review is no gate of its own any more: whether it is required is the workflow's call.
    expect(optional[1]?.querySelector('.wf-gate')).toBeNull();
    expect(text(root.querySelector('[data-lifecycle-stage="idea"] .wf-file'))).toBe('spec.md, context.md');
    expect([...root.querySelectorAll('[data-lifecycle] [data-loop]')].map((l) => l.getAttribute('data-loop'))).toEqual(['blocked', 'reviewed', 'pending', 'stale']);
  });

  it('has one type chip per spec type, glyph and name, each picking its type, then scrolling to and focusing its figure', async () => {
    setUp();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { harness, root } = await open();
    const chips = [...root.querySelectorAll<HTMLButtonElement>('#moves [data-type-chips] button[data-type-chip]')];
    expect(chips.map((c) => c.getAttribute('data-type-chip'))).toEqual([...WORKFLOW_TYPES]);
    expect(chips.map(text)).toEqual(['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore']);
    for (const chip of chips) expect(chip.querySelector('ui-type-glyph')).not.toBeNull();

    chips.find((c) => c.getAttribute('data-type-chip') === 'bug')?.click();
    for (let i = 0; i < 4; i++) {
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
    expect(root.querySelector<HTMLSelectElement>('select[data-workflow-type]')?.value).toBe('bug');
    const figure = root.querySelector('figure[data-workflow-figure="bug"]');
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(figure);
    expect(document.activeElement).toBe(figure);
    expect(figure?.getAttribute('tabindex')).toBe('-1');
  });

  it('puts the legend between the source line and the figures, with the board edge tokens', async () => {
    setUp();
    const { root } = await open();
    const legend = root.querySelector('#workflows ul[data-workflow-legend]');
    expect([...(legend?.querySelectorAll('li') ?? [])].map(text)).toEqual(['moving', 'waits on you', 'done', 'detour', 'optional step', 'fixed gate']);
    const source = root.querySelector('[data-workflow-source]') as Element;
    const figures = root.querySelector('#workflows .figures') as Element;
    expect(source.compareDocumentPosition(legend as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(legend?.compareDocumentPosition(figures)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const edge = (key: string) => LEGEND.find((e) => e.key === key)?.edge;
    expect([edge('moving'), edge('waits'), edge('done')]).toEqual([CARD_EDGE.build, CARD_EDGE.review, CARD_EDGE.done]);
    const swatch = legend?.querySelector<HTMLElement>('[data-legend="moving"] .swatch');
    expect(swatch?.style.getPropertyValue('--legend-edge')).toBe(CARD_EDGE.build);
    expect(legend?.querySelector('[data-legend="gate"] ui-icon')).not.toBeNull();
    // The workflow block itself: the two selects, the source line, the one figure of the picked type.
    expect(root.querySelector('#workflows select[data-workflow-workspace]')).not.toBeNull();
    expect(root.querySelector('#workflows select[data-workflow-type]')).not.toBeNull();
    expect(root.querySelectorAll('#workflows figure[data-workflow-figure]')).toHaveLength(1);
  });

  it('lists every command of the lifecycle once, in its order, the stage table’s included, as a command chip with its line', async () => {
    setUp();
    const { root } = await open();
    // The plugin's own steps literal (story, design pass, archive), every stage's command from core's stage table
    // (`commandFor` since spec 031); a command two nodes share is listed once.
    const expected = [
      ...new Set([
        '/spec idea',
        nextOf('idea'),
        '/spec plan',
        nextOf('plan'),
        nextOf('tasks'),
        nextOf('review'),
        nextOf('build'),
        nextOf('code-review'),
        nextOf('close'),
        '/spec done NNN archive',
        // Spec 043: the claimless row's `/spec new NNN`, after the lifecycle's own steps.
        CLAIMLESS_RULE.next ?? '',
        nextOf('blocked'),
      ]),
    ];
    expect(HELP_COMMANDS.map((c) => c.command)).toEqual(expected);
    for (const rule of STAGE_RULES) if (rule.next !== null) expect(expected).toContain(rule.next);
    // An optional step is skipped as a neighbour: the required path reads straight through.
    const row = (command: string) => HELP_COMMAND_ROWS.find((r) => r.command === command);
    expect(row('/spec idea')).toMatchObject({ needs: null, writes: 'specs/ideas/<slug>.md', then: nextOf('idea') });
    expect(row(nextOf('idea'))).toMatchObject({ needs: 'specs/ideas/<slug>.md', writes: 'spec.md, context.md', then: nextOf('plan') });
    // The plan's row is the plan's, even where the design pass shares its command.
    expect(row(nextOf('plan'))).toMatchObject({ writes: 'plan.md', then: nextOf('tasks') });
    expect(row(nextOf('build'))).toMatchObject({ then: nextOf('close') });
    expect(row('/spec done NNN archive')).toMatchObject({ needs: 'spec.md phase', then: null });
    const rows = [...root.querySelectorAll('#commands table[data-commands] tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-command'))).toEqual(expected);
    expect(rows.map((row) => text(row.querySelector('ui-command-chip code')))).toEqual(expected);
    for (const [i, row] of rows.entries()) {
      const key = HELP_COMMANDS[i]?.key ?? '';
      expect(text(row.querySelector('.purpose'))).toBe(en.help.commands.list[key]);
    }
    // spec 024: the commands table adds Needs, Writes and Then.
    expect([...root.querySelectorAll('#commands thead th')].map(text)).toEqual(['Command', 'What it does', 'Needs', 'Writes', 'Then']);
  });

  it('lists the getting-started steps with their code spans', async () => {
    setUp();
    const { root } = await open();
    const steps = [...root.querySelectorAll('#start ol[data-start-steps] > li')];
    expect(steps.map((li) => li.getAttribute('data-step'))).toEqual(['install', 'register', 'open']);
    expect([...(steps[1]?.querySelectorAll('code') ?? [])].map((c) => c.textContent)).toEqual(['specs/', 'spectant add <repo>']);
    expect(text(steps[1])).toBe('Register a repository that has a specs/ folder: spectant add <repo>.');
  });

  it('renders the Keyboard list from SHORTCUTS with the words and key caps of the ? sheet', async () => {
    setUp();
    const { root } = await open();
    const transloco = TestBed.inject(TranslocoService);
    const rows = [...root.querySelectorAll('#keys [data-binding]')];
    expect(rows.map((row) => row.getAttribute('data-binding'))).toEqual(SHORTCUTS.map((s) => s.id));
    // spec 024: `.keys-grid` rows, the action left in `.action`.
    expect(rows.map((row) => text(row.querySelector('.action')))).toEqual(
      SHORTCUTS.map((s) => transloco.translate(s.label, { target: s.target === undefined ? '' : String(transloco.translate(s.target)) })),
    );
    expect(rows.map((row) => [...row.querySelectorAll('ui-kbd')].map(text))).toEqual(SHORTCUTS.map((s) => s.keys.map(keyLabel)));
    expect([...root.querySelectorAll('#keys [data-context] > h3')].map(text)).toEqual(['On a workspace or all workspaces', 'In a spec', 'Everywhere']);
  });

  it('speaks German formally under German settings', async () => {
    setUp();
    TestBed.inject(TranslocoService).setActiveLang('de');
    const { root } = await open();
    expect(text(root.querySelector('#help-moves'))).toBe('Wie eine Spec sich bewegt');
    expect(text(root.querySelector('a[data-help-chip="keys"]'))).toBe('Tastatur');
    expect(text(root.querySelector('[data-legend="waits"]'))).toBe('wartet auf Sie');
    expect(text(root.querySelector('#commands thead th'))).toBe('Befehl');
  });
});
