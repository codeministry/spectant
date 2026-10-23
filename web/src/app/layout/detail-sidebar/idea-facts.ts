import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { ItemRun, ItemStateInfo } from '../../../../../core/src/files';
import { factsOf, type Relation, type RelationIndex, type RelationType } from '../../../../../core/src/relations';
import { UiCommandChip } from '../../shared/ui/command-chip/command-chip';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiStateChip } from '../../shared/ui/state-chip/state-chip';
import { UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { relationAt } from './selection';

/** A story's next step: the command to copy, the phrase why, and the run that locks it. */
interface IdeaNext {
  readonly command: string;
  readonly reason: string;
  readonly run: ItemRun | null;
}

/**
 * The facts of a story in the detail sidebar (spec 067, T18, ISC-529): its item state always, not only while a run is
 * open, then priority, type, feature (`F<n> · name`) and milestone as a `dl`, then the excerpt core cut from the story,
 * clamped to four lines. A value the story does not carry has no row. Feature and milestone are the story's parents in
 * the relation index; the component renders nothing for an entry that is not a story. Last, the next step (T23,
 * ISC-531): the command the story's served item state names, with its reason, as `ui-command-chip`.
 */
@Component({
  selector: 'app-idea-facts',
  imports: [TranslocoPipe, UiCommandChip, UiPriority, UiStateChip, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './idea-facts.css',
  templateUrl: './idea-facts.html',
})
export class IdeaFacts {
  /** The selected story's relation entry; its `facts` are core's `IdeaFacts`. */
  readonly relation = input.required<Relation>();
  /** The relation index the entry comes from, to name its feature and milestone. */
  readonly index = input.required<RelationIndex>();

  /**
   * The story's item state as the API serves it on the planning tree's story (`IdeaRef.state`, core's `ideaItem`);
   * null hides the next step.
   */
  readonly item = input<ItemStateInfo | null>(null);
  /** The 44 px copy box of the compact sheet. */
  readonly large = input(false);

  protected readonly facts = computed(() => factsOf(this.relation(), 'idea'));
  /**
   * The next step (T23, ISC-531): an open story's command (`/spec new <slug>`) and reason; while a run is open on the
   * story, the run's command, locked by that run. Null when the served state names no command.
   */
  protected readonly next = computed<IdeaNext | null>(() => {
    const item = this.item();
    const run = item?.state === 'running' ? (item.run ?? null) : null;
    const command = item?.command ?? run?.command;
    return command ? { command, reason: item?.reason ?? '', run } : null;
  });
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
