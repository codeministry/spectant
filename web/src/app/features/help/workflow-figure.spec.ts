import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { defaultWorkflowRow } from '../../../../../core/src/stage';
import { CATALOGUES, LANGS } from '../../../i18n/catalogues';
import { type DiagramLabels, SHIELD_CHECK, workflowLayout } from './workflow-diagram';
import { WorkflowFigure } from './workflow-figure';

const LABELS: DiagramLabels = {
  stage: (stage) => `Stage ${stage}`,
  design: 'Design',
  optional: (name) => `${name} (optional)`,
  gateReviewed: 'gate · reviewed mark',
  gateClosed: 'gate · every claim closed',
};

function render(legend: boolean) {
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
  });
  const fixture = TestBed.createComponent(WorkflowFigure);
  const layout = workflowLayout(defaultWorkflowRow('feature'), LABELS);
  fixture.componentRef.setInput('layout', layout);
  fixture.componentRef.setInput('label', 'Workflow diagram of the type feature');
  fixture.componentRef.setInput('legend', legend);
  fixture.detectChanges();
  return { host: fixture.nativeElement as HTMLElement, layout };
}

const text = (el: Element | null | undefined): string => el?.textContent.replace(/\s+/g, ' ').trim() ?? '';

describe('WorkflowFigure (ISC-123)', () => {
  it('draws the layout model as one inline svg, marked rendered at once, with its accessible name', () => {
    const { host, layout } = render(false);
    expect(host.hasAttribute('data-rendered')).toBe(true);
    const svgs = host.querySelectorAll('svg[role="img"]');
    expect(svgs).toHaveLength(1);
    const svg = svgs[0] as SVGSVGElement;
    expect(svg.getAttribute('aria-label')).toBe('Workflow diagram of the type feature');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${String(layout.size.width)} ${String(layout.size.height)}`);
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
  });

  it('renders one node per model node with its label, role, left edge and rect geometry', () => {
    const { host, layout } = render(false);
    const nodes = [...host.querySelectorAll('g[data-stage]')];
    expect(nodes.map((n) => n.getAttribute('data-stage'))).toEqual(layout.nodes.map((n) => n.stage));
    expect(nodes.map(text)).toEqual(layout.nodes.map((n) => n.label));
    const build = host.querySelector('g[data-stage="build"]');
    expect(build?.getAttribute('data-role')).toBe('moving');
    expect(build?.querySelector('rect.box')?.getAttribute('height')).toBe('32');
    expect((build as SVGGElement | null)?.style.getPropertyValue('--edge')).toBe('var(--color-primary)');
    expect(host.querySelector('g[data-stage="blocked"]')?.hasAttribute('data-detour')).toBe(true);
    // The design pass leads the line, dotted: an optional step, no detour.
    const design = host.querySelector('g[data-stage="design"]');
    expect(design?.hasAttribute('data-optional')).toBe(true);
    expect(design?.hasAttribute('data-detour')).toBe(false);
    expect(text(design)).toBe('Design (optional)');
  });

  it('double-frames the gated nodes and draws each gate annotation with the shield-check glyph and its label', () => {
    const { host } = render(false);
    expect([...host.querySelectorAll('g[data-stage] rect.frame')].map((r) => r.closest('g')?.getAttribute('data-stage'))).toEqual(['build', 'done']);
    const notes = [...host.querySelectorAll('g[data-gate-note]')];
    expect(notes.map((n) => [n.getAttribute('data-gate-note'), text(n)])).toEqual([
      ['reviewed', 'gate · reviewed mark'],
      ['closed', 'gate · every claim closed'],
    ]);
    for (const note of notes) {
      expect([...note.querySelectorAll('.glyph path')].map((p) => p.getAttribute('d'))).toEqual([...SHIELD_CHECK]);
    }
  });

  it('draws every edge with its kind, a path and an arrowhead', () => {
    const { host, layout } = render(false);
    const edges = [...host.querySelectorAll('g[data-edge]')];
    expect(edges.map((e) => [e.getAttribute('data-edge'), e.getAttribute('data-kind')])).toEqual(
      layout.edges.map((e) => [`${e.from} ${e.to}`, e.kind]),
    );
    for (const edge of edges) {
      expect(edge.querySelector('path')?.getAttribute('d')).toBeTruthy();
      expect(edge.querySelector('polygon')?.getAttribute('points')).toBeTruthy();
    }
  });

  it('shows the legend only when asked, in the catalogue words', () => {
    expect(render(false).host.querySelector('[data-workflow-legend]')).toBeNull();
    TestBed.resetTestingModule();
    const legend = render(true).host.querySelector('[data-workflow-legend]');
    expect([...(legend?.querySelectorAll('li') ?? [])].map(text)).toEqual(['moving', 'waits on you', 'done', 'detour', 'optional', 'fixed gate']);
  });
});
