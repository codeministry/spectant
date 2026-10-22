import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';

/**
 * The head of a workspace tile on `/` (spec 024 T54, spec 066 T10): the block `[data-tile-block="head"]`, 48 px
 * (`--tile-head`), two lines beside the 30 px badge (`[data-ws-badge]`, the stored logo or the initials on the
 * accent tint). Line 1 holds the name as h2, line 2 the path tail, `·` and what the caller projects (the "Updated"
 * time). The cover is no longer here: the tile renders the preview in its own track below the head.
 * The identity is core's data, no mock: the badge reads only the name (initials, accent of its hash) and the logo
 * stored with spec 016, so the head carries no demo chip.
 */
@Component({
  selector: 'app-ws-identity',
  imports: [RouterLink, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-tile-block': 'head' },
  templateUrl: './ws-identity.html',
  styleUrl: './ws-identity.css',
})
export class WsIdentity {
  /** The workspace name as core reports it. */
  readonly name = input.required<string>();
  readonly slug = input.required<string>();
  readonly pathTail = input('');
  /** Whether badge and name link to the workspace (a loading or unreadable tile does not). */
  readonly link = input(true);
  /** The stored logo (spec 016, the loopback image route); without one the badge shows the initials. */
  readonly logo = input<string | null>(null);

  protected readonly href = computed(() => ['/w', this.slug()]);
}
