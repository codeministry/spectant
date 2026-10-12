import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslocoService, TranslocoTestingModule } from '@jsverse/transloco';
import type { Workflow } from '../../../../../core/src/files';
import { DEFAULT_WORKFLOW, STAGE_RULES, WORKFLOW_TYPES } from '../../../../../core/src/stage';
import { ApiClient, type ApiResult, type PlanningBody } from '../../core/api.service';
import { keyLabel, SHORTCUTS } from '../../core/keyboard-bindings';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { ShellState } from '../../layout/shell/shell-state.service';
import { MERMAID_LOADER, type MermaidApi } from '../../shared/ui/doc-prose/mermaid';
import { CARD_EDGE } from '../board/board-card';
import { HelpPage } from './help-page';
import { HELP_COMMANDS, HELP_SECTIONS, LEGEND, STAGE_CHAIN } from './help-sections';

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
    expect(text(root.querySelector('.head .subtitle'))).toBe('Spectant · the words, the workflows, the commands');

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
    expect(nav?.compareDocumentPosition(root.querySelector('.head') as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect([...root.querySelectorAll('a[data-help-chip]')].map((a) => a.getAttribute('data-help-chip'))).toEqual(HELP_SECTIONS.map((s) => s.id));
  });

  it('keeps ?ws= on the chip links', async () => {
    setUp();
    const { root } = await open('/help?ws=harbor');
    const chip = root.querySelector('a[data-help-chip="commands"]');
    expect(chip?.getAttribute('href')).toBe('/help?ws=harbor#commands');
  });

  it('shows the stage chain in the default order: idea, then the feature row, a chevron between each two', async () => {
    setUp();
    const { root } = await open();
    const stages = [...root.querySelectorAll('#moves ol[data-stage-chain] > li')];
    expect(stages.map((li) => li.getAttribute('data-stage'))).toEqual(['idea', 'plan', 'tasks', 'review', 'build', 'code-review', 'close', 'done']);
    expect(STAGE_CHAIN).toEqual(['idea', ...(DEFAULT_WORKFLOW.find((row) => row.type === 'feature')?.stages ?? [])]);
    expect(stages.map((li) => text(li.querySelector('.pill')))).toEqual(['Idea', 'Plan', 'Tasks', 'Review', 'Build', 'Code review', 'Close', 'Done']);
    expect(root.querySelectorAll('#moves ol[data-stage-chain] ui-icon.chevron')).toHaveLength(7);
    expect(stages.at(-1)?.querySelector('ui-icon')).toBeNull();
    expect(root.querySelector('#moves ol[data-stage-chain]')?.getAttribute('aria-label')).toBe('The stages of a feature, in the default order');
  });

  it('has one type chip per spec type, glyph and name, each scrolling to and focusing its figure', async () => {
    setUp();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { root } = await open();
    const chips = [...root.querySelectorAll<HTMLButtonElement>('#moves [data-type-chips] button[data-type-chip]')];
    expect(chips.map((c) => c.getAttribute('data-type-chip'))).toEqual([...WORKFLOW_TYPES]);
    expect(chips.map(text)).toEqual(['feature', 'project', 'infra', 'refactor', 'bug', 'spike', 'chore']);
    for (const chip of chips) expect(chip.querySelector('ui-type-glyph')).not.toBeNull();

    chips.find((c) => c.getAttribute('data-type-chip') === 'bug')?.click();
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
    expect([...(legend?.querySelectorAll('li') ?? [])].map(text)).toEqual(['moving', 'waits on you', 'done', 'detour', 'fixed gate']);
    const source = root.querySelector('[data-workflow-source]') as Element;
    const figures = root.querySelector('#workflows .figures') as Element;
    expect(source.compareDocumentPosition(legend as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(legend?.compareDocumentPosition(figures)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    const edge = (key: string) => LEGEND.find((e) => e.key === key)?.edge;
    expect([edge('moving'), edge('waits'), edge('done')]).toEqual([CARD_EDGE.build, CARD_EDGE.review, CARD_EDGE.done]);
    const swatch = legend?.querySelector<HTMLElement>('[data-legend="moving"] .swatch');
    expect(swatch?.style.getPropertyValue('--legend-edge')).toBe(CARD_EDGE.build);
    expect(legend?.querySelector('[data-legend="gate"] ui-icon')).not.toBeNull();
    // The workflow block itself stays as built: the select, the source line, seven figures.
    expect(root.querySelector('#workflows select[data-workflow-workspace]')).not.toBeNull();
    expect(root.querySelectorAll('#workflows figure[data-workflow-figure]')).toHaveLength(7);
  });

  it('lists every command of the stage table once, in table order, as a command chip with its line', async () => {
    setUp();
    const { root } = await open();
    const expected = [...new Set(STAGE_RULES.map((rule) => rule.next).filter((next): next is string => next !== null))];
    expect(HELP_COMMANDS.map((c) => c.command)).toEqual(expected);
    expect(expected).toEqual(['/spec new', '/spec-plan', '/spec-tasks', '/spec-review', '/spec-implement', '/spec-code-review', '/spec-complete', '/spec-status']);
    const rows = [...root.querySelectorAll('#commands table[data-commands] tbody tr')];
    expect(rows.map((row) => row.getAttribute('data-command'))).toEqual(expected);
    expect(rows.map((row) => text(row.querySelector('ui-command-chip code')))).toEqual(expected);
    for (const [i, row] of rows.entries()) {
      const key = HELP_COMMANDS[i]?.key ?? '';
      expect(text(row.querySelector('.purpose'))).toBe(en.help.commands.list[key]);
    }
    expect([...root.querySelectorAll('#commands thead th')].map(text)).toEqual(['Command', 'What it does']);
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
    expect(rows.map((row) => text(row.querySelector('dd')))).toEqual(
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
