import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../../core/src/files';

export type StageState = 'done' | 'current' | 'held' | 'blocked' | 'pending';

/** The two detours every type has and no workflow row lists: markers on the track, never segments. */
export type StageDetour = 'blocked' | 'close-pending';

/** The most main-path segments a workflow row can reach (design 008 § stage track). */
const MAX_SEGMENTS = 7;
const DETOURS: ReadonlySet<string> = new Set<StageDetour>(['blocked', 'close-pending']);

interface Segment {
  /** The stage key in row mode; the index in label mode. */
  readonly key: string;
  readonly label: string;
  readonly state: StageState;
  readonly current: boolean;
}

/**
 * The stage track. Two ways to feed it:
 *
 * - **Row mode** (spec 008, T110, ISC-122.3): `stages` is the spec type's workflow row (`WorkflowRow.stages`), up to
 *   seven main-path segments in row order with the words from `stages.*`; `stage` is the segment the spec stands on
 *   (`done` reads as every segment done); `detour` (`blocked`, `close-pending`) is never a segment but a held-grey
 *   marker on the current one, with its word. A stage the row does not hold marks nothing current.
 * - **Label mode** (spec 002): `labels` already translated and a zero-based `current`, where `labels().length` means
 *   every stage is done. The dashboard consumers still use it. `blocked` (spec 025) keeps the progress and marks the
 *   current segment as the board's Blocked column does, in the error colour, with the word "Blocked" after the mini
 *   bars, so the state is not colour alone.
 *
 * Sizes: `mini` is 16 × 4 px bars named as one image; `labelled` an ordered list with `aria-current="step"`, 60 px per
 * segment so "Abschluss" fits; `compact` full-width unlabelled 4 px bars with only the current word under its segment,
 * the other words kept for assistive technology. Done segments in the accent, the current one in the primary, a held
 * one in `--held` with a dashed pattern so the detour is not colour alone, pending ones in `--track`.
 */
@Component({
  selector: 'ui-stage-track',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-marker]': "marker() && size() === 'labelled' ? '' : null",
  },
  styleUrl: './stage-track.css',
  templateUrl: './stage-track.html',
})
export class UiStageTrack {
  private readonly transloco = inject(TranslocoService);
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  /** Row mode: the type's workflow row, `WorkflowRow.stages`; detours in it are dropped, at most seven segments. */
  readonly stages = input<readonly WorkflowStage[]>();
  /** Row mode: the main-path stage the spec stands on (the anchor of a detour); `done` is every segment done. */
  readonly stage = input<string | null>(null);
  /** Row mode: a detour marker on the current segment, in held grey with its word. */
  readonly detour = input<StageDetour | null>(null);
  /** Label mode: the translated stage words. */
  readonly labels = input<readonly string[]>([]);
  /** Label mode: zero-based index of the current stage; `labels().length` means every stage is done. */
  readonly current = input(0);
  /** Label mode: the spec stands on `blocked` (spec 025); the current segment turns blocked and the mini track says so. */
  readonly blocked = input(false);
  readonly size = input<'mini' | 'labelled' | 'compact'>('mini');
  readonly ariaLabel = input<string>();
  /** Labelled only: a ▾ above the current segment and its label in the primary ink, so the stage is not colour alone. */
  readonly marker = input(false);

  protected readonly rowMode = computed(() => this.stages() !== undefined);

  private word(stage: string): string {
    this.lang();
    return this.transloco.translate(`stages.${stage}`);
  }

  private readonly rowStages = computed(() => (this.stages() ?? []).filter((s) => !DETOURS.has(s)).slice(0, MAX_SEGMENTS));

  /** Row mode: the index of `stage` in the row, -1 when the row does not hold it. Label mode: `current`. */
  private readonly index = computed(() => (this.rowMode() ? this.rowStages().indexOf(this.stage() as WorkflowStage) : this.current()));

  /** Label mode: the word after the mini bars while `blocked`; null otherwise and in row mode, which has `detour`. */
  protected readonly blockedLabel = computed(() => (!this.rowMode() && this.blocked() ? this.word('blocked') : null));

  protected readonly detourLabel = computed(() => {
    const detour = this.rowMode() ? this.detour() : null;
    return detour ? this.word(detour) : null;
  });

  protected readonly segments = computed<readonly Segment[]>(() => {
    const index = this.index();
    if (!this.rowMode()) {
      const blocked = this.blocked();
      return this.labels().map((label, i) => {
        const state = this.stateOf(i, index, false);
        return { key: String(i), label, state: blocked && state === 'current' ? 'blocked' : state, current: i === index };
      });
    }
    const allDone = this.stage() === 'done';
    const held = this.detour() !== null;
    return this.rowStages().map((stage, i) => ({
      key: stage,
      label: this.word(stage),
      state: allDone ? 'done' : this.stateOf(i, index, held),
      current: i === index,
    }));
  });

  protected readonly name = computed(() => {
    const given = this.ariaLabel();
    if (given !== undefined) return given;
    if (!this.rowMode()) {
      const labels = this.labels();
      const index = Math.min(this.current(), labels.length - 1);
      const blocked = this.blockedLabel();
      return `Stage ${index + 1} of ${labels.length}: ${labels[index] ?? ''}${blocked ? ` · ${blocked}` : ''}`;
    }
    const stage = this.stage();
    const index = this.index();
    const detour = this.detourLabel();
    if (index < 0) return stage ? this.word(stage) : '';
    const word = detour ? `${this.word(this.rowStages()[index] ?? '')} · ${detour}` : this.word(this.rowStages()[index] ?? '');
    this.lang();
    return this.transloco.translate('stages.position', { index: index + 1, total: this.rowStages().length, stage: word });
  });

  private stateOf(i: number, index: number, held: boolean): StageState {
    if (i < index) return 'done';
    if (i > index) return 'pending';
    return held ? 'held' : 'current';
  }
}
