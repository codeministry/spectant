import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { DEMO_BLOCK_ATTR, DemoData } from '../../shared/demo/demo-data';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiWsBadge } from '../../shared/ui/ws-badge/ws-badge';
import { UiWsCover } from '../../shared/ui/ws-badge/ws-cover';

/**
 * The top of a workspace column on `/` (spec 024 T54): the 16:5
 * cover (`[data-ws-cover]`, the fixture's screenshot or the name pattern) above the 56 px ws-head with the 30 px
 * badge (`[data-ws-badge]`, the fixture's logo or the initials on the accent tint), the name as h2 and the path tail;
 * the caller projects the head's end (the "Updated" time). The identity images are a mock (ISC-149.1): they read
 * `DemoData.identity()` only, so the block is a `[data-demo]` root whose ws-head is its `[data-demo-head]` with the
 * demo chip. A workspace the fixture does not know gets stand-ins: the name pattern, the monogram and
 * the accent its name hash picks.
 */
@Component({
  selector: 'app-ws-identity',
  imports: [RouterLink, TranslocoPipe, UiChip, UiWsBadge, UiWsCover],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { [DEMO_BLOCK_ATTR]: '' },
  templateUrl: './ws-identity.html',
  styleUrl: './ws-identity.css',
})
export class WsIdentity {
  /** The workspace name as core reports it. */
  readonly name = input.required<string>();
  readonly slug = input.required<string>();
  readonly pathTail = input('');
  /** Whether cover and name link to the workspace (a loading or unreadable column does not). */
  readonly link = input(true);

  private readonly demo = inject(DemoData);

  protected readonly identity = computed(() => this.demo.identity(this.slug()) ?? this.demo.identity(this.name()));
  protected readonly href = computed(() => ['/w', this.slug()]);
}
