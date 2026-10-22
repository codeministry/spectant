import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DEMO_BLOCK_ATTR, DemoData } from '../../shared/demo/demo-data';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';

/**
 * The head of a workspace tile on `/` (spec 024 T54, spec 066 T10): the block `[data-tile-block="head"]`, 48 px
 * (`--tile-head`), two lines beside the 30 px badge (`[data-ws-badge]`, the fixture's logo or the initials on the
 * accent tint). Line 1 holds the name as h2 and the demo chip, line 2 the path tail, `·` and what the caller projects
 * (the "Updated" time). The cover is no longer here: the tile renders the preview in its own track below the head.
 * The identity images are a mock (ISC-149.1): they read `DemoData.identity()` only, so the block is a `[data-demo]`
 * root whose ws-head is its `[data-demo-head]` with the demo chip. A workspace the fixture does not know gets
 * stand-ins: the monogram and the accent its name hash picks.
 */
@Component({
  selector: 'app-ws-identity',
  imports: [RouterLink, UiChip, UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { [DEMO_BLOCK_ATTR]: '', 'data-tile-block': 'head' },
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
  /** The stored logo (spec 016, the loopback image route); it wins over the fixture's stand-in. */
  readonly logo = input<string | null>(null);
  /**
   * Unused since spec 066 T10: the screenshot belongs to the tile's preview track. It stays only so the caller still
   * compiles until the tile renders the preview itself; that change removes it here and in the caller.
   */
  readonly screenshot = input<string | null>(null);

  private readonly demo = inject(DemoData);

  protected readonly identity = computed(() => this.demo.identity(this.slug()) ?? this.demo.identity(this.name()));
  protected readonly href = computed(() => ['/w', this.slug()]);
}
