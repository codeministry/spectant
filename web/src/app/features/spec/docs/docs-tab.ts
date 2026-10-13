import { ChangeDetectionStrategy, Component, computed, inject, resource, signal, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ConstitutionView, DecisionLog, DocName, DocsPage } from '../../../../../../core/src/files';
import { specRoutes } from '../../../../../../server/src/spec-routes.contract';
import { ApiClient, type DocsResult } from '../../../core/api.service';
import { ShellData } from '../../../layout/shell/shell-data.service';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { UiIcon } from '../../../shared/icons/icon';
import { type Tone, UiCard, UiChip, UiCommandChip, UiDialog, UiDisclosure, UiDocProse, UiEmptyState, UiNotice, UiSkeleton } from '../../../shared/ui';
import { quoteIdea } from '../dashboard/dashboard-model';
import { type DesignShot, type DesignViewport, designViewports } from './design-viewports';

/** The file behind each Docs tab, as the empty state names it. */
export const DOC_FILE_NAMES: Readonly<Record<DocName, string>> = {
  plan: 'plan.md',
  design: 'design.md',
  decisions: 'context.md',
  constitution: 'constitution.md',
};

/** The design.md frontmatter keys shown as plain chips on the Design tab. */
const DESIGN_KEYS = ['design_track', 'viewports'] as const;
const DOC_NAMES = new Set<string>(Object.keys(DOC_FILE_NAMES));
const STATUS_TONE: Readonly<Record<string, Tone>> = { approved: 'success', draft: 'warning', superseded: 'neutral' };
/** The prototype's `chipIcon` for a plan status: `status: approved` carries `check-circle` (CHIP_ICON.approved). */
const STATUS_ICON: Readonly<Record<string, 'circle-check'>> = { approved: 'circle-check' };
/** A `Landed in` part that names a spec file opens that file's tab, as the prototype's `file-chip` links do. */
const FILE_TABS: Readonly<Record<string, string>> = { 'spec.md': 'status', 'plan.md': 'plan', 'design.md': 'design', 'tasks.md': 'tasks', 'context.md': 'decisions' };

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
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiDialog, UiDisclosure, UiDocProse, UiEmptyState, UiIcon, UiNotice, UiSkeleton],
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
  private readonly transloco = inject(TranslocoService);

  /** The tab id from the route data; the four Docs tab ids are exactly the four `DocName`s. */
  protected readonly name: DocName = docName(this.route.snapshot.data['tab']);
  protected readonly fileName = DOC_FILE_NAMES[this.name];

  /**
   * Decisions only (spec 024, the prototype's `goal-card` and `fog-list`): the goal card quotes the spec's idea
   * (`ideaQuote`, as the dashboard does) above context.md, and "Still open" lists the spec's fog (core's `FogView`
   * from the Claims route) with the `cloud` icon below it. Both read core's models; nothing is parsed here.
   */
  protected readonly goal = computed<{ quote: string; source: 'task' | 'spec' | 'context'; locked: string | null } | null>(() => {
    if (this.name !== 'decisions') return null;
    // context.md's goal lock first (prototype `goal-card`: the locked goal sentence and its time), else the idea.
    const lock = this.log()?.goal ?? null;
    if (lock !== null) return { quote: lock.text, source: 'context', locked: lock.confirmed.slice(0, 10) };
    const spec = this.data.spec.value();
    if (spec?.kind !== 'ok' || !spec.body.ideaQuote) return null;
    return { quote: quoteIdea(spec.body.ideaQuote, this.transloco.getActiveLang()), source: spec.body.ideaSource === 'task' ? 'task' : 'spec', locked: null };
  });

  /**
   * Decisions (prototype `tabDecisions`): core's question rounds of context.md as `decision-round` sections with
   * one `decision-block` card per question; null when the log records no question and no shapes, and the tab shows
   * the file as prose, as before. The whole file stays reachable below the cards.
   */
  /** spec.md's `principal_stated_goal_signal` (1–4) through core's docs model: the prototype's four-dot `.sig` bar. */
  protected readonly signal = computed(() => (this.name === 'decisions' ? (this.page()?.goalSignal ?? null) : null));
  protected readonly signalSteps = [1, 2, 3, 4] as const;

  protected readonly log = computed<DecisionLog | null>(() => {
    const log = this.page()?.decisions ?? null;
    return log?.rounds.some((r) => r.questions.length > 0 || r.shapes.length > 0) ? log : null;
  });
  /** Constitution (prototype `tabConstitution`): core's lanes table and gate tiers, above the full document. */
  protected readonly constitution = computed<ConstitutionView | null>(() => {
    const view = this.name === 'constitution' ? (this.page()?.constitution ?? null) : null;
    return view !== null && (view.lanes.length > 0 || view.tiers.length > 0) ? view : null;
  });
  protected fileTab(part: string): string | null {
    return FILE_TABS[part] ?? null;
  }
  private readonly claims = resource({
    params: () => {
      const ws = this.state.ws();
      const id = this.state.specId();
      return this.name === 'decisions' && ws !== null && id !== null ? { ws, id } : undefined;
    },
    loader: ({ params }) => this.api.claims(params.ws, params.id),
  });
  protected readonly fog = computed(() => {
    const result = this.claims.value();
    return result?.kind === 'ok' ? result.body.fog : [];
  });

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

  /**
   * The Design tab's Ist/Soll viewport cards (ISC-149, prototype `tabDesign`), above the full document; empty for
   * every other tab and for a design.md without paired Ist/Soll sections.
   */
  protected readonly viewports = computed<readonly DesignViewport[]>(() => {
    const page = this.page();
    return this.name === 'design' && page !== null ? designViewports(page.html) : [];
  });
  /** The screenshot the dialog shows, with its viewport and side; null while the dialog is closed. */
  protected readonly shot = signal<{ viewport: DesignViewport; side: 'ist' | 'soll'; image: DesignShot } | null>(null);
  protected readonly shotOpen = signal(false);
  protected readonly sides = ['ist', 'soll'] as const;
  /** Thumbnails whose image failed to load (`viewport-id:side`): they fall back to the placeholder. */
  protected readonly brokenShots = signal<ReadonlySet<string>>(new Set());

  protected openShot(viewport: DesignViewport, side: 'ist' | 'soll'): void {
    const image = viewport[side];
    if (image === null) return;
    this.shot.set({ viewport, side, image });
    this.shotOpen.set(true);
  }
  protected shotBroken(viewport: DesignViewport, side: 'ist' | 'soll'): void {
    this.brokenShots.update((set) => new Set(set).add(`${viewport.id}:${side}`));
  }
  protected shotShown(viewport: DesignViewport, side: 'ist' | 'soll'): boolean {
    return viewport[side] !== null && !this.brokenShots().has(`${viewport.id}:${side}`);
  }

  /** Frontmatter as chips: every key on the constitution, `status` (toned) elsewhere; `updated` is its own line. */
  protected readonly metaChips = computed<ReadonlyArray<{ label: string; tone: Tone; plain: boolean; icon?: 'circle-check' }>>(() => {
    const front = this.page()?.frontmatter ?? null;
    if (front === null) return [];
    if (this.name === 'constitution') {
      return Object.entries(front).map(([key, value]) => ({ label: `${key}: ${value}`, tone: 'neutral', plain: true }));
    }
    const status = front['status'];
    // `status: approved` as the prototype's Plan shows it (`h.chip("status: approved", "done")`).
    const icon = status ? STATUS_ICON[status] : undefined;
    const chips: Array<{ label: string; tone: Tone; plain: boolean; icon?: 'circle-check' }> = status ? [{ label: `status: ${status}`, tone: STATUS_TONE[status] ?? 'neutral', plain: false, ...(icon ? { icon } : {}) }] : [];
    // The design pass's own keys, plain, as the prototype's Design tab shows them.
    if (this.name === 'design') {
      for (const key of DESIGN_KEYS) if (front[key]) chips.push({ label: `${key}: ${front[key]}`, tone: 'neutral', plain: true });
    }
    return chips;
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
