import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiAgentDot } from '../../shared/ui/agent-dot/agent-dot';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiGlyph } from '../../shared/ui/glyph/glyph';
import { UiRelativeTime } from '../../shared/ui/relative-time/relative-time';
import type { TileList as TileListModel, TileRow } from './overview-model';

/**
 * The list area of a workspace tile on `/` (spec 066 T5, ISC-518; design.md § Across viewports "Listenbereich"), its
 * own one-line row form; the flat tiles of `/w/<ws>` stay as they are. Top to bottom, in the fixed height `--tile-list`:
 *
 * - the counter line: "In progress n" and "Waits on you n", both always, also at 0, the number in tabular muted ink;
 * - three row places of `--tile-row` each: the specs in progress first (agent dot, id, title, session ≤ 12ch), then what
 *   waits (item glyph, id, ref in mono ≤ 8ch without a chip, the spec title, the icon-only copy chip, the short time).
 *   Each row's link (id, ref, title) stretches over the row; the chip stands above it and takes its own clicks. Free
 *   places stay empty, without a placeholder; with no entry at all one line "Nothing is waiting on you." stands;
 * - the foot, always reserved: "Show all n →" to `/w/<ws>` once there are more entries than rows.
 *
 * Renders `tileOf`'s model as it is.
 */
@Component({
  selector: 'app-tile-list',
  imports: [RouterLink, TranslocoPipe, UiAgentDot, UiCommandChip, UiGlyph, UiIcon, UiRelativeTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tile-list.html',
  styleUrl: './tile-list.css',
})
export class TileList {
  /** The tile's list model (`OverviewColumn.tile`). */
  readonly tile = input.required<TileListModel>();
  /** The workspace slug the rows and "Show all n" link into. */
  readonly workspace = input.required<string>();
  /** The workspace's display name, for the name of "Show all n"; the slug without one. */
  readonly name = input<string | null>(null);

  protected readonly label = computed(() => this.name() ?? this.workspace());
  protected readonly wsLink = computed(() => ['/w', this.workspace()]);

  /** A row in progress opens the spec's live view, as the in-progress tiles of `/w/<ws>` do (ISC-508); a waiting row its spec. */
  protected specLink(row: TileRow): readonly string[] {
    const spec = ['/w', this.workspace(), 's', row.id];
    return row.kind === 'working' ? [...spec, 'board'] : spec;
  }
}
