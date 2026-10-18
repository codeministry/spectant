import {
  afterRenderEffect,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  type ComponentRef,
  computed,
  createComponent,
  DestroyRef,
  type ElementRef,
  EnvironmentInjector,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { DocsPage, MermaidFigure } from '../../../../../../core/src/files';
import { ThemeService } from '../../../core/theme.service';
import { UiDialog } from '../overlay/dialog';
import { UiDisclosure } from '../overlay/disclosure';
import { UiDiagramToolbar } from './diagram-toolbar';
import { DiagramZoom, panWithMouse, zoomDiagram } from './diagram-zoom';
import { accentMermaidNodes, capAtNaturalWidth, fitMermaid, MERMAID_LOADER, type MermaidApi, mermaidConfig, themeVariables } from './mermaid';

let nextRenderId = 0;

/**
 * One rendered Markdown page of core's renderer (`DocsPage`), read-only: the four Docs tabs (T59, ISC-84) and the idea
 * page (T131, ISC-124.2). It shows core's sanitised HTML and the table of contents (a sticky mini nav when `wide`, a
 * disclosure above the prose otherwise), and enhances the figures in place: tables become labelled scroll regions,
 * missing images get a note, mermaid sources are drawn client-side from the lazily loaded pinned package and redrawn
 * when the theme changes. A drawn diagram scales to its container until its labels would fall below 12 px; past that
 * it keeps its natural width and scrolls sideways as a labelled region, like a table (`fitMermaid`). Each drawn diagram
 * carries the toolbar of ISC-154.1 (`ui-diagram-toolbar`, mounted into the figure): zoom in steps from 50 to 300 %,
 * the zoomed figure scrolling inside its frame, and full screen in a modal `ui-dialog` drawing the same source again.
 * With `assetUrl`, spec-folder images (`data-spec-asset`) are pointed at that URL.
 *
 * Not encapsulated: the prose is `[innerHTML]`, which Angular's emulated encapsulation cannot reach; every selector in
 * `doc-prose.css` starts with `ui-doc-prose`.
 */
@Component({
  selector: 'ui-doc-prose',
  imports: [NgTemplateOutlet, TranslocoPipe, UiDialog, UiDiagramToolbar, UiDisclosure],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './doc-prose.html',
  styleUrl: './doc-prose.css',
  host: { '[attr.data-wide]': 'wide() ? "" : null' },
})
export class UiDocProse {
  private readonly theme = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loadMermaid = inject(MERMAID_LOADER);
  private readonly appRef = inject(ApplicationRef);
  private readonly environment = inject(EnvironmentInjector);
  private readonly injector = inject(Injector);

  readonly page = input.required<DocsPage>();
  /** The wide tier: the TOC is a sticky nav beside the prose instead of a disclosure above it. */
  readonly wide = input(false);
  /** Resolves a spec-folder image path to its URL; null leaves such images without `src` (core's missing shape stays). */
  readonly assetUrl = input<((path: string) => string) | null>(null);
  /**
   * How many tables of the same document come before this prose: a document drawn as several proses (the library
   * reader's `##` sections) numbers its table regions across all of them, so no two regions share a name.
   */
  readonly tableStart = input(0);

  /**
   * Trusted on purpose, and only here: core's renderer (`core/src/markdown.ts`) escapes every text and every raw HTML
   * block and emits only its own tags and attributes, so no script or handler can reach this string. Angular's
   * sanitizer would strip the heading ids the table of contents jumps to and the `data-figure` hooks; bypassing it is
   * sound because the HTML is already sanitised at its one source, and it is never built from anything else.
   */
  protected readonly html = computed<SafeHtml>(() => this.sanitizer.bypassSecurityTrustHtml(this.page().html));
  protected readonly toc = computed(() => this.page().toc);
  private readonly mermaidFigures = computed(() =>
    this.page().figures.filter((figure): figure is MermaidFigure => figure.kind === 'mermaid'),
  );

  private readonly prose = viewChild<ElementRef<HTMLElement>>('prose');
  private renderRun = 0;
  /** Each drawn diagram box and its region name; the observer refits a box whenever its container width changes. */
  private readonly diagramLabels = new Map<Element, string>();
  private diagramResize: ResizeObserver | null = null;
  /** Each enhanced figure's toolbar and zoom; a toolbar whose figure left the DOM (a new page) is destroyed. */
  private readonly diagramTools = new Map<HTMLElement, { toolbar: ComponentRef<UiDiagramToolbar>; zoom: DiagramZoom }>();
  /** The diagram shown full screen: its title, its source, the SVG once drawn, and its own zoom (fitted at 100 %). */
  protected readonly fullscreen = signal<FullscreenDiagram | null>(null);
  private readonly fullscreenFrame = viewChild<ElementRef<HTMLElement>>('fullscreenFrame');
  private fullscreenResize: ResizeObserver | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.renderRun += 1;
      this.diagramResize?.disconnect();
      this.diagramLabels.clear();
      this.fullscreenResize?.disconnect();
      for (const { toolbar } of this.diagramTools.values()) toolbar.destroy();
      this.diagramTools.clear();
    });
    afterRenderEffect({
      write: () => {
        const frame = this.fullscreenFrame()?.nativeElement;
        const view = this.fullscreen();
        if (!frame || !view?.svg) return;
        // Mermaid's own output under `securityLevel: 'strict'`, as in the figure (drawMermaid).
        frame.innerHTML = view.svg;
        const drawn = frame.querySelector<SVGSVGElement>(':scope > svg');
        if (drawn) {
          accentMermaidNodes(drawn);
          capAtNaturalWidth(drawn);
        }
        panWithMouse(frame);
        untracked(() => view.zoom.refresh()); // the level is read, not tracked: a zoom step must not redraw
        if (typeof ResizeObserver !== 'function') return;
        this.fullscreenResize ??= new ResizeObserver(() => this.fullscreen()?.zoom.refresh());
        this.fullscreenResize.disconnect();
        this.fullscreenResize.observe(frame);
      },
    });
    afterRenderEffect({
      write: () => {
        const host = this.prose()?.nativeElement;
        const figures = this.mermaidFigures(); // tracks the page: a new page re-runs the enhancement
        const theme = this.theme.resolved();
        const assetUrl = this.assetUrl();
        const tableStart = this.tableStart();
        const tableLabel = (index: number) => this.transloco.translate('docs.tableRegion', { index: tableStart + index });
        const notes: MissingNotes = {
          missing: this.transloco.translate('docs.imageMissing'),
          unavailable: this.transloco.translate('docs.imageUnavailable'),
        };
        if (!host) return;
        if (assetUrl !== null) enhanceSpecAssets(host, assetUrl, () => enhanceMissingImages(host, notes));
        enhanceTables(host, tableLabel);
        enhanceMissingImages(host, notes);
        void this.drawMermaid(host, figures, theme);
      },
    });
  }

  /** TOC link: scroll the heading into view, move focus to it, and put its anchor in the URL (router-driven). */
  protected jump(event: Event, anchor: string): void {
    event.preventDefault();
    const heading = this.prose()?.nativeElement.querySelector<HTMLElement>(`[id="${anchor.replaceAll('"', '')}"]`);
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.scrollIntoView({ block: 'start' });
    heading.focus({ preventScroll: true });
    void this.router.navigate([], { relativeTo: this.route, fragment: anchor, queryParamsHandling: 'preserve', replaceUrl: true });
  }

  /**
   * Fits a drawn diagram to its container now (one measurement after the SVG landed) and again on every resize of its
   * box, so a tier change or a panel resize re-decides between scaling and the natural-width scroll region.
   */
  private watchDiagram(box: HTMLElement, label: string, zoom: DiagramZoom): void {
    for (const known of this.diagramLabels.keys()) {
      if (known.isConnected) continue;
      this.diagramResize?.unobserve(known);
      this.diagramLabels.delete(known);
    }
    this.diagramLabels.set(box, label);
    fitMermaid(box, label);
    zoom.refresh();
    if (typeof ResizeObserver !== 'function') return;
    this.diagramResize ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const name = this.diagramLabels.get(entry.target);
        if (name === undefined || !(entry.target instanceof HTMLElement)) continue;
        fitMermaid(entry.target, name);
        const figure = entry.target.closest('figure');
        if (figure instanceof HTMLElement) this.diagramTools.get(figure)?.zoom.refresh();
      }
    });
    this.diagramResize.observe(box);
  }

  private async drawMermaid(host: HTMLElement, figures: readonly MermaidFigure[], theme: 'light' | 'dark'): Promise<void> {
    if (figures.length === 0) return;
    const run = ++this.renderRun;
    let mermaid: MermaidApi;
    try {
      mermaid = await this.loadMermaid();
    } catch {
      return; // The source stays visible in its `pre`: a readable fallback, never a blank figure.
    }
    if (run !== this.renderRun) return;
    mermaid.initialize(mermaidConfig(theme, themeVariables(host)));
    this.releaseTools();
    for (const figure of figures) {
      const element = host.querySelector<HTMLElement>(`figure.mermaid-figure[data-figure="${figure.index}"]`);
      if (!element) continue;
      try {
        const { svg } = await mermaid.render(`docs-mermaid-${++nextRenderId}`, figure.source);
        if (run !== this.renderRun) return;
        let target = element.querySelector<HTMLElement>(':scope > .mermaid-svg');
        if (!target) {
          target = host.ownerDocument.createElement('div');
          target.className = 'mermaid-svg';
          element.insertBefore(target, element.querySelector('figcaption'));
        }
        // Mermaid's own output under `securityLevel: 'strict'` (DOMPurify-cleaned, no HTML labels, no click handlers).
        target.innerHTML = svg;
        const drawn = target.querySelector<SVGSVGElement>(':scope > svg');
        if (drawn) {
          accentMermaidNodes(drawn); // the Help figure's left accent edge (ISC-154)
          capAtNaturalWidth(drawn); // fitted to the column at 100 %, never upscaled
        }
        element.setAttribute('data-rendered', '');
        const caption = (element.querySelector('figcaption')?.textContent ?? figure.caption).trim();
        const zoom = this.mountToolbar(element, target, figure, caption);
        this.watchDiagram(target, caption === '' ? this.transloco.translate('docs.figureRegion', { index: figure.index }) : caption, zoom);
        element.removeAttribute('data-render-error');
      } catch {
        element.setAttribute('data-render-error', '');
      }
    }
  }

  /** Destroys the toolbars of figures that are gone (the page changed); the remaining ones stay. */
  private releaseTools(): void {
    for (const [figure, { toolbar }] of this.diagramTools) {
      if (figure.isConnected) continue;
      toolbar.destroy();
      this.diagramTools.delete(figure);
    }
  }

  /**
   * Mounts the toolbar as the figure's first child, once per figure (a theme redraw keeps it and its level), and
   * binds the frame's zoom and mouse pan. Returns the figure's zoom.
   */
  private mountToolbar(element: HTMLElement, frame: HTMLElement, figure: MermaidFigure, caption: string): DiagramZoom {
    panWithMouse(frame);
    const known = this.diagramTools.get(element);
    if (known) return known.zoom;
    const zoom = new DiagramZoom((factor) => {
      const box = element.querySelector<HTMLElement>(':scope > .mermaid-svg');
      if (box) zoomDiagram(box, factor, 'width');
    });
    const hostElement = element.ownerDocument.createElement('ui-diagram-toolbar');
    element.prepend(hostElement);
    const toolbar = createComponent(UiDiagramToolbar, {
      environmentInjector: this.environment,
      elementInjector: this.injector,
      hostElement,
    });
    toolbar.setInput('zoom', zoom);
    toolbar.instance.screenToggle.subscribe(() => void this.openFullscreen(figure.source, caption));
    this.appRef.attachView(toolbar.hostView);
    this.diagramTools.set(element, { toolbar, zoom });
    return zoom;
  }

  /** Full screen: the dialog opens at once, the diagram is drawn again from its source under a fresh id. */
  private async openFullscreen(source: string, caption: string): Promise<void> {
    const zoom = new DiagramZoom((factor) => {
      const frame = this.fullscreenFrame()?.nativeElement;
      if (frame) zoomDiagram(frame, factor, 'contain');
    });
    const view: FullscreenDiagram = { title: caption || this.transloco.translate('docProse.diagram.label'), svg: null, zoom };
    this.fullscreen.set(view);
    try {
      const mermaid = await this.loadMermaid();
      const { svg } = await mermaid.render(`docs-mermaid-${++nextRenderId}`, source);
      if (this.fullscreen() === view) this.fullscreen.set({ ...view, svg });
    } catch {
      // The figure in the page is still there; the dialog stays empty but closable.
    }
  }

  /** The dialog's `open` model: any dismissal (Esc, backdrop, exit button) clears the full screen diagram. */
  protected fullscreenChange(open: boolean): void {
    if (!open) this.fullscreen.set(null);
  }
}

/** The diagram shown in the full screen dialog. */
interface FullscreenDiagram {
  readonly title: string;
  readonly svg: string | null;
  readonly zoom: DiagramZoom;
}

/**
 * Core renders a spec-folder image (`.design/…`, Design tab only) without `src`, its path in `data-spec-asset`, so the
 * page never asks its own base for it; point it at the spec's evidence file route (idempotent). Should it fail to load
 * (refused since the render, or bytes the browser cannot show), the figure takes core's missing shape, flagged
 * `data-unavailable`, and `noted` adds the "could not be shown" note: never a broken image, and never "not in this
 * checkout" for a file that is there.
 */
function enhanceSpecAssets(host: HTMLElement, url: (path: string) => string, noted: () => void): void {
  host.querySelectorAll<HTMLImageElement>('img[data-spec-asset]').forEach((img) => {
    const path = img.dataset['specAsset'] ?? '';
    const src = url(path);
    if (img.getAttribute('src') === src) return;
    img.addEventListener('error', () => {
      const figure = img.closest('figure');
      if (!figure) return;
      const box = host.ownerDocument.createElement('div');
      box.className = 'figure-missing';
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', figure.querySelector('figcaption')?.textContent ?? path);
      const code = host.ownerDocument.createElement('code');
      code.textContent = path;
      box.append(code);
      img.replaceWith(box);
      figure.classList.add('missing');
      figure.setAttribute('data-missing', '');
      figure.setAttribute('data-unavailable', '');
      noted();
    }, { once: true });
    img.setAttribute('src', src);
  });
}

/** Core wraps each table in `div.mdtable`; make it a focusable, labelled horizontal scroll region (idempotent). */
function enhanceTables(host: HTMLElement, label: (index: number) => string): void {
  host.querySelectorAll<HTMLElement>('div.mdtable').forEach((region, index) => {
    region.setAttribute('role', 'region');
    region.setAttribute('tabindex', '0');
    region.setAttribute('aria-label', label(index + 1));
  });
}

/** The notes of a missing figure: core found no file at render, or the image failed to load (`data-unavailable`). */
interface MissingNotes {
  readonly missing: string;
  readonly unavailable: string;
}

/** Core marks an image absent from the checkout with `div.figure-missing`; add the muted note once. */
function enhanceMissingImages(host: HTMLElement, notes: MissingNotes): void {
  host.querySelectorAll<HTMLElement>('figure[data-missing] .figure-missing').forEach((box) => {
    let note = box.querySelector<HTMLElement>(':scope > .figure-missing-note');
    if (!note) {
      note = host.ownerDocument.createElement('span');
      note.className = 'figure-missing-note';
      box.prepend(note);
    }
    note.textContent = box.closest('figure')?.hasAttribute('data-unavailable') ? notes.unavailable : notes.missing;
  });
}
