import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { Priority, SpecPageModel, SpecType } from '../../../../../core/src/files';
import type { Stage } from '../../../../../core/src/stage';
import { monogram } from '../../features/overview/overview-model';
import { UiIcon } from '../../shared/icons/icon';
import type { IconName } from '../../shared/icons/icons';
import { UiChip } from '../../shared/ui/chip/chip';
import { chipIcon } from '../../shared/ui/chip/chip-icons';
import { OpenState } from '../../shared/open-state';
import { UiClamp } from '../../shared/ui/clamp/clamp';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiDisclosure } from '../../shared/ui/overlay/disclosure';
import { nextId } from '../../shared/ui/overlay/ids';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiWaitsChip } from '../../shared/ui/waits-chip/waits-chip';
import type { Tone } from '../../shared/ui/tone';
import { TYPE_GLYPHS } from '../../shared/ui/type-glyph/type-glyph';
import { UiWorktreeChip } from '../../shared/ui/worktree-chip/worktree-chip';
import { areaById, areaPath, planningTreeLink, specLink, workspaceLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { GateButton } from './gate-button';
import { OverlapLines } from './overlap-lines';
import { SpecGuideCard } from './spec-guide';
import { overlapLines, overlapsIn } from '../../features/dashboard/warnings-panel/overlap';
import {
  type FeaturePlace,
  featurePlace,
  gateInHead,
  goalLines,
  holderOf,
  type MilestonePlace,
  milestonePlace,
  openItem,
  provenance,
  relativeTime,
  worktreeChipTier,
} from './spec-head-model';

/** The stage chip's tone and prototype icon (`CHIP_ICON`: scoping compass, tasked list, building hammer, …). */
export const STAGE_LOOK: Readonly<Record<Stage, { readonly tone: Tone; readonly icon: IconName | undefined }>> = {
  plan: { tone: 'secondary', icon: chipIcon('scoping') },
  tasks: { tone: 'secondary', icon: chipIcon('tasked') },
  review: { tone: 'secondary', icon: chipIcon('code-reviewed') },
  build: { tone: 'primary', icon: chipIcon('building') },
  blocked: { tone: 'error', icon: chipIcon('blocked') },
  'code-review': { tone: 'primary', icon: chipIcon('code-reviewed') },
  'close-pending': { tone: 'primary', icon: chipIcon('done') },
  close: { tone: 'success', icon: chipIcon('closed') },
  done: { tone: 'success', icon: chipIcon('done') },
};

/**
 * T36 · ISC-149: the spec head above the tab bar on every spec area, the prototype's `spec-head-unified`
 * (`pages.js` `specHeader()`; spec 024 design.md § Spec head per viewport and § Across viewports, Breadcrumb).
 *
 * - The context line: the breadcrumb `← [badge] workspace / Spec NNN · Area › ISC-51` on every tier (the workspace
 *   first, spec 019 ISC-140.1; the claim or task the open Claims or Tasks tab names by fragment as the last level). Each
 *   `<li>` names the separator drawn before it in `data-sep` (`scope` "/", `dot` "·", `down` "›"). Beside it (below it
 *   at compact) the chip row: the type chip `plain` with its type icon, the stage chip with the stage icon, the
 *   priority exactly once as `pmark` after the stage chip, the milestone chip with `flag` and the feature chip (its id;
 *   "+n" opens the other blocks the spec holds). Milestone and feature come from the planning tree
 *   (`ShellData.planningModel`) and left the breadcrumb with spec 024 (principal 2026-10-12).
 * - The title row (spec 021 T38, ISC-250): `NNN · title` (mono cyan id, Sora 600 24/32, 20/28 at compact) and, in the
 *   same row on the right (wrapping under the title when the row is too narrow), the next-command chip with copy, the
 *   shared gate button when the stage allows, and the notes pill (`sticky-note` + "n notes", violet tint). Under it the
 *   goal sentence, clamped by `uiClamp` (one line wide, two below) with a "More…" named for the goal of its spec
 *   (ISC-248), then one meta line: updated, round, uncommitted files, the provenance and the "No agent source" text.
 * - The overlaps (spec 021 T37, ISC-250): every overlap of the spec in one collapsed `ui-disclosure` "N overlaps" beside
 *   the meta line (its own line once open), its state in `?open=overlaps` (`OpenState`), on every tab.
 * - Compact (spec 021 T67, ISC-250): the meta line, the next command and Notes leave the head's visible lines for one
 *   collapsed `ui-disclosure` "Details of NNN" beside the overlaps fold, so the head stays under 20 % of the first
 *   screen at 390 px; the gate button stays in the title row. Medium and wide keep the layout above. The goal toggle's
 *   name follows its visible word: "More… goal of NNN" collapsed, "Less, goal of NNN" open (label in name).
 * - The agent banner (3 px orange edge, agent dot, `lock` "writes paused") while a lock source reports a lock (ISC-90);
 *   without one the "No agent source" note joins the meta lines when the server read no source (ISC-86).
 * - The provenance line (spec 027 design.md § Across viewports 1, ISC-175, ISC-181): for a spec with a worktree,
 *   the full `ui-worktree-chip` (warning tone on a `worktree-branch-mismatch` warning, details as a sheet at compact),
 *   then, only when the spec is read from its worktree copy, the source note "Read from the worktree · main: ‹stage› ·
 *   n/m" (main's stage as an outline chip; "main equal" when stage and progress match), then the "No agent source"
 *   text. It wraps after the chip when wider than the left column, always at compact. Without a worktree the "No agent
 *   source" line renders exactly as before.
 *
 * - The guide card (spec 020, T21, ISC-239): `app-spec-guide` under the head where the tab has no other guidance spot.
 *
 * Values come from the spec payload, the dashboard row until it answers. The host carries `spec-head`, the class the
 * zen footer hides.
 */
@Component({
  selector: 'app-spec-head',
  imports: [
    GateButton,
    NgTemplateOutlet,
    OverlapLines,
    RouterLink,
    SpecGuideCard,
    TranslocoPipe,
    UiChip,
    UiClamp,
    UiCommandChip,
    UiDisclosure,
    UiIcon,
    UiPopover,
    UiPopoverTrigger,
    UiPriority,
    UiWaitsChip,
    UiWorktreeChip,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['./spec-head.css', './spec-head.context.css', './spec-head.compact.css'],
  host: { class: 'spec-head', '[attr.data-tier]': 'tier()' },
  template: `
    <div class="sh-context">
      <nav class="crumbs" data-breadcrumb [attr.aria-label]="'planning.breadcrumb.label' | transloco">
        <ol>
          <li>
            <a [routerLink]="workspaceLink()" data-crumb="workspace">
              <ui-icon name="arrow-left" [size]="14" />
              <span class="ws-badge" aria-hidden="true" [attr.data-mono]="workspaceMono()"></span>
              <span class="ws-name">{{ workspaceName() }}</span>
            </a>
          </li>
          <li data-sep="scope">
            <a
              [routerLink]="specHome()"
              data-crumb="spec"
              [attr.aria-label]="archived() ? specArchivedName() : null"
              [attr.aria-description]="'terms.spec' | transloco"
            >
              @if (archived()) {
                <ui-icon name="archive" [size]="12" />
              }
              {{ 'specHead.specCrumb' | transloco: { id: id() } }}
            </a>
          </li>
          <li data-sep="dot">
            @if (leaf()) {
              <a [routerLink]="areaLink()" data-crumb="area">{{ 'shell.areas.' + state.area() | transloco }}</a>
            } @else {
              <span aria-current="page" data-crumb="area">{{ 'shell.areas.' + state.area() | transloco }}</span>
            }
          </li>
          @if (leaf(); as item) {
            <li data-sep="down">
              <a
                class="mono"
                aria-current="page"
                [routerLink]="leafLink()"
                [fragment]="item.kind + '-' + item.id"
                [attr.data-crumb]="item.kind"
                [attr.aria-description]="'terms.' + item.kind | transloco"
                >{{ item.id }}</a
              >
            </li>
          }
        </ol>
      </nav>

      <div class="chips" data-head-chips>
        @if (type(); as type) {
          <ui-chip variant="plain" data-head-chip="type" [icon]="typeIcon()">{{ 'types.' + type | transloco }}</ui-chip>
        }
        <ui-chip data-head-chip="stage" [tone]="stageLook().tone" [icon]="stageLook().icon">{{ 'stages.' + stage() | transloco }}</ui-chip>
        <ui-priority data-head-chip="priority" [mark]="true" [value]="priority()" />
        @if (waits(); as wait) {
          <ui-waits-chip data-head-chip="waits" [wait]="wait" [ws]="state.ws() ?? ''" [titles]="blockerTitles()" [meta]="true" />
        }
        @if (milestoneChip(); as milestone) {
          @if (milestone.known) {
            <a class="chip-link" data-head-chip="milestone" [routerLink]="treeLink()" [queryParams]="{ sel: 'milestone:' + milestone.slug }">
              <ui-chip variant="plain" icon="flag"><span class="label-name">{{ milestone.name }}</span></ui-chip>
            </a>
          } @else {
            <span class="chip-link" data-head-chip="milestone" [attr.aria-description]="'planning.breadcrumb.unknownMilestone' | transloco">
              <ui-chip variant="plain" tone="warning" icon="triangle-alert"><span class="label-name">{{ milestone.name }}</span></ui-chip>
            </span>
          }
        }
        @if (featureChip(); as feature) {
          <a
            class="chip-link"
            data-head-chip="feature"
            [routerLink]="treeLink()"
            [queryParams]="{ sel: 'feature:' + feature.id }"
            [attr.title]="feature.name"
            [attr.aria-description]="'terms.feature' | transloco"
          >
            <ui-chip variant="mono">{{ feature.id }}</ui-chip>
          </a>
          @if (otherFeatures().length; as count) {
            <button type="button" class="head-more" data-head-more [attr.aria-label]="(count === 1 ? 'planning.breadcrumb.more.one' : 'planning.breadcrumb.more.other') | transloco: { count }" [uiPopoverTrigger]="more">
              <ui-chip variant="count">+{{ count }}</ui-chip>
            </button>
            <ui-popover #more [label]="(count === 1 ? 'planning.breadcrumb.more.one' : 'planning.breadcrumb.more.other') | transloco: { count }">
              <ul class="head-more-list">
                @for (other of otherFeatures(); track other.id) {
                  <li>
                    <a [routerLink]="treeLink()" [queryParams]="{ sel: 'feature:' + other.id }" [attr.aria-description]="'terms.feature' | transloco">
                      <span class="mono">{{ other.id }}</span> {{ other.name }}
                    </a>
                  </li>
                }
              </ul>
            </ui-popover>
          }
        }
      </div>
    </div>

    <div class="sh-main">
      <div class="title-row" data-title-row>
        <h1 id="spec-title">
          <span class="spec-id">{{ id() }}</span>
          @if (title(); as title) {
            <span class="sh-sep" aria-hidden="true">·</span>
            <span class="spec-title" [attr.title]="title">{{ title }}</span>
          }
        </h1>
        <div class="actions" data-head-actions>
          @if (!compact()) {
            <ng-container [ngTemplateOutlet]="commandTpl" />
          }
          @if (showGate()) {
            <app-gate-button [size]="compact() ? 'icon' : 'inline'" />
          }
          @if (!compact()) {
            <ng-container [ngTemplateOutlet]="notesTpl" />
          }
        </div>
      </div>
      @if (description(); as description) {
        <div class="desc-block">
          <p
            #goal="uiClamp"
            class="desc"
            data-description
            [id]="goalId"
            [uiClamp]="description"
            [uiClampLines]="goalLines()"
            [uiClampExpanded]="expanded()"
          ></p>
          @if (goal.overflows() || expanded()) {
            <button
              type="button"
              class="more"
              data-more
              [attr.aria-expanded]="expanded()"
              [attr.aria-controls]="goalId"
              [attr.aria-label]="(expanded() ? 'specHead.goalLess' : 'specHead.goalMore') | transloco: { id: id() }"
              (click)="expanded.set(!expanded())"
            >
              {{ (expanded() ? 'specHead.less' : 'specHead.more') | transloco }}
            </button>
          }
        </div>
      }
      @if (compact()) {
        <!-- Spec 021 T67 (ISC-250): at compact the meta line, the next command and Notes fold into "Details of NNN". -->
        @if (hasDetails() || overlaps().length > 0) {
          <div class="meta-row">
            @if (overlaps().length > 0) {
              <ng-container [ngTemplateOutlet]="overlapTpl" />
            }
            @if (hasDetails()) {
              <ui-disclosure class="overlap-fold" data-head-details [open]="detailsOpen()" (openChange)="detailsOpen.set($event)">
                <span uiDisclosureSummary class="fold-summary">{{ 'specHead.details' | transloco: { id: id() } }}</span>
                @if (hasMeta()) {
                  <ng-container [ngTemplateOutlet]="metaTpl" />
                }
                @if (command() || notesLink()) {
                  <div class="details-actions" data-head-details-actions>
                    <ng-container [ngTemplateOutlet]="commandTpl" />
                    <ng-container [ngTemplateOutlet]="notesTpl" />
                  </div>
                }
              </ui-disclosure>
            }
          </div>
        }
      } @else if (hasMeta() || overlaps().length > 0) {
        <div class="meta-row">
          @if (hasMeta()) {
            <ng-container [ngTemplateOutlet]="metaTpl" />
          }
          @if (overlaps().length > 0) {
            <ng-container [ngTemplateOutlet]="overlapTpl" />
          }
        </div>
      }
    </div>

    <ng-template #commandTpl>
      @if (command(); as command) {
        <ui-command-chip
          class="command"
          data-head-command
          [command]="command"
          [copyLabel]="'common.copyCommand' | transloco"
          [copiedLabel]="'common.copied' | transloco: { command }"
          [manualHint]="'common.copyFallback' | transloco"
        />
      }
    </ng-template>

    <ng-template #notesTpl>
      @if (notesLink(); as link) {
        <a class="notes-pill" data-notes-pill [routerLink]="link">
          <ui-icon name="sticky-note" [size]="14" />
          @if (notes(); as count) {
            {{ (count === 1 ? 'specHead.notesCount.one' : 'specHead.notesCount.other') | transloco: { count } }}
          } @else {
            {{ 'specHead.notes' | transloco }}
          }
        </a>
      }
    </ng-template>

    <ng-template #overlapTpl>
      <!-- Spec 021 T37 (ISC-250): every overlap in one collapsed disclosure, its open state in ?open=overlaps. -->
      <ui-disclosure class="overlap-fold" data-head-overlap-fold [open]="overlapsOpen()" (openChange)="setOverlapsOpen($event)">
        <span uiDisclosureSummary class="fold-summary">
          <ui-icon class="warn-icon" name="triangle-alert" [size]="14" />
          {{ (overlaps().length === 1 ? 'warnings.overlap.disclosure.one' : 'warnings.overlap.disclosure.other') | transloco: { count: overlaps().length } }}
        </span>
        <app-overlap-lines class="overlaps" data-head-overlaps [lines]="overlaps()" [ws]="state.ws() ?? ''" [fold]="false" />
      </ui-disclosure>
    </ng-template>

    <ng-template #metaTpl>
      <p class="meta" data-meta>
        @for (part of meta(); track $index) {
          <span class="part">{{ part }}</span>
        }
        @if (provenance(); as prov) {
          <span class="part provenance" data-provenance>
            <ui-worktree-chip data-head-worktree [worktree]="prov.worktree" [mismatch]="prov.mismatch" [source]="prov.source" [tier]="chipTier()" />
            @if (prov.note || noSource()) {
              <span class="source-line">
                @if (prov.note; as note) {
                  <span class="source-note" data-source-note>
                    <span class="read"><ui-icon name="folder-git-2" [size]="12" />{{ 'specHead.source.read' | transloco }}</span>
                    @if (note.kind === 'behind') {
                      <span class="seg"
                        >{{ 'specHead.source.main' | transloco }}
                        <ui-chip class="main-stage" data-main-stage variant="small">{{ 'stages.' + note.stage | transloco }}</ui-chip></span
                      >
                      <span class="seg mono" data-main-progress>{{ note.closed }}/{{ note.total }}</span>
                    } @else {
                      <span class="seg">{{ (note.kind === 'equal' ? 'specHead.source.equal' : 'specHead.source.absent') | transloco }}</span>
                    }
                  </span>
                }
                @if (noSource()) {
                  <span data-no-source-line>{{ 'specHead.noSource' | transloco }}</span>
                }
              </span>
            }
          </span>
        } @else if (noSource()) {
          <span class="part no-source" data-no-source-line>{{ 'specHead.noSource' | transloco }}</span>
        }
      </p>
    </ng-template>

    @if (lock(); as held) {
      <div class="banner" data-agent-banner role="status">
        <p class="banner-line">
          <span class="agent-dot" aria-hidden="true"></span>
          <code class="session" data-session>{{ held.session }}</code>
          <span>{{ 'specHead.agent.on' | transloco: { claim: held.claim, time: ago(held.since) } }}</span>
        </p>
        <span class="paused-chip" data-writes-paused>
          <ui-icon name="lock" [size]="14" />
          {{ 'specHead.agent.paused' | transloco }}
        </span>
      </div>
    }

    <!-- Spec 020 (T21, ISC-239): the compact guide card where this tab has no other guidance spot (guideCardShown). -->
    <app-spec-guide />
  `,
})
export class SpecHead {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  private readonly transloco = inject(TranslocoService);
  private readonly router = inject(Router);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = this.state.tier;
  protected readonly compact = computed(() => this.tier() === 'compact');

  private readonly body = computed<SpecPageModel | null>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });
  private readonly row = this.data.currentRow;

  /** The spec as the route names it: the model's id once the body answers, else the raw `:id` in any accepted form. */
  private readonly ref = computed(() => this.body()?.head.id ?? this.state.specId() ?? '');
  /** The display id: the model's, else the planning holder's (the URL may carry the folder or bare slug), else the ref. */
  protected readonly id = computed(() => this.body()?.head.id ?? this.holder()?.id ?? this.ref());
  protected readonly title = computed(() => this.body()?.head.title ?? this.row()?.title ?? null);
  protected readonly type = computed(() => this.body()?.head.type ?? this.row()?.type ?? null);
  protected readonly typeIcon = computed(() => {
    const type = this.type();
    return type !== null && Object.hasOwn(TYPE_GLYPHS, type) ? TYPE_GLYPHS[type as SpecType] : undefined;
  });
  protected readonly stage = computed(() => this.body()?.head.stage ?? this.row()?.stage ?? 'plan');
  protected readonly stageLook = computed(() => (Object.hasOwn(STAGE_LOOK, this.stage()) ? STAGE_LOOK[this.stage() as Stage] : STAGE_LOOK.plan));
  /** `priority:` as core reads it (P3 for a missing or invalid key); null until a source answers, drawn as unmarked P3. */
  protected readonly priority = computed<Priority | null>(
    () => this.body()?.head.priority ?? this.row()?.priority ?? this.holder()?.priority ?? null,
  );
  /**
   * Spec 025 (T22, ISC-163): what the spec waits on, from the spec payload; null when no open spec edge holds its work.
   * A partial hold keeps the stage and shows the scope behind the chip; a full one already reads `blocked` from core.
   */
  protected readonly waits = computed(() => this.body()?.head.waits ?? null);
  /** The blocker titles for the chip's accessible name, from the dashboard rows (active and archived). */
  protected readonly blockerTitles = computed(() => {
    const ids = this.waits()?.blockers ?? [];
    const rows = [...this.data.specRows(), ...this.data.archiveRows()];
    return Object.fromEntries(ids.flatMap((id) => rows.filter((row) => row.id === id).slice(0, 1).map((row) => [id, row.title] as const)));
  });
  /**
   * Spec 025 (T29, ISC-164.1): this spec's overlaps with other open specs, each with the edge this spec could carry.
   * core puts the warning on the waiting spec's dashboard row only, so both specs of a pair read it from there.
   */
  protected readonly overlaps = computed(() => {
    const dashboard = this.data.dashboard.value();
    return overlapLines(overlapsIn(dashboard?.kind === 'ok' ? dashboard.body : null), this.id());
  });
  protected readonly command = computed(() => this.body()?.head.nextCommand ?? null);
  protected readonly notes = computed(() => this.body()?.areas.notes.count ?? null);
  protected readonly description = computed(() => this.body()?.ideaQuote ?? null);
  protected readonly lock = computed(() => this.body()?.areas.live.lock ?? null);
  protected readonly lockSource = computed(() => this.body()?.areas.live.lockSource ?? null);
  protected readonly showGate = computed(() => this.body() !== null && gateInHead(this.stage()));
  /** No lock and no source read: writes check the file hash only (ISC-86). */
  protected readonly noSource = computed(() => !this.lock() && this.lockSource() === 'none');

  /** The provenance line's chip and source note (spec 027, ISC-175, ISC-181), from the spec payload only; null: none. */
  protected readonly provenance = computed(() => {
    const body = this.body();
    if (body === null) return null;
    const { stage, worktree, source, main } = body.head;
    return provenance({ stage, worktree, source, main, progress: body.keyNumbers.claims, warnings: body.warnings });
  });
  protected readonly chipTier = computed(() => worktreeChipTier(this.tier()));

  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return this.data.workspaceList().find((entry) => entry.slug === ws)?.name ?? ws ?? '';
  });
  /** The workspace badge's monogram, drawn as generated content so the crumb's text stays the workspace name. */
  protected readonly workspaceMono = computed(() => monogram(this.workspaceName()));
  protected readonly workspaceLink = computed(() => workspaceLink(this.state.ws() ?? '', 'specs'));
  protected readonly specHome = computed(() => specLink(this.state.ws() ?? '', this.id()));

  // ─── Breadcrumb and planning chips ──────────────────────────────────────────────────────────────────────────
  private readonly plan = this.data.planningModel;
  /** Re-read on every navigation (`ShellState.route` follows `NavigationEnd`), fragment-only ones included. */
  private readonly fragment = computed(() => {
    this.state.route();
    return this.router.parseUrl(this.router.url).fragment;
  });
  /** The claim or task the open tab names; the last crumb when there is one. */
  protected readonly leaf = computed(() => openItem(this.state.tab(), this.fragment()));
  private readonly holder = computed(() => {
    const plan = this.plan();
    return plan === null ? null : holderOf(plan, this.ref());
  });
  protected readonly milestoneChip = computed<MilestonePlace | null>(() => {
    const plan = this.plan();
    return plan === null ? null : milestonePlace(plan, this.ref());
  });
  private readonly features = computed<FeaturePlace>(() => {
    const plan = this.plan();
    const leaf = this.leaf();
    return plan === null ? { crumb: null, others: [] } : featurePlace(plan, this.ref(), leaf?.kind === 'claim' ? leaf.id : null);
  });
  protected readonly featureChip = computed(() => this.features().crumb);
  protected readonly otherFeatures = computed(() => this.features().others);
  /** Archived per the dashboard's archive rows, or the planning holder's flag while the dashboard has not answered. */
  protected readonly archived = computed(() => {
    const id = this.id();
    return this.data.archiveRows().some((row) => row.id === id) || (this.holder()?.archived ?? false);
  });
  protected readonly specArchivedName = computed(() => {
    // `translate` reads no signal: the language is read here so the name follows a language switch.
    const lang = this.lang();
    const name = this.transloco.translate('specHead.specCrumb', { id: this.id() }, lang);
    return `${name}, ${this.transloco.translate('planning.breadcrumb.archived', {}, lang)}`;
  });
  /**
   * Spec 026 (ISC-167.1): the milestone and feature chips land on the planning tree with their object in `?sel=`, the
   * address the old `/milestones#m-<slug>` and `/features#F<n>` now redirect to.
   */
  protected readonly treeLink = computed(() => planningTreeLink(this.state.ws() ?? ''));
  protected readonly areaLink = computed(() => {
    const area = this.state.area();
    return specLink(this.state.ws() ?? '', this.id(), area === null ? '' : areaPath(areaById(area)));
  });
  protected readonly leafLink = computed(() => specLink(this.state.ws() ?? '', this.id(), this.state.tab() ?? ''));
  protected readonly notesLink = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? null : specLink(ws, id, areaPath(areaById('notes')));
  });

  protected ago(iso: string | null): string {
    return relativeTime(iso, Date.now(), this.lang()) ?? '';
  }

  /** "updated 6 months ago · round 3 · 2 files uncommitted", each part only when the model carries it. */
  protected readonly meta = computed(() => {
    const lang = this.lang();
    const head = this.body()?.head;
    if (!head) return [];
    const parts: string[] = [];
    const updated = relativeTime(head.updated, Date.now(), lang);
    if (updated !== null) parts.push(this.transloco.translate('specHead.updated', { time: updated }));
    if (head.round !== null) parts.push(this.transloco.translate('specHead.round', { round: head.round }));
    if (head.uncommittedFiles !== null) parts.push(this.transloco.translate(head.uncommittedFiles === 1 ? 'specHead.uncommitted.one' : 'specHead.uncommitted.other', { count: head.uncommittedFiles }));
    return parts;
  });

  /**
   * Spec 021 T38 (ISC-250, ISC-248): the goal sentence, clamped by `uiClamp` to `goalLines(tier)` at a whole word. Its
   * "More…" shows only while the clamp cuts; its accessible name names the goal of this spec.
   */
  protected readonly expanded = signal(false);
  protected readonly goalId = nextId('spec-goal');
  protected readonly goalLines = computed(() => goalLines(this.tier()));

  /** The meta line renders when any of its parts does: updated, round, uncommitted files, provenance, "No agent source". */
  protected readonly hasMeta = computed(() => this.meta().length > 0 || this.provenance() !== null || this.noSource());
  /** Spec 021 T67 (ISC-250): "Details of NNN" at compact holds the meta line, the next command and Notes. */
  protected readonly hasDetails = computed(() => this.hasMeta() || this.command() !== null || this.notesLink() !== null);
  /** Collapsed on every visit; the address schema (`?open=`) carries only the shared folds. */
  protected readonly detailsOpen = signal(false);

  // ─── Overlaps (spec 021 T37, ISC-250) ───────────────────────────────────────────────────────────────────────────
  private readonly openState = inject(OpenState);
  protected readonly overlapsOpen = computed(() => this.openState.isOpen('overlaps'));
  protected setOverlapsOpen(open: boolean): void {
    if (open !== this.overlapsOpen()) void this.openState.set('overlaps', open);
  }
}
