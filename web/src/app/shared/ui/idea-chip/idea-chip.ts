import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from '../../icons/icon';

/**
 * An idea, one story file of the backlog (ISC-124.2, design 008 § shared primitives): a dashed 22 px chip with the
 * `lightbulb` glyph and the story slug in mono, or its title when the caller passes one, linking to the read-only idea
 * page `/w/:ws/ideas/:slug`. The slug stays the link target and the tooltip whatever the text shows. Shared by the
 * board, dashboard, features, milestones and palette.
 */
@Component({
  selector: 'ui-idea-chip',
  imports: [RouterLink, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './idea-chip.css',
  templateUrl: './idea-chip.html',
})
export class UiIdeaChip {
  readonly ws = input.required<string>();
  /** The story file name without `.md` (`IdeaRef.slug`). */
  readonly slug = input.required<string>();
  /** `IdeaRef.title`; absent or empty shows the slug. */
  readonly title = input<string>();
  /** The detail sidebar's `data-ref` on the link (spec 026, T28), for a view that selects the idea; none by default. */
  readonly ref = input<string | null>(null);

  protected readonly link = computed(() => ['/w', this.ws(), 'ideas', this.slug()]);
}
