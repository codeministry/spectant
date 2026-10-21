import { DestroyRef, inject, type Signal, signal } from '@angular/core';

/**
 * A clock that ticks every `ms` while the calling view lives: the elapsed and stale ages of the live chips (agent
 * chip, task actors) re-read it. Call it in an injection context.
 */
export function ticker(ms: number): Signal<number> {
  const now = signal(Date.now());
  const timer = setInterval(() => now.set(Date.now()), ms);
  inject(DestroyRef).onDestroy(() => clearInterval(timer));
  return now.asReadonly();
}
