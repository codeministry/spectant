import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, DestroyRef, type ElementRef, inject, input, model, signal, untracked, viewChild, ViewEncapsulation } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { filter, map } from 'rxjs';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { type GraphLens, type LensNode, planningGraph, type RelationRef } from '../../../../../../core/src/relations';
import { ThemeService } from '../../../core/theme.service';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { UiDiagramToolbar } from '../../../shared/ui/doc-prose/diagram-toolbar';
import { DiagramZoom, panWithMouse, zoomDiagram } from '../../../shared/ui/doc-prose/diagram-zoom';
import { capAtNaturalWidth, MERMAID_LOADER, type MermaidApi, mermaidConfig, themeVariables } from '../../../shared/ui/doc-prose/mermaid';
import { planningCounts } from '../planning-counts';
import { laneParam, M_PARAM } from '../planning-matrix/planning-matrix';
import { GRAPH_CSS, type GraphLabels, graphSource, nodeLines, specEdgeIds } from './graph-source';

/** `?m=all`: every lane drawn, one subgraph each (the `Alle` pill). */
const ALL = 'all';
/** Mermaid 11's DOM id of a flowchart node: `<render id>-flowchart-<node id>-<counter>`. */
const NODE_DOM_ID = /flowchart-([A-Za-z0-9_]+)-\d+$/u;
/** The id inside a path's `marker-end="url(#…)"`. */
const MARKER_URL = /^url\(#([^)]+)\)$/u;
const SVG_NS = 'http://www.w3.org/2000/svg';
/** A spec node's number from its lens id (`s_009` → `009`). */
const idOf = (node: string): string => node.slice('s_'.length);

type Choice = typeof ALL | RelationRef | null;

interface Pill {
  readonly param: string;
  readonly label: string;
  readonly icon: 'layers' | 'flag' | 'circle-dashed';
  readonly count: number;
}

let nextRenderId = 0;

/**
 * The graph lens (spec 026, `/w/:ws/planning/graph`, T23, ISC-170): core's `planningGraph` of the planning model drawn
 * by the pinned mermaid as `flowchart LR`, Milestone → Feature → Spec, offline (the lazy chunk of `MERMAID_LOADER`).
 * The view picks the state only: one milestone (`?m=`, shared with the matrix, default the next due milestone) or
 * `Alle`, archived specs off by default, spec edges on, bundles folded until tapped. Every drawn node is wired back to
 * its lens node by mermaid's DOM id: a node with an object is a focusable button that selects it
 * (`DetailSelection.select`), a bundle toggles its features. The figure carries the zoom toolbar of the Docs diagrams.
 * The graph never docks the sidebar; it takes the full width and leaves scroll room while the sidebar floats over it.
 * Not encapsulated: mermaid's SVG is `innerHTML`, so every selector in the stylesheet starts at `app-planning-graph`.
 */
@Component({
  selector: 'app-planning-graph',
  imports: [RouterLink, TranslocoPipe, UiDiagramToolbar, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { 'data-lens': 'graph' },
  templateUrl: './planning-graph.html',
  styleUrl: './planning-graph.css',
})
export class PlanningGraph {
  readonly model = input.required<PlanningModel>();

  private readonly selection = inject(DetailSelection);
  private readonly state = inject(ShellState);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);
  private readonly loadMermaid = inject(MERMAID_LOADER);

  private readonly param = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.readParam()),
    ),
    { initialValue: this.readParam() },
  );
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /**
   * The filter chips (design.md § Across viewports): archived specs off, spec edges on; bundles opened by tap. The
   * archive chip is the page's toggle, shared across its lenses (two-way).
   */
  readonly archived = model(false);
  protected readonly edges = signal(true);
  protected readonly expand = signal<readonly string[]>([]);
  protected readonly status = signal<'drawing' | 'drawn' | 'failed'>('drawing');
  /** Bumped after every drawing, so the selection look is re-applied to the fresh SVG. */
  private readonly drawn = signal(0);

  protected readonly ws = computed(() => this.state.ws() ?? '');
  protected readonly hasSelection = computed(() => this.selection.selected() !== null);
  protected readonly summary = computed(() => {
    const counts = planningCounts(this.model());
    return { milestones: counts.milestones, features: counts.features, specs: counts.specs };
  });

  /** The counted state (every lane, archived drawn): its lane nodes name the pills. */
  private readonly lanes = computed(() => planningGraph(this.model()).nodes.filter((n) => n.kind === 'milestone'));

  /** The lane `?m=` names, else the next due milestone (first not complete, as the matrix), else `Alle`. */
  private readonly choice = computed<Choice>(() => {
    const lanes = this.lanes();
    const param = this.param();
    if (param === ALL || lanes.length === 0) return ALL;
    const chosen = lanes.find((n) => laneParam(n.lane) === param);
    if (chosen !== undefined) return chosen.lane;
    const next = this.model().milestones.find((m) => m.state !== 'complete');
    return lanes.find((n) => next !== undefined && n.lane === `milestone:${next.slug}`)?.lane ?? lanes[0].lane;
  });
  protected readonly active = computed(() => {
    const choice = this.choice();
    return choice === ALL ? ALL : laneParam(choice);
  });

  protected readonly pills = computed<readonly Pill[]>(() => {
    this.lang();
    const all = planningGraph(this.model()).nodes;
    const specs = (lane: RelationRef | null | typeof ALL): number => all.filter((n) => n.kind === 'spec' && (lane === ALL || n.lane === lane)).length;
    return [
      { param: ALL, label: this.transloco.translate('planning.graph.all'), icon: 'layers', count: specs(ALL) },
      ...this.lanes().map((n): Pill => ({
        param: laneParam(n.lane),
        label: n.ref === null ? this.transloco.translate('planning.tree.noMilestone') : (n.title ?? ''),
        icon: n.ref === null ? 'circle-dashed' : 'flag',
        count: specs(n.lane),
      })),
    ];
  });

  protected readonly title = computed(() => this.pills().find((p) => p.param === this.active())?.label ?? '');

  protected readonly lens = computed<GraphLens>(() => {
    const lens = planningGraph(this.model(), { milestone: this.choice(), archived: this.archived(), expand: this.expand() });
    // The `Spec-Kanten` chip off: no spec-edge arrow, and no ghost node, which stands only as the end of one.
    return this.edges() ? lens : { nodes: lens.nodes.filter((n) => n.ghost !== true), edges: lens.edges.filter((e) => e.kind !== 'spec-edge') };
  });

  private readonly labels = computed<GraphLabels>(() => {
    this.lang();
    const t = (key: string, params?: Record<string, unknown>): string => this.transloco.translate(key, params);
    const lanes = this.lanes();
    return {
      lane: (lane) => (lane === null ? t('planning.tree.noMilestone') : (lanes.find((n) => n.lane === lane)?.title ?? '')),
      noMilestone: t('planning.tree.noMilestone'),
      archived: t('planning.features.archived'),
      stage: (stage) => t(`stages.${stage}`),
      bundle: (kind, count) => t(kind === 'done' ? 'planning.graph.bundleDone' : 'planning.graph.bundleNoSpec', { count }),
    };
  });

  protected readonly source = computed(() => graphSource(this.lens(), this.labels()));

  private readonly figure = viewChild<ElementRef<HTMLElement>>('figure');
  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  /** The lens nodes of the SVG on screen, by id: what a click on a drawn node stands for. */
  private nodes = new Map<string, LensNode>();
  private run = 0;

  protected readonly zoom = new DiagramZoom((factor) => {
    const frame = this.frame()?.nativeElement;
    if (frame) zoomDiagram(frame, factor, 'width');
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.run += 1));
    afterRenderEffect({
      write: () => {
        const frame = this.frame()?.nativeElement;
        const source = this.source();
        const theme = this.theme.resolved();
        if (!frame) return;
        const lens = untracked(this.lens);
        const labels = untracked(this.labels);
        void this.draw(frame, source, theme, lens, labels);
      },
    });
    afterRenderEffect({
      write: () => {
        this.drawn();
        const selected = this.selection.selected();
        const frame = this.frame()?.nativeElement;
        if (!frame) return;
        for (const node of frame.querySelectorAll<SVGGElement>('g.node[data-node]')) {
          if (selected !== null && node.getAttribute('data-ref') === selected) node.setAttribute('data-selected', 'node');
          else node.removeAttribute('data-selected');
        }
      },
    });
  }

  protected pick(param: string): void {
    void this.router.navigate([], { queryParams: { [M_PARAM]: param }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected toggleArchived(): void {
    this.archived.update((on) => !on);
  }

  protected toggleEdges(): void {
    this.edges.update((on) => !on);
  }

  protected rebundle(): void {
    this.expand.set([]);
  }

  protected toggleFullscreen(): void {
    const figure = this.figure()?.nativeElement;
    const doc = figure?.ownerDocument;
    if (!figure || !doc) return;
    if (doc.fullscreenElement) void doc.exitFullscreen();
    else if (typeof figure.requestFullscreen === 'function') void figure.requestFullscreen();
  }

  /** A click or Enter/Space on a drawn node: a bundle opens, a node with an object selects it. */
  protected activate(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const node = this.nodes.get(target.closest('g.node')?.getAttribute('data-node') ?? '');
    if (node === undefined) return;
    if (event instanceof KeyboardEvent) event.preventDefault();
    if (node.kind === 'bundle') this.expand.update((open) => [...open, node.id]);
    else if (node.ref !== null) void this.selection.select(node.ref);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') this.activate(event);
  }

  private async draw(frame: HTMLElement, source: string, theme: 'light' | 'dark', lens: GraphLens, labels: GraphLabels): Promise<void> {
    const run = ++this.run;
    let mermaid: MermaidApi;
    try {
      mermaid = await this.loadMermaid();
      if (run !== this.run) return;
      mermaid.initialize({ ...mermaidConfig(theme, themeVariables(frame)), themeCSS: GRAPH_CSS });
      const { svg } = await mermaid.render(`planning-graph-${String(++nextRenderId)}`, source);
      if (run !== this.run) return;
      // Mermaid's own output under `securityLevel: 'strict'` (DOMPurify-cleaned, no click handlers); labels escaped.
      frame.innerHTML = svg;
    } catch {
      if (run === this.run) this.status.set('failed');
      return;
    }
    const drawn = frame.querySelector<SVGSVGElement>(':scope > svg');
    if (drawn) capAtNaturalWidth(drawn);
    this.nodes = new Map(lens.nodes.map((n) => [n.id, n]));
    for (const element of frame.querySelectorAll<SVGGElement>('g.node')) this.wire(element, labels);
    this.wireSpecEdges(frame, lens);
    panWithMouse(frame);
    this.status.set('drawn');
    this.drawn.update((n) => n + 1);
    this.zoom.refresh();
  }

  /** Ties one drawn node to its lens node: `data-node`, `data-ref`, and a button role with a label when it acts. */
  private wire(element: SVGGElement, labels: GraphLabels): void {
    const id = NODE_DOM_ID.exec(element.id)?.[1];
    const node = id === undefined ? undefined : this.nodes.get(id);
    if (node === undefined) return;
    element.setAttribute('data-node', node.id);
    if (node.ref !== null) element.setAttribute('data-ref', node.ref);
    if (node.bundle !== undefined) element.setAttribute('data-bundle', node.bundle);
    if (node.ref === null && node.kind !== 'bundle') return;
    const [first, second] = nodeLines(node, labels);
    const name = second === '' ? first : `${first}, ${second}`;
    element.setAttribute('tabindex', '0');
    element.setAttribute('role', 'button');
    element.setAttribute('aria-label', node.kind === 'bundle' ? this.transloco.translate('planning.graph.openBundle', { name }) : name);
  }

  /**
   * Gives each drawn spec-edge arrow (spec 025, ISC-170.1) its state and its name: `data-spec-edge="open|met"` (styled
   * by `GRAPH_CSS`), an arrowhead of its own colour (a copy of mermaid's end marker per state, `data-spec-edge-marker`),
   * and an accessible name read out as `009 waits on 002, Spec edge open` (`planning.graph.edgeName`), as `aria-label` and SVG `<title>`.
   */
  private wireSpecEdges(frame: HTMLElement, lens: GraphLens): void {
    const svg = frame.querySelector<SVGSVGElement>(':scope > svg');
    if (!svg) return;
    const markers = new Map<string, string>();
    for (const [id, edge] of specEdgeIds(lens)) {
      const path = svg.querySelector<SVGPathElement>(`path[data-id="${id}"]`);
      if (!path) continue;
      const state = edge.state ?? 'open';
      path.setAttribute('data-spec-edge', state);
      const legend: string = this.transloco.translate(`planning.graph.legend.${state}`);
      const name: string = this.transloco.translate('planning.graph.edgeName', {
        from: idOf(edge.from),
        to: idOf(edge.to),
        state: legend,
      });
      path.setAttribute('aria-label', name);
      path.setAttribute('role', 'img');
      const title = svg.ownerDocument.createElementNS(SVG_NS, 'title');
      title.textContent = name;
      path.replaceChildren(title);
      const end = MARKER_URL.exec(path.getAttribute('marker-end') ?? '')?.[1];
      const marker = end === undefined ? null : svg.querySelector<SVGMarkerElement>(`marker[id="${end}"]`);
      if (end === undefined || !marker) continue;
      const key = `${end}-${state}`;
      if (!markers.has(key)) {
        const copy = marker.cloneNode(true) as SVGMarkerElement;
        copy.id = `${end}-spec-edge-${state}`;
        copy.setAttribute('data-spec-edge-marker', state);
        marker.after(copy);
        markers.set(key, copy.id);
      }
      path.setAttribute('marker-end', `url(#${markers.get(key) ?? end})`);
    }
  }

  private readParam(): string | null {
    return this.router.routerState.snapshot.root.queryParamMap.get(M_PARAM);
  }
}
