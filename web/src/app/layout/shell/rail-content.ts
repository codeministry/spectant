import { computed, type DestroyRef, Injectable, type Signal, signal, type TemplateRef } from '@angular/core';

/** One count badge of the collapsed rail strip. */
export interface RailBadge {
  /** `data-rail-count` value, e.g. `thisFrame`. */
  readonly key: string;
  readonly count: number;
  /** The badge's accessible name, already translated ("This frame: 4"). */
  readonly label: string;
}

/** What a view puts into the shell: its rail blocks at wide, its bottom bar, the strip's badges. */
export interface RailRegistration {
  /** Rendered by `app-rail-slot` in place of the placeholder; null keeps the placeholder. */
  readonly blocks: Signal<TemplateRef<unknown> | null>;
  /** The view's bottom bar; in zen `app-zen-footer` renders it inside its own bar, so zen shows one bar. */
  readonly bar: Signal<TemplateRef<unknown> | null>;
  /** The collapsed strip's badges in place of waiting on you and warnings; null keeps those. */
  readonly badges: Signal<readonly RailBadge[] | null>;
}

/**
 * The rail's registration point (T88): a routed view that owns rail content (the board's This frame, Needs you and
 * Your steps) registers it here for its lifetime, and the shell's rail slot, rail toggle and zen footer render it.
 * Templates stay declared in the view, so their bindings keep the view's state; the shell only picks where they go.
 * One registration at a time: the routed view that registered last owns the rail until it is destroyed.
 */
@Injectable({ providedIn: 'root' })
export class RailContent {
  private readonly current = signal<RailRegistration | null>(null);

  readonly blocks = computed(() => this.current()?.blocks() ?? null);
  readonly bar = computed(() => this.current()?.bar() ?? null);
  readonly badges = computed(() => this.current()?.badges() ?? null);

  /** Registers `registration` until `destroyRef` fires. */
  register(registration: RailRegistration, destroyRef: DestroyRef): void {
    this.current.set(registration);
    destroyRef.onDestroy(() => {
      if (this.current() === registration) this.current.set(null);
    });
  }
}
