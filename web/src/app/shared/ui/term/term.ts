import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { nextId } from '../overlay/ids';

/** Gap between the term and its hint, on the 8 px scale; mirrored by `margin-block` in term.css. */
const GAP = 4;

/**
 * The hover delay is the `--motion-duration-base` token, read from the rendered term: 240 ms, and 0 ms under
 * `prefers-reduced-motion` (motion.css), so the one reduced-motion switch covers it too. Empty (no stylesheet) → 0.
 */
const DELAY_TOKEN = '--motion-duration-base';

const supportsAnchor = (): boolean =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('anchor-name', '--x');

/** `popover="hint"` where the platform knows it (Chromium 133+); an unknown value reads back as `manual`. */
const popoverKind = (el: HTMLElement): 'hint' | 'manual' => {
  el.setAttribute('popover', 'hint');
  return (el as HTMLElement & { popover?: unknown }).popover === 'hint' ? 'hint' : 'manual';
};

const toMs = (value: string): number => {
  const match = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!match) return 0;
  const n = Number(match[1]);
  return match[2] === 's' ? n * 1000 : n;
};

/**
 * A glossary term (design 002's `<dfn>` pattern; ISC-107): the projected word keeps the file vocabulary on screen,
 * with a dotted `--muted-ink` underline, and its common tracker term (`hint`, already translated by the caller) sits in
 * a native popover under it: `<ui-term [hint]="featureHint">Features</ui-term>`.
 *
 * - The term is a focusable `<dfn>` whose `aria-describedby` names the hint, so assistive tech reads the hint without
 *   opening it; the hint is never a `title` and focus never moves into it.
 * - Opens on mouse or pen hover after the tooltip delay, on keyboard focus (`:focus-visible`), and on tap: a coarse
 *   pointer has no hover, so a tap toggles. Closes on pointer leave (hover-opened only, after the same delay, so the
 *   pointer can cross onto the hint), on blur and on Esc.
 * - `popover="hint"` where supported, so it never closes an open `auto` popover (a menu); `manual` otherwise, and this
 *   class does the closing itself.
 * - Placed under the term, centred, by CSS anchor positioning; without it (WebKit < 26) term.css falls back to
 *   `--ui-term-top` / `--ui-term-left`, computed here from the term's `getBoundingClientRect()` on open.
 *
 * `id` names the `<dfn>`; the hint is `<id>-hint` (`hintId`), for a consumer that wants to describe another element by it.
 */
@Component({
  selector: 'ui-term',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './term.css',
  host: {
    '[attr.id]': 'null',
    '[attr.data-open]': 'open() || null',
    '(pointerenter)': 'onPointerEnter($event)',
    '(pointerleave)': 'onPointerLeave($event)',
    '(pointerdown)': 'pressed = true',
    '(click)': 'onClick()',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut()',
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <dfn #term tabindex="0" [id]="termId()" [attr.aria-describedby]="hintId()"><ng-content /></dfn>
    <span #panel class="hint" role="tooltip" [id]="hintId()" [attr.popover]="kind" (toggle)="onToggle($event)">{{ hint() }}</span>
  `,
})
export class UiTerm {
  /** The common term, already translated by the caller. */
  readonly hint = input.required<string>();
  readonly id = input<string>();

  private readonly fallbackId = nextId('ui-term');
  protected readonly termId = computed(() => this.id() ?? this.fallbackId);
  readonly hintId = computed(() => `${this.termId()}-hint`);

  protected readonly open = signal(false);
  /** A pointer pressed the term: the focus that follows is not focus-visible, and the click decides. */
  protected pressed = false;

  private readonly doc = inject(DOCUMENT);
  /** Decided once per instance on a detached probe element, before the first render binds it. */
  protected readonly kind = popoverKind(this.doc.createElement('span'));
  private readonly term = viewChild.required<ElementRef<HTMLElement>>('term');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private reason: 'hover' | 'focus' | 'tap' | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => {
      if (supportsAnchor()) {
        const name = `--${this.fallbackId}`;
        this.term().nativeElement.style.setProperty('anchor-name', name);
        this.panel().nativeElement.style.setProperty('position-anchor', name);
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.cancel();
    });
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancel();
    if (this.open()) return;
    this.later(() => {
      this.show('hover');
    });
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'touch') return;
    this.cancel();
    if (this.reason !== 'hover') return;
    this.later(() => {
      this.hide();
    });
  }

  /** A tap or a click toggles; a mouse click on a hover-opened hint leaves it to the pointer leaving. */
  protected onClick(): void {
    this.pressed = false;
    this.cancel();
    if (!this.open()) this.show('tap');
    else if (this.reason !== 'hover') this.hide();
  }

  protected onFocusIn(): void {
    if (this.pressed || !this.focusVisible()) return;
    this.cancel();
    this.show('focus');
  }

  protected onFocusOut(): void {
    this.pressed = false;
    this.cancel();
    this.hide();
  }

  protected onEscape(event: Event): void {
    this.cancel();
    if (!this.open()) return;
    // Stopped so an enclosing popover, sheet or dialog does not close on the same key.
    event.preventDefault();
    event.stopPropagation();
    this.hide();
  }

  /** The platform closed it (Esc, light dismiss, another hint opening): follow, without a second `hidePopover()`. */
  protected onToggle(event: Event): void {
    if ((event as ToggleEvent).newState !== 'closed' || !this.open()) return;
    this.reason = null;
    this.open.set(false);
  }

  private show(reason: 'hover' | 'focus' | 'tap'): void {
    this.reason = reason;
    if (this.open()) return;
    const panel = this.panel().nativeElement;
    this.open.set(true);
    panel.showPopover();
    this.place(panel);
  }

  private hide(): void {
    this.reason = null;
    if (!this.open()) return;
    this.open.set(false);
    this.panel().nativeElement.hidePopover();
  }

  /** `:focus-visible` where the engine knows it; an engine that throws on it gets the hint on every non-pointer focus. */
  private focusVisible(): boolean {
    try {
      return this.term().nativeElement.matches(':focus-visible');
    } catch {
      return true;
    }
  }

  private later(run: () => void): void {
    const view = this.doc.defaultView;
    const delay = view ? toMs(view.getComputedStyle(this.term().nativeElement).getPropertyValue(DELAY_TOKEN)) : 0;
    this.timer = setTimeout(run, delay);
  }

  private cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** The `@supports not (anchor-name: --x)` fallback: centred under the term, flipped above when it does not fit. */
  private place(panel: HTMLElement): void {
    if (supportsAnchor()) return;
    const view = this.doc.defaultView;
    const viewWidth = view?.innerWidth ?? 0;
    const viewHeight = view?.innerHeight ?? 0;
    const rect = this.term().nativeElement.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    const centred = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(8, Math.min(centred, viewWidth - width - 8));
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const top = below + height > viewHeight - 8 && above >= 8 ? above : below;

    panel.style.setProperty('--ui-term-top', `${String(top)}px`);
    panel.style.setProperty('--ui-term-left', `${String(left)}px`);
  }
}
