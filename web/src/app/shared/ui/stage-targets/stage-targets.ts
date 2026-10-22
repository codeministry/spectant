import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../../core/src/files';
import { type DropHint, dropHint } from '../../../core/model/drop-hint';
import { UiIcon } from '../../icons/icon';
import type { BoardRefusal } from '../refusal-notice/refusal';
import { RefusalNotice } from '../refusal-notice/refusal-notice';

/** One row of the list: a stage, what it is for the item (`dropHint`) and whether choosing it sends a move. */
export interface StageTarget {
  readonly stage: WorkflowStage;
  readonly hint: DropHint;
  readonly enabled: boolean;
}

/**
 * The stage-target list (spec 067, T27, ISC-533): the entries of the board's "Move to…" (spec 008, T127, ISC-130),
 * shared so the detail sidebar renders the same list inline as a disclosure, while the board renders it in its popover
 * or bottom sheet. A `<ul>` that is the component's host (`ul[ui-stage-targets]`), so the consumer keeps its own hooks
 * and siblings around it.
 *
 * One entry per stage of `stages`, in that (column) order: the item's own stage `from` marked current
 * (`aria-current`), the stages core's table admits (`targets`, `dropTargetsOf`) enabled, every other one disabled
 * (`aria-disabled`, still focusable so its reason is read) with the drag's own hint words, "not next from …" or "gate"
 * (`dropHint`). `movable` false (a running run holds the item) disables every entry. The first enabled entry carries
 * `data-autofocus`, the current one when none is enabled, for the surface that opens the list.
 *
 * An enabled entry emits `choose` with its stage; the consumer sends the move (write path 3). `refusal` shows its
 * `app-refusal-notice` under the entry it was refused for (a run's refusal stands above the list, the consumer's), and
 * its ✕ emits `dismiss`. Rows are 44 px; `tall` makes them 56 px (the board's bottom sheet) and sets `data-tall`.
 */
@Component({
  // Attribute-style on purpose, as `ui-star-toggle`: the native list keeps its semantics, and the consumer keeps its
  // hooks on it and its siblings (the run's refusal) beside it.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'ul[ui-stage-targets]',
  imports: [RefusalNotice, TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'list', '[attr.data-tall]': 'tall() ? "" : null' },
  styleUrl: './stage-targets.css',
  templateUrl: './stage-targets.html',
})
export class UiStageTargets {
  /** The stages to list, in column order (the board's `stages`). */
  readonly stages = input.required<readonly WorkflowStage[]>();
  /** The item's own stage. */
  readonly from = input.required<WorkflowStage>();
  /** The stages core's transition table admits from `from` (`card.targets`, `dropTargetsOf`). */
  readonly targets = input.required<readonly WorkflowStage[]>();
  /** Whether the item may move at all; false while a running run holds it (spec 040, T58). */
  readonly movable = input(true, { transform: booleanAttribute });
  /** The refusal that stands for the item now, shown under the entry it was refused for unless it is a run's. */
  readonly refusal = input<BoardRefusal | null>(null);
  /** 56 px rows instead of 44 (the board's bottom sheet). */
  readonly tall = input(false, { transform: booleanAttribute });
  /** An enabled entry was chosen: its stage. */
  readonly choose = output<WorkflowStage>();
  /** The ✕ of the refusal notice under an entry. */
  readonly dismiss = output();

  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly entries = computed<readonly StageTarget[]>(() => {
    const item = { stage: this.from(), targets: this.targets() };
    const movable = this.movable();
    return this.stages().map((stage) => {
      const hint = dropHint(item, stage);
      return { stage, hint, enabled: movable && hint === 'allowed' };
    });
  });

  /** The first enabled entry takes focus on open; the current one when none is enabled. */
  protected readonly focusStage = computed(() => this.entries().find((e) => e.enabled)?.stage ?? this.from());

  protected readonly fromLabel = computed(() => this.transloco.translate(`stages.${this.from()}`, {}, this.lang()));

  protected chose(entry: StageTarget): void {
    if (entry.enabled) this.choose.emit(entry.stage);
  }
}
