import { CDK_DRAG_CONFIG, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, type Provider, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { isWorkflowStage } from '../../../../../core/src/stage';
import { FIXED_GATES } from '../../../../../core/src/workflow';
import type { IdeaAllocated } from '../../../../../server/src/contracts/spec-routes.contract';
import type { RunLocked } from '../../../../../server/src/contracts/writes.contract';
import { ApiClient } from '../../core/api.service';
import { ShellData } from '../../layout/shell/shell-data.service';
import type { BoardRefusal } from '../../shared/ui/refusal-notice/refusal';
import { ToastService } from '../../shared/ui/toast/toast';
import { BOARD_DRAG_CONFIG } from '../../shared/ui/drag-config';
import type { BoardCard } from '../../core/model/board-types';

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
 * Why a drop did not move its card (T126), shown by `app-refusal-notice` under the card. The type lives beside the
 * notice in shared/ui since spec 037 (T21) and is re-exported here for the board.
 */
export type { BoardRefusal };
/** The board's drag configuration lives in `shared/ui/drag-config.ts`; the planning tree lifts its rows with it too. */
export { BOARD_DRAG_CONFIG, BOARD_DRAG_DELAY } from '../../shared/ui/drag-config';

/**
 * What one move from any path came to (T127): `moved` on a 200, `refused` when a refusal now stands for the card,
 * `asked` when a story's drop opened the allocation dialog (T128), `none` when nothing was sent.
 */
export type MoveOutcome = 'moved' | 'refused' | 'asked' | 'none';

/**
 * The fields of a CDK drop the board reads. Structural, so every list's event fits whatever its data type (a stage, or
 * null on the strip): `CdkDragDrop<T>` is invariant in `T`.
 */
export type BoardDropEvent = Pick<CdkDragDrop<unknown>, 'isPointerOverContainer' | 'dropPoint'> & {
  readonly container: { readonly data: unknown };
  readonly item: { readonly data: BoardCard };
};

/** What a run-locked refusal names of the run (spec 040, T59): its command, its actor's id and how long it has run. */
export type RunHold = Pick<Extract<BoardRefusal, { kind: 'run-locked' }>, 'command' | 'actor' | 'elapsedMs'>;

/**
 * The run that holds `card` (spec 040, T57, ISC-225.1): while the card's state, as the API served it, is `running`,
 * the run's command, actor and duration; null on every other card. Read only, never decided here: core's state says
 * running, and a running state without its run (a diagnostic) still holds the card, with nothing to name.
 */
export function runHoldOf(card: Pick<BoardCard, 'state'>): RunHold | null {
  const state = card.state;
  if (state?.state !== 'running') return null;
  const run = state.run;
  return { command: run?.command ?? state.command ?? null, actor: run?.actor.id ?? null, elapsedMs: run?.elapsedMs ?? null };
}

/**
 * The run of a 423 `run-locked` (a run started after the board rendered the card): its duration from the card's own
 * run when the reload has brought the same one, else from its start to the clock the page runs on (the refusal is a
 * snapshot, not a live count).
 */
function runHoldOfLocked(card: Pick<BoardCard, 'state'>, body: RunLocked): RunHold {
  const own = card.state?.run;
  const started = Date.parse(body.since);
  const elapsedMs = own?.run === body.run ? own.elapsedMs : Number.isFinite(started) ? Math.max(0, Date.now() - started) : null;
  return { command: body.command, actor: body.actor.id, elapsedMs };
}

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
 * - **A running run (spec 040, T57, T59, ISC-225.1):** a card whose state is `running` does not lift
 *   (`draggable`), and a move of it from any path is refused with `run-locked` before anything is sent (`holdRun`).
 *   A 423 `run-locked` (a run that started after the render) leaves the same refusal and reloads the dashboard and
 *   the planning tree, so the card shows its run and locks.
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
  /** The story whose allocation waits on the confirmation dialog (T128); null while none is asked. */
  readonly allocating = signal<BoardCard | null>(null);
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

  /**
   * A spec card the server hashed can be dragged; so can a story with a target, the first stage of its type, whose
   * drop asks for the allocation (T128) instead of sending a transition.
   */
  draggable(card: BoardCard): boolean {
    if (runHoldOf(card) !== null) return false;
    if (card.kind === 'idea') return card.targets.length > 0;
    return card.id !== null && card.hash !== null;
  }

  /**
   * The one move of every path (T127): a drop, a "Move to…" entry and Shift+←/→ all come here. A spec sends its
   * transition (`drop`); a story asked onto one of its targets opens the allocation dialog and sends nothing yet; a
   * story anywhere else is not moved.
   */
  async move(ws: string, card: BoardCard, to: WorkflowStage | null): Promise<MoveOutcome> {
    if (this.holdRun(card, to ?? card.stage)) return 'refused';
    if (card.kind === 'spec') return this.drop(ws, card, to);
    if (to === null || !card.targets.includes(to) || this.saving() !== null) return 'none';
    this.dismiss(card.key);
    this.allocating.set(card);
    return 'asked';
  }

  /**
   * T128 · ISC-130.2: the allocation of the asked story with the story file's raw hash (`IdeaPage.hash`). 200 reloads
   * the planning tree and the dashboard and answers the new spec; 422 (`not-in-index`, `folder-exists`), 409 (which
   * also reloads the tree), 423 and any other answer leave a refusal under the story's card and answer null.
   */
  async allocate(ws: string, card: BoardCard, hash: string): Promise<IdeaAllocated | null> {
    const to = card.targets.at(0);
    if (card.kind !== 'idea' || to === undefined || this.saving() !== null) return null;
    this.saving.set(card.key);
    const result = await this.api.allocate(ws, card.slug, hash);
    this.saving.set(null);
    const base = { key: card.key, id: card.slug, stage: card.stage, to };
    if (result.kind === 'error') {
      this.refuse({ ...base, kind: 'failed', status: result.status });
      return null;
    }
    if (result.kind === 'run-locked') {
      this.refuseRunLocked(base, card, result.body);
      return null;
    }
    const answer = result.answer;
    switch (answer.status) {
      case 200:
        this.dismiss(card.key);
        this.data.planning.reload();
        this.data.dashboard.reload();
        return answer.body;
      case 422:
        this.refuse({ ...base, kind: 'unallocated', reason: answer.body.reason, folder: answer.body.folder });
        return null;
      case 409:
        this.refuse({ ...base, kind: 'stale' });
        this.data.planning.reload();
        return null;
      case 423:
        this.refuse({ ...base, kind: 'locked', session: answer.body.lock.session, claim: answer.body.lock.claim });
        return null;
      case 400:
        this.refuse({ ...base, kind: 'failed', status: 400 });
        return null;
    }
  }

  /**
   * Spec 040 (T57, T59, ISC-225.1): when a run holds `card`, keeps the `run-locked` refusal under it and answers true;
   * nothing is sent. The keys, "Move to…" and a press on the locked grip at medium and wide all come here.
   */
  holdRun(card: BoardCard, to: WorkflowStage): boolean {
    const hold = runHoldOf(card);
    if (hold === null) return false;
    this.refuse({ key: card.key, id: card.id ?? card.slug, stage: card.stage, to, kind: 'run-locked', ...hold });
    return true;
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
   * The stage a CDK drop names: the drop list's data (a column, a stub, a band cell, a tray slot). Null when the pointer
   * left every list. (Named `dropTarget`, not `stageOf`: the single-core guard reserves that name for core's stage
   * derivation, and this only reads which list took the drop.)
   */
  dropTarget(event: BoardDropEvent): WorkflowStage | null {
    if (!event.isPointerOverContainer) return null;
    const data = event.container.data;
    return typeof data === 'string' && isWorkflowStage(data) ? data : null;
  }

  /** The transition for `card` dropped on `to`: nothing for its own column, a card that cannot move or a write in flight. */
  async drop(ws: string, card: BoardCard, to: WorkflowStage | null): Promise<MoveOutcome> {
    const id = card.id;
    const hash = card.hash;
    if (to === null || to === card.stage || card.kind !== 'spec' || id === null || hash === null || this.saving() !== null) return 'none';
    this.saving.set(card.key);
    const result = await this.api.transition(ws, id, to, hash);
    this.saving.set(null);
    const base = { key: card.key, id, stage: card.stage, to };
    if (result.kind === 'error') {
      this.refuse({ ...base, kind: 'failed', status: result.status });
      return 'refused';
    }
    if (result.kind === 'run-locked') {
      this.refuseRunLocked(base, card, result.body);
      return 'refused';
    }
    const answer = result.answer;
    switch (answer.status) {
      case 200:
        this.accept(card, hash, answer.body.to, answer.body.hash);
        return 'moved';
      case 422:
        this.refuse({ ...base, kind: 'refused', reason: answer.body.reason, command: answer.body.command });
        return 'refused';
      case 409:
        this.refuse({ ...base, kind: 'stale' });
        this.data.planning.reload();
        return 'refused';
      case 423:
        this.refuse({ ...base, kind: 'locked', session: answer.body.lock.session, claim: answer.body.lock.claim });
        return 'refused';
      case 400:
        this.refuse({ ...base, kind: 'failed', status: 400 });
        return 'refused';
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

  /** The 423 `run-locked`: the run's refusal, and a reload so the card shows the run that holds it. */
  private refuseRunLocked(base: Pick<BoardRefusal, 'key' | 'id' | 'stage' | 'to'>, card: BoardCard, body: RunLocked): void {
    this.refuse({ ...base, kind: 'run-locked', ...runHoldOfLocked(card, body) });
    this.data.dashboard.reload();
    this.data.planning.reload();
  }

  private refuse(refusal: BoardRefusal): void {
    this.refusals.update((all) => new Map(all).set(refusal.key, refusal));
  }
}

/** The board page's providers: the drag configuration for every `cdkDrag` and `cdkDropList` under it, and the state. */
export const provideBoardDrag = (): Provider[] => [{ provide: CDK_DRAG_CONFIG, useValue: BOARD_DRAG_CONFIG }, BoardDrag];
