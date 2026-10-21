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
 * Radio mode wears the segmented style (spec 024, ISC-148): 2 px padding, 1 px `--line` border, 8 px radius on
 * `--lane`; segments 28 px high, 6 px radius, 13 px `--muted`; the checked one `--card` with `--shadow-hair` and
 * `--text`. Two forms:
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
  styleUrl: './segmented.css',
  templateUrl: './segmented.html',
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
