import { computed, signal } from '@angular/core';

/** The zoom steps of a drawn diagram in percent (design.md § Mermaid toolbar, ISC-154.1). */
export const ZOOM_STEPS = [50, 75, 100, 125, 150, 200, 300] as const;
const HOME = ZOOM_STEPS.indexOf(100);

/**
 * The zoom level of one drawn diagram: a step of `ZOOM_STEPS`, moved one step at a time and never past either bound.
 * Every change hands the new factor (1 = 100 %) to `apply`, which sizes the SVG (`zoomDiagram`).
 */
export class DiagramZoom {
  private readonly step = signal(HOME);
  readonly percent = computed(() => ZOOM_STEPS[this.step()] ?? 100);
  readonly atMin = computed(() => this.step() === 0);
  readonly atMax = computed(() => this.step() === ZOOM_STEPS.length - 1);

  constructor(private readonly apply: (factor: number) => void) {}

  zoomIn(): void {
    this.go(this.step() + 1);
  }

  zoomOut(): void {
    this.go(this.step() - 1);
  }

  reset(): void {
    this.go(HOME);
  }

  /** Applies the current level again: after a redraw (a theme switch) or a resize of the frame. */
  refresh(): void {
    this.apply(this.percent() / 100);
  }

  private go(index: number): void {
    if (index < 0 || index >= ZOOM_STEPS.length) return;
    this.step.set(index);
    this.refresh();
  }
}

/** The width and height of an SVG's `viewBox` in user units, or null when it has none. */
function viewBoxSize(svg: SVGSVGElement): { width: number; height: number } | null {
  const parts = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number.parseFloat);
  const [, , width = Number.NaN, height = Number.NaN] = parts;
  return parts.length === 4 && width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Sizes the SVG in `frame` (`.mermaid-svg`) to `factor` times its base width. `fit: 'width'` is the figure in the
 * prose: the base is what the stylesheet draws at 100 % (scaled to the frame, or the natural width once `fitMermaid`
 * keeps it, `data-natural`), and 100 % hands the size back to the stylesheet. `fit: 'contain'` is the full screen dialog: the
 * base fits the whole diagram into the frame, at most at its natural size. The frame scrolls what no longer fits (`data-zoomed`); the page never does.
 */
export function zoomDiagram(frame: HTMLElement, factor: number, fit: 'width' | 'contain'): void {
  const svg = frame.querySelector<SVGSVGElement>(':scope > svg');
  if (!svg) return;
  const size = viewBoxSize(svg);
  const outer = frame.offsetWidth;
  if (fit === 'width' && (factor === 1 || !size || !(outer > 0))) {
    frame.removeAttribute('data-zoomed');
    svg.style.removeProperty('width');
    svg.style.removeProperty('min-width');
    svg.style.removeProperty('max-width');
    return;
  }
  if (!size || !(outer > 0)) return; // not laid out yet: the frame's resize observer applies it once it is
  let base: number;
  if (fit === 'contain') {
    // Fitted into the dialog, never upscaled past the natural size (as in the page).
    base = Math.min(frame.clientWidth, (frame.clientHeight * size.width) / size.height, size.width);
  } else {
    // The width the stylesheet draws at 100 % (scaled to the frame, or natural): measured once with the zoom lifted.
    frame.removeAttribute('data-zoomed');
    for (const property of ['width', 'min-width', 'max-width']) svg.style.removeProperty(property);
    base = svg.getBoundingClientRect().width;
    if (!(base > 0)) return;
  }
  frame.toggleAttribute('data-zoomed', factor !== 1);
  svg.style.setProperty('width', `${String(base * factor)}px`);
  svg.style.setProperty('min-width', '0');
  svg.style.setProperty('max-width', 'none');
}

/**
 * Drag to pan: a mouse drag on a zoomed frame scrolls it (touch and pen pan natively). Bound once per frame.
 */
export function panWithMouse(frame: HTMLElement): void {
  if (frame.hasAttribute('data-pan')) return;
  frame.setAttribute('data-pan', '');
  let last: { x: number; y: number } | null = null;
  frame.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !frame.hasAttribute('data-zoomed')) return;
    if (frame.scrollWidth <= frame.clientWidth && frame.scrollHeight <= frame.clientHeight) return;
    last = { x: event.clientX, y: event.clientY };
    frame.setPointerCapture(event.pointerId);
    frame.setAttribute('data-panning', '');
    event.preventDefault();
  });
  frame.addEventListener('pointermove', (event) => {
    if (!last) return;
    frame.scrollBy(last.x - event.clientX, last.y - event.clientY);
    last = { x: event.clientX, y: event.clientY };
  });
  const end = (event: PointerEvent): void => {
    if (!last) return;
    last = null;
    frame.removeAttribute('data-panning');
    if (frame.hasPointerCapture(event.pointerId)) frame.releasePointerCapture(event.pointerId);
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
}
