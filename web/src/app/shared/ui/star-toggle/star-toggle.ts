import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { LanguageService } from '../../../core/language.service';
import { UiIcon } from '../../icons/icon';

/** `sm` is the 32 px quiet-icon box of the spec select, the dashboard row and the spec head; `head` the 28 px box of
 * the compact spec head, level with the gate icon (spec 052 design.md, Mobile). */
export type StarToggleSize = 'sm' | 'head';

/**
 * The favorite toggle of spec 052 (ISC-300), one primitive for its three consumers: the spec head, the dashboard's
 * spec row and the header spec select. The accessible name stays fixed and names the spec (the caller passes
 * `favorites.toggle`); `aria-pressed` carries the state and `title` the action, so a screen reader never hears the
 * state twice (ARIA APG, as the archive toggle of spec 050). The state belongs to the caller: a click only emits
 * `toggled`, the primitive knows no route and no service beyond the language.
 */
@Component({
  // Attribute-style on purpose, as `ui-icon-button`: the native button keeps its semantics, and the host is the focus
  // target a roving companion can hand its tabindex to.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[ui-star-toggle]',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './star-toggle.css',
  host: {
    type: 'button',
    '[attr.aria-pressed]': "pressed() ? 'true' : 'false'",
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'action()',
    '[attr.data-size]': 'size()',
    '(click)': 'toggled.emit()',
  },
  templateUrl: './star-toggle.html',
})
export class UiStarToggle {
  readonly pressed = input(false);
  /** The fixed accessible name, translated by the caller ("Favorite: 052 Spec favorites"). */
  readonly label = input.required<string>();
  readonly size = input<StarToggleSize>('sm');
  readonly toggled = output();

  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;

  protected readonly action = computed(() =>
    this.transloco.translate(this.pressed() ? 'favorites.remove' : 'favorites.add', {}, this.lang()),
  );
}
