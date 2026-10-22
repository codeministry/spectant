import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { lastChangeOf, SpecFacts, type SpecFactsRow, specFactsRowOf } from './spec-facts';

const FULL: SpecFactsRow = {
  id: '002',
  slug: '002-web-console',
  title: 'Web console',
  type: 'feature',
  priority: 'P1',
  stage: 'build',
  stageSource: 'derived',
  nextCommand: '/spec implement 002',
  nextReason: 'ISC-75 is takeable',
  assignee: null,
  goal: 'A teammate finds any mirrored repository in two steps.',
  feature: 'F2',
  featureName: 'Console',
  milestone: 'Harbor 1.0',
  progress: { closed: 3, total: 12 },
  tasks: { landed: 7, total: 20 },
  taken: [{ id: 'ISC-74', session: 'a:claude:sess-2' }],
  warnings: [{ kind: 'orphan-task' }, { kind: 'stale-lock' }],
  updated: '2026-03-07T14:30:00.000Z',
  lastRound: '2026-03-08T11:15:00.000Z',
};

/** A spec with nothing but its stage and the priority every row carries (P3 when the file names none). */
const BARE: SpecFactsRow = {
  ...FULL,
  id: '009',
  type: null,
  priority: 'P3',
  nextCommand: null,
  nextReason: '',
  goal: '',
  feature: null,
  featureName: null,
  milestone: null,
  progress: { closed: 0, total: 0 },
  tasks: null,
  taken: [],
  warnings: [],
  updated: null,
  lastRound: null,
};

function render(row: SpecFactsRow, large = false): HTMLElement {
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
  const fixture = TestBed.createComponent(SpecFacts);
  fixture.componentRef.setInput('row', row);
  fixture.componentRef.setInput('ws', 'harbor');
  fixture.componentRef.setInput('large', large);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const q = (host: HTMLElement, selector: string): HTMLElement | null => host.querySelector(selector);
const all = (host: HTMLElement, attr: string): string[] => [...host.querySelectorAll(`[${attr}]`)].map((el) => el.getAttribute(attr) ?? '');

describe('SpecFacts (spec 067, T16, ISC-528)', () => {
  it('shows stage, priority and type, the goal, the next step with its reason, the metrics and every fact', () => {
    const host = render(FULL);
    expect(q(host, '[data-part="stage"]')?.textContent).toContain('Build');
    expect(q(host, '[data-part="priority"]')?.getAttribute('data-level')).toBe('P1');
    expect(q(host, '[data-part="spec-type"]')?.textContent.trim()).toBe('feature');
    expect(q(host, '[data-part="goal"]')?.textContent.trim()).toBe(FULL.goal);
    expect(q(host, '[data-part="next"] ui-command-chip')?.textContent).toContain('/spec implement 002');
    expect(q(host, '[data-part="reason"]')?.textContent.trim()).toBe('ISC-75 is takeable');
    expect(all(host, 'data-metric')).toEqual(['claims', 'tasks', 'warnings']);
    expect(q(host, '[data-metric="claims"]')?.textContent).toMatch(/3\s*\/\s*12/);
    expect(q(host, '[data-metric="claims"] ui-ring')).not.toBeNull();
    expect(q(host, '[data-metric="tasks"]')?.textContent).toMatch(/7\s*\/\s*20/);
    expect(q(host, '[data-metric="warnings"]')?.textContent).toMatch(/2\s*warnings/);
    expect(q(host, '[data-metric="warnings"]')?.getAttribute('href')).toBe('/w/harbor/s/002/status');
    expect(all(host, 'data-fact')).toEqual(['feature', 'milestone', 'agent', 'changed']);
    expect(q(host, '[data-fact="feature"] dd')?.textContent.trim()).toBe('F2 · Console');
    expect(q(host, '[data-fact="milestone"] dd')?.textContent.trim()).toBe('Harbor 1.0');
    expect(q(host, '[data-fact="agent"] ui-actor-chip')?.textContent).toContain('claude');
    // The newer of `updated:` and the newest round.
    expect(q(host, '[data-fact="changed"] time')?.getAttribute('datetime')).toBe(FULL.lastRound);
  });

  it('leaves no row, metric or block for a value the spec does not carry', () => {
    const host = render(BARE);
    expect(q(host, '[data-part="stage"]')).not.toBeNull();
    // Every row carries a priority (P3 when the file names none), so the chip stays.
    expect(q(host, '[data-part="priority"]')?.getAttribute('data-level')).toBe('P3');
    for (const part of ['spec-type', 'goal', 'next', 'metrics', 'spec-facts']) expect(q(host, `[data-part="${part}"]`)).toBeNull();
    expect(all(host, 'data-fact')).toEqual([]);
    expect(host.querySelectorAll('dd:empty, dt:empty, p:empty')).toHaveLength(0);
  });

  it('drops only the missing rows: no agent, no warnings, no priority mark beyond P3', () => {
    const host = render({ ...FULL, taken: [], warnings: [], priority: 'P3' });
    expect(all(host, 'data-fact')).toEqual(['feature', 'milestone', 'changed']);
    expect(all(host, 'data-metric')).toEqual(['claims', 'tasks']);
    expect(q(host, '[data-fact="agent"]')).toBeNull();
  });

  it('names F<n> alone without a feature name, and gives the copy box its 44 px at compact', () => {
    const host = render({ ...FULL, featureName: null }, true);
    expect(q(host, '[data-fact="feature"] dd')?.textContent.trim()).toBe('F2');
    expect(q(host, 'ui-command-chip')?.getAttribute('data-size')).toBe('lg');
  });

  it('reads the row from a served dashboard body and the last change from the newer date', () => {
    expect(specFactsRowOf({ specs: [FULL] }, '002')?.slug).toBe('002-web-console');
    expect(specFactsRowOf({ specs: [{ id: '002', slug: 'x' }] }, '002')).toBeNull();
    expect(specFactsRowOf({ archive: [FULL] }, '002')).toBeNull();
    expect(lastChangeOf({ updated: '2026-03-09', lastRound: '2026-03-08T11:15:00.000Z' })).toEqual({ value: '2026-03-09', form: 'day' });
    expect(lastChangeOf({ updated: null, lastRound: null })).toBeNull();
  });
});
