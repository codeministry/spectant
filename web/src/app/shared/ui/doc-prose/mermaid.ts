import { InjectionToken } from '@angular/core';
import type { ResolvedTheme } from '../../../core/theme.service';

/** The slice of the mermaid API `ui-doc-prose` uses (the Docs tabs and the idea page). */
export interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  render(id: string, source: string): Promise<{ readonly svg: string }>;
}

/**
 * Loads the pinned `mermaid` package. A dynamic `import()` on purpose: mermaid and its diagram modules are several
 * hundred kB and must stay lazy chunks, fetched only when a rendered doc shows a diagram, never in the initial bundle
 * (`web/tests/docs-lazy-chunk.test.ts`). A token so a spec can hold the import open or hand in a fake.
 */
export const MERMAID_LOADER = new InjectionToken<() => Promise<MermaidApi>>('MERMAID_LOADER', {
  providedIn: 'root',
  factory: () => () => import('mermaid').then((module) => module.default as unknown as MermaidApi),
});

/**
 * Token → mermaid theme variable. The tokens are OKLCH; mermaid's colour parser reads only hex / rgb / hsl. The
 * values follow the Help page's workflow figure (`features/help/workflow-figure.css`, ISC-154): nodes are cards
 * (`--color-base-100`, 1 px `--track`), labels `--color-base-content`, edges and arrowheads `--track`, clusters a
 * `--lane` surface with a `--line` border (the Help canvas). Mermaid writes these into its own `#id`-scoped style
 * sheet, which outranks any page rule, so the colours go in here; the radius lives in `doc-prose.css`, the label
 * weight, the edge width and the accent edge in `DIAGRAM_CSS`.
 */
const THEME_TOKENS: Readonly<Record<string, string>> = {
  background: '--color-base-100',
  mainBkg: '--color-base-100',
  primaryColor: '--color-base-100',
  primaryTextColor: '--color-base-content',
  primaryBorderColor: '--track',
  secondaryColor: '--color-base-300',
  tertiaryColor: '--lane',
  lineColor: '--track',
  arrowheadColor: '--track',
  textColor: '--color-base-content',
  nodeTextColor: '--color-base-content',
  nodeBorder: '--track',
  clusterBkg: '--lane',
  clusterBorder: '--line',
  edgeLabelBackground: '--color-base-100',
  titleColor: '--color-base-content',
};

/** The Help figure's node label size (`.node text` there: 13 px); mermaid measures its nodes with it. */
export const DIAGRAM_FONT_PX = 13;

/**
 * Resolves each token to `#rrggbb` by painting one pixel: canvas converts any CSS colour (OKLCH included) to sRGB.
 * Returns `{}` where there is no 2D canvas (a DOM emulation); mermaid then keeps its base theme.
 */
export function themeVariables(host: Element): Record<string, string> {
  const canvas = host.ownerDocument.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d', { willReadFrequently: true });
  } catch {
    context = null;
  }
  if (!context) return {};
  const style = getComputedStyle(host);
  const variables: Record<string, string> = {};
  for (const [name, token] of Object.entries(THEME_TOKENS)) {
    const value = style.getPropertyValue(token).trim();
    if (!value) continue;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
    variables[name] = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
  return variables;
}

/**
 * Appended to mermaid's own sheet, which scopes every rule under the diagram's `#id` (so it outranks a page rule, and
 * its `.node rect` fill would paint the accent like the card): the left accent edge of `accentMermaidNodes` in the
 * Help figure's role colour, plus what mermaid's theme variables cannot say: the Help figure's 600 label weight and its
 * 1.5 px edge (`.edge .line`). The rect sits in its own `g.node-accent`, so mermaid's class rules on a node's direct
 * children (`.default > *`, `!important`) land on the group, not on the edge. A `var()` here resolves against the
 * page, so it follows a theme switch like any token.
 */
export const DIAGRAM_CSS = [
  '.node .node-accent rect { fill: var(--color-primary); stroke: none; }',
  '.node .nodeLabel, .node text { font-weight: 600; }',
  '.edgePaths path, path.flowchart-link { stroke-width: 1.5px; }',
  '@media (forced-colors: active) { .node .node-accent rect { fill: CanvasText; } }',
].join(' ');

/**
 * Mermaid's configuration for one theme: strict security (no HTML labels, no click handlers), never auto-start. The
 * layout and look are named, not left to mermaid's defaults: mermaid 12 lays flowcharts out with ELK and draws them
 * in its `neo` look unless told otherwise, and the figures here are drawn and styled for dagre and the classic look
 * (the accent edge of `accentMermaidNodes`, `DIAGRAM_CSS`, the visual baselines).
 */
export function mermaidConfig(theme: ResolvedTheme, variables: Record<string, string>): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    layout: 'dagre',
    look: 'classic',
    darkMode: theme === 'dark',
    fontFamily: 'inherit',
    themeCSS: DIAGRAM_CSS,
    themeVariables: { ...variables, fontSize: `${String(DIAGRAM_FONT_PX)}px`, darkMode: theme === 'dark' },
  };
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The Help figure's role bar (`.node .bar`, `workflow-figure.ts`): 3 wide, 7 in from the left, 8 from top and bottom. */
const ACCENT = { width: 3, inset: 7, block: 8, radius: 1.5 } as const;

/** A node's outline: the first shape mermaid drew for it (a rect for the default shape, a path or polygon otherwise). */
function nodeShape(node: SVGGElement): SVGGraphicsElement | null {
  return node.querySelector<SVGGraphicsElement>(
    ':scope > :is(rect, path, polygon, circle, ellipse),'
      + ' :scope > g:not(.node-accent) > :is(rect, path, polygon, circle, ellipse)',
  );
}

/** The shape's box in the node's own units: a rect's attributes (no layout needed), else `getBBox` (0 when hidden). */
function shapeBox(shape: SVGGraphicsElement): { x: number; y: number; width: number; height: number } | null {
  const attr = (name: string): number => Number.parseFloat(shape.getAttribute(name) ?? '');
  if (shape.localName === 'rect') {
    const box = { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') };
    if (Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0) return box;
  }
  try {
    const box = shape.getBBox();
    return box.width > 0 && box.height > 0 ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
  } catch {
    return null;
  }
}

/**
 * Gives every node of a drawn flowchart the Help figure's left accent edge: one `g.node-accent > rect` per `g.node`,
 * placed over the node's outline the way `workflow-figure.ts` places its `.bar` (3 wide, 7 in from the left edge, 8 in
 * from top and bottom, radius 1.5), coloured by `doc-prose.css`. A real element instead of a stroke trick: SVG has no
 * per-side stroke, a dasharray depends on the path's start point and direction (different per shape), and a filter
 * or `box-shadow` does not paint on SVG shapes. Inserted right after the outline, so the label stays on top.
 * Idempotent: a node that already has its accent is left alone. Nodes whose box cannot be measured are skipped.
 */
export function accentMermaidNodes(svg: SVGSVGElement): void {
  for (const node of svg.querySelectorAll<SVGGElement>('g.node')) {
    if (node.querySelector(':scope > g.node-accent')) continue;
    const shape = nodeShape(node);
    const box = shape ? shapeBox(shape) : null;
    if (!shape || !box) continue;
    const height = Math.max(box.height - 2 * ACCENT.block, ACCENT.width);
    const group = svg.ownerDocument.createElementNS(SVG_NS, 'g');
    group.setAttribute('class', 'node-accent');
    group.setAttribute('aria-hidden', 'true');
    // `getBBox` is in the shape's own units, before its `transform` (a cylinder is drawn translated): the edge takes it too.
    const transform = shape.getAttribute('transform');
    if (transform) group.setAttribute('transform', transform);
    const accent = svg.ownerDocument.createElementNS(SVG_NS, 'rect');
    group.append(accent);
    accent.setAttribute('x', String(box.x + ACCENT.inset));
    accent.setAttribute('y', String(box.y + (box.height - height) / 2));
    accent.setAttribute('width', String(ACCENT.width));
    accent.setAttribute('height', String(height));
    accent.setAttribute('rx', String(ACCENT.radius));
    const anchor: Node | null = shape.parentNode === node ? shape : shape.parentNode;
    node.insertBefore(group, anchor?.nextSibling ?? null);
  }
}

/** Below this rendered label size a scaled-down diagram is no longer readable (the shared renderer's floor). */
export const MIN_DIAGRAM_LABEL_PX = 12;

/** Mermaid's label size when the SVG's computed one cannot be read (its theme default). */
const MERMAID_DEFAULT_FONT_PX = 16;

/**
 * Whether a drawn diagram keeps its natural width and scrolls sideways instead of scaling to its container: only when
 * scaling `viewBoxWidth` user units into `containerWidth` px would draw its `fontSize` labels below
 * `MIN_DIAGRAM_LABEL_PX`. No input depends on the figure's own rendered width, so applying the answer never changes the
 * next measurement (no layout loop). An unmeasured side (0, NaN) decides nothing: the figure keeps scaling.
 */
export function mermaidKeepsNaturalWidth(viewBoxWidth: number, containerWidth: number, fontSize: number): boolean {
  if (!(viewBoxWidth > 0) || !(containerWidth > 0) || !(fontSize > 0)) return false;
  if (viewBoxWidth <= containerWidth) return false;
  return (fontSize * containerWidth) / viewBoxWidth < MIN_DIAGRAM_LABEL_PX;
}

/**
 * Caps a drawn diagram at its natural width (its `viewBox` width in px), never upscaled: mermaid draws its SVG
 * `width="100%"`, and the `max-width` style its `useMaxWidth` would add does not survive into the page, so a small
 * `viewBox` was stretched to the column (a 365-unit plan figure drawn 738 px wide and 2173 px tall). The cap is a
 * custom property the stylesheet reads (`--mermaid-max-width`, doc-prose.css), so zooming (`zoomDiagram`) still
 * overrides it inline. No `viewBox`: nothing to cap, the figure keeps scaling to its container.
 */
export function capAtNaturalWidth(svg: SVGSVGElement): void {
  const natural = viewBoxWidth(svg);
  if (natural > 0) svg.style.setProperty('--mermaid-max-width', `${String(natural)}px`);
  else svg.style.removeProperty('--mermaid-max-width');
}

/** The width of an SVG's `viewBox` in user units, or 0 when it has none. */
function viewBoxWidth(svg: SVGSVGElement): number {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/);
  const width = Number.parseFloat(parts.at(2) ?? '');
  return parts.length === 4 && Number.isFinite(width) ? width : 0;
}

/**
 * Measures one drawn diagram after render (`.mermaid-svg`, the box holding mermaid's SVG: its `viewBox` width and
 * computed font size against the box's own width) and switches it between the two shapes: scaled to 100 % of the
 * container, or kept at its natural width as a labelled, focusable horizontal scroll region (`data-natural`,
 * `role="region"`, `tabindex="0"`, `aria-label`), the way tables are. Idempotent; it writes only on a change.
 */
export function fitMermaid(scroller: HTMLElement, label: string): void {
  const svg = scroller.querySelector<SVGSVGElement>(':scope > svg');
  const container = scroller.clientWidth;
  if (!svg || !(container > 0)) return; // not laid out (a hidden panel): the resize observer measures once it is
  const fontSize = Number.parseFloat(getComputedStyle(svg).fontSize) || MERMAID_DEFAULT_FONT_PX;
  const natural = viewBoxWidth(svg);
  const keep = mermaidKeepsNaturalWidth(natural, container, fontSize);
  const width = `${natural}px`;
  if (keep) {
    if (scroller.hasAttribute('data-natural') && scroller.getAttribute('aria-label') === label
      && scroller.style.getPropertyValue('--mermaid-natural-width') === width) return;
    scroller.setAttribute('data-natural', '');
    scroller.style.setProperty('--mermaid-natural-width', width);
    scroller.setAttribute('role', 'region');
    scroller.setAttribute('tabindex', '0');
    scroller.setAttribute('aria-label', label);
  } else if (scroller.hasAttribute('data-natural')) {
    scroller.removeAttribute('data-natural');
    scroller.style.removeProperty('--mermaid-natural-width');
    scroller.removeAttribute('role');
    scroller.removeAttribute('tabindex');
    scroller.removeAttribute('aria-label');
  }
}
