import { ChangeDetectionStrategy, Component, computed, inject, ViewEncapsulation } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { notesLinkOf } from '../spec-head/notes-link';
import { RailContent } from '../shell/rail-content';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * Zen's footer status bar (ISC-75, T38; design.md § Zen per tier): a sticky 40 px bar at the bottom of the shell that
 * takes the spec head's place while zen is on. Spec 024 aligns it with the prototype `zen-statusbar`: 36 px, 12 px muted
 * text on the page glass, the path `← <ws badge> ws / area` back to the workspace, the id and the 600 title, then pushed
 * right the type chip (plain) and the stage chip, followed by the app's claims meter (`25/30`), the command chip with
 * copy and the notes pill (ISC-75); compact: path · id · chips · claims · command chip.
 *
 * The values come from the spec payload (`head`, `keyNumbers.claims`, `areas.notes`), the dashboard row until it
 * answers. Unencapsulated on purpose: the one rule that hides the spec head reaches into `app-spec-page`, which this
 * lane does not own; every other selector is prefixed with the host element, so nothing leaks.
 */
@Component({
  selector: 'app-zen-footer',
  imports: [NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiCommandChip, UiIcon, UiMeter, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styles: `
    app-shell[data-zen] app-spec-page .spec-head { display: none; }
    app-zen-footer { position: sticky; inset-block-end: 0; z-index: 20; display: block; }
    app-zen-footer .zen-bar {
      display: flex; gap: 8px; align-items: center; block-size: 36px; padding-inline: 16px;
      padding-block-end: env(safe-area-inset-bottom); border-block-start: 1px solid var(--line);
      background: var(--page-glass); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);
      color: var(--muted); font-size: 12px; line-height: 16px; white-space: nowrap;
      animation: zen-bar-in var(--dur-sheet) var(--ease);
    }
    @keyframes zen-bar-in { from { opacity: 0; translate: 0 8px; } }
    @media (prefers-reduced-motion: reduce) { app-zen-footer .zen-bar { animation: none; } }
    app-zen-footer .zen-path { display: flex; flex: none; gap: 4px; align-items: center; overflow: hidden; color: var(--muted); }
    app-zen-footer .zen-path a { display: inline-flex; gap: 4px; align-items: center; color: inherit; text-decoration: none; }
    app-zen-footer .zen-path a:hover { color: var(--color-base-content); }
    app-zen-footer .zen-id { color: var(--disp-text); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
    app-zen-footer .zen-title { overflow: hidden; min-inline-size: 0; flex: 0 1 auto; color: var(--color-base-content); font-weight: 600; text-overflow: ellipsis; }
    app-zen-footer .zen-chips { display: flex; flex: none; gap: 4px; align-items: center; margin-inline-start: auto; }
    app-zen-footer .zen-claims { display: inline-flex; gap: 8px; align-items: center; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
    app-zen-footer .zen-meter { inline-size: 64px; }
    app-zen-footer .zen-command { min-inline-size: 0; }
    app-zen-footer .zen-command ui-command-chip { flex-wrap: nowrap; }
    app-zen-footer .zen-notes { color: var(--muted-ink); font-variant-numeric: tabular-nums; }
    @container shell (width < 640px) {
      app-zen-footer .zen-bar { gap: 8px; padding-inline: 16px; }
      app-zen-footer .zen-title, app-zen-footer .zen-meter, app-zen-footer .zen-notes, app-zen-footer .zen-here, app-zen-footer [data-zen-part='type'] { display: none; }
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
      @if (wsPath(); as path) {
        <nav class="zen-path" data-zen-part="path" aria-hidden="true">
          <a [routerLink]="path.link" tabindex="-1"><ui-icon name="arrow-left" [size]="12" /><ui-ws-badge size="sm" [name]="path.name" />{{ path.name }}</a>
          <span class="zen-here">/</span>
          <span class="zen-here">{{ areaKey() | transloco }}</span>
        </nav>
      }
      <span class="zen-id" data-zen-part="id">{{ id() }}</span>
      @if (title(); as title) {
        <span class="zen-title" data-zen-part="title" [attr.title]="title">{{ title }}</span>
      }
      <span class="zen-chips">
        @if (type(); as type) {
          <ui-chip variant="plain" data-zen-part="type">{{ 'types.' + type | transloco }}</ui-chip>
        }
        <ui-chip tone="primary" [dot]="true" data-zen-part="stage">{{ stageKey() | transloco }}</ui-chip>
      </span>
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
  protected readonly type = computed(() => this.body()?.head.type ?? null);
  /** The prototype path: back to the workspace, its name, then the open area. */
  protected readonly wsPath = computed(() => {
    const ws = this.state.ws();
    return ws === null ? null : { link: '/w/' + ws, name: this.data.workspaceName(ws) };
  });
  protected readonly areaKey = computed(() => `shell.areas.${this.state.area() ?? 'status'}`);
  protected readonly stageKey = computed(() => `stages.${this.body()?.head.stage ?? this.data.currentRow()?.stage ?? 'plan'}`);
  protected readonly claims = computed(() => {
    const claims = this.body()?.keyNumbers.claims;
    return claims ? { closed: claims.closed, total: claims.total } : null;
  });
  protected readonly command = computed(() => this.body()?.head.nextCommand ?? null);
  protected readonly notes = computed(() => this.body()?.areas.notes.count ?? null);
  protected readonly notesLink = computed(() => notesLinkOf(this.state.ws(), this.state.specId()));
}
