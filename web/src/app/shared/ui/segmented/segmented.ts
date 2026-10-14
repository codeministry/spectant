import {
  afterRenderEffect,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { type IconName } from '../../icons/icons';
import { UiIcon } from '../../icons/icon';
import { type Tone, toneColor } from '../tone';

export interface SegmentedOption {
  readonly key: string;
  readonly label: string;
  readonly tone?: Tone;
  /** Radio mode: a 14 px icon before the label (the board view switch: `rows-3` Lanes, `workflow` Flow). */
  readonly icon?: IconName;
  /** Strip mode: the tabular number under the label (cards in the column). */
  readonly count?: number;
  /**
   * The segment's full accessible name, translated by the host: strip mode "Review, 2 cards, 1 waits on you", radio
   * mode the board's waiting lane "web, waits on 006" (spec 025).
   */
  readonly ariaLabel?: string;
}

/** `radio` picks one value (phase filter, theme mode, the compact board column); `strip` is the board's minimap. */
export type SegmentedMode = 'radio' | 'strip';

const STEP: Partial<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** The most segments one wrapped strip row holds. */
const ROW = 5;

/**
 * The strip's wrap rule: one line while its segments fit, rows of at most five once the one-line width (`natural`,
 * measured while unwrapped) exceeds the `available` width, and one line again as soon as that width fits. Five or
 * fewer segments never wrap; their labels truncate instead.
 */
export function stripWraps(count: number, available: number, natural: number): boolean {
  return count > ROW && natural > available;
}

/**
 * The minimap's source, wired by the host: watches the `[data-col]` children of a horizontal `scroller` with an
 * IntersectionObserver rooted at it (half a column visible counts as in view) and reports the `data-col` keys in view,
 * in column order, after every change. Returns the disconnect. `Observer` is injectable for tests.
 */
export function watchColumns(
  scroller: HTMLElement,
  onChange: (keys: readonly string[]) => void,
  Observer: typeof IntersectionObserver = IntersectionObserver,
  selector = '[data-col]',
): () => void {
  const columns = [...scroller.querySelectorAll<HTMLElement>(selector)];
  const visible = new Set<Element>();
  const observer = new Observer(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      onChange(columns.filter((c) => visible.has(c)).map((c) => c.dataset['col'] ?? ''));
    },
    { root: scroller, threshold: 0.5 },
  );
  for (const column of columns) observer.observe(column);
  return () => observer.disconnect();
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A segmented control with two behaviours (design 008 § board layout: one component, two behaviours).
 *
 * `mode="radio"` (default): radio-group semantics (phase filter, theme mode): one tab stop (roving tabindex on the
 * checked option), arrow keys move and select with wrap-around, Home / End jump, per the ARIA radio group pattern.
 *
 * `mode="strip"`: the board's sticky stage strip, a toolbar with one segment per column of a horizontal scroller. It
 * selects nothing (`value` is untouched): a click emits `jump` and, when `scroller` is set, scrolls that scroller to
 * the `[data-col="<key>"]` column (instantly under reduced motion). `inView` (the keys of the columns in view, which a
 * host feeds from `watchColumns`) underlines those segments, so the strip doubles as a minimap. One tab stop stays on
 * the highlighted segment, the first in view unless the keyboard moved it; arrow keys (wrap-around), Home and End move
 * it and scroll along. More than five segments that overflow one line wrap into rows of five.
 *
 * Radio mode wears the prototype's `.seg` (spec 024, ISC-148): 2 px padding, 1 px `--line` border, 8 px radius on
 * `--lane`; segments 28 px high, 6 px radius, 13 px `--muted`; the checked one `--card` with `--shadow-hair` and
 * `--text`. Two forms, as the prototype draws them:
 *
 * - default, the toolbar form (`.btool .seg`): columns as wide as their labels, segments `0 12px` with a 6 px gap
 *   for a dot or an icon (the board's Lanes / Flow);
 * - `fill`, the stretched form (the generic `.seg`): the group fills its container in equal columns and the
 *   segments carry no inline padding (settings, the compact lane switch, a sheet's tabs, the note's Edit / Preview).
 *
 * The focus ring is the global one (primitives.css).
 */
@Component({
  selector: 'ui-segmented',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-mode]': 'mode()', '[attr.data-fill]': 'fill() ? "" : null' },
  styles: `
    .seg-icon { flex: none; margin-inline-end: 6px; vertical-align: -2px; }
    :host { display: inline-flex; }
    .group { display: inline-grid; grid-auto-columns: auto; grid-auto-flow: column; min-inline-size: 0; padding: 2px; border: 1px solid var(--line); border-radius: var(--radius-field); background: var(--lane); }
    .seg { display: inline-flex; gap: 6px; align-items: center; justify-content: center; block-size: 28px; padding: 0 12px; border-radius: 6px; background: transparent; color: var(--muted-ink); font-size: 13px; cursor: pointer; transition: color var(--motion-duration-instant) var(--motion-ease-standard); }
    .seg:hover { color: var(--color-base-content); }
    .seg[aria-checked='true'] { background: var(--color-base-100); color: var(--color-base-content); box-shadow: var(--shadow-hair); }
    :host([data-fill]) { display: flex; }
    :host([data-fill]) .group { flex: 1 1 auto; grid-auto-columns: 1fr; }
    :host([data-fill]) .seg { gap: normal; padding: 0; }
    :host([data-fill]) .seg .dot { margin-inline-end: 6px; }
    /* The checked segment's own shadow outranks the zero-specificity global ring rule; keep the halo (ISC-64). */
    .seg[aria-checked='true']:focus-visible { box-shadow: 0 0 0 4px var(--focus-halo), var(--shadow-hair); }
    .dot { inline-size: 8px; block-size: 8px; border-radius: 50%; }
    :host([data-mode='strip']) { display: block; min-inline-size: 0; }
    .strip { display: flex; gap: 2px; padding-block: 4px 6px; }
    .strip[data-wrap] { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
    .sseg { --btn-fg: var(--muted-ink); position: relative; flex: 1 0 auto; gap: 6px; block-size: auto; min-block-size: 40px; padding-inline: 12px; border: 0; font-weight: 600; }
    .strip[data-wrap] .sseg { flex-direction: column; gap: 0; min-block-size: 52px; padding-inline: 4px; }
    .sseg[data-inview] { --btn-fg: var(--color-base-content); }
    .sseg[data-inview]::after { position: absolute; inset-inline: 8px; inset-block-end: 0; block-size: 2px; border-radius: 1px; background: var(--color-primary); content: ''; }
    .sl { font-size: 12px; line-height: 16px; }
    .strip[data-wrap] .sl { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow-wrap: anywhere; text-align: center; }
    .count { color: var(--color-base-content); font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; line-height: 20px; }
    .strip .dot { inline-size: 6px; block-size: 6px; }
    .strip[data-wrap] .dot { position: absolute; inset-block-start: 6px; inset-inline-end: 6px; }
    @media (forced-colors: active) {
      .seg[aria-checked='true'] { outline: 2px solid Highlight; }
      .dot { background: CanvasText; }
      .sseg[data-inview]::after { background: Highlight; }
    }
  `,
  template: `
    @if (mode() === 'strip') {
      <div #group class="strip" role="toolbar" [attr.aria-label]="label() ?? null" [attr.data-wrap]="wrapped() ? '' : null">
        @for (option of options(); track option.key; let i = $index) {
          <button
            #segment
            type="button"
            class="btn btn-ghost sseg"
            [attr.data-key]="option.key"
            [attr.data-inview]="inView().includes(option.key) ? '' : null"
            [attr.aria-label]="option.ariaLabel ?? null"
            [tabIndex]="i === highlighted() ? 0 : -1"
            (click)="go(i)"
            (keydown)="onStripKey($event)"
          >
            <span class="sl">{{ option.label }}</span>
            @if (option.count !== undefined) {
              <span class="count">{{ option.count }}</span>
            }
            @if (option.tone; as tone) {
              <span class="dot" aria-hidden="true" [style.background]="color(tone)"></span>
            }
          </button>
        }
      </div>
    } @else {
      <div class="group" role="radiogroup" [attr.aria-label]="label() ?? null">
        @for (option of options(); track option.key; let i = $index) {
          <button
            #segment
            type="button"
            role="radio"
            class="seg"
            [attr.aria-checked]="option.key === value()"
            [attr.aria-label]="option.ariaLabel ?? null"
            [tabIndex]="i === activeIndex() ? 0 : -1"
            (click)="value.set(option.key)"
            (keydown)="onKey($event)"
          >
            @if (option.tone; as tone) {
              <span class="dot" aria-hidden="true" [style.background]="color(tone)"></span>
            }
            @if (option.icon; as icon) {
              <ui-icon class="seg-icon" [name]="icon" [size]="14" />
            }
            {{ option.label }}
          </button>
        }
      </div>
    }
  `,
})
export class UiSegmented {
  readonly options = input.required<readonly SegmentedOption[]>();
  readonly value = model<string>();
  /** Accessible name of the radio group or the strip's toolbar (translated). */
  readonly label = input<string>();
  readonly mode = input<SegmentedMode>('radio');
  /** Radio mode: the stretched form (equal columns filling the container, no inline padding) instead of the toolbar form. */
  readonly fill = input(false, { transform: booleanAttribute });
  /** Strip mode: the keys of the columns currently in view, in any order (see `watchColumns`). */
  readonly inView = input<readonly string[]>([]);
  /** Strip mode: the horizontal scroller whose `[data-col]` columns the segments scroll to. */
  readonly scroller = input<HTMLElement>();
  /** Strip mode: the column a click or an arrow key moved to. */
  readonly jump = output<string>();

  protected readonly color = toneColor;
  private readonly segments = viewChildren<ElementRef<HTMLButtonElement>>('segment');
  private readonly group = viewChild<ElementRef<HTMLElement>>('group');

  /** The strip's tab stop: kept while its column stays in view, else the first column in view. */
  protected readonly highlighted = linkedSignal<{ keys: readonly string[]; inView: readonly string[] }, number>({
    source: () => ({ keys: this.options().map((o) => o.key), inView: this.inView() }),
    computation: ({ keys, inView }, previous) => {
      const kept = previous?.value;
      if (kept !== undefined && kept < keys.length && inView.includes(keys[kept] ?? '')) return kept;
      return Math.max(0, keys.findIndex((k) => inView.includes(k)));
    },
  });
  protected readonly wrapped = signal(false);
  /** The strip's one-line width, measured while unwrapped. */
  private natural = 0;

  constructor() {
    // New segments may fit one line again: unwrap, and let the measurement below decide afresh.
    effect(() => {
      this.options();
      untracked(() => this.wrapped.set(false));
    });
    afterRenderEffect(() => {
      this.options();
      this.wrapped();
      this.measure();
    });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
    effect((onCleanup) => {
      const group = this.group()?.nativeElement;
      if (!resize || !group) return;
      resize.observe(group);
      onCleanup(() => resize.unobserve(group));
    });
    inject(DestroyRef).onDestroy(() => resize?.disconnect());
  }

  protected activeIndex(): number {
    return Math.max(0, this.options().findIndex((o) => o.key === this.value()));
  }

  protected onKey(event: KeyboardEvent): void {
    const next = this.nextIndex(event, this.activeIndex());
    if (next < 0) return;
    event.preventDefault();
    this.value.set(this.options()[next].key);
    this.segments()[next].nativeElement.focus();
  }

  protected onStripKey(event: KeyboardEvent): void {
    const next = this.nextIndex(event, this.highlighted());
    if (next < 0) return;
    event.preventDefault();
    this.segments()[next].nativeElement.focus();
    this.go(next);
  }

  /** Strip mode: highlight segment `index`, emit its column and scroll the scroller to it. */
  protected go(index: number): void {
    const key = this.options().at(index)?.key;
    if (key === undefined) return;
    this.highlighted.set(index);
    this.jump.emit(key);
    const scroller = this.scroller();
    const column = [...(scroller?.querySelectorAll<HTMLElement>('[data-col]') ?? [])].find((c) => c.dataset['col'] === key);
    if (!scroller || !column) return;
    const left = scroller.scrollLeft + column.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
    scroller.scrollTo({ left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  private nextIndex(event: KeyboardEvent, current: number): number {
    const count = this.options().length;
    if (count === 0) return -1;
    const step = STEP[event.key];
    if (step !== undefined) return (current + step + count) % count;
    return event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : -1;
  }

  private measure(): void {
    const group = this.group()?.nativeElement;
    if (!group) return;
    if (!untracked(this.wrapped)) this.natural = group.scrollWidth;
    this.wrapped.set(stripWraps(this.options().length, group.clientWidth, this.natural));
  }
}
