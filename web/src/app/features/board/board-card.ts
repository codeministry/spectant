import { CdkDragHandle } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { WorkflowStage } from '../../../../../core/src/files';
import { UiIcon } from '../../shared/icons/icon';
import { UiActorChip } from '../../shared/ui/actor-chip/actor-chip';
import { UiCard } from '../../shared/ui/card/card';
import { UiPriority } from '../../shared/ui/priority/priority';
import { UiReason } from '../../shared/ui/reason/reason';
import { type TypeGlyphKind, UiTypeGlyph } from '../../shared/ui/type-glyph/type-glyph';
import type { BoardCard as BoardCardModel } from './board-model';

/**
 * The inline-start edge per stage, in the prototype's role colours (spec 024, design § Workspace-Board): teal for an
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
 * - Row 3: the main feature chip `F<n>` (its name in the tooltip), the milestone (muted) and, pushed to the end,
 *   `ui-actor-chip` with the resolved name or the raw id; nothing when the card is unassigned.
 * - Row 4, waiting cards only: `ui-reason` compact, the row's phrase and its command chip (none for close-pending).
 * - The `grip-vertical` zone at the trailing edge is the `cdkDragHandle` (T125): the board page puts `cdkDrag` on this
 *   element and only the grip lifts the card, so the title stays a link. The grip is a button named "Move 008"
 *   (T127): a click without movement, Enter or Space emits `moveMenu` with the grip, and the board opens "Move to…"
 *   on it, the single-pointer and keyboard path to the move (WCAG 2.5.7).
 * - Shift+← / Shift+→ anywhere on the card (the title link or the grip focused) emit `step` with -1 or 1; the board
 *   moves the card to the previous or next allowed stage (T127).
 *
 * Variants come only from `ui-card`: `side` (the edge, `--edge` per stage) on every card, `dashed` on a story's.
 */
@Component({
  selector: 'app-board-card',
  imports: [CdkDragHandle, RouterLink, TranslocoPipe, UiActorChip, UiCard, UiIcon, UiPriority, UiReason, UiTypeGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-key]': 'card().key',
    '[attr.data-stage]': 'card().stage',
    '[attr.data-kind]': 'card().kind',
    '(keydown.shift.arrowleft)': 'onStep($event, -1)',
    '(keydown.shift.arrowright)': 'onStep($event, 1)',
  },
  styles: `
    :host { display: block; min-inline-size: 0; }
    ui-card { min-block-size: 72px; }
    article { display: grid; grid-template-columns: minmax(0, 1fr) 44px; margin-inline-end: -12px; }
    .main { display: grid; gap: 8px; min-inline-size: 0; }
    .r1, .r3 { display: flex; gap: 8px; align-items: center; min-inline-size: 0; }
    .r1 { color: var(--muted-ink); }
    .r1 ui-priority { margin-inline-start: auto; }
    .r3 { flex-wrap: wrap; }
    .r3 ui-actor-chip { max-inline-size: 14ch; margin-inline-start: auto; }
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
    ui-reason { position: relative; z-index: 1; }
    .grip { position: relative; z-index: 1; display: grid; place-items: center; align-self: center; inline-size: 44px; block-size: 44px; padding: 0; border: 0; border-radius: var(--radius-field); background: none; color: var(--muted-ink); cursor: grab; }
    .grip:active { cursor: grabbing; }
    /* The prototype's wb-grip (spec 024): shown on hover and focus where a fine pointer can hover; always on touch. */
    @media (hover: hover) and (pointer: fine) {
      .grip { opacity: 0; transition: opacity var(--dur-hover) var(--ease); }
      :host(:hover) .grip, :host(:focus-within) .grip, :host(.cdk-drag-preview) .grip { opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .grip { transition: none; } }
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
    <ui-card [padding]="12" side [dashed]="c.kind === 'idea'" [style.--edge]="edge()" [style.--reason-ink]="ink()">
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
            [routerLink]="link()"
            [attr.aria-label]="
              c.kind === 'idea'
                ? ('board.workspace.card.ideaName' | transloco: { title: c.title, priority: c.priority })
                : ('board.workspace.card.name' | transloco: { id: c.id, type, title: c.title, priority: c.priority, stage })
            "
            [attr.aria-describedby]="waits() ? describedBy() : null"
            >{{ c.title }}</a
          >

          @if (c.feature || c.milestone || c.assignee) {
            <div class="r3">
              @if (c.feature; as feature) {
                <span class="chip feat" [title]="'board.workspace.card.feature' | transloco: { id: feature, name: c.featureName ?? feature }"
                  ><span>{{ feature }}</span></span
                >
              }
              @if (c.milestone; as milestone) {
                <span class="chip ms"><ui-icon name="flag" [size]="12" /><span>{{ milestone }}</span></span>
              }
              @if (c.assignee; as assignee) {
                <ui-actor-chip [actor]="assignee" [name]="c.assigneeName" />
              }
            </div>
          }

          @if (waits(); as reason) {
            <span class="vh" [id]="describedBy()">{{ 'board.workspace.card.waits' | transloco: { reason } }}</span>
            <ui-reason [compact]="true" [phrase]="reason" [command]="c.command" />
          }
        </div>
        <button
          type="button"
          class="grip"
          cdkDragHandle
          data-grip
          aria-haspopup="dialog"
          [attr.aria-label]="'board.workspace.card.move' | transloco: { id: c.id ?? c.slug }"
          (click)="moveMenu.emit(grip)"
          #grip
        >
          <ui-icon class="i-grip" name="grip-vertical" [size]="16" />
          <ui-icon class="i-move" name="ellipsis" [size]="16" />
        </button>
      </article>
    </ui-card>
  `,
})
export class BoardCard {
  readonly card = input.required<BoardCardModel>();
  /** The workspace slug the card's link opens in. */
  readonly ws = input.required<string>();
  /** The grip was clicked (no drag), or pressed with Enter or Space: the board opens "Move to…" on it (T127). */
  readonly moveMenu = output<HTMLElement>();
  /** Shift+← (-1) or Shift+→ (1) on the card: the board moves it to the previous or next allowed stage (T127). */
  readonly step = output<-1 | 1>();

  protected onStep(event: Event, dir: -1 | 1): void {
    event.preventDefault();
    this.step.emit(dir);
  }

  protected readonly edge = computed(() => CARD_EDGE[this.card().stage]);
  protected readonly ink = computed(() => reasonInk(this.card()));
  protected readonly glyph = computed<TypeGlyphKind>(() => this.card().type ?? 'idea');
  /** The phrase of a waiting card; null on every other card, which shows no reason line. */
  protected readonly waits = computed(() => (this.card().waiting ? this.card().reason : null));
  protected readonly describedBy = computed(() => `bc-${this.card().key}-waits`);
  protected readonly link = computed(() => {
    const c = this.card();
    return c.kind === 'idea' ? ['/w', this.ws(), 'ideas', c.slug] : ['/w', this.ws(), 's', c.id ?? c.slug];
  });
}
