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
  styles: `
    :host { display: flex; gap: 8px; align-items: center; min-inline-size: 0; block-size: 56px; }
    .step-buttons { display: flex; flex: none; gap: 4px; }
    .step-button { inline-size: 32px; block-size: 32px; min-block-size: 32px; padding: 0; }
    .step-button svg { inline-size: 16px; block-size: 16px; fill: currentcolor; }
    .rail { position: relative; flex: 1; min-inline-size: 0; block-size: 32px; }
    .track, .fill { position: absolute; inset-block-start: 50%; block-size: 4px; margin-block-start: -2px; border-radius: 999px; }
    .track { inset-inline: 8px; background: var(--track); }
    .fill { inset-inline-start: 8px; inline-size: calc((100% - 16px) * var(--progress)); background: var(--color-primary); transition: inline-size var(--motion-duration-slow) var(--motion-ease-standard); }
    .ticks { position: absolute; inset-block: 0; inset-inline: 8px; pointer-events: none; }
    .tick { position: absolute; inset-block-start: 50%; box-sizing: border-box; translate: -50% -50%; border-radius: 50%; }
    .tick[data-kind='dispatch'] { inline-size: 8px; block-size: 8px; border: 1.5px solid var(--tick-color); background: var(--color-base-100); }
    .tick[data-kind='result'] { inline-size: 10px; block-size: 10px; background: var(--tick-color); }
    .tick[data-kind='recut'] { inline-size: 6px; block-size: 16px; border-radius: 2px; background: repeating-linear-gradient(45deg, var(--color-warning) 0 2px, transparent 2px 4px); }
    .tick[data-kind='live'] { inline-size: 12px; block-size: 12px; border: 2px solid var(--color-accent); background: var(--color-base-100); }
    .marker { position: absolute; inset-block-start: 50%; box-sizing: border-box; translate: -50% -50%; inline-size: 6px; block-size: 16px; border-radius: 2px; background: repeating-linear-gradient(45deg, var(--color-warning) 0 2px, transparent 2px 4px); }
    .caption, .marker-label { position: absolute; translate: -50% 0; color: var(--muted-ink); font-size: 11px; font-variant-numeric: tabular-nums; line-height: 12px; white-space: nowrap; }
    .caption { inset-block-start: calc(50% + 9px); }
    .marker-label { inset-block-end: calc(50% + 9px); color: var(--hover-ink); }
    .caption[data-current] { color: var(--color-base-content); font-weight: 600; }
    .tick[data-current] { outline: 2px solid var(--color-base-content); outline-offset: 1px; }
    input { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; margin: 0; opacity: 0; cursor: pointer; }
    input:focus-visible { opacity: 1; background: none; }
    @media (forced-colors: active) {
      .tick { border: 1px solid CanvasText; }
      .tick[data-kind='result'], .fill { background: CanvasText; }
    }
  `,
  template: `
    <div class="step-buttons">
      <button type="button" class="btn btn-ghost btn-square step-button" data-step="previous" [attr.aria-label]="'scrubber.previous' | transloco" [disabled]="value() <= 0" (click)="go(value() - 1)">
        <svg data-icon-exempt viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M10.5 3.5 4.5 8l6 4.5z" /></svg>
      </button>
      <button type="button" class="btn btn-ghost btn-square step-button" data-step="play" [attr.aria-label]="'scrubber.play' | transloco" [attr.aria-pressed]="playing()" (click)="playing.set(!playing())">
        <svg data-icon-exempt viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M4.5 2.5v11l9-5.5z" /></svg>
      </button>
      <button type="button" class="btn btn-ghost btn-square step-button" data-step="next" [attr.aria-label]="'scrubber.next' | transloco" [disabled]="value() >= max()" (click)="go(value() + 1)">
        <svg data-icon-exempt viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m5.5 3.5 6 4.5-6 4.5z" /></svg>
      </button>
    </div>
    <div class="rail" [style.--progress]="progress()">
      <span class="track"></span>
      <span class="fill"></span>
      <div class="ticks" aria-hidden="true">
        @for (frame of frames(); track $index) {
          <span class="tick" [attr.data-kind]="frame.kind" [attr.data-current]="$index === value() ? '' : null" [style.inset-inline-start.%]="position($index)" [style.--tick-color]="tickColor(frame)"></span>
        }
        @for (marker of markers(); track marker.before) {
          <span class="marker" data-kind="recut" [style.inset-inline-start.%]="position(marker.before - 0.5)"></span>
        }
      </div>
      <div class="ticks captions">
        @for (frame of frames(); track $index) {
          @if (frame.caption; as caption) {
            <span class="caption" [attr.data-current]="$index === value() ? '' : null" [style.inset-inline-start.%]="position($index)">{{ caption }}</span>
          }
        }
        @for (marker of markers(); track marker.before) {
          <span class="marker-label" data-recut-label [attr.data-recut-before]="marker.before" [attr.title]="marker.title ?? null" [attr.aria-label]="marker.title ?? null" [style.inset-inline-start.%]="position(marker.before - 0.5)">{{ marker.label }}</span>
        }
      </div>
      <input
        type="range"
        min="0"
        step="1"
        [max]="max()"
        [value]="value()"
        [disabled]="frames().length === 0"
        [attr.aria-label]="ariaLabel() ?? ('scrubber.label' | transloco)"
        [attr.aria-valuetext]="valueText()"
        (input)="onInput($event)"
        (keydown)="onKey($event)"
      />
    </div>
  `,
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
