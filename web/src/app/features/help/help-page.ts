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
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Workflow, WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { GLOSSARY } from '../../../../../core/src/glossary';
import { DEFAULT_WORKFLOW, defaultWorkflowRow } from '../../../../../core/src/stage';
import { ApiClient } from '../../core/api.service';
import { type ResolvedTheme, ThemeService } from '../../core/theme.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
// The Docs tabs' loader, reused as it is: one lazy `mermaid` chunk for the whole app (web/tests/docs-lazy-chunk.test.ts).
import { MERMAID_LOADER, type MermaidApi, mermaidConfig, themeVariables } from '../../shared/ui/doc-prose/mermaid';
import { type DiagramTransition, diagramDirection, transitionList, workflowDiagram } from './workflow-diagram';

/** The default table as a workflow: what the page shows without a workspace or when its workflow cannot be read. */
const DEFAULT: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };

/** Whose workflow the diagrams show, and how far it has loaded. */
type WorkflowView =
  | { readonly kind: 'none'; readonly workflow: Workflow }
  | { readonly kind: 'loading'; readonly ws: string }
  | { readonly kind: 'workspace'; readonly ws: string; readonly workflow: Workflow }
  | { readonly kind: 'unavailable'; readonly ws: string; readonly workflow: Workflow };

interface WorkflowFigure {
  readonly row: WorkflowRow;
  /** The row differs from the type's default row. */
  readonly custom: boolean;
  readonly text: string;
  readonly moves: readonly DiagramTransition[];
}

/** The line under the select: a catalogue key and its parameters. */
interface SourceLine {
  readonly key: string;
  readonly params: Readonly<Record<string, string>>;
}

/** One stretch of a definition: the catalogue writes code in backticks, shown as `<code>`. */
interface Span {
  readonly code: boolean;
  readonly text: string;
}

const sameRow = (a: WorkflowRow, b: WorkflowRow): boolean =>
  a.codeReview === b.codeReview && a.stages.length === b.stages.length && a.stages.every((stage, i) => stage === b.stages[i]);

let nextRenderId = 0;

/**
 * The global help page (spec 008, ISC-116, ISC-123), inside the shell like settings and outside any workspace. The
 * glossary is core's `GLOSSARY` with its cells from the `glossary.*` catalogue, so the active language applies. The
 * workflows are those of one workspace: `?ws=` names it (`?ws=` empty for the default table), else the workspace of
 * the last `/w/:ws` route; its planning tree carries the parsed table, and each type's row becomes one mermaid state
 * diagram drawn through the Docs tabs' lazy chunk. The diagram text is a computed signal of that workflow and the
 * tier, so a changed `specs/workflow.md` redraws on the next read.
 */
@Component({
  selector: 'app-help-page',
  imports: [TranslocoPipe, UiCard, UiChip, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-page': 'help' },
  templateUrl: './help-page.html',
  styleUrl: './help-page.css',
})
export class HelpPage {
  private readonly shell = inject(ShellState);
  protected readonly data = inject(ShellData);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly theme = inject(ThemeService);
  private readonly loadMermaid = inject(MERMAID_LOADER);

  protected readonly glossary = GLOSSARY.map((row) => ({ ...row, key: row.term.toLowerCase() }));

  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** The chosen workspace: `?ws=`, else the last `/w/:ws` route; null for the default table. */
  protected readonly selected = computed<string | null>(() => {
    const ws = this.query().get('ws');
    if (ws === null) return this.shell.lastWs();
    return ws === '' ? null : ws;
  });

  private readonly planning = resource({
    params: () => this.selected() ?? undefined,
    loader: ({ params }) => this.api.planning(params),
  });

  protected readonly view = computed<WorkflowView>(() => {
    const ws = this.selected();
    if (ws === null) return { kind: 'none', workflow: DEFAULT };
    if (this.planning.isLoading()) return { kind: 'loading', ws };
    const result = this.planning.hasValue() ? this.planning.value() : undefined;
    return result?.kind === 'ok' ? { kind: 'workspace', ws, workflow: result.body.workflow } : { kind: 'unavailable', ws, workflow: DEFAULT };
  });

  /** The line under the select: where the table came from, or why it is the default. */
  protected readonly sourceLine = computed<SourceLine | null>((): SourceLine | null => {
    const view = this.view();
    switch (view.kind) {
      case 'none':
        return { key: 'help.workflow.defaultCaption', params: {} };
      case 'loading':
        return null;
      case 'workspace':
        return { key: view.workflow.source === 'file' ? 'help.workflow.source.custom' : 'help.workflow.source.default', params: {} };
      case 'unavailable':
        return { key: 'help.workflow.unavailable', params: { ws: this.data.workspaceName(view.ws) } };
    }
  });

  protected readonly figures = computed<readonly WorkflowFigure[]>(() => {
    this.lang();
    const view = this.view();
    if (view.kind === 'loading') return [];
    const t = (key: string): string => this.transloco.translate(key);
    const labels = {
      stage: (stage: WorkflowStage) => t(`stages.${stage}`),
      gateReviewed: t('help.workflow.gateReviewed'),
      gateClosed: t('help.workflow.gateClosed'),
    };
    const direction = diagramDirection(this.shell.tier());
    return view.workflow.rows.map((row) => ({
      row,
      custom: !sameRow(row, defaultWorkflowRow(row.type)),
      text: workflowDiagram(row, direction, labels),
      moves: transitionList(row),
    }));
  });

  private readonly diagrams = viewChild<ElementRef<HTMLElement>>('diagrams');
  private renderRun = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.renderRun += 1));
    afterRenderEffect({
      write: () => {
        const host = this.diagrams()?.nativeElement;
        const figures = this.figures();
        const theme = this.theme.resolved();
        if (host) void this.draw(host, figures, theme);
      },
    });
  }

  /** The select writes `?ws=` (empty for the default table), so reload and back land on the same choice. */
  protected choose(ws: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ws }, queryParamsHandling: 'merge' });
  }

  protected spans(text: string): readonly Span[] {
    return text.split('`').flatMap((part, i) => (part === '' ? [] : [{ code: i % 2 === 1, text: part }]));
  }

  private async draw(host: HTMLElement, figures: readonly WorkflowFigure[], theme: ResolvedTheme): Promise<void> {
    if (figures.length === 0) return;
    const run = ++this.renderRun;
    let mermaid: MermaidApi;
    try {
      mermaid = await this.loadMermaid();
    } catch {
      return; // The diagram text stays visible in its `pre`: a readable fallback, never a blank figure.
    }
    if (run !== this.renderRun) return;
    mermaid.initialize(mermaidConfig(theme, themeVariables(host)));
    for (const figure of figures) {
      const element = host.querySelector<HTMLElement>(`figure[data-workflow-figure="${figure.row.type}"]`);
      const target = element?.querySelector<HTMLElement>('[data-diagram]');
      if (!element || !target) continue;
      try {
        const { svg } = await mermaid.render(`help-workflow-${figure.row.type}-${++nextRenderId}`, figure.text);
        if (run !== this.renderRun) return;
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
