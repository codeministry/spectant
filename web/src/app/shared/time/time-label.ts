import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../core/language.service';
import { UiTime, type UiTimeForm } from './time';

/** The translation parameters of a sentence, besides its time. */
export type TimeLabelParams = Readonly<Record<string, unknown>>;

/** The split character: a private-use code point no catalogue text holds (guarded by `time-label.spec.ts`). */
export const TIME_SENTINEL = '';

/**
 * A translated sentence with exactly one time in it (spec 006, ISC-114.4): the key is translated with the split
 * character as its time parameter, cut there, and the time rendered between the two halves as a `<ui-time>`. So each
 * language keeps its own word order and no catalogue key is added. A text without the placeholder gets the time after
 * it.
 */
@Component({
  selector: 'ui-time-label',
  imports: [UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `{{ parts().before }}<ui-time [value]="value()" [form]="form()" />{{ parts().after }}`,
})
export class UiTimeLabel {
  readonly key = input.required<string>();
  readonly params = input<TimeLabelParams>({});
  readonly value = input.required<string>();
  readonly form = input<UiTimeForm>('instant');
  /** The catalogue parameter that holds the time: `time` in most sentences, `date` in `brief.asOf`. */
  readonly timeParam = input('time');

  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;
  // Recomputes once the active language's catalogue has loaded.
  private readonly translation = toSignal(this.transloco.selectTranslation());

  protected readonly parts = computed(() => {
    this.translation();
    const text = this.transloco.translate(this.key(), { ...this.params(), [this.timeParam()]: TIME_SENTINEL }, this.lang());
    const at = text.indexOf(TIME_SENTINEL);
    if (at < 0) return { before: text === '' ? '' : `${text} `, after: '' };
    return { before: text.slice(0, at), after: text.slice(at + TIME_SENTINEL.length) };
  });
}
