import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, resource } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { catchError, map, of, switchMap } from 'rxjs';
import type { SpecType, Workflow, WorkflowRow, WorkflowStage } from '../../../../../core/src/files';
import { GLOSSARY } from '../../../../../core/src/glossary';
import { DEFAULT_WORKFLOW, defaultWorkflowRow } from '../../../../../core/src/stage';
import { ApiClient } from '../../core/api.service';
import { keyLabel } from '../../core/keyboard-bindings';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ShellState } from '../../layout/shell/shell-state.service';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { HelpNav } from './help-nav';
import { HELP_COMMANDS, HELP_SECTIONS, HELP_TYPES, KEY_CONTEXTS, LEGEND, STAGE_CHAIN, START_STEPS } from './help-sections';
import { type DiagramLabels, type DiagramTransition, transitionList, type WorkflowLayout, workflowLayout } from './workflow-diagram';
import { WorkflowFigure } from './workflow-figure';

/** The default table as a workflow: what the page shows without a workspace or when its workflow cannot be read. */
const DEFAULT: Workflow = { rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] };

/** Whose workflow the diagrams show, and how far it has loaded. */
type WorkflowView =
  | { readonly kind: 'none'; readonly workflow: Workflow }
  | { readonly kind: 'loading'; readonly ws: string }
  | { readonly kind: 'workspace'; readonly ws: string; readonly workflow: Workflow }
  | { readonly kind: 'unavailable'; readonly ws: string; readonly workflow: Workflow };

interface HelpFigure {
  readonly row: WorkflowRow;
  /** The row differs from the type's default row. */
  readonly custom: boolean;
  /** What `app-workflow-figure` draws, its words from the loaded catalogue. */
  readonly layout: WorkflowLayout;
  /** The figure's accessible name: the type, its stages in order, the detours and the fixed gates. */
  readonly label: string;
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

/**
 * The global help page (spec 008, ISC-116, ISC-123), inside the shell like settings and outside any workspace. The
 * glossary is core's `GLOSSARY` with its cells from the `glossary.*` catalogue, so the active language applies. The
 * workflows are those of one workspace: `?ws=` names it (`?ws=` empty for the default table), else the workspace of
 * the last `/w/:ws` route; its planning tree carries the parsed table, and each type's row becomes one layout model
 * (`workflowLayout`) that `app-workflow-figure` draws as an inline SVG, left to right at every tier. The models are a
 * computed signal of that workflow and of the loaded catalogue, so a changed `specs/workflow.md` redraws on the next
 * read and a language switch redraws once the new catalogue has arrived (T161).
 */
@Component({
  selector: 'app-help-page',
  imports: [HelpNav, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiIcon, UiKbd, UiTypeGlyph, WorkflowFigure],
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

  protected readonly glossary = GLOSSARY.map((row) => ({ ...row, key: row.term.toLowerCase() }));

  // The sections around the workflows and the glossary (T162, ISC-133.1): data from core and the one shortcut table.
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly sections = HELP_SECTIONS;
  protected readonly chain = STAGE_CHAIN;
  protected readonly types = HELP_TYPES;
  protected readonly legend = LEGEND;
  protected readonly commands = HELP_COMMANDS;
  protected readonly steps = START_STEPS;
  protected readonly keyContexts = KEY_CONTEXTS;
  protected readonly keyLabel = keyLabel;

  /**
   * The active language once its catalogue has loaded; undefined until the first one has. `translate()` answers a key
   * with the key itself while its catalogue is still on the way (the cold first load), so the figures translate only
   * against a language this signal names: they never show a key, and they redraw when a switched-to catalogue lands.
   * A catalogue that fails to load still names its language, and the configured fallback answers.
   */
  private readonly loadedLang = toSignal(
    this.transloco.langChanges$.pipe(
      switchMap((lang) =>
        this.transloco.load(lang).pipe(
          map(() => lang),
          catchError(() => of(lang)),
        ),
      ),
    ),
  );
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

  protected readonly figures = computed<readonly HelpFigure[]>(() => {
    const lang = this.loadedLang();
    const view = this.view();
    if (lang === undefined || view.kind === 'loading') return [];
    const t = (key: string, params?: Readonly<Record<string, string>>): string => this.transloco.translate(key, params, lang);
    const labels: DiagramLabels = {
      stage: (stage: WorkflowStage) => t(`stages.${stage}`),
      gateReviewed: t('help.workflow.gateReviewed'),
      gateClosed: t('help.workflow.gateClosed'),
    };
    return view.workflow.rows.map((row) => {
      const layout = workflowLayout(row, labels);
      return { row, custom: !sameRow(row, defaultWorkflowRow(row.type)), layout, label: figureLabel(row, layout, t), moves: transitionList(row) };
    });
  });

  /** The select writes `?ws=` (empty for the default table), so reload and back land on the same choice. */
  protected choose(ws: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ws }, queryParamsHandling: 'merge' });
  }

  /** A type chip of "How a spec moves": scrolls to that type's figure and focuses it, as a section jump does. */
  protected showFigure(type: SpecType): void {
    const figure = this.host.nativeElement.querySelector<HTMLElement>(`figure[data-workflow-figure="${type}"]`);
    if (!figure) return;
    if (!figure.hasAttribute('tabindex')) figure.setAttribute('tabindex', '-1');
    figure.scrollIntoView({ block: 'start' });
    figure.focus({ preventScroll: true });
  }

  protected spans(text: string): readonly Span[] {
    return text.split('`').flatMap((part, i) => (part === '' ? [] : [{ code: i % 2 === 1, text: part }]));
  }
}

/** A figure's accessible name: its type and stages in order, then the detours and the fixed gates it draws. */
function figureLabel(row: WorkflowRow, layout: WorkflowLayout, t: (key: string, params?: Readonly<Record<string, string>>) => string): string {
  const main = layout.nodes.filter((n) => !n.detour);
  const detours = layout.nodes.filter((n) => n.detour);
  const gates = layout.gates.map((g) => t('help.workflow.diagramGate', { stage: main.find((n) => n.stage === g.stage)?.label ?? g.stage, gate: g.label }));
  return [
    t('help.workflow.diagram', { type: row.type, stages: main.map((n) => n.label).join(', ') }),
    ...(detours.length === 0 ? [] : [t('help.workflow.diagramDetours', { detours: detours.map((n) => n.label).join(', ') })]),
    ...(gates.length === 0 ? [] : [t('help.workflow.diagramGates', { gates: gates.join(', ') })]),
  ].join(' ');
}
