import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { type Tone, toneMark } from '../tone';

/** One stop on the scrubber: `dispatch` a hollow tick, `result` filled in its worst state's tone, `recut` hatched,
 * `live` the lime ring. `label` is the frame's accessible value ("R2", "Live"). */
export interface ScrubberFrame {
  readonly kind: 'dispatch' | 'result' | 'recut' | 'live';
  readonly label: string;
  readonly tone?: Tone;
  /** Visible text under the tick ("R2", "Live"); the board leaves it out where ticks sit too close (compact). */
  readonly caption?: string;
}

/** A re-cut marker (ISC-91): hatched, drawn between the stop before `before` and `before` itself, with a visible label.
 * `title`, when given, is the label's tooltip and accessible name (the frame and the struck, changed, added counts). */
export interface ScrubberMarker {
  readonly before: number;
  readonly label: string;
  readonly title?: string;
}

const STEP_KEYS: Readonly<Partial<Record<string, (value: number, max: number) => number>>> = {
  ArrowRight: (v) => v + 1,
  ArrowUp: (v) => v + 1,
  ArrowLeft: (v) => v - 1,
  ArrowDown: (v) => v - 1,
  PageUp: (v) => v + 1,
  PageDown: (v) => v - 1,
  Home: () => 0,
  End: (_, max) => max,
};

/**
 * The Live scrubber (design.md § Live, ISC-87 to ISC-91): 32 px ◂ ▶ ▸ step buttons and a real `<input type="range">`
 * over the frames, named by `aria-valuetext` = the frame label. The keys a native range knows (arrows, Page keys,
 * Home, End) are handled here with the same meaning, so the frame changes the same way in every engine and in jsdom.
 * Ticks sit on the rail by kind; the progress fill morphs over `--motion-duration-slow` (400 ms), which is 0ms under
 * reduced motion (motion.css). `value` and `playing` are two-way `model()`s: the board owns playback and binds the
 * frame to its query param.
 */
@Component({
  selector: 'ui-scrubber',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './scrubber.css',
  templateUrl: './scrubber.html',
})
export class UiScrubber {
  readonly frames = input.required<readonly ScrubberFrame[]>();
  readonly value = model(0);
  readonly playing = model(false);
  /** Re-cut markers between stops; they are not stops themselves, so the value stays the frame index. */
  readonly markers = input<readonly ScrubberMarker[]>([]);
  /** Overrides the default accessible name ("Frame"). */
  readonly ariaLabel = input<string>();

  protected readonly max = computed(() => Math.max(0, this.frames().length - 1));
  protected readonly valueText = computed(() => this.frames()[this.value()]?.label ?? '');
  protected readonly progress = computed(() => (this.max() === 0 ? 0 : this.value() / this.max()));

  protected position(index: number): number {
    return this.max() === 0 ? 0 : (index / this.max()) * 100;
  }

  protected tickColor(frame: ScrubberFrame): string {
    return toneMark(frame.tone ?? 'neutral');
  }

  protected go(next: number): void {
    const clamped = Math.min(this.max(), Math.max(0, Math.round(next)));
    if (clamped !== this.value()) this.value.set(clamped);
  }

  protected onInput(event: Event): void {
    this.go(Number((event.target as HTMLInputElement).value));
  }

  protected onKey(event: KeyboardEvent): void {
    const step = STEP_KEYS[event.key];
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.go(step(this.value(), this.max()));
  }
}
