import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemStateInfo } from '../../../../../core/src/files';
import type { Relation } from '../../../../../core/src/relations';
import { RunRelease } from '../run-release/run-release';

/**
 * The actions of the detail sidebar (spec 067, T30 ISC-534): a grid of two columns, one action alone takes the full
 * width, none hides the host.
 *
 * "Release run" embeds `app-run-release` unchanged for the open run the sidebar passes (`running`); its refresh after a
 * 200 drops the run, so the button and with it the grid leave. The sidebar offers no stage change (spec 068, T15
 * ISC-548): a stage moves on the board only.
 */
@Component({
  selector: 'app-sidebar-actions',
  imports: [RunRelease, TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-ui': 'sidebar-actions',
    '[attr.data-count]': 'count()',
    '[hidden]': 'count() === 0',
  },
  styleUrl: './sidebar-actions.css',
  templateUrl: './sidebar-actions.html',
})
export class SidebarActions {
  /** The selected object's relation entry; a spec or story with an open run gets "Release run". */
  readonly relation = input.required<Relation>();
  /**
   * The shown spec's or story's item while a run line's run is open on it, as the sidebar's state line reads it
   * (`DetailSidebar.running`, `releasableRun`); null shows no release.
   */
  readonly running = input<ItemStateInfo | null>(null);

  /** How many actions the grid holds; one takes the full width, none hides the host. */
  protected readonly count = computed(() => (this.running() === null ? 0 : 1));
}
