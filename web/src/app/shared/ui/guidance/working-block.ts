import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkingEntry } from '../../../core/model/working';
import { UiIcon } from '../../icons/icon';
import { UiAgentDot } from '../agent-dot/agent-dot';
import { UiChip } from '../chip/chip';
import { UiGlyph } from '../glyph/glyph';
import { UiSectionHeader } from '../section-header/section-header';
import { UiFlatTile } from './flat-tile';
import { TILE_LIMIT } from './tiles';

/**
 * The block "In progress" (spec 064, ISC-460 to ISC-462; design.md § Across viewports): every spec a session holds a
 * claim of, as `workingOf` reads it off the dashboard body. A section header (`level` 2 on `/w/<ws>`, 3 on `/`) with
 * the `running` item glyph and the total as a `count` chip, then at most `TILE_LIMIT` flat tiles: the agent dot
 * (hidden from assistive tech, the tile's name says it), the id, the spec title cut with an ellipsis (full title as the
 * link's `title`), the agent session (mono, at most 16ch, full value in its `title`) and an empty end column. Each tile
 * links to `/w/<ws>/s/<id>`. With more entries a 44 px link "Show all n" leads to `/w/<ws>/specs?working=1`.
 * Without an entry the block renders nothing at all: no section, no heading, no space (ISC-462).
 */
@Component({
  selector: 'ui-working-block',
  imports: [RouterLink, TranslocoPipe, UiAgentDot, UiChip, UiFlatTile, UiGlyph, UiIcon, UiSectionHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './working-block.css',
  templateUrl: './working-block.html',
})
export class UiWorkingBlock {
  /** `workingOf(body)`, in served order. */
  readonly entries = input.required<readonly WorkingEntry[]>();
  /** The workspace slug the tiles and the "Show all" link point into. */
  readonly workspace = input.required<string>();
  /** The heading level: 2 on the workspace dashboard, 3 under a workspace column of the start. */
  readonly level = input<2 | 3>(3);
  /** The heading's id, which the section's `aria-labelledby` names; unique per page. */
  readonly headingId = input('working-heading');

  protected readonly shown = computed(() => this.entries().slice(0, TILE_LIMIT));
  protected readonly more = computed(() => this.entries().length > TILE_LIMIT);
  protected readonly specsLink = computed(() => ['/w', this.workspace(), 'specs']);
  protected readonly showAllQuery = { working: '1' } as const;

  protected specLink(entry: WorkingEntry): readonly string[] {
    return ['/w', this.workspace(), 's', entry.id];
  }
}
