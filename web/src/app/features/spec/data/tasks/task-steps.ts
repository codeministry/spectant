import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { TaskStep } from '../../../../../../../core/src/files';
import { UiIcon } from '../../../../shared/icons/icon';
import type { IconName } from '../../../../shared/icons/icons';
import { UiTime } from '../../../../shared/time';
import { lookOf, StepTimeline } from '../../live/steps/step-timeline';

/** What a row's step toggle names (spec 015, ISC-232): the latest step, its word (`steps.kind.*`) and icon, the count. */
export interface LatestStep {
  readonly step: TaskStep;
  readonly word: string;
  readonly icon: IconName;
  readonly count: number;
}

/**
 * One Tasks-tab row's agent steps (spec 015, T23, ISC-232): a toggle naming the latest step, its clock with seconds and
 * the count, and under it, while `open`, the full `app-step-timeline`. Whether it is open is the caller's (the
 * `?steps=` query); this only asks for a change through `toggled`, so a live update never opens it.
 */
@Component({
  selector: 'app-task-steps',
  imports: [StepTimeline, TranslocoPipe, UiIcon, UiTime],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './task-steps.css',
  templateUrl: './task-steps.html',
})
export class TaskStepsToggle {
  /** The task's steps as core derived them (ISC-231), oldest first; empty renders nothing. */
  readonly steps = input.required<readonly TaskStep[]>();
  /** The task id (`T14`): the panel is `task-T14-steps`. */
  readonly task = input.required<string>();
  readonly open = input.required<boolean>();
  readonly toggled = output();

  protected readonly panelId = computed(() => `task-${this.task()}-steps`);
  protected readonly latest = computed<LatestStep | null>(() => {
    const steps = this.steps();
    const step = steps.at(-1);
    if (step === undefined) return null;
    const { word, icon } = lookOf(step);
    return { step, word, icon, count: steps.length };
  });
}
