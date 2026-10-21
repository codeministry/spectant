import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiKbd } from '../../../../shared/ui/kbd/kbd';
import { ShellState } from '../../../../layout/shell/shell-state.service';

/**
 * The board's bottom bar below wide (T88, ISC-87; design.md § Mobile "Bottom bar", § Tablet): "◂ R3 · live ▸ · This
 * frame 4 · Needs you 2", sticky, 48 px plus the safe area; the middle opens the sheet with both lists. In zen the
 * board registers this bar with the shell (`RailContent.bar`) and `app-zen-footer` renders it inside its own bar, so
 * zen shows one 48 px bar, not two (`data-merged`: static, no surface of its own there).
 */
@Component({
  selector: 'app-frame-bar',
  imports: [TranslocoPipe, UiKbd],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-bottom-bar': '', '[attr.data-merged]': "state.zen() ? '' : null" },
  styleUrl: './frame-bar.css',
  templateUrl: './frame-bar.html',
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
