import { NgTemplateOutlet } from '@angular/common';
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { SpecPageModel } from '../../../../../core/src/files';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { areaById, areaPath, specLink } from '../shell/areas';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';
import { GateButton } from './gate-button';
import { gateInHead, relativeTime, slugName } from './spec-head-model';

/**
 * T78 · ISC-85 · ISC-86 · ISC-22: the spec head above the tab bar on every spec area (design.md § Spec head).
 *
 * - Row 1, medium and wide: the breadcrumb (workspace name, `NNN slug`, area); dropped at compact, where the header
 *   pill already carries workspace and spec.
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
  imports: [GateButton, NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './spec-head.css',
  host: { class: 'spec-head', '[attr.data-tier]': 'tier()' },
  template: `
    @if (!compact()) {
      <nav class="crumbs" data-breadcrumb [attr.aria-label]="'specHead.breadcrumb' | transloco">
        <ol>
          <li>
            <a [routerLink]="workspaceLink()" data-crumb="workspace">
              <ui-icon name="arrow-left" [size]="16" />
              <span>{{ workspaceName() }}</span>
            </a>
          </li>
          <li>
            <a [routerLink]="specHome()" data-crumb="spec"><span class="mono">{{ id() }}</span> {{ slug() }}</a>
          </li>
          <li><span aria-current="page" data-crumb="area">{{ 'shell.areas.' + state.area() | transloco }}</span></li>
        </ol>
      </nav>
    }

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
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly tier = this.state.tier;
  protected readonly compact = computed(() => this.tier() === 'compact');

  private readonly body = computed<SpecPageModel | null>(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });
  private readonly row = this.data.currentRow;

  protected readonly id = computed(() => this.body()?.head.id ?? this.state.specId() ?? '');
  protected readonly title = computed(() => this.body()?.head.title ?? this.row()?.title ?? null);
  protected readonly type = computed(() => this.body()?.head.type ?? this.row()?.type ?? null);
  protected readonly stage = computed(() => this.body()?.head.stage ?? this.row()?.stage ?? 'plan');
  protected readonly slug = computed(() => slugName(this.body()?.head.slug ?? '', this.id()));
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
  protected readonly workspaceLink = computed(() => ['/w', this.state.ws() ?? '']);
  protected readonly specHome = computed(() => specLink(this.state.ws() ?? '', this.id()));
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
