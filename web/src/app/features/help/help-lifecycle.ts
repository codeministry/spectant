import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiCard } from '../../shared/ui/card/card';
import { LIFECYCLE, LIFECYCLE_TONES } from './help-sections';

/**
 * The lifecycle in two bands (Help "How a spec moves", `.flow-canvas`, `.wf-*`; spec 024 sweep): a dotted
 * canvas, "Shape & plan" and "Build & finish" with five nodes each (number, step, what it does, command, the file it
 * writes with `file`, the gate with `flag`, an optional step dotted with its `optional` pill), arrows between the
 * nodes, then the loops with `refresh-cw` and the tone legend. Static: the stages and commands come from core's stage
 * table, the optional steps from the Spec skill (`LIFECYCLE`).
 */
@Component({
  selector: 'app-help-lifecycle',
  imports: [TranslocoPipe, UiCard, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './help-lifecycle.html',
  styleUrl: './help-lifecycle.css',
})
export class HelpLifecycle {
  protected readonly lifecycle = LIFECYCLE;
  protected readonly tones = LIFECYCLE_TONES;

  /** A file path cut after each `/` and `,`: where a narrow node may break the line. */
  protected parts(file: string): readonly string[] {
    return file.split(/(?<=[/,])/u);
  }
}
