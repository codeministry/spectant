import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ShellState } from '../../../../layout/shell/shell-state.service';

/**
 * The board's bottom bar below wide (T88, ISC-87; design.md § Mobile "Bottom bar", § Tablet): "◂ R3 · live ▸ · This
 * frame 4 · Needs you 2", sticky, 48 px plus the safe area; the middle opens the sheet with both lists. In zen the
 * board registers this bar with the shell (`RailContent.bar`) and `app-zen-footer` renders it inside its own bar, so
 * zen shows one 48 px bar, not two (`data-merged`: static, no surface of its own there).
 */
@Component({
  selector: 'app-frame-bar',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-bottom-bar': '', '[attr.data-merged]': "state.zen() ? '' : null" },
  styles: `
    :host { position: sticky; z-index: 2; inset-block-end: 0; display: flex; gap: 4px; align-items: center; min-inline-size: 0; min-block-size: 48px; padding-block-end: env(safe-area-inset-bottom, 0); border-block-start: 1px solid var(--line); background: var(--color-base-100); }
    :host([data-merged]) { position: static; flex: 1 1 auto; min-block-size: 0; padding: 0; border: 0; background: none; }
    .step { flex: none; inline-size: 44px; block-size: 44px; }
    :host([data-merged]) .step { inline-size: 40px; block-size: 40px; }
    .step svg { inline-size: 16px; block-size: 16px; fill: currentcolor; }
    .main { display: flex; flex: 1; flex-wrap: wrap; gap: 0 12px; align-items: center; justify-content: center; min-inline-size: 0; min-block-size: 44px; border: 0; border-radius: var(--radius-field); background: none; color: var(--color-base-content); font-size: 13px; line-height: 20px; cursor: pointer; transition: background-color var(--motion-duration-instant) var(--motion-ease-standard); }
    :host([data-merged]) .main { min-block-size: 40px; flex-wrap: nowrap; white-space: nowrap; }
    .main:hover { background: var(--color-base-200); }
    .frame { font-weight: 600; }
    .count { font-variant-numeric: tabular-nums; }
  `,
  template: `
    <button type="button" class="btn btn-ghost btn-square step" data-bar-step="previous" [attr.aria-label]="'scrubber.previous' | transloco" [disabled]="index() <= 0" (click)="step.emit(index() - 1)">
      <svg data-icon-exempt viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.5 3.5 4.5 8l6 4.5z" /></svg>
    </button>
    <button type="button" class="main" data-bar-open (click)="opened.emit()">
      <span class="frame">{{ live() ? ('board.frame.live' | transloco) : label() }}</span>
      <span class="count" data-bar-count="thisFrame">{{ 'board.rail.thisFrameCount' | transloco: { count: thisFrame() } }}</span>
      <span class="count" data-bar-count="needsYou">{{ 'board.rail.needsYouCount' | transloco: { count: needsYou() } }}</span>
    </button>
    <button type="button" class="btn btn-ghost btn-square step" data-bar-step="next" [attr.aria-label]="'scrubber.next' | transloco" [disabled]="index() >= last()" (click)="step.emit(index() + 1)">
      <svg data-icon-exempt viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3.5 6 4.5-6 4.5z" /></svg>
    </button>
  `,
})
export class FrameBar {
  protected readonly state = inject(ShellState);

  readonly label = input.required<string>();
  readonly live = input(false);
  readonly thisFrame = input.required<number>();
  readonly needsYou = input.required<number>();
  readonly index = input.required<number>();
  readonly last = input.required<number>();
  readonly step = output<number>();
  readonly opened = output();
}
