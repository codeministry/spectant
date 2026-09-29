import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Directive,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  model,
  viewChild,
} from '@angular/core';
import { nextId } from './ids';

export type PopoverPlacement = 'start' | 'end';

/** Gap between trigger and panel, on the 8 px scale; mirrored by `margin-block` in popover.css. */
const GAP = 8;

const supportsAnchor = (): boolean =>
  typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('anchor-name', '--x');

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A non-modal panel on the native `popover="auto"` attribute (`showPopover()`): top layer, light dismiss and
 * closing its siblings come from the platform. Open it through a `[uiPopoverTrigger]` button (or `show(trigger)`);
 * `open` is a two-way model and `close()` hides it. On open, focus moves to the element marked `data-autofocus` inside (a
 * menu's current entry; the `autofocus` attribute is linted out), else to the first focusable one; Esc
 * closes and returns focus to the trigger, and so does a light dismiss that left focus nowhere.
 *
 * Placement: below the trigger, aligned to its inline `start` or `end`, 8 px gap, via CSS anchor positioning
 * (`anchor-name` on the trigger, `position-anchor` on the panel, flip fallbacks). Without it (WebKit < 26) popover.css
 * falls back under `@supports not (anchor-name: --x)` to `--ui-popover-top` / `--ui-popover-left`, which this class
 * computes from the trigger's `getBoundingClientRect()` and refreshes on scroll and resize while open.
 *
 * At the compact tier the consumer renders the same content in a `ui-sheet` instead (design.md § Mobile).
 * `label` (translated) names the panel; `--ui-popover-width` on the host sets its width (the switcher: 320px).
 */
@Component({
  selector: 'ui-popover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './popover.css',
  host: {
    '[attr.data-placement]': 'placement()',
    '(keydown.escape)': 'onEscape($event)',
  },
  template: `
    <div #panel class="panel" popover="auto" role="dialog" tabindex="-1" [id]="id" [attr.aria-label]="label() ?? null" (toggle)="onToggle($event)">
      <ng-content />
    </div>
  `,
})
export class UiPopover {
  readonly open = model(false);
  readonly placement = input<PopoverPlacement>('start');
  /** Accessible name of the panel (translated). */
  readonly label = input<string>();

  readonly id = nextId('ui-popover');

  private readonly doc = inject(DOCUMENT);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private trigger: HTMLElement | null = null;
  private shown = false;
  private readonly reposition = (): void => {
    this.place(this.panel().nativeElement);
  };

  constructor() {
    afterRenderEffect(() => {
      const panel = this.panel().nativeElement;
      const wanted = this.open();
      if (wanted === this.shown) return;
      this.shown = wanted;
      if (wanted) this.reveal(panel);
      else this.conceal(panel);
    });
    inject(DestroyRef).onDestroy(() => {
      this.track(false);
    });
  }

  /** Opens the panel anchored to `trigger` (the `[uiPopoverTrigger]` element). */
  show(trigger: HTMLElement): void {
    this.trigger = trigger;
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    // Stopped so an enclosing sheet or dialog does not close on the same key.
    event.preventDefault();
    event.stopPropagation();
    this.close();
  }

  /** The platform closed it (light dismiss, Esc, another auto popover): follow, without a second `hidePopover()`. */
  protected onToggle(event: Event): void {
    if ((event as ToggleEvent).newState !== 'closed' || !this.shown) return;
    this.shown = false;
    this.track(false);
    this.open.set(false);
    this.returnFocus(this.panel().nativeElement, false);
  }

  private reveal(panel: HTMLElement): void {
    if (supportsAnchor() && this.trigger) {
      const name = `--${this.id}`;
      this.trigger.style.setProperty('anchor-name', name);
      panel.style.setProperty('position-anchor', name);
    }
    panel.showPopover();
    this.place(panel);
    this.track(true);
    (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel.querySelector<HTMLElement>(FOCUSABLE) ?? panel).focus();
  }

  private conceal(panel: HTMLElement): void {
    const hadFocus = panel.contains(this.doc.activeElement);
    this.track(false);
    panel.hidePopover();
    this.returnFocus(panel, hadFocus);
  }

  /** Back to the trigger when focus was inside the panel or has fallen to the body; never steal it from elsewhere. */
  private returnFocus(panel: HTMLElement, hadFocus: boolean): void {
    const active = this.doc.activeElement;
    if (hadFocus || active === null || active === this.doc.body || panel.contains(active)) this.trigger?.focus();
  }

  /** The `@supports not (anchor-name: --x)` fallback: below the trigger, flipped above when it does not fit. */
  private place(panel: HTMLElement): void {
    if (supportsAnchor() || !this.trigger) return;
    const view = this.doc.defaultView;
    const viewWidth = view?.innerWidth ?? 0;
    const viewHeight = view?.innerHeight ?? 0;
    const rect = this.trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;

    const aligned = this.placement() === 'end' ? rect.right - width : rect.left;
    const left = Math.max(GAP, Math.min(aligned, viewWidth - width - GAP));
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const top = below + height > viewHeight - GAP && above >= GAP ? above : below;

    panel.style.setProperty('--ui-popover-top', `${String(top)}px`);
    panel.style.setProperty('--ui-popover-left', `${String(left)}px`);
  }

  private track(on: boolean): void {
    const view = this.doc.defaultView;
    if (!view || supportsAnchor()) return;
    const method = on ? 'addEventListener' : 'removeEventListener';
    view[method]('resize', this.reposition);
    view[method]('scroll', this.reposition, { capture: true });
  }
}

/**
 * Makes its host (a `ui-button` / `ui-icon-button`) the trigger and anchor of a `ui-popover`:
 * `<button ui-icon-button icon="settings" [label]="…" [uiPopoverTrigger]="gear"></button> <ui-popover #gear>…`.
 * Sets `aria-expanded` and `aria-controls`, and toggles on click. A press on the trigger while the panel is open
 * light-dismisses it before the click arrives; the click then must not reopen it, so the state at press time wins.
 */
@Directive({
  selector: '[uiPopoverTrigger]',
  host: {
    '[attr.aria-expanded]': 'popover().open()',
    '[attr.aria-controls]': 'popover().id',
    '(pointerdown)': 'openAtPress = popover().open()',
    '(click)': 'onClick()',
  },
})
export class UiPopoverTrigger {
  readonly popover = input.required<UiPopover>({ alias: 'uiPopoverTrigger' });

  protected openAtPress: boolean | null = null;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  protected onClick(): void {
    const wasOpen = this.openAtPress ?? this.popover().open();
    this.openAtPress = null;
    if (wasOpen) this.popover().close();
    else this.popover().show(this.host);
  }
}
