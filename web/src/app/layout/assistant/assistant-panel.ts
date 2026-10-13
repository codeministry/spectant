import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  type ElementRef,
  inject,
  type OnDestroy,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../shared/icons/icon';
import { UiIconButton } from '../../shared/ui/button/icon-button';
import { UiChip } from '../../shared/ui/chip/chip';
import { UiKbd } from '../../shared/ui/kbd/kbd';
import { DemoData } from '../../shared/demo/demo-data';
import { AssistantDot } from './assistant.service';
import { Mascot } from './mascot';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * The assistant "dot" panel (spec 024 T53, ISC-150; prototype `assistant.js`, `styles.css` `.as-*`), a mock until specs
 * 012/015 with the demo chip in its `as-head` (ISC-149.1). It renders only while open, as a manual popover in the top
 * layer (the sticky header's backdrop filter would otherwise contain a fixed panel): from 640 px floating 16 px from the
 * bottom right, 400 × min(660, 100dvh − 96), below 640 px a full-height bottom sheet. Suggestions and answers come from
 * `DemoData` only; nothing is sent, stored or written. Esc and `x` close it, Tab stays inside, focus returns to the
 * trigger; the entry motion and dot's thinking animation stop under reduced motion.
 */
@Component({
  selector: 'app-assistant-panel',
  imports: [TranslocoPipe, UiChip, UiIcon, UiIconButton, UiKbd, Mascot],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assistant-panel.html',
  styleUrl: './assistant-panel.css',
  host: { '(document:keydown.escape)': 'onEscape($event)' },
})
export class AssistantPanel implements OnDestroy {
  protected readonly dot = inject(AssistantDot);
  private readonly demo = inject(DemoData);
  protected readonly suggestions = this.demo.assistantSuggestions;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly log = viewChild.required<ElementRef<HTMLElement>>('log');
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  constructor() {
    afterNextRender(() => {
      const panel = this.panel().nativeElement;
      if (typeof panel.showPopover === 'function') panel.showPopover();
      this.input().nativeElement.focus();
    });
    // The newest bubble stays in view.
    afterRenderEffect(() => {
      this.dot.messages();
      this.dot.thinking();
      const log = this.log().nativeElement;
      log.scrollTop = log.scrollHeight;
    });
  }

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    const panel = this.panel().nativeElement;
    if (panel.matches(':popover-open')) panel.hidePopover();
  }

  /** Asks dot: the prompt shows at once, the fixture's answer after 650 ms (at once under reduced motion). */
  protected ask(prompt: string): void {
    const text = prompt.trim();
    if (text === '' || this.dot.thinking()) return;
    this.dot.messages.update((list) => [...list, { from: 'you', text }]);
    const answer = (): void => {
      this.dot.thinking.set(false);
      this.dot.messages.update((list) => [...list, { from: 'dot', text: this.demo.assistantReply(text) }]);
    };
    if (this.reducedMotion()) {
      answer();
      return;
    }
    this.dot.thinking.set(true);
    this.timer = setTimeout(answer, 650);
  }

  protected send(event: Event): void {
    event.preventDefault();
    const field = this.input().nativeElement;
    if (field.value.trim() === '') return;
    this.ask(field.value);
    field.value = '';
  }

  protected restart(): void {
    clearTimeout(this.timer);
    this.dot.thinking.set(false);
    this.dot.messages.set([]);
    this.input().nativeElement.focus();
  }

  /** Esc closes dot unless a modal on top of it (palette, dialog) takes the key first. */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented || this.panel().nativeElement.ownerDocument.querySelector('dialog[open]:modal')) return;
    event.preventDefault();
    this.dot.close();
  }

  /** The focus trap: Tab and Shift+Tab cycle through the panel's controls. */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = Array.from(this.panel().nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items.at(0);
    const last = items.at(-1);
    if (first === undefined || last === undefined) return;
    const active = this.panel().nativeElement.ownerDocument.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private reducedMotion(): boolean {
    return this.view?.matchMedia('(prefers-reduced-motion: reduce)').matches ?? false;
  }
}
