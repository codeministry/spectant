import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';

export type RelativeUnit = 's' | 'min' | 'h' | 'd';
export type RelativeFormat = (value: number, unit: RelativeUnit) => string;

/** How often the label re-reads the clock (design.md: "Updated 12 s ago" updates every 10 s). */
const TICK_MS = 10_000;

/** Whole units elapsed from `then` to `now`, both epoch milliseconds; a future `then` reads as 0 s. */
export function relativeParts(then: number, now: number): { value: number; unit: RelativeUnit } {
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return { value: seconds, unit: 's' };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { value: minutes, unit: 'min' };
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? { value: hours, unit: 'h' } : { value: Math.floor(hours / 24), unit: 'd' };
}

// TODO(T23): the consumer passes a Transloco-backed `format` once T23 lands; this is the English fallback.
const ENGLISH: RelativeFormat = (value, unit) => `${value} ${unit} ago`;

/**
 * "12 s ago" / "3 min ago" in a `<time datetime>`, refreshed every 10 s from a signal. Hidden from assistive
 * technology (design.md § Header: "not announced"); the page's live region reports refreshes instead.
 */
@Component({
  selector: 'ui-relative-time',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { font-variant-numeric: tabular-nums; white-space: nowrap; }
  `,
  template: `<time aria-hidden="true" [attr.datetime]="iso()">{{ text() }}</time>`,
})
export class UiRelativeTime {
  readonly date = input.required<Date | string | number>();
  readonly format = input<RelativeFormat>(ENGLISH);

  private readonly now = signal(Date.now());
  private readonly epoch = computed(() => new Date(this.date()).getTime());
  protected readonly iso = computed(() => new Date(this.epoch()).toISOString());
  protected readonly text = computed(() => {
    const { value, unit } = relativeParts(this.epoch(), this.now());
    return this.format()(value, unit);
  });

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), TICK_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}
