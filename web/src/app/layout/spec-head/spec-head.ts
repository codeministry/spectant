import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiPopover, UiPopoverTrigger } from '../../shared/ui/overlay/popover';
import { areaById, areaPath, specLink, workspaceLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { GateButton } from './gate-button';
import {
  type FeaturePlace,
  featurePlace,
  gateInHead,
  holderOf,
  type MilestonePlace,
  milestonePlace,
  openItem,
  relativeTime,
  slugName,
} from './spec-head-model';

/**
 * T78 · ISC-85 · ISC-86 · ISC-22: the spec head above the tab bar on every spec area (design.md § Spec head).
 *
 * - Row 1, every tier: the breadcrumb (T39, ISC-105; design § The breadcrumb). Medium and wide:
 *   `← workspace / ⚑ milestone · F2 name +n › NNN slug › area › ISC-51`; compact returns it in the short form
 *   `⚑ milestone · F2 +n › NNN › ISC-51` (the header pill and the row-2 trigger carry workspace and area). The
 *   milestone and feature levels come from the planning tree (`ShellData.planningModel`), so without it the line is
 *   the three levels of spec 002. The claim or task level is the one the open Claims or Tasks tab names by fragment.
 *   Each `<li>` names the separator drawn before it in `data-sep` (`scope` "/", `dot` "·", `down` "›").
 * - Row 2: mono id and the Sora title (ellipsis with `title`), the type and stage chips; the cluster on the right
 *   holds the next-command chip with copy (the canonical copy target of the page), the notes pill and, when the stage
 *   allows, the shared gate button. At compact the chips wrap under the title and the command chip goes full width.
 * - Row 3: the description (the idea quote, clamped to two lines with a "more" disclosure at compact) and the meta
 *   line with `Intl` relative times in the UI language.
 * - The agent banner when a lock source reports a lock (ISC-90), else the muted "No agent source" line when the
 *   server read none (ISC-86).
 *
 * Values come from the spec payload, the dashboard row until it answers. The host carries `spec-head`, the class the
 * zen footer hides.
 */
@Component({
  selector: 'app-spec-head',
  imports: [GateButton, NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiIcon, UiPopover, UiPopoverTrigger],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './spec-head.css',
  host: { class: 'spec-head', '[attr.data-tier]': 'tier()' },
  template: `
    <nav class="crumbs" data-breadcrumb [attr.aria-label]="'planning.breadcrumb.label' | transloco">
      <ol>
        @if (!compact()) {
          <li>
            <a [routerLink]="workspaceLink()" data-crumb="workspace">
              <ui-icon name="arrow-left" [size]="16" />
              <span>{{ workspaceName() }}</span>
            </a>
          </li>
        }
        @if (milestoneCrumb(); as milestone) {
          <li [attr.data-sep]="seps().milestone">
            @if (milestone.known) {
              <a [routerLink]="milestonesLink()" [fragment]="'m-' + milestone.slug" data-crumb="milestone">
                <ui-icon name="flag" [size]="12" />
                <span class="name">{{ milestone.name }}</span>
              </a>
            } @else {
              <span class="unknown" data-crumb="milestone" [attr.aria-description]="'planning.breadcrumb.unknownMilestone' | transloco">
                <ui-icon name="triangle-alert" [size]="12" />
                @if (milestone.name; as name) {
                  <span class="name">{{ name }}</span>
                }
              </span>
            }
          </li>
        }
        @if (featureCrumb(); as feature) {
          <li [attr.data-sep]="seps().feature">
            <a [routerLink]="featuresLink()" [fragment]="feature.id" data-crumb="feature" [attr.aria-description]="'terms.feature' | transloco">
              <span class="mono">{{ feature.id }}</span>
              @if (!compact()) {
                <span class="name"> {{ feature.name }}</span>
              }
            </a>
            @if (otherFeatures().length; as count) {
              <button
                type="button"
                class="crumb-more"
                data-crumb-more
                [attr.aria-label]="'planning.breadcrumb.more' | transloco: { count }"
                [uiPopoverTrigger]="more"
              >
                <ui-chip>+{{ count }}</ui-chip>
              </button>
              <ui-popover #more [label]="'planning.breadcrumb.more' | transloco: { count }">
                <ul class="crumb-more-list">
                  @for (other of otherFeatures(); track other.id) {
                    <li>
                      <a [routerLink]="featuresLink()" [fragment]="other.id" [attr.aria-description]="'terms.feature' | transloco">
                        <span class="mono">{{ other.id }}</span> {{ other.name }}
                      </a>
                    </li>
                  }
                </ul>
              </ui-popover>
            }
          </li>
        }
        <li [attr.data-sep]="seps().spec">
          <a
            [routerLink]="specHome()"
            data-crumb="spec"
            [attr.aria-current]="specCurrent() ? 'page' : null"
            [attr.aria-label]="archived() ? specArchivedName() : null"
            [attr.aria-description]="'terms.spec' | transloco"
          >
            @if (archived()) {
              <ui-icon name="archive" [size]="12" />
            }
            <span class="mono">{{ id() }}</span>
            @if (!compact()) {
              &ngsp;<span class="crumb-slug">{{ slug() }}</span>
            }
          </a>
        </li>
        @if (!compact()) {
          <li data-sep="down">
            @if (leaf()) {
              <a [routerLink]="areaLink()" data-crumb="area">{{ 'shell.areas.' + state.area() | transloco }}</a>
            } @else {
              <span aria-current="page" data-crumb="area">{{ 'shell.areas.' + state.area() | transloco }}</span>
            }
          </li>
        }
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

    <div class="row">
      <div class="title-line">
        <h1 id="spec-title">
          <span class="spec-id">{{ id() }}</span>
          @if (title(); as title) {
            <span class="spec-title" [attr.title]="title">{{ title }}</span>
          }
        </h1>
        <span class="chips">
          @if (type(); as type) {
            <ui-chip data-head-chip="type">{{ type }}</ui-chip>
          }
          <ui-chip tone="primary" [dot]="true" data-head-chip="stage">{{ 'stages.' + stage() | transloco }}</ui-chip>
          @if (compact()) {
            <ng-container [ngTemplateOutlet]="notesPill" />
            @if (showGate()) {
              <app-gate-button size="inline" />
            }
          }
        </span>
      </div>
      @if (!compact()) {
        <div class="actions" data-head-actions>
          <ng-container [ngTemplateOutlet]="commandChip" />
          <ng-container [ngTemplateOutlet]="notesPill" />
          @if (showGate()) {
            <app-gate-button size="inline" />
          }
        </div>
      }
    </div>

    @if (description(); as description) {
      <div class="desc-block">
        <p #desc class="desc" data-description [class.clamped]="compact() && !expanded()">{{ description }}</p>
        @if (compact() && (expanded() || overflowing())) {
          <button type="button" class="btn btn-link btn-xs more" data-more [attr.aria-expanded]="expanded()" (click)="expanded.set(!expanded())">
            {{ (expanded() ? 'specHead.less' : 'specHead.more') | transloco }}
          </button>
        }
      </div>
    }
    @if (meta().length > 0) {
      <p class="meta" data-meta>
        @for (part of meta(); track $index) {
          <span>{{ part }}</span>
        }
      </p>
    }
    @if (compact()) {
      <ng-container [ngTemplateOutlet]="commandChip" />
    }

    @if (lock(); as held) {
      <div class="banner" data-agent-banner>
        <p class="banner-line">
          <span class="banner-dot" aria-hidden="true"></span>
          <code class="session" data-session>{{ held.session }}</code>
          <span>{{ 'specHead.agent.on' | transloco: { claim: held.claim, time: ago(held.since) } }}</span>
        </p>
        <span class="paused-chip" data-writes-paused>
          <ui-icon name="lock" [size]="14" />
          {{ 'specHead.agent.paused' | transloco }}
        </span>
      </div>
    } @else if (lockSource() === 'none') {
      <p class="no-source" data-no-source-line>{{ 'specHead.noSource' | transloco }}</p>
    }

    <ng-template #commandChip>
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
    <ng-template #notesPill>
      @if (notesLink(); as link) {
        <a class="badge badge-secondary notes-pill" data-notes-pill [routerLink]="link">
          @if (notes(); as count) {
            {{ 'specHead.notesCount' | transloco: { count } }}
          } @else {
            {{ 'specHead.notes' | transloco }}
          }
        </a>
      }
    </ng-template>
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
  protected readonly stage = computed(() => this.body()?.head.stage ?? this.row()?.stage ?? 'plan');
  protected readonly slug = computed(() => slugName(this.body()?.head.slug ?? this.holder()?.slug ?? ''));
  protected readonly command = computed(() => this.body()?.head.nextCommand ?? null);
  protected readonly notes = computed(() => this.body()?.areas.notes.count ?? null);
  protected readonly description = computed(() => this.body()?.ideaQuote ?? null);
  protected readonly lock = computed(() => this.body()?.areas.live.lock ?? null);
  protected readonly lockSource = computed(() => this.body()?.areas.live.lockSource ?? null);
  protected readonly showGate = computed(() => this.body() !== null && gateInHead(this.stage()));

  protected readonly workspaceName = computed(() => {
    const ws = this.state.ws();
    return this.data.workspaceList().find((entry) => entry.slug === ws)?.name ?? ws ?? '';
  });
  protected readonly workspaceLink = computed(() => workspaceLink(this.state.ws() ?? '', 'specs'));
  protected readonly specHome = computed(() => specLink(this.state.ws() ?? '', this.id()));

  // ─── Breadcrumb (T39, ISC-105) ──────────────────────────────────────────────────────────────────────────────
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
  protected readonly milestoneCrumb = computed<MilestonePlace | null>(() => {
    const plan = this.plan();
    return plan === null ? null : milestonePlace(plan, this.ref());
  });
  private readonly features = computed<FeaturePlace>(() => {
    const plan = this.plan();
    const leaf = this.leaf();
    return plan === null ? { crumb: null, others: [] } : featurePlace(plan, this.ref(), leaf?.kind === 'claim' ? leaf.id : null);
  });
  protected readonly featureCrumb = computed(() => this.features().crumb);
  protected readonly otherFeatures = computed(() => this.features().others);
  /** Archived per the dashboard's archive rows, or the planning holder's flag while the dashboard has not answered. */
  protected readonly archived = computed(() => {
    const id = this.id();
    return this.data.archiveRows().some((row) => row.id === id) || (this.holder()?.archived ?? false);
  });
  protected readonly specArchivedName = computed(() => {
    const name = this.compact() ? this.id() : `${this.id()} ${this.slug()}`.trim();
    // `translate` reads no signal: the language is read here so the name follows a language switch.
    return `${name}, ${this.transloco.translate('planning.breadcrumb.archived', {}, this.lang())}`;
  });
  /**
   * At compact the area crumb is dropped, so with no claim or task open the spec crumb is the last level and current
   * on every area; at medium and wide the area crumb (or the leaf) carries `aria-current` instead.
   */
  protected readonly specCurrent = computed(() => this.compact() && this.leaf() === null);
  /** The separator before each level: "/" leaves the workspace scope, "·" joins milestone and feature, "›" descends. */
  protected readonly seps = computed(() => {
    const lead = this.compact() ? null : 'scope';
    const milestone = this.milestoneCrumb() !== null;
    return {
      milestone: lead,
      feature: milestone ? 'dot' : lead,
      spec: milestone || this.featureCrumb() !== null ? 'down' : lead,
    };
  });
  protected readonly milestonesLink = computed(() => workspaceLink(this.state.ws() ?? '', 'milestones'));
  protected readonly featuresLink = computed(() => workspaceLink(this.state.ws() ?? '', 'features'));
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
    if (head.uncommittedFiles !== null) parts.push(this.transloco.translate('specHead.uncommitted', { count: head.uncommittedFiles }));
    return parts;
  });

  protected readonly expanded = signal(false);
  protected readonly overflowing = signal(false);
  private readonly desc = viewChild<ElementRef<HTMLElement>>('desc');

  constructor() {
    // The "more" disclosure shows only when the two-line clamp actually cuts the description.
    afterRenderEffect(() => {
      const el = this.desc()?.nativeElement;
      if (!el || !this.compact() || this.expanded()) return;
      this.description();
      this.overflowing.set(el.scrollHeight > el.clientHeight + 1);
    });
  }
}
