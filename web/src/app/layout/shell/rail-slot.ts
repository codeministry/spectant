import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiCard } from '../../shared/ui/card/card';
import { DetailSidebar } from '../detail-sidebar/detail-sidebar';
import { DetailSelection } from '../detail-sidebar/selection';
import { RailContent } from './rail-content';
import { ShellState } from './shell-state.service';

/**
 * The context rail's slot: the blocks the current view registered with `RailContent` (the board's This frame, Needs
 * you and Your steps, T88; the spec rail of every spec-detail tab, spec 024), else at wide an empty placeholder card for
 * a view that registers nothing. Below 1120 px a view without blocks shows nothing here (the prototype's rail is
 * `only-wide`; each tab keeps its own inline blocks). While a docking page (the tree lens, the workspace dashboard)
 * has an object selected at wide, the detail sidebar (spec 026, T14) takes the slot in place of the blocks.
 */
@Component({
  selector: 'app-rail-slot',
  imports: [DetailSidebar, NgTemplateOutlet, TranslocoPipe, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-slot': 'rail' },
  styleUrl: './rail-slot.css',
  templateUrl: './rail-slot.html',
})
export class RailSlot {
  protected readonly content = inject(RailContent);
  protected readonly state = inject(ShellState);
  protected readonly selection = inject(DetailSelection);
}
