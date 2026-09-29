import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/**
 * The rail's collapse control at wide (ISC-75, T38; design.md § Rail, "Collapsed rail"). Expanded, it is one
 * `panel-right-close` button above the rail's content; collapsed, it is the 48 px strip: `panel-right-open` and two
 * count badges (waiting on you, warnings), so the strip still signals open work. The choice is `railCollapsed` in
 * `/api/settings` (`ShellState.toggleRail`) and survives a reload.
 */
@Component({
  selector: 'app-rail-toggle',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-collapsed]': "collapsed() ? '' : null" },
  styles: `
    :host { display: flex; justify-content: flex-end; }
    :host([data-collapsed]) { flex-direction: column; gap: 8px; align-items: center; padding-block: 8px; border: 1px solid var(--line); border-radius: var(--radius-box); background: var(--color-base-100); }
    .badge { min-inline-size: 24px; font-variant-numeric: tabular-nums; }
  `,
  template: `
    @if (collapsed()) {
      <button
        ui-icon-button
        data-control="rail-expand"
        icon="panel-right-open"
        aria-expanded="false"
        [label]="'shell.rail.expand' | transloco"
        [attr.title]="'shell.rail.expand' | transloco"
        (click)="state.toggleRail()"
      ></button>
      @if (waiting(); as count) {
        <span
          class="badge badge-sm badge-ghost"
          data-rail-count="waiting"
          role="img"
          [attr.aria-label]="'shell.rail.waiting' | transloco: { count }"
        >{{ count }}</span>
      }
      @if (warnings(); as count) {
        <span
          class="badge badge-sm badge-ghost"
          data-rail-count="warnings"
          role="img"
          [attr.aria-label]="'shell.rail.warnings' | transloco: { count }"
        >{{ count }}</span>
      }
    } @else {
      <button
        ui-icon-button
        data-control="rail-collapse"
        icon="panel-right-close"
        aria-expanded="true"
        [label]="'shell.rail.collapse' | transloco"
        [attr.title]="'shell.rail.collapse' | transloco"
        (click)="state.toggleRail()"
      ></button>
    }
  `,
})
export class RailToggle {
  protected readonly state = inject(ShellState);
  private readonly data = inject(ShellData);

  readonly collapsed = input(false);

  private readonly body = computed(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });
  protected readonly waiting = computed(() => this.body()?.waitingOnYou.length ?? 0);
  protected readonly warnings = computed(() => this.body()?.warnings.length ?? 0);
}
