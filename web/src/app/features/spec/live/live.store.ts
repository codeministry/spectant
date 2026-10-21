import { computed, inject, Injectable, resource, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { Frame, FrameCard, LiveFrame } from '../../../../../../core/src/files';
import { ApiClient } from '../../../core/api.service';
import type { RailBadge } from '../../../layout/shell/rail-content';
import { ShellState } from '../../../layout/shell/shell-state.service';
import { activeLang, specParams } from '../spec-view';
import { frameEvents, needsYouOf, recutMarkers, scrubberStops } from './board/board-model';
import { cardHistory } from './card/card-history';
import { LiveSource } from './live-source';

/** A frame on the scrubber: a history frame of `…/frames` or the live frame of `…/live`. */
export type AnyFrame = Frame | LiveFrame;

/**
 * The frames behind a live tab (spec 061, ISC-436): the history (`…/frames`) and the live frame (`LiveSource`, one
 * shared read per refresh tick, ISC-371) as one scrubber, the frame on screen, its events and its Needs you, the rail's
 * badges and the card detail a This frame or Needs you row opened. The Board and the Matrix tab each provide one, so
 * each tab owns its frames; the tab names the frame on screen with `useIndex` (the board's `?frame`, the matrix's pick).
 */
@Injectable()
export class LiveStore {
  private readonly api = inject(ApiClient);
  private readonly transloco = inject(TranslocoService);
  private readonly state = inject(ShellState);

  private readonly params = specParams(this.state);
  readonly framesResult = resource({ params: () => this.params(), loader: ({ params }) => this.api.frames(params.ws, params.id) });
  /** The live frame, one shared read per refresh tick for the board, its cards' detail and the matrix (ISC-371). */
  readonly liveResult = inject(LiveSource).attach();
  readonly lang = activeLang(this.transloco);

  /** Every frame on the scrubber: the history (`Frame[]`), then the live frame. */
  readonly frames = computed<readonly AnyFrame[]>(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return [...(history?.kind === 'ok' ? history.body : []), ...(live?.kind === 'ok' ? [live.body] : [])];
  });
  readonly loading = computed(() => this.framesResult.isLoading() || this.liveResult.status() === 'loading');
  readonly failed = computed(() => {
    const history = this.framesResult.value();
    const live = this.liveResult.value();
    return history !== undefined && live !== undefined && history.kind !== 'ok' && live.kind !== 'ok';
  });
  readonly lastIndex = computed(() => Math.max(0, this.frames().length - 1));
  private readonly indexOf = signal<() => number>(() => this.lastIndex());
  /** The index of the frame on screen, as the tab names it (`useIndex`); the live frame until then. */
  readonly index = computed(() => this.indexOf()());
  readonly frame = computed<AnyFrame | null>(() => this.frames()[this.index()] ?? null);
  readonly isLive = computed(() => this.frame()?.kind === 'live');
  private readonly previous = computed<AnyFrame | null>(() => this.frames()[this.index() - 1] ?? null);
  readonly events = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : frameEvents(this.previous(), frame);
  });
  readonly needsYou = computed(() => {
    const frame = this.frame();
    return frame === null ? [] : needsYouOf(frame);
  });

  /** The scrubber's stops and re-cut marks over every frame. */
  readonly stops = computed(() => scrubberStops(this.frames(), this.state.tier() === 'compact'));
  readonly markers = computed(() => {
    this.lang();
    return recutMarkers(this.frames(), this.transloco.translate('board.frame.recut'), (counts) => this.transloco.translate('board.frame.recutTitle', counts));
  });

  /** The collapsed strip's two badges: This frame and Needs you. */
  readonly railBadges = computed<readonly RailBadge[]>(() => {
    this.lang();
    const thisFrame = this.events().length;
    const needsYou = this.needsYou().length;
    return [
      { key: 'thisFrame', count: thisFrame, label: this.transloco.translate('board.rail.badgeThisFrame', { count: thisFrame }) },
      { key: 'needsYou', count: needsYou, label: this.transloco.translate('board.rail.badgeNeedsYou', { count: needsYou }) },
    ];
  });

  /** Whether the bottom bar's sheet (This frame / Needs you) is open. */
  readonly barOpen = signal(false);
  /** The card a This frame or Needs you row opened, shown in the card detail until it closes. */
  readonly selected = signal<FrameCard | null>(null);
  readonly selectedHistory = computed(() => {
    const card = this.selected();
    return card === null ? null : cardHistory(this.frames(), card);
  });

  /** Names the frame on screen by index: the tab's own source (a query param, a pick). */
  useIndex(index: () => number): void {
    this.indexOf.set(index);
  }

  /** A row of This frame or Needs you: close the sheet and show the card detail. */
  openCard(card: FrameCard): void {
    this.barOpen.set(false);
    this.selected.set(card);
  }

  closeDetail(open: boolean): void {
    if (!open) this.selected.set(null);
  }
}
