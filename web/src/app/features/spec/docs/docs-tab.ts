import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  type ElementRef,
  inject,
  resource,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { DocName, DocsPage, MermaidFigure } from '../../../../../../core/src/files';
import { ApiClient, type DocsResult } from '../../../core/api.service';
import { ThemeService } from '../../../core/theme.service';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { type Tone, UiChip, UiCommandChip, UiDisclosure, UiEmptyState, UiNotice, UiSkeleton } from '../../../shared/ui';
import { MERMAID_LOADER, type MermaidApi, mermaidConfig, themeVariables } from './mermaid';

/** The file behind each Docs tab, as the empty state names it. */
export const DOC_FILE_NAMES: Readonly<Record<DocName, string>> = {
  plan: 'plan.md',
  design: 'design.md',
  decisions: 'context.md',
  constitution: 'constitution.md',
};

const DOC_NAMES = new Set<string>(Object.keys(DOC_FILE_NAMES));
const STATUS_TONE: Readonly<Record<string, Tone>> = { approved: 'success', draft: 'warning', superseded: 'neutral' };

let nextRenderId = 0;

/**
 * One view for the four Docs tabs (T59, ISC-84): `plan`, `design`, `decisions` (the spec's `context.md`) and
 * `constitution`, picked by the route's `tab` data. It renders core's sanitised HTML, a frontmatter meta row, the
 * table of contents (a sticky mini nav at wide, a disclosure above the prose below), and enhances the figures in
 * place: tables become labelled scroll regions, missing images get a note, mermaid sources are drawn client-side from
 * the lazily loaded pinned package and redrawn when the theme changes. A doc the spec lacks answers `DocMissing`,
 * shown as a type-aware empty state.
 *
 * Not encapsulated: the prose is `[innerHTML]`, which Angular's emulated encapsulation cannot reach; every selector in
 * `docs-tab.css` starts with `app-docs-tab`.
 */
@Component({
  selector: 'app-docs-tab',
  imports: [NgTemplateOutlet, TranslocoPipe, UiChip, UiCommandChip, UiDisclosure, UiEmptyState, UiNotice, UiSkeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  templateUrl: './docs-tab.html',
  styleUrl: './docs-tab.css',
  host: { 'data-page': 'docs', '[attr.data-doc]': 'name', '[attr.data-tier]': 'state.tier()' },
})
export class DocsTab {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly api = inject(ApiClient);
  private readonly theme = inject(ThemeService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly loadMermaid = inject(MERMAID_LOADER);

  /** The tab id from the route data; the four Docs tab ids are exactly the four `DocName`s. */
  protected readonly name: DocName = docName(this.route.snapshot.data['tab']);
  protected readonly fileName = DOC_FILE_NAMES[this.name];

  protected readonly result = resource<DocsResult, { ws: string; id: string } | undefined>({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.docs(params.ws, params.id, this.name),
  });

  protected readonly page = computed<DocsPage | null>(() => {
    const value = this.result.value();
    return value?.kind === 'ok' ? value.body : null;
  });
  protected readonly missing = computed(() => {
    const value = this.result.value();
    return value?.kind === 'doc-missing' ? value.body : null;
  });
  protected readonly failed = computed(() => {
    const kind = this.result.value()?.kind;
    return this.result.error() !== undefined || kind === 'error' || kind === 'not-found' || kind === 'unavailable';
  });

  /**
   * Trusted on purpose, and only here: core's renderer (`core/src/markdown.ts`) escapes every text and every raw HTML
   * block and emits only its own tags and attributes, so no script or handler can reach this string. Angular's
   * sanitizer would strip the heading ids the table of contents jumps to and the `data-figure` hooks; bypassing it is
   * sound because the HTML is already sanitised at its one source, and it is never built from anything else.
   */
  protected readonly html = computed<SafeHtml | null>(() => {
    const page = this.page();
    return page === null ? null : this.sanitizer.bypassSecurityTrustHtml(page.html);
  });

  protected readonly toc = computed(() => this.page()?.toc ?? []);
  protected readonly mermaidFigures = computed(
    () => this.page()?.figures.filter((figure): figure is MermaidFigure => figure.kind === 'mermaid') ?? [],
  );
  protected readonly diagramMissing = computed(
    () => this.name === 'plan' && this.page() !== null && this.mermaidFigures().length === 0,
  );

  /** Frontmatter as chips: every key on the constitution, `status` (toned) elsewhere; `updated` is its own line. */
  protected readonly metaChips = computed<ReadonlyArray<{ label: string; tone: Tone }>>(() => {
    const front = this.page()?.frontmatter ?? null;
    if (front === null) return [];
    if (this.name === 'constitution') {
      return Object.entries(front).map(([key, value]) => ({ label: `${key}: ${value}`, tone: 'neutral' }));
    }
    const status = front['status'];
    return status ? [{ label: status, tone: STATUS_TONE[status] ?? 'neutral' }] : [];
  });
  protected readonly updated = computed(() => (this.name === 'constitution' ? null : (this.page()?.frontmatter?.['updated'] ?? null)));

  /** The empty state's heading key and params, from `DocMissing.availability` and the dashboard row's type. */
  protected readonly empty = computed(() => {
    const missing = this.missing();
    if (missing === null) return null;
    const type = this.data.currentRow()?.type ?? null;
    const file = this.fileName;
    if (!missing.availability.applies) {
      return { key: type === null ? 'docs.empty.noType' : 'docs.empty.notApplicable', params: { type, file }, command: null, bodyKey: 'docs.empty.notApplicableBody' };
    }
    const base = missing.availability.command;
    const command = base === null ? null : this.name === 'constitution' ? base : `${base} ${this.state.specId() ?? ''}`.trim();
    return { key: 'docs.empty.missing', params: { type, file }, command, bodyKey: command ? 'docs.empty.missingBody' : 'docs.empty.missingNoCommand' };
  });

  private readonly prose = viewChild<ElementRef<HTMLElement>>('prose');
  private renderRun = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.renderRun += 1));
    afterRenderEffect({
      write: () => {
        const host = this.prose()?.nativeElement;
        const page = this.page();
        const theme = this.theme.resolved();
        const tableLabel = (index: number) => this.transloco.translate('docs.tableRegion', { index });
        const imageMissing = this.transloco.translate('docs.imageMissing');
        if (!host || page === null) return;
        enhanceTables(host, tableLabel);
        enhanceMissingImages(host, imageMissing);
        void this.drawMermaid(host, this.mermaidFigures(), theme);
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
        element.setAttribute('data-rendered', '');
        element.removeAttribute('data-render-error');
      } catch {
        element.setAttribute('data-render-error', '');
      }
    }
  }
}

function docName(value: unknown): DocName {
  return typeof value === 'string' && DOC_NAMES.has(value) ? (value as DocName) : 'plan';
}

/** Core wraps each table in `div.mdtable`; make it a focusable, labelled horizontal scroll region (idempotent). */
function enhanceTables(host: HTMLElement, label: (index: number) => string): void {
  host.querySelectorAll<HTMLElement>('div.mdtable').forEach((region, index) => {
    region.setAttribute('role', 'region');
    region.setAttribute('tabindex', '0');
    region.setAttribute('aria-label', label(index + 1));
  });
}

/** Core marks an image absent from the checkout with `div.figure-missing`; add the muted note once. */
function enhanceMissingImages(host: HTMLElement, text: string): void {
  host.querySelectorAll<HTMLElement>('figure[data-missing] .figure-missing').forEach((box) => {
    let note = box.querySelector<HTMLElement>(':scope > .figure-missing-note');
    if (!note) {
      note = host.ownerDocument.createElement('span');
      note.className = 'figure-missing-note';
      box.prepend(note);
    }
    note.textContent = text;
  });
}
