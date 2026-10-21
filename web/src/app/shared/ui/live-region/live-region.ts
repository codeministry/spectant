import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

const NBSP = String.fromCharCode(0xa0);

/**
 * A visually hidden polite live region (design.md § States, ISC-62): the page owns one and calls `announce()` once
 * per refresh, only when something changed, and after a copy ("Copied /spec implement 012"). Repeating the same
 * text toggles a trailing no-break space, so screen readers announce it again without a timer.
 */
@Component({
  selector: 'ui-live-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-live': 'polite', 'aria-atomic': 'true' },
  styleUrl: './live-region.css',
  templateUrl: './live-region.html',
})
export class UiLiveRegion {
  protected readonly message = signal('');

  announce(text: string): void {
    this.message.update((previous) => (previous === text ? `${text}${NBSP}` : text));
  }

  /**
   * One announcement for everything a refresh tick changed (spec 027: "T3: patch ready; T5: building"), never one per
   * part; nothing when the tick changed nothing.
   */
  announceAll(parts: readonly string[], separator = '; '): void {
    if (parts.length > 0) this.announce(parts.join(separator));
  }
}
