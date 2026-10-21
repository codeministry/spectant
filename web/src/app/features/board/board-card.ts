import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RelationRef } from '../../../../../core/src/relations';
import { DetailSelection, selectedLook } from '../../layout/detail-sidebar/selection';
import { UiIcon } from '../../shared/icons/icon';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiCard } from '../../shared/ui/card/card';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiItemState } from '../../shared/ui/item-state/item-state';
import { UiPriority } from '../../shared/ui/priority/priority';
import { withReason } from '../../core/model/guidance-entry';
import { GuidanceReasonPipe } from '../../shared/ui/guidance/guidance-reason.pipe';
import { UiReason } from '../../shared/ui/reason/reason';
import { type TypeGlyphKind, UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { UiWaitsChip } from '../../shared/ui/waits-chip/waits-chip';
import { UiWorktreeChip } from '../../shared/ui/worktree-chip/worktree-chip';
import type { BoardCard as BoardCardModel } from '../../core/model/board-types';
import { CARD_EDGE } from '../../shared/ui/stage-edge';

/** The reason line's ink in the edge's tone: the violet ink for a wait on you, the muted ink otherwise. */
const reasonInk = (card: BoardCardModel): string => (card.waitsOnYou ? 'var(--ques-ink)' : 'var(--muted-ink)');

/**
 * One card of the workspace board (spec 008, T122, ISC-129 / ISC-131 / ISC-122.3; design 008 § board card), rendered
 * from a `BoardCard` as `buildBoard` built it: nothing is derived here.
 *
 * - Row 1: the type glyph, the mono number (a story shows the idea chip's look in its place: dashed, lightbulb,
 *   slug; the glyph shows the story's `type:`, the lightbulb when it names none) and `ui-priority` at the end.
 * - Row 2: the title, clamped to two lines; it is the card's one link (to the spec page or the idea page), stretched
 *   over the whole card, named by `board.workspace.card.name` / `ideaName` and described by the waiting phrase.
 *   Spec 026 (T26, ISC-171): a plain click, a tap or Enter on it selects the card (`?sel=spec:NNN` / `idea:<slug>`, the
 *   detail sidebar) instead of navigating; Shift+Enter or a shift click opens the page, and a Ctrl/Cmd or middle click
 *   keeps the browser's new-tab default. The link carries `data-ref`, the card `data-selected="card"` while selected.
 * - Row 3: the main feature chip `F<n>` (its name in the tooltip), the milestone (muted) and, pushed to the end,
 *   `ui-actor-chip` with the resolved name or the raw id; nothing when the card is unassigned. A spec with a worktree
 *   shows the compact `ui-worktree-chip` (`git-branch` · `↑n` · `±`, the branch in its accessible name) right before
 *   the assignee pill (spec 027, ISC-175, design.md § Across viewports 6): not interactive, the card is the tap
 *   target; the warning tone on the row's `worktree-branch-mismatch`. The chip stays compact at every card width
 *   (the host declares no `board-card` container), so the card never grows by a line. No worktree, no chip.
 * - Row 4, the state line on every card (spec 040, T48, ISC-224): `ui-item-state` from the card's `state` as the API
 *   serves it: glyph · "‹Stage› · ‹state›" · details (the copy chip of `open`, a story's `/spec new <slug>` included;
 *   the specs `waiting` waits on; the locked chip, actor and "since" of `running`, set off as a band like `aborted`).
 *   Spec 025's `ui-waits-chip` (T23, ISC-163; a spec an open spec edge holds) moved from its own line under the title
 *   into this line at every width, and is left out where the state is `waiting`, whose line names the blockers already.
 *   Each chip lies over the stretched title link and so is its own target. The edge stays the stage's. A card without
 *   a state (a server without a clock) keeps the old row 4 on waiting cards: `ui-reason` compact with the command chip.
 * - The `grip-vertical` zone at the trailing edge is the `cdkDragHandle` (T125): the board page puts `cdkDrag` on this
 *   element and only the grip lifts the card, so the title stays a link. The grip is a button named "Move 008"
 *   (T127): a click without movement, Enter or Space emits `moveMenu` with the grip, and the board opens "Move to…"
 *   on it, the single-pointer and keyboard path to the move (WCAG 2.5.7).
 * - Shift+← / Shift+→ anywhere on the card (the title link or the grip focused) emit `step` with -1 or 1; the board
 *   moves the card to the previous or next allowed stage (T127).
 * - Spec 040 (T57, ISC-225.1): while the card's state is `running` the grip carries `data-locked`, shows `lock` in
 *   place of `grip-vertical`, always visible, with the `not-allowed` cursor; the board disables the drag
 *   (`BoardDrag.draggable`), so the card does not lift, and a press or the keys show the run's refusal. At compact the
 *   ellipsis stays and opens "Move to…" with every entry disabled.
 *
 * Variants come only from `ui-card`: `side` (the edge, `--edge` per stage) on every card, `dashed` on a story's.
 */
@Component({
  selector: 'app-board-card',
  imports: [CdkDragHandle, GuidanceReasonPipe, TranslocoPipe, UiActorChip, UiCard, UiChip, UiIcon, UiItemState, UiPriority, UiReason, UiTypeGlyph, UiWaitsChip, UiWorktreeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-key]': 'card().key',
    '[attr.data-stage]': 'card().stage',
    '[attr.data-kind]': 'card().kind',
    '(keydown.shift.arrowleft)': 'onStep($event, -1)',
    '(keydown.shift.arrowright)': 'onStep($event, 1)',
  },
  styleUrls: ['../../layout/detail-sidebar/selection.css', './board-card.css'],
  templateUrl: './board-card.html',
})
export class BoardCard {
  private readonly router = inject(Router);
  private readonly selection = inject(DetailSelection);
  readonly card = input.required<BoardCardModel>();
  /** The workspace slug the card's link opens in. */
  readonly ws = input.required<string>();
  /** The grip was clicked (no drag), or pressed with Enter or Space: the board opens "Move to…" on it (T127). */
  readonly moveMenu = output<HTMLElement>();
  /** Shift+← (-1) or Shift+→ (1) on the card: the board moves it to the previous or next allowed stage (T127). */
  readonly step = output<-1 | 1>();

  /**
   * A locked grip answers the press itself (spec 040, T60, ISC-225.1): the drag is disabled, so a drag attempt never
   * lifts the card, and its release over another column sends no click to the grip. The press emits `moveMenu`, so the
   * board shows the run's refusal (or, at compact, the menu with every entry disabled); the click of that same press
   * is skipped. Enter and Space (a click with `detail` 0) still come through the click.
   */
  protected onGripPress(event: PointerEvent, grip: HTMLElement): void {
    if (this.locked() && event.button === 0) this.moveMenu.emit(grip);
  }

  protected onGripClick(event: MouseEvent, grip: HTMLElement): void {
    if (this.locked() && event.detail > 0) return;
    this.moveMenu.emit(grip);
  }

  protected onStep(event: Event, dir: -1 | 1): void {
    event.preventDefault();
    this.step.emit(dir);
  }

  protected readonly edge = computed(() => CARD_EDGE[this.card().stage]);
  /** A run on the card's item is running (spec 040, T57): the grip locks. The state as served decides. */
  protected readonly locked = computed(() => this.card().state?.state === 'running');
  protected readonly ink = computed(() => reasonInk(this.card()));
  protected readonly withReason = withReason;
  protected readonly glyph = computed<TypeGlyphKind>(() => this.card().type ?? 'idea');
  /** The phrase of a waiting card; null on every other card, which shows no reason line. */
  protected readonly waits = computed(() => (this.card().waiting ? this.card().reason : null));
  protected readonly describedBy = computed(() => `bc-${this.card().key}-waits`);
  /** The marker row's id (spec 020, T23); the row reads in the card's flow, the link's description stays the phrase. */
  protected readonly markId = computed(() => `bc-${this.card().key}-mark`);
  /** The `waits on NNN` line's id (spec 025, T23): the title link's description names the blockers after the reason. */
  protected readonly holdId = computed(() => `bc-${this.card().key}-hold`);
  /**
   * The spec 025 waits chip stands in the state line unless the state is `waiting`, whose line already names what the
   * item waits on: "waits" appears once on the card (spec 040, T48).
   */
  protected readonly holdShown = computed(() => this.card().waits !== null && this.card().state?.state !== 'waiting');
  protected readonly describedByList = computed(() => {
    const ids = [this.waits() ? this.describedBy() : null, this.holdShown() ? this.holdId() : null].filter((id) => id !== null);
    return ids.length === 0 ? null : ids.join(' ');
  });
  protected readonly link = computed(() => {
    const c = this.card();
    return c.kind === 'idea' ? ['/w', this.ws(), 'ideas', c.slug] : ['/w', this.ws(), 's', c.id ?? c.slug];
  });
  protected readonly href = computed(() => this.router.serializeUrl(this.router.createUrlTree(this.link())));
  /** The object the card stands for in the sidebar (spec 026, T26): `spec:NNN`, or `idea:<slug>` for a story. */
  readonly ref = computed<RelationRef>(() => {
    const c = this.card();
    return c.kind === 'idea' ? `idea:${c.slug}` : `spec:${c.id ?? c.slug}`;
  });
  protected readonly look = computed(() => selectedLook(this.selection, this.ref(), 'card'));

  /**
   * A click (Enter included) on the card surface: Ctrl/Cmd, Alt or a non-primary button keep the browser's default
   * (a new tab); Shift opens the page in place; anything else selects the card.
   */
  protected open(event: MouseEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.shiftKey) void this.router.navigate(this.link());
    else void this.selection.select(this.ref());
  }
}
