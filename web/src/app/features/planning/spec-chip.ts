import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { PlanningHolder } from '../../../../../core/src/planning';
import { specLink } from '../../layout/shell/areas';
import { UiIcon } from '../../shared/icons/icon';

export type SpecChipVariant = 'main' | 'other' | 'archived';

/**
 * A holding spec on the Features page (design § Features page, "The holding specs"): a 28 px pill linking to the spec.
 * `main` is the block its `isa_feature` names (primary tint, dot), `other` an outline, `archived` a dashed muted pill
 * with the archive glyph and no stage word. `PlanningHolder.main` is relative to the block the chip sits under, so the
 * holder's own main block is not derivable here: the page passes it as `mainFeature` for the accessible name of an
 * `other` chip.
 */
@Component({
  selector: 'app-spec-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslocoPipe, UiIcon],
  host: { '[attr.data-spec]': 'holder().id' },
  styleUrl: './spec-chip.css',
  templateUrl: './spec-chip.html',
})
export class SpecChip {
  private readonly transloco = inject(TranslocoService);
  /** `translate` reads no signal, so the computeds below read the language themselves to follow a switch. */
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  readonly ws = input.required<string>();
  readonly holder = input.required<PlanningHolder>();
  /** The block the chip sits under. */
  readonly feature = input.required<string>();
  /** The id of the holder's own main block (`F7`), for the accessible name of an `other` chip. */
  readonly mainFeature = input<string | null>(null);

  protected readonly variant = computed<SpecChipVariant>(() => {
    const holder = this.holder();
    return holder.archived ? 'archived' : holder.main ? 'main' : 'other';
  });
  protected readonly link = computed(() => specLink(this.ws(), this.holder().id));
  protected readonly stage = computed(() => {
    const stage = this.holder().stage;
    return stage === null || this.variant() === 'archived' ? null : this.transloco.translate(`stages.${stage}`, {}, this.lang());
  });
  protected readonly label = computed(() => {
    const id = this.holder().id;
    const stage = this.stage();
    const lang = this.lang();
    const name = stage === null ? id : `${id} ${stage}`;
    switch (this.variant()) {
      case 'archived':
        return this.transloco.translate('planning.features.holderArchived', { name }, lang);
      case 'main':
        return this.transloco.translate('planning.features.holderMain', { name }, lang);
      default: {
        const feature = this.mainFeature();
        return feature === null
          ? name
          : this.transloco.translate('planning.features.holderOther', { name, feature }, lang);
      }
    }
  });
}
