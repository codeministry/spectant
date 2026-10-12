import { CDK_DRAG_CONFIG, type CdkDragDrop, type DragDropConfig } from '@angular/cdk/drag-drop';
import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, type Provider, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { isWorkflowStage } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import { ApiClient } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import { ToastService } from '../../shared/ui/toast/toast';
import type { BoardCard } from './board-model';

/**
 * The one drag configuration of the workspace board (spec 008, T125, ISC-130; design 008 § Drag, Drop und die
 * Alternativen; plan DS-APP-23): a touch lifts a card after a 350 ms press, so a swipe keeps scrolling; a mouse lifts it
 * at once. Sorting is off everywhere: a card's place in its column comes from the files, so a drop never reorders.
 */
export const BOARD_DRAG_DELAY = { touch: 350, mouse: 0 } as const;

export const BOARD_DRAG_CONFIG: DragDropConfig = {
  dragStartDelay: BOARD_DRAG_DELAY,
  sortingDisabled: true,
};

/** What a column (stub, strip segment, tray slot) says while a card is dragged over the board. */
export type DropHint = 'current' | 'allowed' | 'gate' | 'not-next';

/**
 * The hint of one column for the dragged card. `allowed` is a column core's transition table admits (`card.targets`,
 * `dropTargetsOf`); any other column is `gate` when it is one of core's `FIXED_GATES` (the card has not passed it) and
 * `not-next` otherwise. Only hints: core decides every drop, so a drop on a `gate` or `not-next` column is still sent
 * and comes back refused.
 */
export function dropHint(card: Pick<BoardCard, 'stage' | 'targets'>, stage: WorkflowStage): DropHint {
  if (stage === card.stage) return 'current';
  if (card.targets.includes(stage)) return 'allowed';
  return FIXED_GATES.includes(stage) ? 'gate' : 'not-next';
}

/** An accepted move the planning tree has not caught up with yet: the slug, both stages and both spec.md hashes. */
export interface BoardMove {
  readonly slug: string;
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
  /** The hash the card was rendered with, which the transition sent. */
  readonly hash: string;
  /** spec.md's hash after the write (`TransitionWritten.hash`); the next drag sends it. */
  readonly written: string;
}

/**
 * The planning tree with the accepted moves applied, so the card leaves its column on the 200 and not one reload
 * later: each holder of a moved spec gets the new stage (`explicit`, as the write records it) and hash, and the two
 * counts move by one. A move applies only while the served holder still carries the hash the move was sent with; once
 * the reloaded tree shows the new hash (or any other), the server's tree is the truth again and the move is inert.
 */
export function withMoves(planning: PlanningModel, moves: readonly BoardMove[]): PlanningModel {
  if (moves.length === 0) return planning;
  const applied = new Set<BoardMove>();
  const move = (holder: PlanningHolder): PlanningHolder => {
    const m = moves.find((x) => x.slug === holder.slug && x.hash === holder.hash && x.from === holder.stage);
    // A spec never moves to `idea` (no row lists it), so such a move is never applied.
    if (m === undefined || m.to === 'idea') return holder;
    applied.add(m);
    return { ...holder, stage: m.to, stageSource: 'explicit', hash: m.written };
  };
  const features = planning.features.map((f) => ({ ...f, holders: f.holders.map(move) }));
  const milestones = planning.milestones.map((m) => ({ ...m, specs: m.specs.map(move) }));
  if (applied.size === 0) return planning;
  const stageCounts: Partial<Record<WorkflowStage, number>> = { ...planning.stageCounts };
  for (const m of applied) {
    stageCounts[m.from] = Math.max(0, (stageCounts[m.from] ?? 0) - 1);
    stageCounts[m.to] = (stageCounts[m.to] ?? 0) + 1;
  }
  return { ...planning, features, milestones, stageCounts };
}

/**
 * Why a drop did not move its card (T126), shown by `app-refusal-notice` under the card. `stage` is the card's stage
 * when it was refused: once the card stands anywhere else, the notice is gone.
 */
export type BoardRefusal = {
  readonly key: string;
  readonly id: string;
  readonly stage: WorkflowStage;
  readonly to: WorkflowStage;
} & (
  | { readonly kind: 'refused'; readonly reason: string; readonly command: string | null }
  | { readonly kind: 'stale' }
  | { readonly kind: 'locked'; readonly session: string; readonly claim: string }
  | { readonly kind: 'failed'; readonly status: number }
);

/**
 * The fields of a CDK drop the board reads. Structural, so every list's event fits whatever its data type (a stage, or
 * null on the strip): `CdkDragDrop<T>` is invariant in `T`.
 */
export type BoardDropEvent = Pick<CdkDragDrop<unknown>, 'isPointerOverContainer' | 'dropPoint'> & {
  readonly container: { readonly data: unknown };
  readonly item: { readonly data: BoardCard };
};

/** A duration token of `motion.css` in ms, read from the root so reduced motion (0ms) is honoured. */
function tokenMs(doc: Document, name: string): number {
  if (typeof getComputedStyle !== 'function') return 0;
  const raw = getComputedStyle(doc.documentElement).getPropertyValue(name).trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('ms') ? value : value * 1000;
}

/**
 * The board's drag state and its one write (T125, T126): which card is lifted, the hint per column, the transition on
 * a drop and its four answers.
 *
 * - **200:** the move is kept (`withMoves`) so the card lands at once, the two column counts morph
 *   (`--motion-duration-slow`), the card carries the changed-value tint (`--motion-duration-highlight`, 1200 ms), the
 *   one `ui-toast` says `drag.toast`, then the planning tree and the dashboard reload so the model matches the server.
 * - **422, 409, 423, anything else:** nothing moves (the CDK puts the element back; the model never changed), a
 *   refusal is kept for the card and `app-refusal-notice` shows it under the card; never a toast. A 409 also reloads
 *   the planning tree, whose new hash the next drag sends.
 *
 * Provided per board page (`provideBoardDrag`), with the CDK configuration above.
 */
@Injectable()
export class BoardDrag {
  private readonly api = inject(ApiClient);
  private readonly data = inject(ShellData);
  private readonly toasts = inject(ToastService);
  private readonly transloco = inject(TranslocoService);
  private readonly doc = inject(DOCUMENT);
  private timer: ReturnType<typeof setTimeout> | undefined;

  /** The lifted card; null while nothing is dragged. */
  readonly dragging = signal<BoardCard | null>(null);
  /** The card whose transition is in flight. */
  readonly saving = signal<string | null>(null);
  /** Accepted moves the planning tree may not show yet (`withMoves`). */
  readonly moves = signal<readonly BoardMove[]>([]);
  /** The card just moved, tinted for `--motion-duration-highlight`. */
  readonly moved = signal<string | null>(null);
  /** The two columns whose counts morph after a move. */
  readonly morph = signal<readonly WorkflowStage[]>([]);
  private readonly refusals = signal<ReadonlyMap<string, BoardRefusal>>(new Map());

  /** The hint per column for the lifted card; null while nothing is dragged. */
  readonly hints = computed<ReadonlyMap<WorkflowStage, DropHint> | null>(() => {
    const card = this.dragging();
    if (card === null) return null;
    const stages = this.data.stages();
    return new Map(stages.map((stage) => [stage, dropHint(card, stage)]));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.timer));
  }

  hint(stage: WorkflowStage): DropHint | null {
    return this.hints()?.get(stage) ?? null;
  }

  /** A spec card the server hashed can be dragged; a story's allocation is its own write (T128). */
  draggable(card: BoardCard): boolean {
    return card.kind === 'spec' && card.id !== null && card.hash !== null;
  }

  start(card: BoardCard): void {
    this.dismiss(card.key);
    this.dragging.set(card);
  }

  end(): void {
    this.dragging.set(null);
  }

  /** The card's refusal while the card still stands where it was refused; null otherwise. */
  refusalOf(card: Pick<BoardCard, 'key' | 'stage'>): BoardRefusal | null {
    const refusal = this.refusals().get(card.key);
    return refusal?.stage === card.stage ? refusal : null;
  }

  dismiss(key: string): void {
    if (!this.refusals().has(key)) return;
    this.refusals.update((all) => {
      const next = new Map(all);
      next.delete(key);
      return next;
    });
  }

  /**
   * The stage a CDK drop names: the drop list's data (a column, a stub, a band cell, a tray slot), or for the strip,
   * whose segments live inside `ui-segmented`, the `[data-key]` segment under the drop point. Null when the pointer
   * left every list, or the drop is on no stage.
   */
  stageOf(event: BoardDropEvent): WorkflowStage | null {
    if (!event.isPointerOverContainer) return null;
    const data = event.container.data;
    if (typeof data === 'string') return isWorkflowStage(data) ? data : null;
    const { x, y } = event.dropPoint;
    const hit = typeof this.doc.elementFromPoint === 'function' ? this.doc.elementFromPoint(x, y) : null;
    const key = hit?.closest<HTMLElement>('[data-key]')?.dataset['key'] ?? null;
    return key !== null && isWorkflowStage(key) ? key : null;
  }

  /** The transition for `card` dropped on `to`: nothing for its own column, a card that cannot move or a write in flight. */
  async drop(ws: string, card: BoardCard, to: WorkflowStage | null): Promise<void> {
    const id = card.id;
    const hash = card.hash;
    if (to === null || to === card.stage || card.kind !== 'spec' || id === null || hash === null || this.saving() !== null) return;
    this.saving.set(card.key);
    const result = await this.api.transition(ws, id, to, hash);
    this.saving.set(null);
    const base = { key: card.key, id, stage: card.stage, to };
    if (result.kind === 'error') {
      this.refuse({ ...base, kind: 'failed', status: result.status });
      return;
    }
    const answer = result.answer;
    switch (answer.status) {
      case 200:
        this.accept(card, hash, answer.body.to, answer.body.hash);
        return;
      case 422:
        this.refuse({ ...base, kind: 'refused', reason: answer.body.reason, command: answer.body.command });
        return;
      case 409:
        this.refuse({ ...base, kind: 'stale' });
        this.data.planning.reload();
        return;
      case 423:
        this.refuse({ ...base, kind: 'locked', session: answer.body.lock.session, claim: answer.body.lock.claim });
        return;
      case 400:
        this.refuse({ ...base, kind: 'failed', status: 400 });
    }
  }

  private accept(card: BoardCard, hash: string, to: WorkflowStage, written: string): void {
    const move: BoardMove = { slug: card.slug, from: card.stage, to, hash, written };
    this.dismiss(card.key);
    this.moves.update((all) => [...all.filter((m) => m.slug !== card.slug), move]);
    this.moved.set(card.key);
    this.morph.set([card.stage, to]);
    const stage = this.transloco.translate(`stages.${to}`);
    this.toasts.show(this.transloco.translate('board.workspace.drag.toast', { id: card.id, stage }));
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.moved.set(null);
        this.morph.set([]);
      },
      Math.max(tokenMs(this.doc, '--motion-duration-highlight'), tokenMs(this.doc, '--motion-duration-slow')),
    );
    this.data.planning.reload();
    this.data.dashboard.reload();
  }

  private refuse(refusal: BoardRefusal): void {
    this.refusals.update((all) => new Map(all).set(refusal.key, refusal));
  }
}

/** The board page's providers: the drag configuration for every `cdkDrag` and `cdkDropList` under it, and the state. */
export const provideBoardDrag = (): Provider[] => [{ provide: CDK_DRAG_CONFIG, useValue: BOARD_DRAG_CONFIG }, BoardDrag];
