import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import type { RelationRef } from '../../../../../core/src/relations';
import { DetailSelection, selectedLook } from '../../layout/detail-sidebar/selection';
import { UiIcon } from '../../shared/icons/icon';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiCard } from '../../shared/ui/card/card';
import { UiItemState } from '../../shared/ui/item-state/item-state';
import { UiPriority } from '../../shared/ui/priority/priority';
import { withReason } from '../../shared/ui/guidance/guidance-entry';
import { GuidanceReasonPipe } from '../../shared/ui/guidance/guidance-reason.pipe';
import { UiReason } from '../../shared/ui/reason/reason';
import { type TypeGlyphKind, UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import { UiWaitsChip } from '../../shared/ui/waits-chip/waits-chip';
import { UiWorktreeChip } from '../../shared/ui/worktree-chip/worktree-chip';
import type { BoardCard as BoardCardModel } from './board-model';

/**
 * The inline-start edge per stage, in the prototype's role colours (spec 024, design § Workspace board): teal for an
 * idea, the track grey for plan and tasks, violet for a wait on you (review, code-review, close), cyan in motion
 * (build), red for blocked, the held grey for close-pending, lime done. The edge never carries the meaning alone: the
 * reason line says it in words.
 */
export const CARD_EDGE: Readonly<Record<WorkflowStage, string>> = {
  idea: 'var(--teal)',
  plan: 'var(--track)',
  tasks: 'var(--track)',
  review: 'var(--color-secondary)',
  'code-review': 'var(--color-secondary)',
  close: 'var(--color-secondary)',
  build: 'var(--color-primary)',
  blocked: 'var(--color-error)',
  'close-pending': 'var(--held)',
  done: 'var(--color-accent)',
};

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
  imports: [CdkDragHandle, GuidanceReasonPipe, TranslocoPipe, UiActorChip, UiCard, UiIcon, UiItemState, UiPriority, UiReason, UiTypeGlyph, UiWaitsChip, UiWorktreeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-key]': 'card().key',
    '[attr.data-stage]': 'card().stage',
    '[attr.data-kind]': 'card().kind',
    '(keydown.shift.arrowleft)': 'onStep($event, -1)',
    '(keydown.shift.arrowright)': 'onStep($event, 1)',
  },
  styleUrls: ['../../layout/detail-sidebar/selection.css'],
  styles: `
    /* The card declares no board-card container on purpose (spec 027, principal 2026-10-13): the worktree chip stays
       compact at every width, so a card with a worktree never grows by a line. The full form lives in the spec head. */
    :host { display: block; min-inline-size: 0; }
    ui-card { min-block-size: 72px; }
    article { display: grid; grid-template-columns: minmax(0, 1fr) 44px; margin-inline-end: -12px; }
    .main { display: grid; gap: 8px; min-inline-size: 0; }
    .r1, .r3 { display: flex; gap: 8px; align-items: center; min-inline-size: 0; }
    .r1 { color: var(--muted-ink); }
    .r1 ui-priority { margin-inline-start: auto; }
    .r3 { flex-wrap: wrap; }
    /*
     * The assignee line: the worktree chip, then the pill pushed to the end, on one line that never wraps (spec 027,
     * design.md § Across viewports 6: no new line); on a narrow card the pill gives way and truncates.
     */
    .who { display: flex; flex: 1 1 auto; gap: 8px; align-items: center; min-inline-size: 0; }
    .who ui-actor-chip { min-inline-size: 0; max-inline-size: 14ch; margin-inline-start: auto; }
    .who ui-worktree-chip { flex: none; }
    .num { color: var(--disp-ink); font-family: var(--font-mono); font-size: 13px; font-variant-numeric: tabular-nums; font-weight: 600; line-height: 20px; }
    .idea { display: inline-flex; gap: 6px; align-items: center; min-inline-size: 0; block-size: 22px; padding-inline: 7px; border: 1px dashed var(--track); border-radius: var(--radius-selector); color: var(--muted-ink); font-family: var(--font-mono); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; line-height: 16px; white-space: nowrap; }
    .idea ui-icon { flex: none; color: var(--conc-ink); }
    .slug { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    .title { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: var(--color-base-content); font-size: 14px; font-weight: 600; line-height: 20px; overflow-wrap: anywhere; text-decoration: none; }
    .title::after { position: absolute; inset: 0; border-radius: inherit; content: ''; }
    .title:focus-visible { outline: none; }
    .title:focus-visible::after { outline: 2px solid var(--disp); outline-offset: -2px; }
    :host([data-stage='done']) .title { color: var(--muted-ink); }
    .chip { display: inline-flex; flex: none; gap: 4px; align-items: center; max-inline-size: 120px; block-size: 24px; padding-inline: 8px; border-radius: var(--radius-field); font-size: 12px; font-weight: 500; line-height: 16px; white-space: nowrap; }
    .chip > span { min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; }
    .feat { background: var(--disp-t); color: var(--disp-ink); font-family: var(--font-mono); }
    .ms { border: 1px solid var(--line); color: var(--muted-ink); }
    /* Spec 040 (T48): the state line lies over the stretched title link, so its chips and links are their own targets. */
    .r4 { position: relative; z-index: 1; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; min-inline-size: 0; }
    .r4[data-run] { padding: 4px 8px; border-radius: var(--radius-field); background: var(--color-base-200); }
    .grip { position: relative; z-index: 1; display: grid; place-items: center; align-self: center; inline-size: 44px; block-size: 44px; padding: 0; border: 0; border-radius: var(--radius-field); background: none; color: var(--muted-ink); cursor: grab; }
    .grip:active { cursor: grabbing; }
    /* The prototype's wb-grip (spec 024): shown on hover and focus where a fine pointer can hover; always on touch. */
    @media (hover: hover) and (pointer: fine) {
      .grip { opacity: 0; transition: opacity var(--dur-hover) var(--ease); }
      :host(:hover) .grip, :host(:focus-within) .grip, :host(.cdk-drag-preview) .grip { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .grip { transition: none; } }
    .grip[data-locked] { opacity: 1; cursor: not-allowed; }
    /* Below 640 the prototype hides the drag grip and shows the card menu "Move to" (quiet-icon wb-move, ellipsis). */
    .i-move { display: none; }
    :host-context([data-tier='compact']) .grip { align-self: start; margin-block-start: -8px; opacity: 1; cursor: pointer; }
    :host-context([data-tier='compact']) .grip:hover { background: var(--color-base-300); color: var(--color-base-content); }
    :host-context([data-tier='compact']) .i-grip { display: none; }
    :host-context([data-tier='compact']) .i-move { display: inline-grid; }
    .vh { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (forced-colors: active) {
      .title:focus-visible::after { outline-color: Highlight; }
      .idea, .ms { border-color: CanvasText; }
    }
  `,
  template: `
    @let c = card();
    <ui-card [attr.data-selected]="look()" [padding]="12" side [dashed]="c.kind === 'idea'" [style.--edge]="edge()" [style.--reason-ink]="ink()">
      <article>
        <div class="main">
          <div class="r1">
            <ui-type-glyph [type]="glyph()" />
            @if (c.kind === 'idea') {
              <span class="idea"><ui-icon name="lightbulb" [size]="12" /><span class="slug">{{ c.slug }}</span></span>
            } @else {
              <span class="num">{{ c.id }}</span>
            }
            <ui-priority [value]="c.priority" />
          </div>

          @let stage = 'stages.' + c.stage | transloco;
          @let type = c.type === null ? ('common.noValue' | transloco) : ('types.' + c.type | transloco);
          <a
            class="title"
            [attr.href]="href()"
            [attr.data-ref]="ref()"
            (click)="open($event)"
            [attr.aria-label]="
              c.kind === 'idea'
                ? ('board.workspace.card.ideaName' | transloco: { title: c.title, priority: c.priority })
                : ('board.workspace.card.name' | transloco: { id: c.id, type, title: c.title, priority: c.priority, stage })
            "
            [attr.aria-describedby]="describedByList()"
            >{{ c.title }}</a
          >

          @if (c.feature || c.milestone || c.assignee || c.worktree) {
            <div class="r3">
              @if (c.feature; as feature) {
                <span class="chip feat" [title]="'board.workspace.card.feature' | transloco: { id: feature, name: c.featureName ?? feature }"
                  ><span>{{ feature }}</span></span
                >
              }
              @if (c.milestone; as milestone) {
                <span class="chip ms"><ui-icon name="flag" [size]="12" /><span>{{ milestone }}</span></span>
              }
              @if (c.worktree || c.assignee) {
                <span class="who">
                  @if (c.worktree; as worktree) {
                    <ui-worktree-chip [worktree]="worktree" [compact]="true" [interactive]="false" [mismatch]="c.worktreeMismatch" />
                  }
                  @if (c.assignee; as assignee) {
                    <ui-actor-chip [actor]="assignee" [name]="c.assigneeName" />
                  }
                </span>
              }
            </div>
          }

          <!-- Spec 020 (T13, ISC-237.1): the spec's guidance entry reads its catalogue sentence; without one, the phrase. -->
          @if (waits(); as phrase) {
            @let reason = c.guidance | guidanceReason: phrase;
            <span class="vh" [id]="describedBy()">{{ 'board.workspace.card.waits' | transloco: { reason } }}</span>
          }
          @if (c.state || c.waits || waits()) {
            <div class="r4" data-card-state [attr.data-run]="c.state?.run ? c.state?.state : null">
              @if (c.state; as state) {
                <ui-item-state [info]="withReason(state, c.guidance | guidanceReason: state.reason)" [ws]="ws()" />
              }
              @if (holdShown() && c.waits; as wait) {
                <ui-waits-chip data-card-waits [id]="holdId()" [wait]="wait" [ws]="ws()" [titles]="c.waitTitles" />
              }
              @if (!c.state && waits(); as reason) {
                <ui-reason [compact]="true" [phrase]="reason" [guidance]="c.guidance ?? null" [command]="c.command" />
              }
            </div>
          }
        </div>
        <button
          type="button"
          class="grip"
          cdkDragHandle
          data-grip
          aria-haspopup="dialog"
          [attr.data-locked]="locked() ? '' : null"
          [attr.aria-label]="'board.workspace.card.move' | transloco: { id: c.id ?? c.slug }"
          (pointerdown)="onGripPress($event, grip)"
          (click)="onGripClick($event, grip)"
          #grip
        >
          <ui-icon class="i-grip" [name]="locked() ? 'lock' : 'grip-vertical'" [size]="16" />
          <ui-icon class="i-move" name="ellipsis" [size]="16" />
        </button>
      </article>
    </ui-card>
  `,
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
