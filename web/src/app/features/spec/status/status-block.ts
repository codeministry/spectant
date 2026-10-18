import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Guidance, ItemStateInfo, SpecHead, SpecNextStep, Workflow } from '../../../../../../core/src/files';
import { guidanceEntryOf, withReason } from '../../../shared/ui/guidance/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import { RunRelease } from '../../../layout/run-release/run-release';
import { UiActorChip } from '../../../shared/ui/actor-chip/actor-chip';
import { UiItemState } from '../../../shared/ui/item-state/item-state';
import { UiReason } from '../../../shared/ui/reason/reason';
import { UiStateChip } from '../../../shared/ui/state-chip/state-chip';
import { UiTimeLabel } from '../../../shared/time';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { stageSourceOf, statusAssignee, statusReason, statusTrack } from './status-model';

/**
 * The top of "Where it stands" (spec 008, T132 · T133, ISC-122.3, ISC-131), from top to bottom: the stage track drawn
 * from the type's workflow row with `blocked` / `close-pending` as held markers (unlabelled bars with the current word
 * at compact, labelled with the ▾ marker otherwise); the stage chip with "since … via …"; the one phrase of the stage
 * table in `ui-reason`'s unclamped block variant with the next command (none on close-pending, none at wide where the
 * spec head holds the canonical chip), or the done line on a done spec; and a wrapping meta line with the assignee as
 * `ui-actor-chip` (muted "unassigned" when nobody is) and the stage source as a muted hint. Everything is read from
 * the spec payload and the planning tree as served; nothing is derived here.
 *
 * Spec 040 (T49, ISC-224): when the head carries the spec's `state`, the state chip stands beside the stage chip and
 * `ui-item-state`'s block form replaces the reason block: open with the reason and the command chip, waiting with its
 * links, running with the locked chip, the agent, "since …" and the start, aborted on its warning band, done with the
 * date. Without `state` (an older payload) the reason block stays as it was. A running run of a run line carries
 * "Release run" (`app-run-release`, T62, ISC-226) in the item's action slot.
 */
@Component({
  selector: 'app-status-block',
  imports: [GuidanceReasonPipe, RunRelease, TranslocoPipe, UiActorChip, UiItemState, UiReason, UiStageTrack, UiStateChip, UiTimeLabel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: 16px; min-inline-size: 0; }
    .stage-line, .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
    .stage-chip { padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--radius-selector); color: var(--disp-ink); font-size: 12px; font-weight: 600; line-height: 16px; }
    .caption, .muted { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .done { margin: 0; color: var(--muted-ink); }
    .phrase { margin: 0; color: var(--muted-ink); font-size: 15px; line-height: 24px; }
  `,
  template: `
    <ui-stage-track
      [stages]="track().stages"
      [stage]="track().stage"
      [detour]="track().detour"
      [size]="compact() ? 'compact' : 'labelled'"
      [marker]="!compact()"
    />
    <p class="stage-line">
      <span class="stage-chip" data-stage [attr.data-value]="head().stage">{{ 'stages.' + head().stage | transloco }}</span>
      @if (stateChip(); as state) {
        <ui-state-chip data-state-chip [state]="state" family="item" />
      }
      @if (since(); as s) {
        <span class="caption" data-since><ui-time-label key="status.where.since" [params]="{ via: s.via }" [value]="s.at" /></span>
      }
    </p>
    @if (item(); as item) {
      <!-- Spec 020 (T13, ISC-237.1): the spec's guidance entry reads its catalogue sentence; without one, the phrase. -->
      @let sentence = entryReason() | guidanceReason: item.reason;
      <ui-item-state block [info]="withReason(item, sentence)" [ws]="ws()" [attr.data-next-command]="item.state === 'open' && item.command ? '' : null">
        <!-- T62 · ISC-226: "Release run" beside an open run's details; the button renders itself only for a releasable run. -->
        <app-run-release uiItemStateAction [info]="item" />
      </ui-item-state>
      @if (item.state === 'waiting' && reason(); as r) {
        <!-- ISC-122.3: a waiting stage's phrase stays verbatim in the block; the state line names what it waits on. -->
        <p class="phrase" data-phrase>{{ entryReason() | guidanceReason: r.phrase }}</p>
      }
    } @else if (reason(); as r) {
      <ui-reason [block]="true" [phrase]="r.phrase" [guidance]="entryReason()" [command]="command()" [attr.data-next-command]="command() ? '' : null" />
    } @else {
      <p class="done" data-done>{{ 'status.where.done' | transloco }}</p>
    }
    <p class="meta">
      @if (assignee(); as a) {
        <span data-assignee><ui-actor-chip [actor]="a.actor" [name]="a.name" /></span>
      } @else {
        <span class="muted" data-unassigned>{{ 'status.unassigned' | transloco }}</span>
      }
      @if (source(); as src) {
        <span class="muted" data-stage-source [attr.data-value]="src">{{ 'status.stageSource.' + src | transloco }}</span>
      }
    </p>
  `,
})
export class StatusBlock {
  readonly head = input.required<SpecHead>();
  readonly next = input.required<SpecNextStep>();
  /** `ShellData.workflow`; null until the planning tree answers, when the type's default row stands in. */
  readonly workflow = input<Workflow | null>(null);
  /** `ShellData.actorList`: the person display names. */
  readonly actors = input<readonly ActorMapping[]>([]);
  /** The compact tier: the unlabelled track with the current word under its segment. */
  readonly compact = input(false);
  /** False at wide, where the spec head holds the next command's chip. */
  readonly showCommand = input(true);
  /** "since … via …": the ISO instant of the event into the current stage and its command; null without one. */
  readonly since = input<{ readonly at: string; readonly via: string } | null>(null);

  /** The workspace slug, for the links of a waiting spec's state line. */
  readonly ws = input('');
  /** `SpecPageModel.guidance` (spec 020): the spec's own entry turns the phrase into its sentence (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);

  protected readonly entryReason = computed(() => guidanceEntryOf(this.guidance(), this.head().id)?.reason ?? null);
  protected readonly withReason = withReason;

  /**
   * The spec's item as the head carries it (spec 040, ISC-224); at wide an open command stays with the spec head, so
   * the block drops only that chip. A run's command stays: it names the run that locks the chip. Null on an older
   * payload without `state`, which keeps the reason block.
   */
  protected readonly item = computed<ItemStateInfo | null>(() => {
    const state = this.head().state;
    if (!state) return null;
    return state.state === 'open' && !this.showCommand() ? { ...state, command: undefined } : state;
  });

  /** The state chip beside the stage chip; none when the stage already says done. */
  protected readonly stateChip = computed(() => {
    const state = this.head().state;
    return !state || (state.state === 'done' && state.stage === 'done') ? null : state.state;
  });

  protected readonly track = computed(() => statusTrack(this.head(), this.workflow()));
  protected readonly reason = computed(() => statusReason(this.head(), this.next()));
  protected readonly command = computed(() => (this.showCommand() ? (this.reason()?.command ?? null) : null));
  protected readonly source = computed(() => stageSourceOf(this.head()));
  protected readonly assignee = computed(() => statusAssignee(this.head(), this.actors()));
}
