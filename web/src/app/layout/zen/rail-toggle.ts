import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { RailContent } from '../shell/rail-content';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** Counts that ask for the reader's attention take the prototype's orange text tone; the rest stay muted. */
const ATTENTION = new Set(['needsYou', 'waiting']);

/**
 * The rail's fold control at wide (ISC-75, T38; spec 024 aligns it with the prototype's rail fold, principal
 * 2026-10-13). Expanded, it is the prototype's `.rail-tools`: a quiet `›` (`chevron-right`) sitting just outside the
 * rail's top-left edge (shell.css positions the host). Collapsed, the rail column shrinks to the prototype's 32 px
 * track and this is its quiet `‹` (`chevron-left`) tab, sticky with the rail, sliding in; under it the app's own
 * counts stay as small mono numbers (waiting on you and warnings, or a view's own badges such as the board's This
 * frame and Needs you), so the folded rail still signals open work. Both icons are colour-only on hover (prototype
 * "Panel toggles: pure icon"). A toggle hands focus to the counterpart control. The choice is `railCollapsed` in
 * `/api/settings` (`ShellState.toggleRail`) and survives a reload.
 */
@Component({
  selector: 'app-rail-toggle',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-collapsed]': "collapsed() ? '' : null" },
  styles: `
    :host { display: flex; }
    :host([data-collapsed]) { flex-direction: column; align-items: center; gap: 4px; }

    /* Prototype: rail-tab and rail-collapse are pure icons, no background, border or shadow, also on hover. */
    :host button.fold.fold[data-control] {
      --btn-bg: transparent;
      --btn-border: transparent;
      --btn-shadow: none;

      background: none;
      border: 0;
      box-shadow: none;
      color: var(--muted);
      transition: color var(--dur-hover) var(--ease);
    }

    :host button.fold.fold[data-control]:is(:hover, :focus-visible) {
      --btn-bg: transparent;

      color: var(--disp-text);
    }

    :host button.fold[data-control='rail-expand'] {
      animation: rail-tab-in var(--dur-pop) var(--ease);
    }

    .count {
      min-inline-size: 24px;
      font: 500 11px / 16px var(--font-mono);
      font-variant-numeric: tabular-nums;
      text-align: center;
      color: var(--muted);
    }

    .count[data-tone='attention'] {
      color: var(--hover-text);
    }

    @keyframes rail-tab-in {
      from {
        opacity: 0;
        translate: 4px 0;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      :host button.fold[data-control='rail-expand'] {
        animation: none;
      }
    }
  `,
  template: `
    @if (collapsed()) {
      <button
        #control
        ui-icon-button
        size="sm"
        class="fold"
        data-control="rail-expand"
        icon="chevron-left"
        aria-expanded="false"
        [label]="'shell.rail.expand' | transloco"
        (click)="toggle()"
      ></button>
      @if (content.badges(); as badges) {
        @for (badge of badges; track badge.key) {
          <span
            class="count"
            role="img"
            [attr.data-rail-count]="badge.key"
            [attr.data-tone]="tone(badge.key)"
            [attr.aria-label]="badge.label"
            [attr.title]="badge.label"
          >{{ badge.count }}</span>
        }
      } @else {
        @if (waiting(); as count) {
          <span
            class="count"
            data-rail-count="waiting"
            data-tone="attention"
            role="img"
            [attr.aria-label]="'shell.rail.waiting' | transloco: { count }"
            [attr.title]="'shell.rail.waiting' | transloco: { count }"
          >{{ count }}</span>
        }
        @if (warnings(); as count) {
          <span
            class="count"
            data-rail-count="warnings"
            role="img"
            [attr.aria-label]="'shell.rail.warnings' | transloco: { count }"
            [attr.title]="'shell.rail.warnings' | transloco: { count }"
          >{{ count }}</span>
        }
      }
    } @else {
      <button
        #control
        ui-icon-button
        size="sm"
        class="fold"
        data-control="rail-collapse"
        icon="chevron-right"
        aria-expanded="true"
        [label]="'shell.rail.collapse' | transloco"
        (click)="toggle()"
      ></button>
    }
  `,
})
export class RailToggle {
  protected readonly state = inject(ShellState);
  /** A view's own strip badges (the board's This frame and Needs you counts, T88) replace the two defaults. */
  protected readonly content = inject(RailContent);
  private readonly data = inject(ShellData);

  readonly collapsed = input(false);

  private readonly body = computed(() => {
    const spec = this.data.spec.value();
    return spec?.kind === 'ok' ? spec.body : null;
  });
  protected readonly waiting = computed(() => this.body()?.waitingOnYou.length ?? 0);
  protected readonly warnings = computed(() => this.body()?.warnings.length ?? 0);

  /** The control rendered now: `›` expanded, `‹` collapsed; a toggle swaps it, and the new one takes focus. */
  private readonly control = viewChild<string, ElementRef<HTMLElement>>('control', { read: ElementRef });
  private handoff = false;

  constructor() {
    afterRenderEffect(() => {
      const control = this.control()?.nativeElement;
      if (control === undefined || !this.handoff) return;
      this.handoff = false;
      control.focus({ preventScroll: true });
    });
  }

  protected tone(key: string): 'attention' | null {
    return ATTENTION.has(key) ? 'attention' : null;
  }

  protected toggle(): void {
    this.handoff = true;
    this.state.toggleRail();
  }
}
