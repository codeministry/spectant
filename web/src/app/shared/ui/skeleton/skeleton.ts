import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * A loading placeholder at the final geometry (design.md § States): a static tint with one `ui-shimmer` sweep per
 * `--motion-duration-skeleton`. Under reduced motion the global override in `motion.css` stops the sweep (the
 * `.ui-skeleton` class it targets is on the host) and the tint stays. Hidden from assistive technology; the 150 ms
 * show delay belongs to the consumer's loading state, not to the placeholder.
 */
@Component({
  selector: 'ui-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-skeleton',
    'aria-hidden': 'true',
    '[style.inline-size]': 'width()',
    '[style.block-size]': 'height()',
  },
  styleUrl: './skeleton.css',
  templateUrl: './skeleton.html',
})
export class UiSkeleton {
  readonly width = input('100%');
  readonly height = input('16px');
}
