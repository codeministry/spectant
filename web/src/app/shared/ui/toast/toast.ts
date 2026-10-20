import { ChangeDetectionStrategy, Component, computed, effect, inject, Injectable, signal, untracked, viewChild } from '@angular/core';
import { UiLiveRegion } from '../live-region/live-region';

/** How long a toast stays: 4 s (DS-APP-25). */
export const TOAST_MS = 4000;

/**
 * The app's single toast (DS-APP-25): `show(text)` replaces whatever is showing and restarts the 4 s clock. One
 * message at a time, so a burst of copies never stacks. Callers pass translated text.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly current = signal<{ readonly text: string; readonly seq: number } | null>(null);
  private readonly said = signal<{ readonly text: string; readonly seq: number } | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  readonly message = computed(() => this.current()?.text ?? null);
  /** Changes on every `show()`, so a repeated text is announced again. */
  readonly entry = this.current.asReadonly();
  /** The last spoken-only text (`announce()`); changes on every call, so a repeated text is announced again. */
  readonly spoken = this.said.asReadonly();

  show(text: string): void {
    clearTimeout(this.timer);
    this.current.set({ text, seq: ++this.seq });
    this.timer = setTimeout(() => this.dismiss(), TOAST_MS);
  }

  /**
   * Speaks `text` through the one live region without a visible toast (spec 016: a re-scan or upload result, where
   * design.md allows no toast). Callers pass translated text.
   */
  announce(text: string): void {
    this.said.set({ text, seq: ++this.seq });
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.current.set(null);
  }
}

/**
 * The one toast host, mounted once by the shell. The visible toast is `aria-hidden`; screen readers hear the text
 * through the page's single polite `ui-live-region`, which lives here so there is never a second one. The entry fade
 * runs on motion tokens, which are 0ms under reduced motion (motion.css); nothing slides.
 */
@Component({
  selector: 'ui-toast',
  imports: [UiLiveRegion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .toast { z-index: 50; padding: 16px; }
    .alert { max-inline-size: min(360px, calc(100vw - 32px)); border: 1px solid var(--color-accent); background: var(--color-base-100); color: var(--color-base-content); font-size: 14px; animation: toast-in var(--motion-duration-fast) var(--motion-ease-emphasized); }
    @keyframes toast-in { from { opacity: 0; } }
  `,
  template: `
    @if (toasts.message(); as text) {
      <div class="toast toast-end toast-bottom" aria-hidden="true">
        <div class="alert">{{ text }}</div>
      </div>
    }
    <ui-live-region />
  `,
})
export class UiToast {
  protected readonly toasts = inject(ToastService);
  private readonly region = viewChild.required(UiLiveRegion);

  constructor() {
    effect(() => {
      const entry = this.toasts.entry();
      if (entry) untracked(() => this.region().announce(entry.text));
    });
    effect(() => {
      const spoken = this.toasts.spoken();
      if (spoken) untracked(() => this.region().announce(spoken.text));
    });
  }
}
