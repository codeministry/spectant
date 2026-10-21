import { Injectable, signal } from '@angular/core';

/** One bubble of the conversation: the person's prompt, or dot's answer (`text` from the fixture). */
export interface AssistantMessage {
  readonly from: 'you' | 'dot';
  readonly text: string;
}

/**
 * The assistant "dot" (spec 024 T53, ISC-150), mocked until specs 012/015: whether its panel
 * is open, the trigger focus returns to, and the conversation. The service stays tiny because the header loads it
 * eagerly; the panel (`AssistantPanel`, deferred) reads its answers from `DemoData` and adds them here. The history
 * lives in memory only (no localStorage, ISC-149.1) and is gone with a reload or "New conversation".
 */
@Injectable({ providedIn: 'root' })
export class AssistantDot {
  private readonly openState = signal(false);
  private returnTo: HTMLElement | null = null;

  readonly open = this.openState.asReadonly();
  readonly messages = signal<readonly AssistantMessage[]>([]);
  /** dot is "typing" (three dots) before its answer lands. */
  readonly thinking = signal(false);

  /** Opens the panel; focus returns to `trigger` when it closes. */
  show(trigger: HTMLElement | null): void {
    this.returnTo = trigger;
    this.openState.set(true);
  }

  toggle(trigger: HTMLElement | null): void {
    if (this.openState()) this.close();
    else this.show(trigger);
  }

  /** Closes the panel (it leaves the DOM) and puts focus back on its trigger. */
  close(): void {
    if (!this.openState()) return;
    this.openState.set(false);
    this.thinking.set(false);
    const target = this.returnTo;
    this.returnTo = null;
    if (target?.isConnected) target.focus();
  }
}
