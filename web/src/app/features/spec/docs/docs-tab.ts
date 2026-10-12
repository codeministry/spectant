import { ChangeDetectionStrategy, Component, computed, inject, resource, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DocName, DocsPage } from '../../../../../../core/src/files';
import { specRoutes } from '../../../../../../server/src/spec-routes.contract';
import { ApiClient, type DocsResult } from '../../../core/api.service';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { type Tone, UiChip, UiCommandChip, UiDocProse, UiEmptyState, UiNotice, UiSkeleton } from '../../../shared/ui';

/** The file behind each Docs tab, as the empty state names it. */
export const DOC_FILE_NAMES: Readonly<Record<DocName, string>> = {
  plan: 'plan.md',
  design: 'design.md',
  decisions: 'context.md',
  constitution: 'constitution.md',
};

const DOC_NAMES = new Set<string>(Object.keys(DOC_FILE_NAMES));
const STATUS_TONE: Readonly<Record<string, Tone>> = { approved: 'success', draft: 'warning', superseded: 'neutral' };

/**
 * One view for the four Docs tabs (T59, ISC-84): `plan`, `design`, `decisions` (the spec's `context.md`) and
 * `constitution`, picked by the route's `tab` data. It shows a frontmatter meta row and hands the page to the shared
 * renderer `ui-doc-prose` (core's sanitised HTML, the table of contents, the figure enhancements), pointing spec-folder
 * images at the spec's evidence file route. A doc the spec lacks answers `DocMissing`, shown as a type-aware empty
 * state.
 *
 * Not encapsulated, like the renderer it hosts; every selector in `docs-tab.css` starts with `app-docs-tab`.
 */
@Component({
  selector: 'app-docs-tab',
  imports: [TranslocoPipe, UiChip, UiCommandChip, UiDocProse, UiEmptyState, UiNotice, UiSkeleton],
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
  private readonly route = inject(ActivatedRoute);

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
   * The spec's evidence file route for spec-folder images, only once this spec's page has loaded: while the route
   * moves on, the old HTML keeps its own spec's URLs.
   */
  protected readonly assetUrl = computed<((path: string) => string) | null>(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    if (this.result.status() !== 'resolved' || ws === null || id === null) return null;
    return (path) => specRoutes.evidenceFile(ws, id, path);
  });

  protected readonly diagramMissing = computed(() => {
    const page = this.page();
    return this.name === 'plan' && page !== null && !page.figures.some((figure) => figure.kind === 'mermaid');
  });

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
}

function docName(value: unknown): DocName {
  return typeof value === 'string' && DOC_NAMES.has(value) ? (value as DocName) : 'plan';
}
