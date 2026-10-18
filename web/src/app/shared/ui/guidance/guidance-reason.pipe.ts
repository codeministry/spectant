import { Pipe, type PipeTransform, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { GuidanceReason } from '../../../../../../core/src/files';

/** Where the sentences live: `guidance.reason.<key>`, the key's dots read as nesting or as one literal key alike. */
export const GUIDANCE_REASON_PREFIX = 'guidance.reason.';

/** Where a value's own word lives: `guidance.value.<placeholder>.<value>`, e.g. `guidance.value.state.stale`. */
export const GUIDANCE_VALUE_PREFIX = 'guidance.value.';

/** Keys already warned about, so a missing sentence warns once per session, not once per render. */
const warned = new Set<string>();

/**
 * A guidance entry's reason as one sentence of the active catalogue (ISC-237.1): `guidance.reason.<key>` filled with
 * the reason's `values` as params, so the same item reads the same sentence on every surface. A value with its own
 * word in the catalogue (`guidance.value.<placeholder>.<value>`, the closed `state` words) is passed as that word,
 * never as core's English machine word. Transloco stores each
 * catalogue flattened, so the key `stage.review.0` resolves whether the catalogue nests it (stage → review → 0) or
 * holds it as one literal key. A key the catalogue lacks, and the key `phrase` (no template matched), show the core's
 * `phrase` unchanged and warn once naming the key. Impure because it follows the active language: the active
 * catalogue is a signal, so a language switch marks the view and the next render reads the new sentence.
 */
@Pipe({ name: 'guidanceReason', pure: false })
export class GuidanceReasonPipe implements PipeTransform {
  private readonly transloco = inject(TranslocoService);
  /** The active language's flattened catalogue; it emits again once a switched-to language has loaded. */
  private readonly catalogue = toSignal(this.transloco.selectTranslation());

  /** `fallback` is what no entry reads: a surface's own phrase where the guidance names no entry for its item. */
  transform(reason: GuidanceReason | null | undefined, fallback = ''): string {
    if (!reason) return fallback;
    const catalogue = this.catalogue();
    // Not loaded yet: the phrase stands in without a warning, the sentence follows on the next emission.
    if (!catalogue) return reason.phrase;
    const path = `${GUIDANCE_REASON_PREFIX}${reason.key}`;
    if (reason.key !== 'phrase' && typeof catalogue[path] === 'string') {
      return this.transloco.translate(path, this.words(reason.values, catalogue));
    }
    if (!warned.has(reason.key)) {
      warned.add(reason.key);
      console.warn(`guidanceReason: no sentence for reason key "${reason.key}", showing the core phrase`);
    }
    return reason.phrase;
  }

  /** Each value as the catalogue's word for it where one exists, else as it stands. */
  private words(values: GuidanceReason['values'], catalogue: Readonly<Record<string, unknown>>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(values).map(([name, value]) => {
        const word = catalogue[`${GUIDANCE_VALUE_PREFIX}${name}.${value}`];
        return [name, typeof word === 'string' ? word : value];
      }),
    );
  }
}
