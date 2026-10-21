import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BoardQueryState } from '../../core/model/board-query';
import { UiIcon } from '../../shared/icons/icon';
import { UiMeter } from '../../shared/ui/meter/meter';
import { UiTime } from '../../shared/time';
import { bandDone, type BandHead } from './board-view';

/**
 * A swimlane band's head line (spec 037, ISC-197), on the `h3.bh` of a band: the mono F-ID and name, or the flag,
 * milestone name and target date; then the card count and, for a band across the board, the done cards' mini meter.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the band's <h3>, so the band head keeps its heading
  selector: 'h3[app-band-head]',
  imports: [TranslocoPipe, UiIcon, UiMeter, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './band-head-line.html',
  styleUrl: './band-head-line.css',
})
export class BandHeadLine {
  readonly band = input.required<BandHead>();
  readonly group = input.required<BoardQueryState['group']>();
  protected readonly done = computed(() => bandDone(this.band()));
}
