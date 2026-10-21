import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { BoardQueryState } from '../../core/model/board-query';
import type { BandPlace } from '../../core/model/board-types';
import type { ReorderStep } from '../../layout/backlog-menu/reorder-menu';
import { BacklogWriter } from '../../layout/shell/backlog-writer.service';
import { UiIcon } from '../../shared/icons/icon';
import { RefusalNotice } from '../../shared/ui/refusal-notice/refusal-notice';
import { BandHeadLine } from './band-head-line';
import type { BandHead } from './board-view';

/** Alt+↑ / Alt+↓ on a band's grip: the step and the key event it came with. */
export interface BandKeyStep {
  readonly step: ReorderStep;
  readonly event: Event;
}

/**
 * A band head's inside (spec 037, ISC-197, ISC-198; spec 061): the label sticking to the scroller's start with the
 * grip, the heading and another milestone's lock hint, then a refused move's notice from the backlog writer. The grip
 * is the band drag's handle; the drag is the host `<div class="band-head">` in the page's band list, found through the
 * element injector. At compact the head is no drag and the handle has no drag to serve.
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- an attribute on the band's head <div>, so the band list keeps its drag element
  selector: 'div[app-band-header]',
  imports: [BandHeadLine, CdkDragHandle, RefusalNotice, TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './band-header.html',
  styleUrl: './band-header.css',
})
export class BandHeader {
  readonly band = input.required<BandHead & Pick<BandPlace, 'moveGroup'>>();
  readonly group = input.required<BoardQueryState['group']>();
  /** The band's "Move" menu is open on this grip. */
  readonly expanded = input(false);
  /** The grip's accessible name. */
  readonly label = input.required<string>();
  /** The band belongs to another milestone than the band being dragged. */
  readonly locked = input(false);
  /** The grip was clicked: the menu anchors to it. */
  readonly open = output<HTMLElement>();
  readonly step = output<BandKeyStep>();

  protected readonly writer = inject(BacklogWriter);
}
