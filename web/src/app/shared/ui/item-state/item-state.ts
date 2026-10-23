import { booleanAttribute, ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { ItemStateInfo, SpecWait } from '../../../../../../core/src/files';
import { LanguageService } from '../../../core/language.service';
import { UiTime } from '../../time';
import { UiActorChip } from '../actor-chip/actor-chip';
import { UiChip } from '../chip/chip';
import { UiCommandChip } from '../command-chip/command-chip';
import { UiGlyph } from '../glyph/glyph';
import { UiStateChip } from '../state-chip/state-chip';
import { UiWaitsChip } from '../waits-chip/waits-chip';
import { elapsedText } from './duration';

/** Marks the text before and after a placeholder, so a translated phrase can wrap an element (`started <time>`). */
const SPLIT = '\u0000';

/**
 * Spec 040 (T46, ISC-224, ISC-225.1): the state line of an item, on every surface in one order: glyph · "‹Stage› ·
 * ‹state›" · details. It renders the API's `ItemStateInfo` as it is and computes no state (ISC-221.1):
 *
 * - `open`: the command as a copyable `ui-command-chip`; the reason only in the accessible text, visible in `block`.
 * - `waiting`: the specs it waits on as `ui-waits-chip` links (claims as their ids), never a command.
 * - `running`: "· since 3 min" from `run.elapsedMs`, the command chip locked by the run, the agent's actor chip and the
 *   finer state as a detail. No timer and no `aria-live`: the refresh tick brings the next `elapsedMs`.
 * - `aborted`: the state word as the warning chip on `--hover-t`, "started ‹time›", the actor chip stale, the command
 *   copyable again (an aborted run does not lock).
 * - `done`: the date, and "dropped" / "struck" for a claim or task closed without being done; in the `done` stage the
 *   stage word alone.
 *
 * A chip "2 runs" stands behind the line when more than one run is open. A diagnostic is the quiet note in place of
 * the missing detail, never an invented value. Content marked `uiItemStateAction` is projected beside a run's details
 * (the release button of T62). `block` is the status block's form: details one per row, nothing hidden, and a running
 * run's start beside its duration (T49). `details` is the task row's form (T54): the details alone, the duration among
 * them, without the head and the finer state, which the row's status cell already shows.
 */
@Component({
  selector: 'ui-item-state',
  imports: [TranslocoPipe, UiActorChip, UiChip, UiCommandChip, UiGlyph, UiStateChip, UiTime, UiWaitsChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-state]': 'info().state',
    '[attr.data-kind]': 'info().kind',
    '[attr.data-block]': "block() ? '' : null",
    '[attr.data-details]': "details() ? '' : null",
    '[attr.data-reasoned]': "reasoned() ? '' : null",
  },
  styleUrl: './item-state.css',
  templateUrl: './item-state.html',
})
export class UiItemState {
  /** The item's state with its details, as the API delivers it. */
  readonly info = input.required<ItemStateInfo>();
  /** The stage word from the caller (a board column's label); without it the stage key's word from `stages.*`. */
  readonly stageLabel = input<string>();
  /** The workspace slug, for the links of `waiting`; without it the specs it waits on read as plain ids. */
  readonly ws = input('');
  /** The status block's form: larger, every detail on its own row, the reason visible. */
  readonly block = input(false, { transform: booleanAttribute });
  /** The task row's form: the details alone, the duration among them (the row's status cell names the state). */
  readonly details = input(false, { transform: booleanAttribute });
  /** Leave the run's actor chip out: the caller already shows who holds the item (a task row's agent and sub-agent). */
  readonly noActor = input(false, { transform: booleanAttribute });
  /**
   * The board card's form (spec 020, T23, ISC-240): an `open` item's reason stands visible on its own line between
   * the head and the copy chip, wrapping on whole words and never cut; the other states are unchanged.
   */
  readonly reasoned = input(false, { transform: booleanAttribute });
  /** The copy chip's size (spec 067, T36, ISC-537): the detail sidebar's run line passes `md`, `lg` in its sheet. */
  readonly chipSize = input<'default' | 'md' | 'lg'>('default');

  private readonly transloco = inject(TranslocoService);
  private readonly lang = inject(LanguageService).current;

  private t(key: string, params: Record<string, unknown> = {}): string {
    return this.transloco.translate(key, params, this.lang());
  }

  protected readonly stageWord = computed(() => {
    const label = this.stageLabel();
    if (label) return label;
    const stage = this.info().stage;
    if (!stage) return null;
    const key = `stages.${stage}`;
    const word = this.t(key);
    return word === key ? stage : word;
  });

  /** In the `done` stage the stage word already says done; without a stage the state word stands alone. */
  protected readonly stateShown = computed(() => !(this.info().state === 'done' && this.info().stage === 'done') || !this.stageWord());

  /** "Tasks · " and "" around the state word (`itemState.line`), in the active language's order. */
  protected readonly lineParts = computed(() => {
    const stage = this.stageWord();
    if (!stage) return ['', ''] as const;
    const [before = '', after = ''] = this.t('itemState.line', { stage, state: SPLIT }).split(SPLIT);
    return [before, after] as const;
  });

  protected readonly duration = computed(() => {
    const run = this.info().run;
    if (!run) return null;
    const { key, params } = elapsedText(run.elapsedMs);
    return this.t(key, params);
  });

  protected readonly since = computed(() => {
    const duration = this.duration();
    return this.info().state === 'running' && duration !== null ? ` · ${this.t('itemState.since', { duration })}` : null;
  });

  protected readonly runs = computed(() => {
    const count = this.info().run?.openRuns ?? 0;
    return count > 1 ? this.t('itemState.runs.other', { count }) : null;
  });

  /** "started " and "" around the time element, in the active language's order. */
  protected readonly started = computed(() => {
    const [before = '', after = ''] = this.t('itemState.started', { time: SPLIT }).split(SPLIT);
    return [before, after] as const;
  });

  private readonly waitSpecs = computed(() => {
    const waits = this.info().waits;
    return waits ? [...waits.specs, ...waits.siblings] : [];
  });

  protected readonly waitsChip = computed<SpecWait | null>(() => {
    const blockers = this.waitSpecs();
    if (!this.ws() || blockers.length === 0) return null;
    const { id, spec } = this.info();
    return { spec: spec ?? id, blockers, heldTasks: 0, readyTasks: 0, openTasks: 0, full: true };
  });

  protected readonly waitsText = computed(() => {
    const claims = this.info().waits?.claims ?? [];
    const ids = this.ws() ? claims : [...this.waitSpecs(), ...claims];
    return ids.length === 0 ? null : ids.join(', ');
  });
}
