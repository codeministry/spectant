import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { LanguageService } from '../../core/language.service';
import { formatClock, formatClockSeconds, formatDate, formatDay, formatInstant } from './format';

/**
 * What `<ui-time>` shows: date and time, the date, the clock alone (under a day heading), the clock with seconds (a step
 * timeline), or a calendar day.
 */
export type UiTimeForm = 'instant' | 'date' | 'clock' | 'clockSeconds' | 'day';

/**
 * The one place that writes a displayed time (ISC-114.4): a `<time>` whose `datetime` is exactly the ISO value it was
 * formatted from, in the active app language and the browser's zone. A value that is not a date renders as raw text
 * without a `<time>`.
 */
@Component({
  selector: 'ui-time',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { font-variant-numeric: tabular-nums; }
  `,
  template: `@if (valid()) {<time [attr.datetime]="value()">{{ text() }}</time>} @else {{{ value() }}}`,
})
export class UiTime {
  readonly value = input.required<string>();
  readonly form = input<UiTimeForm>('instant');

  private readonly lang = inject(LanguageService).current;

  protected readonly valid = computed(() => !Number.isNaN(Date.parse(this.value())));
  protected readonly text = computed(() => {
    const value = this.value();
    const lang = this.lang();
    switch (this.form()) {
      case 'date':
        return formatDate(value, lang);
      case 'clock':
        return formatClock(value, lang);
      case 'clockSeconds':
        return formatClockSeconds(value, lang);
      case 'day':
        return formatDay(value, lang);
      default:
        return formatInstant(value, lang);
    }
  });
}
