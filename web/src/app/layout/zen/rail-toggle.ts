import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, viewChild } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { RailContent } from '../shell/rail-content';
import { ShellData } from '../shell/shell-data.service';
import { ShellState } from '../shell/shell-state.service';

/** Counts that ask for the reader's attention take the orange text tone; the rest stay muted. */
const ATTENTION = new Set(['needsYou', 'waiting']);

/**
 * The rail's fold control at wide (ISC-75, T38; spec 024 sets the rail fold, principal
 * 2026-10-13). Expanded, it is the rail's tools: a quiet `›` (`chevron-right`) sitting just outside the
 * rail's top-left edge (shell.css positions the host). Collapsed, the rail column shrinks to a 32 px
 * track and this is its quiet `‹` (`chevron-left`) tab, sticky with the rail, sliding in; under it the app's own
 * counts stay as small mono numbers (waiting on you and warnings, or a view's own badges such as the board's This
 * frame and Needs you), so the folded rail still signals open work. Both icons are colour-only on hover (pure
 * icons). A toggle hands focus to the counterpart control. The choice is `railCollapsed` in
 * `/api/settings` (`ShellState.toggleRail`) and survives a reload.
 */
@Component({
  selector: 'app-rail-toggle',
  imports: [TranslocoPipe, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-collapsed]': "collapsed() ? '' : null" },
  styleUrl: './rail-toggle.css',
  templateUrl: './rail-toggle.html',
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
