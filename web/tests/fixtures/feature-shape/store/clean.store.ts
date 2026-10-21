import { computed, Injectable, signal } from '@angular/core';

// Fixture for the store shape (spec 061, ISC-436): state as signals, a derivation as `computed`, a change as a
// method, and nothing that reaches a template or the DOM. The guard finds no violation here.
@Injectable()
export class CleanStore {
  private readonly items = signal<readonly string[]>([]);
  readonly count = computed(() => this.items().length);

  add(item: string): void {
    this.items.update((items) => [...items, item]);
  }
}
