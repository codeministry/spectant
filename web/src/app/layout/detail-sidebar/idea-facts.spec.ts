import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { ItemStateInfo } from '../../../../../core/src/files';
import type { IdeaFacts as IdeaFactsData, Relation, RelationIndex, RelationRef } from '../../../../../core/src/relations';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { IdeaFacts } from './idea-facts';

const rel = (ref: RelationRef, title: string, extra: Partial<Relation> = {}): Relation => {
  const [type, ...rest] = ref.split(':');
  return { ref, type: type as Relation['type'], id: rest.join(':'), title, closed: 0, total: 0, parents: [], children: [], blockers: [], ...extra };
};

const EXCERPT = 'Zooming the graph loses the selection, and the minimap does not follow the viewport.';

const FULL: IdeaFactsData = { state: 'running', priority: 'P1', type: 'bug', excerpt: EXCERPT };
const BARE: IdeaFactsData = { state: 'open', priority: 'P3' };

const INDEX: RelationIndex = Object.fromEntries(
  [
    rel('milestone:v1-0', 'Version 1.0', { children: ['feature:F25', 'idea:graph-zoom'] }),
    rel('feature:F25', 'Unified planning', { parents: ['milestone:v1-0'], children: ['idea:graph-zoom'] }),
    rel('idea:graph-zoom', 'Graph zoom', { parents: ['feature:F25', 'milestone:v1-0'], facts: FULL }),
    rel('idea:bare', 'Bare story', { facts: BARE }),
  ].map((entry) => [entry.ref, entry]),
);

/** The story's served item state while it is open: row 1's step, `/spec new <slug>`, and its reason. */
const OPEN: ItemStateInfo = { kind: 'idea', id: 'bare', stage: 'idea', state: 'open', command: '/spec new bare', reason: 'the story is ready to shape' };
/** The same story while a run on it is open; the item then carries the run, not the step. */
const RUNNING: ItemStateInfo = {
  kind: 'idea',
  id: 'bare',
  stage: 'idea',
  state: 'running',
  run: {
    run: 'r-2',
    command: '/spec new bare',
    session: 'a:claude:s2',
    actor: { raw: 'a:claude:s2', kind: 'agent', id: 'a:claude:s2', legacy: false },
    since: '2026-10-17T14:02:00Z',
    elapsedMs: 120_000,
    openRuns: 1,
    source: 'run',
  },
};

function render(ref: RelationRef, item: ItemStateInfo | null = null): HTMLElement {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(IdeaFacts);
  fixture.componentRef.setInput('relation', INDEX[ref]);
  fixture.componentRef.setInput('index', INDEX);
  fixture.componentRef.setInput('item', item);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const row = (host: HTMLElement, field: string): HTMLElement | null => host.querySelector(`[data-fact="${field}"]`);
const fields = (host: HTMLElement): string[] => [...host.querySelectorAll('[data-fact]')].map((el) => el.getAttribute('data-fact') ?? '');

describe('IdeaFacts (spec 067, T18, ISC-529)', () => {
  it('shows state, priority, type, feature, milestone and the excerpt of a story with every field', () => {
    const host = render('idea:graph-zoom');
    expect(fields(host)).toEqual(['state', 'priority', 'type', 'feature', 'milestone']);
    expect(row(host, 'state')?.querySelector('ui-state-chip')?.getAttribute('data-state')).toBe('running');
    expect(row(host, 'priority')?.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P1');
    expect(row(host, 'type')?.querySelector('ui-type-glyph')?.getAttribute('data-type')).toBe('bug');
    expect(row(host, 'type')?.textContent.trim()).toMatch(/bug$/);
    expect(row(host, 'feature')?.querySelector('dd')?.textContent.replace(/\s+/g, ' ').trim()).toBe('F25 · Unified planning');
    expect(row(host, 'milestone')?.querySelector('dd')?.textContent.trim()).toBe('Version 1.0');
    expect([...host.querySelectorAll('dt')].map((dt) => dt.textContent.trim())).toEqual(['State', 'Priority', 'Type', 'Feature', 'Milestone']);
    const excerpt = host.querySelector<HTMLElement>('[data-part="excerpt"]');
    expect(excerpt?.textContent.trim()).toBe(EXCERPT);
    expect(excerpt?.title).toBe(EXCERPT);
  });

  it('shows the state even when no run is open, and leaves out every field the story does not carry', () => {
    const host = render('idea:bare');
    expect(fields(host)).toEqual(['state', 'priority']);
    expect(row(host, 'state')?.querySelector('ui-state-chip')?.getAttribute('data-state')).toBe('open');
    expect(row(host, 'priority')?.querySelector('ui-priority')?.getAttribute('data-level')).toBe('P3');
    expect(host.querySelectorAll('dt').length).toBe(2);
    expect(host.querySelectorAll('dd').length).toBe(2);
    expect(host.querySelector('[data-part="excerpt"]')).toBeNull();
  });

  it('renders nothing for an entry that is not a story', () => {
    TestBed.resetTestingModule();
    const host = render('feature:F25');
    expect(host.querySelector('dl')).toBeNull();
  });

  // Spec 067 (T23, ISC-531): the story's next step is the command its served item state names, `/spec new <slug>`.
  describe('next step', () => {
    afterEach(() => Reflect.deleteProperty(navigator, 'clipboard'));

    it('shows the open story’s command with its reason after the facts, copies it and announces the copy politely', async () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const host = render('idea:bare', OPEN);
      const parts = [...host.children].map((el) => el.getAttribute('data-part'));
      expect(parts).toEqual(['idea-facts', 'next']);
      expect(host.querySelector('[data-part="reason"]')?.textContent.trim()).toBe('the story is ready to shape');
      const button = host.querySelector<HTMLElement>('[data-part="next"] ui-command-chip button');
      expect(button?.getAttribute('aria-label')).toBe('Copy /spec new bare · next step for bare');
      expect(host.querySelector('[data-part="next"] ui-live-region')?.getAttribute('aria-live')).toBe('polite');
      button?.click();
      await vi.waitFor(() => expect(button?.hasAttribute('data-copied')).toBe(true));
      expect(writeText).toHaveBeenCalledWith('/spec new bare');
      await vi.waitFor(() => expect(host.querySelector('[data-part="next"] ui-live-region')?.textContent.trim()).toBe('Copied /spec new bare'));
    });

    it('locks the chip on the run’s command while a run is open on the story, and copies nothing', () => {
      const writeText = vi.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const host = render('idea:bare', RUNNING);
      const button = host.querySelector<HTMLElement>('[data-part="next"] ui-command-chip button');
      expect(host.querySelector('[data-part="next"] code')?.textContent.trim()).toBe('/spec new bare');
      expect(button?.getAttribute('aria-disabled')).toBe('true');
      expect(button?.querySelector('ui-icon')?.getAttribute('data-icon')).toBe('lock');
      button?.click();
      expect(writeText).not.toHaveBeenCalled();
    });

    it('has no next-step row without a served item state', () => {
      expect(render('idea:bare').querySelector('[data-part="next"]')).toBeNull();
    });
  });
});
