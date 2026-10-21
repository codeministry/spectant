import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BandDivider } from '../../core/model/board-types';
import { UiIcon } from '../../shared/icons/icon';
import { UiTime } from '../../shared/time';

/** The quiet row between two milestones' feature bands (spec 037, decision 6): "⚑ Free · 2026-12-31", not interactive. */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the divider's <p>, so the grid keeps its row element
  selector: 'p[app-band-divider]',
  imports: [TranslocoPipe, UiIcon, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './band-divider-row.html',
  styleUrl: './band-divider-row.css',
})
export class BandDividerRow {
  readonly divider = input.required<BandDivider>();
}
