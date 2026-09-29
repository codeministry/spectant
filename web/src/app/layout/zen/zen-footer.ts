import { ChangeDetectionStrategy, Component, computed, inject, ViewEncapsulation } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { areaById, areaPath, specLink } from '../shell/areas';
import { RailContent } from '../shell/rail-content';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * Zen's footer status bar (ISC-75, T38; design.md § Zen per tier): a sticky 40 px bar at the bottom of the shell that
 * takes the spec head's place while zen is on. Wide and medium: id and title, stage chip, claims meter (`25/30`), the
 * command chip with copy and the notes pill; compact: id · stage chip · claims · command chip.
 *
 * The values come from the spec payload (`head`, `keyNumbers.claims`, `areas.notes`), the dashboard row until it
 * answers. Unencapsulated on purpose: the one rule that hides the spec head reaches into `app-spec-page`, which this
 * lane does not own; every other selector is prefixed with the host element, so nothing leaks.
 */
@Component({
  selector: 'app-zen-footer',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiMeter],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-shell[data-zen] app-spec-page .spec-head { display: none; }
    app-zen-footer { position: sticky; inset-block-end: 0; z-index: 20; display: block; }
    app-zen-footer .zen-bar {
      display: flex; gap: 12px; align-items: center; block-size: 40px; padding-inline: 32px;
      padding-block-end: env(safe-area-inset-bottom); border-block-start: 1px solid var(--line);
      background: var(--page-glass); -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
      font-size: 13px; line-height: 20px; white-space: nowrap;
    }
    app-zen-footer .zen-id { color: var(--disp-ink); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
    app-zen-footer .zen-title { overflow: hidden; min-inline-size: 0; flex: 0 1 auto; text-overflow: ellipsis; }
    app-zen-footer .zen-claims { display: inline-flex; gap: 8px; align-items: center; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    app-zen-footer .zen-meter { inline-size: 64px; }
    app-zen-footer .zen-command { min-inline-size: 0; margin-inline-start: auto; }
    app-zen-footer .zen-command ui-command-chip { flex-wrap: nowrap; }
    app-zen-footer .zen-notes { color: var(--muted-ink); font-variant-numeric: tabular-nums; }
    @container shell (width < 1120px) { app-zen-footer .zen-bar { padding-inline: 24px; } }
    @container shell (width < 640px) {
      app-zen-footer .zen-bar { gap: 8px; padding-inline: 16px; }
      app-zen-footer .zen-title, app-zen-footer .zen-meter, app-zen-footer .zen-notes { display: none; }
    }
    /* Merged with a view's bottom bar (the board, T88): one 48 px bar; the bar yields the command chip first. */
    app-zen-footer .zen-bar[data-merged] { block-size: 48px; }
    app-zen-footer .zen-bar[data-merged] .zen-command { flex: 0 1 auto; margin-inline-start: 0; }
    @container shell (width < 1120px) {
      app-zen-footer .zen-bar[data-merged] .zen-command, app-zen-footer .zen-bar[data-merged] .zen-notes { display: none; }
    }
    @container shell (width < 640px) {
      app-zen-footer .zen-bar[data-merged] { gap: 4px; padding-inline: 8px; }
      app-zen-footer .zen-bar[data-merged] [data-zen-part='stage'], app-zen-footer .zen-bar[data-merged] .zen-claims { display: none; }
    }
  `,
  template: `
    <footer class="zen-bar" data-zen-footer [attr.data-merged]="bar() ? '' : null" [attr.aria-label]="'shell.zen.footer' | transloco">
      <span class="zen-id" data-zen-part="id">{{ id() }}</span>
      @if (title(); as title) {
        <span class="zen-title" data-zen-part="title" [attr.title]="title">{{ title }}</span>
      }
      <ui-chip tone="primary" [dot]="true" data-zen-part="stage">{{ stageKey() | transloco }}</ui-chip>
      @if (claims(); as claims) {
        <span class="zen-claims" data-zen-part="claims">
          <ui-meter
            class="zen-meter"
            [mini]="true"
            [value]="claims.closed"
            [max]="claims.total"
            [label]="'common.claimsClosed' | transloco: claims"
          />
          <span aria-hidden="true">{{ 'shell.zen.claims' | transloco: claims }}</span>
        </span>
      }
      <span class="zen-command">
        @if (command(); as command) {
          <ui-command-chip
            [command]="command"
            [copyLabel]="'common.copyCommand' | transloco"
            [copiedLabel]="'common.copied' | transloco: { command }"
            [manualHint]="'common.copyFallback' | transloco"
          />
        }
      </span>
      @if (notesLink(); as link) {
        <a class="zen-notes badge badge-ghost" data-zen-part="notes" [routerLink]="link">
          @if (notes(); as count) {
            {{ 'shell.zen.notesCount' | transloco: { count } }}
          } @else {
            {{ 'shell.zen.notes' | transloco }}
          }
        </a>
      }
      @if (bar(); as bar) {
        <ng-container [ngTemplateOutlet]="bar" />
      }
    </footer>
  `,
})
export class ZenFooter {
  private readonly state = inject(ShellState);
  private readonly data = inject(ShellData);
  /** A view's bottom bar (the board's frame bar, T88), rendered inside this bar so zen shows one bar, not two. */
  protected readonly bar = inject(RailContent).bar;

  private readonly body = computed(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });

  protected readonly id = computed(() => this.body()?.head.id ?? this.state.specId());
  protected readonly title = computed(() => this.body()?.head.title ?? this.data.currentRow()?.title ?? null);
  protected readonly stageKey = computed(() => `stages.${this.body()?.head.stage ?? this.data.currentRow()?.stage ?? 'plan'}`);
  protected readonly claims = computed(() => {
    const claims = this.body()?.keyNumbers.claims;
    return claims ? { closed: claims.closed, total: claims.total } : null;
  });
  protected readonly command = computed(() => this.body()?.head.nextCommand ?? null);
  protected readonly notes = computed(() => this.body()?.areas.notes.count ?? null);
  protected readonly notesLink = computed(() => {
    const ws = this.state.ws();
    const id = this.state.specId();
    return ws === null || id === null ? null : specLink(ws, id, areaPath(areaById('notes')));
  });
}
