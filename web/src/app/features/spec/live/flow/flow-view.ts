import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { FrameCard } from '../../../../../../../core/src/files';
import { prefersReducedMotion } from '../../../../core/motion';
import type { Tier } from '../../../../layout/shell/tier';
import { type SegmentedOption, UiSegmented } from '../../../../shared/ui/segmented/segmented';
import { BoardCard } from '../board/board-card';
import type { BoardSection, LaneView } from '../board/board-model';
import { type CardPlace, FLOW_COLUMNS, flipMoves, flowBands, flowCounts, resolveColumn } from './flow-model';

/**
 * The Flow view of the Board tab (T82, ISC-87; design.md § Live "Flow view", § Tablet, § Mobile "Flow at compact").
 * The same cards and the same `board-model` sections as the Lanes view, drawn as four columns (Waiting · In flight ·
 * Needs you · Landed, `repeat(4, minmax(0, 1fr))`). Each lane is a band headed by a 32 px sticky row (dot, name, n/m)
 * that spans the columns, so a card keeps one width and, when the scrubber changes the frame, moves to its new place
 * with a FLIP on `--motion-duration-base`. Under reduced motion nothing moves: a card that changed column only gets a
 * static highlight (`data-moved`). At compact a segmented control picks one column (`?flow=`, router-driven) and the
 * lanes stay bands beneath it. The board passes its filtered lanes, so the legend, search, density and lane filters
 * apply here as they do in Lanes.
 */
@Component({
  selector: 'app-flow-view',
  imports: [BoardCard, TranslocoPipe, UiSegmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tier]': 'tier()' },
  templateUrl: './flow-view.html',
  styleUrl: './flow-view.css',
})
export class FlowView {
  /** The board's lanes after its filters, in lane order (`buildLanes`). */
  readonly lanes = input.required<readonly LaneView[]>();
  /** The frame shown; a change of frame is what makes cards move. */
  readonly frame = input.required<number>();
  readonly density = input<'comfortable' | 'compact'>('comfortable');
  readonly tier = input<Tier>('wide');
  readonly opened = output<FrameCard>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly transloco = inject(TranslocoService);
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

  protected readonly allColumns = FLOW_COLUMNS;
  protected readonly compact = computed(() => this.tier() === 'compact');
  protected readonly bands = computed(() => flowBands(this.lanes()));
  protected readonly counts = computed(() => flowCounts(this.bands()));
  /** The column shown at compact. */
  protected readonly column = computed(() => resolveColumn(this.query().get('flow'), this.counts()));
  protected readonly columns = computed<readonly BoardSection[]>(() => (this.compact() ? [this.column()] : FLOW_COLUMNS));
  /** At compact only the bands with a card in the chosen column; wider, every band. */
  protected readonly shownBands = computed(() => {
    const column = this.column();
    return this.compact() ? this.bands().filter((band) => band.columns[column].length > 0) : this.bands();
  });
  protected readonly segments = computed<readonly SegmentedOption[]>(() => {
    this.lang();
    const counts = this.counts();
    return FLOW_COLUMNS.map((key) => {
      const word: string = this.transloco.translate(`board.flow.columns.${key}`);
      return { key, label: this.transloco.translate('board.flow.segment', { label: word, count: counts[key] }) };
    });
  });

  /** Where every card was drawn after the last render, and for which frame. */
  private places = new Map<string, CardPlace>();
  private placedFrame: number | null = null;

  constructor() {
    // FLIP (first, last, invert, play) after each render: the DOM is the I/O boundary here. Only a change of frame
    // moves cards; a filter, tier or column switch re-measures without moving anything.
    afterRenderEffect(() => {
      const frame = this.frame();
      this.shownBands();
      this.columns();
      const root = this.host.nativeElement;
      const origin = root.getBoundingClientRect();
      const next = new Map<string, CardPlace>();
      const elements = new Map<string, HTMLElement>();
      for (const el of root.querySelectorAll<HTMLElement>('[data-flow-card]')) {
        const task = el.dataset['flowCard'] ?? '';
        const box = el.getBoundingClientRect();
        next.set(task, { x: box.left - origin.left, y: box.top - origin.top, column: el.closest<HTMLElement>('[data-column]')?.dataset['column'] ?? '' });
        elements.set(task, el);
        el.removeAttribute('data-moved');
      }
      const moves = this.placedFrame !== null && this.placedFrame !== frame ? flipMoves(this.places, next) : [];
      this.places = next;
      this.placedFrame = frame;

      const still = prefersReducedMotion();
      const flipping: HTMLElement[] = [];
      for (const move of moves) {
        const el = elements.get(move.task);
        if (el === undefined) continue;
        if (move.moved) el.setAttribute('data-moved', '');
        if (still) continue;
        el.setAttribute('data-flip', '');
        el.style.transform = `translate(${String(move.dx)}px, ${String(move.dy)}px)`;
        flipping.push(el);
      }
      if (flipping.length === 0) return;
      // Commit the inverted positions before releasing them, so the transition plays from there.
      root.getBoundingClientRect();
      for (const el of flipping) {
        el.removeAttribute('data-flip');
        el.style.transform = '';
      }
    });
  }

  protected setColumn(column: string | undefined): void {
    const valid = FLOW_COLUMNS.find((c) => c === column) ?? null;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { flow: valid }, queryParamsHandling: 'merge', replaceUrl: true });
  }
}
