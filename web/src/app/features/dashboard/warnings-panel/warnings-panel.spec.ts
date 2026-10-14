import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import harbor from '../../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.golden.json';
import type { DashboardView as DashboardModel } from '../context-rail/dashboard-view';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import { type WarningsForm, WarningsPanel } from './warnings-panel';

const HARBOR = harbor as unknown as DashboardModel;
const LANTERN = lantern as unknown as DashboardModel;

beforeEach(() => {
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
});

async function render(model: DashboardModel, form?: WarningsForm): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(WarningsPanel);
  fixture.componentRef.setInput('specs', model.specs);
  fixture.componentRef.setInput('kpis', model.kpis);
  if (form) fixture.componentRef.setInput('form', form);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

const withWarnings = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0);
/** The prototype's groups: every spec with a warning or open fog, in model order. */
const withNotes = (model: DashboardModel) => model.specs.filter((r) => r.warnings.length > 0 || r.fog > 0);

describe('WarningsPanel', () => {
  // Open fog is said once, by the spec's fog line: a fog-kind warning of a spec with open fog gets no text line.
  const said = (spec: (typeof HARBOR.specs)[number]) => spec.warnings.filter((w) => !(spec.fog > 0 && w.kind === 'fog'));

  it('groups the lines by spec in model order, one line per model warning, under a focusable heading', async () => {
    const root = await render(HARBOR);
    const heading = root.querySelector('#warnings') as HTMLElement;
    expect(heading.textContent.trim()).toBe('Warnings');
    expect(heading.getAttribute('tabindex')).toBe('-1');

    const groups = [...root.querySelectorAll('[data-warning-spec]')];
    expect(groups.map((g) => g.getAttribute('data-warning-spec'))).toEqual(withNotes(HARBOR).map((r) => r.id));
    for (const spec of withWarnings(HARBOR)) {
      const group = root.querySelector(`[data-warning-spec="${spec.id}"]`) as HTMLElement;
      const lines = [...group.querySelectorAll('[data-warning-kind]')];
      expect(lines.map((i) => i.getAttribute('data-warning-kind'))).toEqual(said(spec).map((w) => w.kind));
      said(spec).forEach((w, i) => {
        const line = lines[i] as HTMLElement;
        expect(line.querySelector('ui-icon[data-icon="triangle-alert"]')).not.toBeNull();
        const link = line.querySelector('a[data-warning-link]') as HTMLAnchorElement;
        expect(link.getAttribute('href')).toBe(`/?sel=spec:${spec.id}`);
        expect(link.textContent.trim()).toBe(spec.id);
        expect(line.querySelector('[data-warning-text]')?.textContent.trim()).toBe(w.text);
        expect(line.querySelector('ui-command-chip code')?.textContent ?? null).toBe(w.command ?? w.overlap?.edge ?? null);
      });
    }
  });

  it('adds one fog line per spec with open fog: cloud icon, spec link and the count', async () => {
    const root = await render(HARBOR);
    const foggy = HARBOR.specs.filter((r) => r.fog > 0);
    expect(foggy.length).toBeGreaterThan(0);
    const lines = [...root.querySelectorAll('[data-fog-line]')];
    expect(lines.map((l) => l.getAttribute('data-fog-line'))).toEqual(foggy.map((r) => r.id));
    for (const spec of foggy) {
      const line = root.querySelector(`[data-fog-line="${spec.id}"]`) as HTMLElement;
      expect(line.closest(`[data-warning-spec="${spec.id}"]`)).not.toBeNull();
      // spec 024: prototype value (principal: the prototype wins)
      expect(line.querySelector('ui-icon[data-icon="cloud"]')).not.toBeNull();
      expect(line.querySelector('a[data-warning-link]')?.getAttribute('href')).toBe(`/?sel=spec:${spec.id}`);
      expect(line.textContent).toContain(spec.fog === 1 ? '1 open fog item' : `${spec.fog} open fog items`);
    }
    expect(root.querySelector('[data-open-fog]')).toBeNull();
  });

  it("states the model's warning count and the specs they sit in", async () => {
    const root = await render(HARBOR, 'callout');
    const specs = withWarnings(HARBOR).length;
    expect(root.querySelector('[data-warnings-summary]')?.textContent.trim()).toBe(`${HARBOR.kpis.warnings} warnings in ${specs} specs`);
  });

  it('shows the "No warnings" line with a check icon and no fog line when the model has none', async () => {
    const root = await render(LANTERN);
    expect(root.querySelectorAll('[data-warning-spec]').length).toBe(0);
    const empty = root.querySelector('[data-warnings-empty]') as HTMLElement;
    expect(empty.textContent.trim()).toBe('No warnings');
    expect(empty.querySelector('ui-icon')).not.toBeNull();
    expect(root.querySelector('[data-fog-line]')).toBeNull();
  });

  it('ports the rail from the prototype: an eyebrow heading with the count above one card of lines', async () => {
    const root = await render(HARBOR, 'rail');
    expect(root.getAttribute('data-form')).toBe('rail');
    const eyebrow = root.querySelector('[data-warnings-eyebrow]') as HTMLElement;
    expect(eyebrow.querySelector('#warnings')?.classList).toContain('type-eyebrow');
    expect(eyebrow.querySelector('[data-warnings-count]')?.textContent.trim()).toBe(String(HARBOR.kpis.warnings));
    expect(root.querySelector('ui-section-header')).toBeNull();
    const card = root.querySelector('ui-card') as HTMLElement;
    expect(card.querySelectorAll('[data-warning-spec]').length).toBe(withNotes(HARBOR).length);
  });

  it('renders the callout form as a collapsed details element summarising the count', async () => {
    const root = await render(HARBOR, 'callout');
    const details = root.querySelector('details[data-warnings-callout]') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    const summary = details.querySelector('summary') as HTMLElement;
    expect(summary.id).toBe('warnings');
    expect(summary.textContent).toContain(`${HARBOR.kpis.warnings} warnings in ${withWarnings(HARBOR).length} specs`);
    expect(details.querySelectorAll('[data-warning-spec]').length).toBe(withNotes(HARBOR).length);
  });

  it('renders nothing in the callout form when the model has no warnings', async () => {
    const root = await render(LANTERN, 'callout');
    expect(root.querySelector('details')).toBeNull();
    expect(root.textContent.trim()).toBe('');
  });
});

describe('WarningsPanel spec edges (T28, ISC-164.1, ISC-162.4)', () => {
  type Row = DashboardModel['specs'][number];
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
  const PATHS = ['web/src/app/layout/shell/areas.ts', 'web/src/app/layout/shell/index.ts', 'web/src/app/board/index.ts', 'core/src/a.ts', 'core/src/b.ts'];
  const row = (id: string, warnings: Row['warnings']): Row => ({ ...HARBOR.specs[0], id, title: `Spec ${id}`, warnings, fog: 0 });
  const model = (specs: Row[]): DashboardModel => ({ ...HARBOR, specs, kpis: { ...HARBOR.kpis, warnings: specs.length } });

  it('puts the golden overlap on the waiting spec 002: the other spec as a link, the suffix, the edge with copy', async () => {
    const root = await render(HARBOR);
    const line = root.querySelector('[data-warning-spec="002"] [data-warning-kind="spec-overlap"]') as HTMLElement;
    expect(root.querySelectorAll('[data-warning-kind="spec-overlap"]')).toHaveLength(1);
    expect(text(line.querySelector('[data-overlap-text]'))).toBe('shares 1 file with 004, no edge');
    expect(line.querySelector('a[data-overlap-other]')?.getAttribute('href')).toBe('/?sel=spec:004');
    const path = line.querySelector('[data-overlap-path]') as HTMLElement;
    expect(text(path)).toBe('retention/');
    expect(path.title).toBe('web/src/app/retention/');
    expect(line.querySelector('[data-overlap-more]')).toBeNull();
    expect(text(line.querySelector('[data-overlap-edge] code'))).toBe('(after: 004)');
    expect(text(line.querySelector('[data-overlap-target]'))).toBe('in 002');
  });

  it('shows three paths as unique suffixes, then "+n more" opening every full path', async () => {
    const overlap = { specs: ['017', '024'] as [string, string], paths: PATHS, waiting: '017', edge: '(after: 024)' };
    const root = await render(model([row('017', [{ kind: 'spec-overlap', text: 'shares 5 files with 024, no edge', overlap }])]));
    const line = root.querySelector('[data-warning-kind="spec-overlap"]') as HTMLElement;
    expect([...line.querySelectorAll('[data-overlap-path]')].map(text)).toEqual(['areas.ts', 'shell/index.ts', 'board/index.ts']);
    expect(text(line.querySelector('[data-overlap-more]'))).toBe('+2 more');
    expect([...line.querySelectorAll('[data-overlap-all] li')].map(text)).toEqual(PATHS);
  });

  it('copies exactly the edge of the waiting spec and confirms it on the button', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const fixture = TestBed.createComponent(WarningsPanel);
    fixture.componentRef.setInput('specs', HARBOR.specs);
    fixture.componentRef.setInput('kpis', HARBOR.kpis);
    await fixture.whenStable();
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-overlap-edge] button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Copy (after: 004)');
    button.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith('(after: 004)');
    expect(button.hasAttribute('data-copied')).toBe(true);
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('draws a spec-edge diagnostic as its own line with its place, no chip', async () => {
    const unknown = { kind: 'spec-edge' as const, text: 'The spec edge (after: 042) on T1 names no spec, active or archived; it stays open.', ref: 'tasks.md' };
    const cycle = { kind: 'spec-edge' as const, text: 'Spec edges form the cycle 017 → 024 → 017; every edge in it stays open.', ref: 'spec.md' };
    const root = await render(model([row('002', [unknown, cycle])]));
    const lines = [...root.querySelectorAll('[data-warning-kind="spec-edge"]')];
    expect(lines.map((l) => text(l.querySelector('[data-edge-text]')))).toEqual(['edge to 042 · no such spec', 'edge cycle 017 → 024 → 017']);
    expect(lines.map((l) => text(l.querySelector('[data-edge-where]')))).toEqual(['tasks.md · T1', 'spec.md']);
    expect(lines.every((l) => l.querySelector('ui-command-chip') === null)).toBe(true);
  });
});
