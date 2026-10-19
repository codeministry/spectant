import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { parseActor } from '../../../../../../../core/src/actor';
import type { ActorRef, TaskStep } from '../../../../../../../core/src/files';
import { LanguageService } from '../../../../core/language.service';
import { UiIcon } from '../../../../shared/icons/icon';
import type { IconName } from '../../../../shared/icons/icons';
import { formatStepDelta, formatStepDeltaLong, UiTime } from '../../../../shared/time';
import { UiActorChip } from '../../../../shared/ui/actor-chip/actor-chip';

/** What one step reads as: its word (`steps.kind.*`), its lucide icon and its tone (design.md, the step vocabulary). */
interface StepLook {
  readonly word: string;
  readonly icon: IconName;
  readonly tone: string;
}

/** A probe's look follows its result; red and green differ in shape as well as tone. */
function lookOf(step: TaskStep): StepLook {
  switch (step.kind) {
    case 'dispatch':
      return { word: 'dispatch', icon: 'send', tone: 'muted' };
    case 'build':
      return { word: 'build', icon: 'play', tone: 'disp' };
    case 'probe':
      if (step.result === 'red') return { word: 'probeRed', icon: 'circle-x', tone: 'fail' };
      if (step.result === 'green') return { word: 'probeGreen', icon: 'circle-check', tone: 'lime' };
      return { word: 'probe', icon: 'circle-check', tone: 'muted' };
    case 'question':
      return { word: 'question', icon: 'message-circle-question', tone: 'ques' };
    case 'patch':
      return { word: 'patch', icon: 'file-diff', tone: 'cyan' };
    case 'apply':
      return { word: 'apply', icon: 'git-merge', tone: 'done' };
    case 'release':
      // The claim's release: its own word and `lock-open`, never the run release of spec 040.
      return { word: 'release', icon: 'lock-open', tone: 'muted' };
  }
}

interface StepRow extends StepLook {
  readonly step: TaskStep;
  /** The short span since the previous step (`+45 s`), or the dash on the first. */
  readonly delta: string;
  /** The spoken span, empty on the first step, which reads `steps.delta.first`. */
  readonly deltaLong: string;
  /** Set only where the actor differs from the previous step's. */
  readonly actor: ActorRef | null;
  readonly latest: boolean;
}

/**
 * One task's agent steps (spec 015, ISC-232) as core derived them (ISC-231), in their order: the oldest at the top, the
 * newest at the bottom and marked. Each step is a lucide icon (decorative) beside its visible word, the clock with
 * seconds and the span since the previous step; the actor shows only where it changes. Nothing ticks: every time is
 * absolute. Consumers: the card detail and the Tasks tab.
 */
@Component({
  selector: 'app-step-timeline',
  imports: [TranslocoPipe, UiIcon, UiTime, UiActorChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './step-timeline.css',
  template: `
    <ol class="steps" data-step-timeline [attr.aria-label]="'steps.timeline.label' | transloco: { task: task() }">
      @for (row of rows(); track $index) {
        <li
          class="step"
          [attr.data-step-kind]="row.step.kind"
          [attr.data-step-result]="row.step.result ?? null"
          [attr.data-step-latest]="row.latest ? '' : null"
          [attr.data-tone]="row.tone"
        >
          <span class="mark"><ui-icon [name]="row.icon" [size]="14" /></span>
          <span class="word" data-step-word>{{ 'steps.kind.' + row.word | transloco }}</span>
          @if (row.latest) {
            <span class="vh">{{ 'steps.timeline.latest' | transloco }}</span>
          }
          <ui-time class="time" data-step-time [value]="row.step.ts" form="clockSeconds" />
          <span class="meta">
            <span class="delta" data-step-delta aria-hidden="true">{{ row.delta }}</span>
            <span class="vh" data-step-delta-long>{{
              row.deltaLong ? ('steps.delta.after' | transloco: { duration: row.deltaLong }) : ('steps.delta.first' | transloco)
            }}</span>
            @if (row.actor; as actor) {
              <ui-actor-chip [actor]="actor" />
            }
          </span>
          @if (row.step.text; as text) {
            <p class="question" data-step-question>{{ text }}</p>
          }
        </li>
      }
    </ol>
  `,
})
export class StepTimeline {
  readonly steps = input.required<readonly TaskStep[]>();
  /** The task the steps belong to (`T12`), for the list's accessible name. */
  readonly task = input.required<string>();

  private readonly lang = inject(LanguageService).current;

  protected readonly rows = computed<readonly StepRow[]>(() => {
    const steps = this.steps();
    const lang = this.lang();
    return steps.map((step, i) => {
      const previous = i > 0 ? steps[i - 1] : undefined;
      const span = previous ? Date.parse(step.ts) - Date.parse(previous.ts) : Number.NaN;
      const known = !Number.isNaN(span);
      return {
        ...lookOf(step),
        step,
        delta: known ? formatStepDelta(span) : '—',
        deltaLong: known ? formatStepDeltaLong(span, lang) : '',
        actor: previous?.actor === step.actor ? null : parseActor(step.actor),
        latest: i === steps.length - 1,
      };
    });
  });
}
