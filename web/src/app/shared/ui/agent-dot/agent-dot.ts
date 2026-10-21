import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The agent dot (spec 064, design § `ui-agent-dot`): the prototype's 8 px `--color-warning` dot with its `agent-ping`
 * ring, one beat on `--motion-duration-pulse`. Users: the specs list row and the In-progress tile. With a `label` the
 * host is an image named by it; without one it is decorative and `aria-hidden` (the tile names the agent itself).
 * Under reduced motion the ring stands still and the dot stays (ISC-467); forced colours draw the dot in `CanvasText`
 * without the ring.
 */
@Component({
  selector: 'ui-agent-dot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
  },
  styleUrl: './agent-dot.css',
  templateUrl: './agent-dot.html',
})
export class UiAgentDot {
  /** The accessible name; `null` (default) leaves the dot decorative. */
  readonly label = input<string | null>(null);
}
