import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The Spectant ring mark (spec 072, design.md § Desktop "`ui-brand-mark`"): the living ring of the app header, lime
 * into cyan with the violet dot in its gap, moved verbatim from `shell-brand`. 27 px in the header, 28 px in the
 * status widget, where it shows the `viewBox` 1:1 and so the same 3 px stroke as the rows' rings. Always decorative:
 * `aria-hidden`, no role, no label, no tab stop. The host is a fixed block box (no baseline gap) and carries no
 * animation; a consumer that turns the ring rotates the host.
 */
@Component({
  selector: 'ui-brand-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--brand-mark-size.px]': 'size()',
  },
  styleUrl: './brand-mark.css',
  templateUrl: './brand-mark.html',
})
export class UiBrandMark {
  /** 27 the app header, 28 the status widget. */
  readonly size = input<27 | 28>(27);
}
