import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { Relation, RelationIndex, RelationRef } from '../../../../../core/src/relations';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { PlanningFacts } from './planning-facts';

const rel = (ref: RelationRef, title: string, extra: Partial<Relation> = {}): Relation => {
  const [type, ...rest] = ref.split(':');
  return { ref, type: type as Relation['type'], id: rest.join(':'), title, closed: 0, total: 0, parents: [], children: [], blockers: [], ...extra };
};

const FEATURE = rel('feature:F25', 'Unified planning', {
  closed: 2,
  total: 7,
  parents: ['milestone:v1-0'],
  children: ['spec:025', 'spec:026', 'spec:024', 'spec:003', 'spec:010', 'claim:ISC-1', 'idea:graph-zoom'],
  facts: { why: 'One place to see what the plan holds.', milestone: 'Version 1.0' },
});
const MILESTONE = rel('milestone:v1-0', 'Version 1.0', {
  closed: 5,
  total: 12,
  children: ['feature:F25', 'feature:F7', 'idea:graph-zoom'],
  facts: { target: '2026-12-01', description: 'The first public release.' },
});
const CLOSED_CLAIM = rel('claim:ISC-1', 'The sidebar shows every fact.', {
  closed: 1,
  total: 1,
  parents: ['spec:025', 'feature:F25'],
  facts: { kind: 'anti', state: 'closed', probe: 'bun run e2e -- sidebar\n-g "planning overview"', verification: '2026-10-20 e2e green, 3 passed' },
});
const OPEN_CLAIM = rel('claim:ISC-2', 'A held claim.', {
  total: 1,
  parents: ['spec:025'],
  facts: { kind: 'normal', state: 'open', lockHolder: 'a:claude:spec-067/T20' },
});

const INDEX: RelationIndex = Object.fromEntries(
  [
    MILESTONE,
    FEATURE,
    rel('feature:F7', 'Side feature with a much longer name than fits on one line of the sidebar', { closed: 0, total: 3 }),
    rel('spec:025', 'Spec edges', { stage: 'build' }),
    rel('spec:026', 'Relations', { stage: 'build' }),
    rel('spec:024', 'Shell', { stage: 'review' }),
    rel('spec:003', 'Old pages', { archived: true }),
    rel('spec:010', 'Without state', { stage: null }),
    CLOSED_CLAIM,
    OPEN_CLAIM,
    rel('idea:graph-zoom', 'Graph zoom'),
  ].map((entry) => [entry.ref, entry]),
);

function setup(): void {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [provideRouter([])],
  });
}

async function render(relation: Relation, index: RelationIndex | null = INDEX): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(PlanningFacts);
  fixture.componentRef.setInput('relation', relation);
  fixture.componentRef.setInput('index', index);
  fixture.autoDetectChanges();
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const q = (root: HTMLElement, selector: string) => root.querySelector<HTMLElement>(selector);
const qa = (root: HTMLElement, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];
const facts = (root: HTMLElement) => qa(root, '[data-fact]').map((row) => row.dataset['fact']);
const text = (el: HTMLElement | null) => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';

describe('PlanningFacts (spec 067, T20, ISC-530)', () => {
  beforeEach(setup);

  it('shows a feature its why line, its milestone and its specs per stage, word and number', async () => {
    const root = await render(FEATURE);
    expect(root.getAttribute('data-type')).toBe('feature');
    expect(facts(root)).toEqual(['why', 'milestone', 'specs']);
    expect(text(q(root, '[data-fact="why"] dd'))).toBe('One place to see what the plan holds.');
    expect(text(q(root, '[data-fact="milestone"] dd'))).toBe('Version 1.0');
    // Workflow order, archived last; a spec without a stage and the claim and idea children count nowhere.
    const chips = qa(root, '[data-fact="specs"] [data-stage]');
    expect(chips.map((c) => c.dataset['stage'])).toEqual(['review', 'build', 'archived']);
    expect(chips.map((c) => text(c))).toEqual(['Review 1', 'Build 2', 'archived 1']);
    expect(chips.map((c) => text(q(c, '[data-count]')))).toEqual(['1', '2', '1']);
    // The tone follows the stage, the word stands beside it (never colour alone).
    expect(q(root, '[data-stage="build"] ui-chip')?.getAttribute('data-tone')).toBe('primary');
  });

  it('leaves out every feature row without a value', async () => {
    const bare = rel('feature:F9', 'Bare', { facts: {} });
    const root = await render(bare);
    expect(facts(root)).toEqual([]);
    expect(q(root, 'dl')).toBeNull();
    // Without an index there is nothing to count, and still no empty row.
    const noIndex = await render(FEATURE, null);
    expect(facts(noIndex)).toEqual(['why', 'milestone']);
  });

  it('shows a milestone its date in mono, its description and its features with x/y as selecting links', async () => {
    const root = await render(MILESTONE);
    expect(facts(root)).toEqual(['target', 'description', 'features']);
    const time = q(root, '[data-fact="target"] time');
    expect(time?.getAttribute('datetime')).toBe('2026-12-01');
    // A calendar day goes through `ui-time` (ISC-114.3), formatted in the app language, never the raw field.
    expect(text(time)).toContain('2026');
    expect(q(root, '[data-fact="target"] ui-time')?.classList).toContain('pf-mono');
    expect(text(q(root, '[data-fact="description"] dd'))).toBe('The first public release.');
    const rows = qa(root, '[data-fact="features"] a[data-sel]');
    expect(rows.map((a) => a.dataset['sel'])).toEqual(['feature:F25', 'feature:F7']);
    expect(rows.map((a) => text(q(a, '[data-progress]')))).toEqual(['2/7', '0/3']);
    expect(text(q(rows[1] ?? root, '.pf-title'))).toBe('Side feature with a much longer name than fits on one line of the sidebar');
    expect(q(rows[1] ?? root, '.pf-title')?.getAttribute('title')).toBe('Side feature with a much longer name than fits on one line of the sidebar');
    expect(rows[0]?.getAttribute('href')).toContain('sel=feature:F25');
  });

  it('leaves out every milestone row without a value', async () => {
    const root = await render(rel('milestone:later', 'Later', { facts: {} }));
    expect(facts(root)).toEqual([]);
  });

  it('shows a closed claim its kind, state, probe as a mono block and its verification line', async () => {
    const root = await render(CLOSED_CLAIM);
    expect(facts(root)).toEqual(['kind', 'state', 'probe', 'verification']);
    expect(text(q(root, '[data-fact="kind"] ui-chip'))).toBe('Anti');
    expect(q(root, '[data-fact="state"] ui-state-chip')?.getAttribute('data-state')).toBe('closed');
    const probe = q(root, '[data-fact="probe"] pre');
    expect(probe?.textContent).toBe('bun run e2e -- sidebar\n-g "planning overview"');
    expect(text(q(root, '[data-fact="verification"] dd'))).toBe('2026-10-20 e2e green, 3 passed');
  });

  it('shows an open claim its lock holder and no kind, probe or verification it lacks', async () => {
    const root = await render(OPEN_CLAIM);
    expect(facts(root)).toEqual(['state', 'lock']);
    expect(q(root, '[data-fact="state"] ui-state-chip')?.getAttribute('data-state')).toBe('open');
    const holder = q(root, '[data-fact="lock"] ui-actor-chip');
    expect(holder?.getAttribute('data-kind')).toBe('subagent');
    expect(holder?.hasAttribute('data-active')).toBe(true);
    expect(text(holder)).toContain('a:claude:spec-067');
  });

  it('never shows a verification line on a claim that is not closed', async () => {
    const odd = rel('claim:ISC-3', 'Odd', { facts: { kind: 'antecedent', state: 'dropped', verification: 'stale line' } });
    const root = await render(odd);
    expect(facts(root)).toEqual(['kind', 'state']);
    expect(text(q(root, '[data-fact="kind"] ui-chip'))).toBe('Antecedent');
  });

  it('shows nothing for a spec or an idea', async () => {
    expect(facts(await render(rel('spec:025', 'Spec edges', { stage: 'build' })))).toEqual([]);
    expect(facts(await render(rel('idea:graph-zoom', 'Graph zoom', { facts: { state: 'open', priority: 'P2' } })))).toEqual([]);
  });
});
