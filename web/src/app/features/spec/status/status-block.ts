import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { SpecHead, SpecNextStep, Workflow } from '../../../../../../core/src/files';
import type { ActorMapping } from '../../../../../../server/src/spec-routes.contract';
import { UiActorChip } from '../../../shared/ui/actor-chip/actor-chip';
import { UiReason } from '../../../shared/ui/reason/reason';
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
 */
@Component({
  selector: 'app-status-block',
  imports: [TranslocoPipe, UiActorChip, UiReason, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: 16px; min-inline-size: 0; }
    .stage-line, .meta { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0; }
    .stage-chip { padding: 2px 8px; border: 1px solid var(--line); border-radius: var(--radius-selector); color: var(--disp-ink); font-size: 12px; font-weight: 600; line-height: 16px; }
    .caption, .muted { color: var(--muted-ink); font-size: 12px; line-height: 16px; }
    .done { margin: 0; color: var(--muted-ink); }
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
      @if (since(); as caption) {
        <span class="caption" data-since>{{ caption }}</span>
      }
    </p>
    @if (reason(); as r) {
      <ui-reason [block]="true" [phrase]="r.phrase" [command]="command()" [attr.data-next-command]="command() ? '' : null" />
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
  /** "since … via …", formatted by the tab; null without an event into the current stage. */
  readonly since = input<string | null>(null);

  protected readonly track = computed(() => statusTrack(this.head(), this.workflow()));
  protected readonly reason = computed(() => statusReason(this.head(), this.next()));
  protected readonly command = computed(() => (this.showCommand() ? (this.reason()?.command ?? null) : null));
  protected readonly source = computed(() => stageSourceOf(this.head()));
  protected readonly assignee = computed(() => statusAssignee(this.head(), this.actors()));
}
