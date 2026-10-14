import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { TranslocoTestingModule } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { type GraphLens, planningGraph, type RelationRef } from '../../../../../../core/src/relations';
import emptyMaster from '../../../../../../core/fixtures/empty-master.planning.golden.json';
import harbor from '../../../../../../core/fixtures/harbor.planning.golden.json';
import lantern from '../../../../../../core/fixtures/lantern.planning.golden.json';
import milestoneLines from '../../../../../../core/fixtures/milestone-lines.planning.golden.json';
import { ThemeService } from '../../../core/theme.service';
import { CATALOGUES, LANGS } from '../../../../i18n/catalogues';
import en from '../../../../i18n/en.json';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { MERMAID_LOADER, type MermaidApi } from '../../../shared/ui/doc-prose/mermaid';
import { graphSource, type GraphLabels } from './graph-source';
import { PlanningGraph } from './planning-graph';

// T23 · ISC-170: the graph lens draws Milestone → Feature → Spec with the pinned mermaid, offline. The counted state is
// core's default (`Alle`, archived drawn, bundles collapsed); its node and edge numbers are the golden's own, and the
// mermaid text the view generates defines exactly those nodes and links. jsdom has no layout, so mermaid itself cannot
// draw here: the count is taken on the generated mermaid text, and a fake renderer (one `g.node` per defined node, the
// DOM id mermaid 11 gives it) proves the view wires every drawn node to its object. Probe:
// `bun run --cwd web test -- --filter "planning-graph"`.

const FIXTURES = {
  'empty-master': emptyMaster,
  harbor,
  lantern,
  'milestone-lines': milestoneLines,
} as unknown as Record<string, PlanningModel>;

/** The counted state of ISC-170 per golden (nodes / edges), as plan.md names it. */
const COUNTED: Record<string, readonly [number, number]> = {
  harbor: [19, 16],
  'milestone-lines': [9, 6],
  lantern: [4, 2],
  'empty-master': [1, 0],
};

const LABELS: GraphLabels = {
  noMilestone: 'No milestone',
  archived: 'Archived',
  stage: (stage) => stage,
  bundle: (kind, count) => `${String(count)} ${kind}`,
};

const NODE_LINE = /^\s*([A-Za-z0-9_]+)(?:\(\[|\[|\()"/u;
const LINK_LINE = /^\s*([A-Za-z0-9_]+) (?:---|-\.->|-->) ([A-Za-z0-9_]+)\s*$/u;

/** The node ids the mermaid text defines, in order, and its links as `from>to`. */
function parse(source: string): { nodes: string[]; links: string[] } {
  const nodes: string[] = [];
  const links: string[] = [];
  for (const line of source.split('\n')) {
    const node = NODE_LINE.exec(line);
    if (node) nodes.push(node[1]);
    const link = LINK_LINE.exec(line);
    if (link) links.push(`${link[1]}>${link[2]}`);
  }
  return { nodes, links };
}

class FakeMermaid implements MermaidApi {
  readonly sources: string[] = [];
  initialize(): void {
    /* nothing to configure in a fake */
  }
  render(id: string, source: string): Promise<{ svg: string }> {
    this.sources.push(source);
    const nodes = parse(source).nodes.map((n, i) => `<g class="node" id="${id}-flowchart-${n}-${String(i)}"><rect width="10" height="10"></rect></g>`);
    return Promise.resolve({ svg: `<svg data-icon-exempt id="${id}" viewBox="0 0 100 100">${nodes.join('')}</svg>` });
  }
}

class FakeSelection {
  readonly current = signal<RelationRef | null>(null);
  readonly selected = this.current.asReadonly();
  readonly picks: RelationRef[] = [];
  dock(): void {
    throw new Error('the graph never docks the sidebar');
  }
  select(ref: RelationRef): Promise<boolean> {
    this.picks.push(ref);
    this.current.set(ref);
    return Promise.resolve(true);
  }
}

@Component({ imports: [PlanningGraph], template: `<app-planning-graph [model]="model()" />` })
class Host {
  readonly model = signal<PlanningModel>(harbor as unknown as PlanningModel);
}

interface Rendered {
  el: HTMLElement;
  mermaid: FakeMermaid;
  selection: FakeSelection;
  router: Router;
  settle: () => Promise<void>;
}

async function render(model: PlanningModel, url = '/w/harbor/planning/graph'): Promise<Rendered> {
  const selection = new FakeSelection();
  const mermaid = new FakeMermaid();
  TestBed.configureTestingModule({
    imports: [
      TranslocoTestingModule.forRoot({
        langs: CATALOGUES,
        translocoConfig: { availableLangs: [...LANGS], defaultLang: 'en' },
        preloadLangs: true,
      }),
    ],
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: DetailSelection, useValue: selection },
      { provide: ShellState, useValue: { tier: signal('wide'), ws: signal('harbor') } },
      { provide: ThemeService, useValue: { resolved: signal('light') } },
      { provide: MERMAID_LOADER, useValue: () => Promise.resolve(mermaid) },
    ],
  });
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.model.set(model);
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  await settle();
  return { el: fixture.nativeElement as HTMLElement, mermaid, selection, router, settle };
}

const drawn = (el: HTMLElement): SVGGElement[] => [...el.querySelectorAll<SVGGElement>('[data-graph-frame] g.node')];
const nextDue = (model: PlanningModel): RelationRef | 'all' => {
  const next = model.milestones.find((m) => m.state !== 'complete');
  return next === undefined ? 'all' : (`milestone:${next.slug}` as RelationRef);
};

describe('planning-graph', () => {
  for (const [name, model] of Object.entries(FIXTURES)) {
    it(`${name}: the counted state equals the golden, and the mermaid text defines exactly those nodes and links`, () => {
      const lens: GraphLens = planningGraph(model);
      expect([lens.nodes.length, lens.edges.length]).toEqual(COUNTED[name]);
      const { nodes, links } = parse(graphSource(lens, LABELS));
      expect(nodes).toEqual(lens.nodes.map((n) => n.id));
      expect(links).toEqual(lens.edges.map((e) => `${e.from}>${e.to}`));
    });

    it(`${name}: drawn at ?m=all with archived specs on, every node of the golden is a focusable button naming its object`, async () => {
      const r = await render(model, '/w/harbor/planning/graph?m=all');
      const archived = r.el.querySelector<HTMLButtonElement>('[data-filter="archived"]');
      expect(archived?.getAttribute('aria-pressed')).toBe('false');
      archived?.click();
      await r.settle();
      expect(archived?.getAttribute('aria-pressed')).toBe('true');
      const lens = planningGraph(model);
      const nodes = drawn(r.el);
      expect(nodes.length).toBe(lens.nodes.length);
      expect(nodes.map((n) => n.getAttribute('data-node'))).toEqual(lens.nodes.map((n) => n.id));
      nodes.forEach((node, i) => {
        const want = lens.nodes[i];
        expect(node.getAttribute('data-ref')).toBe(want.ref);
        expect(node.getAttribute('tabindex')).toBe(want.ref === null && want.kind !== 'bundle' ? null : '0');
        if (want.ref !== null || want.kind === 'bundle') {
          expect(node.getAttribute('role')).toBe('button');
          expect(node.getAttribute('aria-label') ?? '').not.toBe('');
        }
      });
      expect(r.mermaid.sources.at(-1)?.startsWith('flowchart LR')).toBe(true);
    });
  }

  it('defaults to the next due milestone with archived specs hidden, and draws what core derives for that state', async () => {
    const model = harbor as unknown as PlanningModel;
    const r = await render(model);
    const milestone = nextDue(model);
    const lens = planningGraph(model, { milestone, archived: false });
    expect(drawn(r.el).map((n) => n.getAttribute('data-node'))).toEqual(lens.nodes.map((n) => n.id));
    const pressed = r.el.querySelector('[data-m][aria-pressed="true"]');
    expect(pressed?.getAttribute('data-m')).toBe(milestone === 'all' ? 'all' : milestone.slice('milestone:'.length));
    expect(r.el.querySelector('[data-filter="edges"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('a node click and Enter select its object; the selected node carries the selection look; the graph never docks', async () => {
    const r = await render(harbor as unknown as PlanningModel, '/w/harbor/planning/graph?m=all&sel=x');
    const spec = drawn(r.el).find((n) => n.getAttribute('data-ref')?.startsWith('spec:'));
    const feature = drawn(r.el).find((n) => n.getAttribute('data-ref')?.startsWith('feature:'));
    expect(spec).toBeDefined();
    spec?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await r.settle();
    expect(r.selection.picks).toEqual([spec?.getAttribute('data-ref')]);
    expect(drawn(r.el).find((n) => n.getAttribute('data-ref') === spec?.getAttribute('data-ref'))?.getAttribute('data-selected')).toBe('node');
    expect(r.el.querySelector('[data-graph]')?.hasAttribute('data-has-selection')).toBe(true);
    feature?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await r.settle();
    expect(r.selection.picks.at(-1)).toBe(feature?.getAttribute('data-ref'));
  });

  it('a bundle click draws its features in place of the bundle, and "Bundle again" folds them', async () => {
    const model = harbor as unknown as PlanningModel;
    const r = await render(model, '/w/harbor/planning/graph?m=all');
    const bundle = drawn(r.el).find((n) => n.hasAttribute('data-bundle'));
    expect(bundle).toBeDefined();
    const id = bundle?.getAttribute('data-node') ?? '';
    bundle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await r.settle();
    const open = planningGraph(model, { archived: false, expand: [id] });
    expect(drawn(r.el).map((n) => n.getAttribute('data-node'))).toEqual(open.nodes.map((n) => n.id));
    expect(r.selection.picks).toEqual([]);
    r.el.querySelector<HTMLButtonElement>('[data-rebundle]')?.click();
    await r.settle();
    expect(drawn(r.el).some((n) => n.getAttribute('data-node') === id)).toBe(true);
  });

  it('the pills write ?m=, the legend names the four line kinds, and "Read as a tree" keeps ?sel=', async () => {
    const r = await render(harbor as unknown as PlanningModel, '/w/harbor/planning/graph?sel=spec%3A001');
    r.el.querySelector<HTMLButtonElement>('[data-m="all"]')?.click();
    await r.settle();
    expect(r.router.routerState.snapshot.root.queryParamMap.get('m')).toBe('all');
    const legend = r.el.querySelector('[data-graph-legend]')?.textContent ?? '';
    for (const key of ['contains', 'open', 'met', 'bundle'] as const) expect(legend).toContain(en.planning.graph.legend[key]);
    const tree = r.el.querySelector<HTMLAnchorElement>('a[data-as-tree]');
    expect(tree?.getAttribute('href')).toContain('/w/harbor/planning/tree');
    expect(tree?.getAttribute('href')).toContain('sel=spec');
    expect(r.el.querySelector('[data-graph] ui-diagram-toolbar')).not.toBeNull();
  });
});
