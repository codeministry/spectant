import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { factsOf, type Relation, type RelationIndex, type RelationType } from '../../../../../core/src/relations';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiStateChip } from '../../shared/ui/state-chip/state-chip';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { relationAt } from './selection';

/**
 * The facts of a story in the detail sidebar (spec 067, T18, ISC-529): its item state always, not only while a run is
 * open, then priority, type, feature (`F<n> · name`) and milestone as a `dl`, then the excerpt core cut from the story,
 * clamped to four lines. A value the story does not carry has no row. Feature and milestone are the story's parents in
 * the relation index; the component renders nothing for an entry that is not a story.
 */
@Component({
  selector: 'app-idea-facts',
  imports: [TranslocoPipe, UiPriority, UiStateChip, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './idea-facts.css',
  templateUrl: './idea-facts.html',
})
export class IdeaFacts {
  /** The selected story's relation entry; its `facts` are core's `IdeaFacts`. */
  readonly relation = input.required<Relation>();
  /** The relation index the entry comes from, to name its feature and milestone. */
  readonly index = input.required<RelationIndex>();

  protected readonly facts = computed(() => factsOf(this.relation(), 'idea'));
  protected readonly feature = computed(() => this.parent('feature'));
  protected readonly milestone = computed(() => this.parent('milestone'));

  private parent(type: RelationType): Relation | undefined {
    const index = this.index();
    for (const ref of this.relation().parents) {
      const entry = relationAt(index, ref);
      if (entry?.type === type) return entry;
    }
    return undefined;
  }
}
