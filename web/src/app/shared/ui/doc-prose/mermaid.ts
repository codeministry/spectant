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

/** Token → mermaid theme variable. The tokens are OKLCH; mermaid's colour parser reads only hex / rgb / hsl. */
const THEME_TOKENS: Readonly<Record<string, string>> = {
  background: '--color-base-100',
  mainBkg: '--color-base-200',
  primaryColor: '--color-base-200',
  primaryTextColor: '--color-base-content',
  primaryBorderColor: '--line',
  secondaryColor: '--color-base-300',
  tertiaryColor: '--color-base-100',
  lineColor: '--muted-ink',
  textColor: '--color-base-content',
  nodeBorder: '--line',
  clusterBkg: '--color-base-100',
  clusterBorder: '--line',
  edgeLabelBackground: '--color-base-100',
  titleColor: '--color-base-content',
};

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

/** Mermaid's configuration for one theme: strict security (no HTML labels, no click handlers), never auto-start. */
export function mermaidConfig(theme: ResolvedTheme, variables: Record<string, string>): Record<string, unknown> {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    darkMode: theme === 'dark',
    fontFamily: 'inherit',
    themeVariables: { ...variables, darkMode: theme === 'dark' },
  };
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
