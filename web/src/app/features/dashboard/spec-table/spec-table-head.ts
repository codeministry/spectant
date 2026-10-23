import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RowVariant } from './spec-row';

/** One column of the row grid (`_row-grid.css`) and its heading's key; `agent` and `star` carry none. */
interface HeadCell {
  readonly name: string;
  readonly key: string | null;
}

const CELLS: readonly HeadCell[] = [
  { name: 'id', key: 'specs.columns.id' },
  { name: 'title', key: 'specs.columns.title' },
  { name: 'feature', key: 'specs.columns.feature' },
  { name: 'mark', key: 'specs.columns.mark' },
  { name: 'agent', key: null },
  { name: 'prio', key: 'specs.columns.prio' },
  { name: 'track', key: 'specs.columns.track' },
  { name: 'phase', key: 'specs.columns.stage' },
  { name: 'meter', key: 'specs.columns.meter' },
  { name: 'star', key: null },
];

/** Spec 068 (T1, ISC-546): Next up's grid adds the copy chip's column after `star`. */
const NEXT_CELLS: readonly HeadCell[] = [...CELLS, { name: 'command', key: 'specs.columns.command' }];

/**
 * Spec 064 (T68, ISC-509): the column header row of the Specs list, one `columnheader` per named column of the rows'
 * grid (`_row-grid.css`, imported here as `app-spec-row` and `app-idea-row` import it), so every heading starts where
 * its column starts in every tier. The list wraps it in the sticky `[data-cols]` box, which is its `specs` container.
 * Spec 068 (T1, ISC-546): the variant `next` (Next up) names the rows' extra `command` column too.
 */
@Component({
  selector: 'app-spec-table-head',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './spec-table-head.html',
  styleUrl: './spec-table-head.css',
  host: { role: 'row', '[attr.data-variant]': "variant() === 'next' ? 'next' : null" },
})
export class SpecTableHead {
  /** Spec 068 (T1, ISC-546): the rows' variant, `next` for Next up's grid with the `command` column. */
  readonly variant = input<RowVariant>('list');
  protected readonly cells = computed(() => (this.variant() === 'next' ? NEXT_CELLS : CELLS));
}
