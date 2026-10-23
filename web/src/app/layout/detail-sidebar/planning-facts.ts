import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseActor } from '../../../../../core/src/actor';
import type { ActorRef } from '../../../../../core/src/files';
import { factsOf, type Relation, type RelationIndex } from '../../../../../core/src/relations';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiChip } from '../../shared/ui/chip/chip';
import { STAGE_ORDER, STAGE_TONE, type ToneStage } from '../../shared/ui/stage-tone';
import { UiTime } from '../../shared/time/time';
import { UiStateChip } from '../../shared/ui/state-chip/state-chip';
import type { Tone } from '../../shared/ui/tone';
import { relationAt, SEL_PARAM } from './selection';

/** One chip of a feature's spec counts: a stage, or `archived` for the specs held only in `specs/archive/`. */
export interface StageCount {
  readonly stage: ToneStage | 'archived';
  /** The catalogue key of the chip's word. */
  readonly word: string;
  readonly tone: Tone;
  readonly count: number;
}

/** One of a milestone's features as a link row that selects it. */
interface FeatureLink {
  readonly entry: Relation;
  readonly params: Record<string, string>;
}

/**
 * The counts of `feature`'s specs per stage, in workflow order (`STAGE_ORDER`), the archived ones last; a stage no spec
 * stands in has no chip, and a spec without a board stage counts nowhere.
 */
export function stageCounts(feature: Relation, index: RelationIndex): readonly StageCount[] {
  const counts = new Map<ToneStage | 'archived', number>();
  for (const ref of feature.children) {
    const spec = ref.startsWith('spec:') ? relationAt(index, ref) : undefined;
    const key = spec?.archived ? 'archived' : spec?.stage;
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const stages: readonly StageCount[] = STAGE_ORDER.flatMap((stage) => {
    const count = counts.get(stage);
    return count ? [{ stage, word: `stages.${stage}`, tone: STAGE_TONE[stage], count }] : [];
  });
  const archived = counts.get('archived');
  return archived ? [...stages, { stage: 'archived', word: 'sidebar.archived', tone: 'neutral', count: archived }] : stages;
}

/**
 * The planning facts of the detail sidebar (spec 067, T20, ISC-530): what a feature, a milestone or a claim carries
 * beyond its relations, as a `<dl>` of one key and one value per row. Every value comes from `Relation.facts`
 * (`factsOf`, core), the counts from the relation index; a value the files do not carry has no row, and an object
 * with none renders nothing.
 *
 * - Feature: the why line, the milestone, its specs per stage as chips with the stage word and the number.
 * - Milestone: the target date in mono (`ui-time`, form `day`), the description, its features as link rows with
 *   closed/total claims.
 * - Claim: the kind chip (anti, antecedent; nothing for a normal claim), the state chip, the probe as a mono block that
 *   keeps its line breaks, the verification line of a closed claim and the lock holder as an actor chip.
 *
 * A spec and a story carry their facts elsewhere and render nothing here.
 */
@Component({
  selector: 'app-planning-facts',
  imports: [RouterLink, TranslocoPipe, UiActorChip, UiChip, UiStateChip, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './planning-facts.html',
  styleUrl: './planning-facts.css',
  host: {
    'data-ui': 'planning-facts',
    '[attr.data-type]': 'relation().type',
  },
})
export class PlanningFacts {
  /** The selected object; only a feature, milestone or claim shows facts. */
  readonly relation = input.required<Relation>();
  /** The planning model's relation index, to count a feature's specs and resolve a milestone's features; null skips both. */
  readonly index = input<RelationIndex | null>(null);

  protected readonly feature = computed(() => factsOf(this.relation(), 'feature'));
  protected readonly milestone = computed(() => factsOf(this.relation(), 'milestone'));
  protected readonly claim = computed(() => factsOf(this.relation(), 'claim'));

  protected readonly stages = computed<readonly StageCount[]>(() => {
    const index = this.index();
    return index && this.relation().type === 'feature' ? stageCounts(this.relation(), index) : [];
  });

  protected readonly features = computed<readonly FeatureLink[]>(() => {
    const index = this.index();
    if (!index || this.relation().type !== 'milestone') return [];
    return this.relation().children.flatMap((ref) => {
      const entry = ref.startsWith('feature:') ? relationAt(index, ref) : undefined;
      return entry ? [{ entry, params: { [SEL_PARAM]: ref } }] : [];
    });
  });

  /** The lock holder as the actor grammar reads it; null without a lock. */
  protected readonly holder = computed<ActorRef | null>(() => {
    const raw = this.claim()?.lockHolder;
    return raw ? parseActor(raw) : null;
  });

  /** Whether any row has a value, so an object without facts leaves no empty list behind. */
  protected readonly any = computed(() => {
    const f = this.feature();
    const m = this.milestone();
    return this.claim() !== undefined || !!f?.why || !!f?.milestone || this.stages().length > 0 || !!m?.target || !!m?.description || this.features().length > 0;
  });
}
