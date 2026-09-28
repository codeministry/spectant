import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

const NBSP = String.fromCharCode(0xa0);

/**
 * A visually hidden polite live region (design.md § States, ISC-62): the page owns one and calls `announce()` once
 * per refresh, only when something changed, and after a copy ("Copied /spec-implement 012"). Repeating the same
 * text toggles a trailing no-break space, so screen readers announce it again without a timer.
 */
@Component({
  selector: 'ui-live-region',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-live': 'polite', 'aria-atomic': 'true' },
  styles: `
    :host { position: absolute; overflow: hidden; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; clip-path: inset(50%); white-space: nowrap; }
  `,
  template: `{{ message() }}`,
})
export class UiLiveRegion {
  protected readonly message = signal('');

  announce(text: string): void {
    this.message.update((previous) => (previous === text ? `${text}${NBSP}` : text));
  }
}
