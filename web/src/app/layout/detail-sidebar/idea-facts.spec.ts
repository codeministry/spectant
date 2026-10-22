import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
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

function render(ref: RelationRef): HTMLElement {
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
});
