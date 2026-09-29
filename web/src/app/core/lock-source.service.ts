import { computed, Injectable, signal, type Signal } from '@angular/core';
import type { SpecAreas } from '../../../../core/src/files';

/** The spec model's Live summary: the lock source read, the sessions holding a claim of this spec, the newest lock. */
export type LiveReading = SpecAreas['live'];

const NO_READING: Signal<LiveReading | null> = signal(null).asReadonly();

/**
 * Which agent lock source the server read for the open spec (plan 002 § Interfaces, "Client shell contract"): the
 * live indicator, the agent banner, the gate button and the task checkboxes read it.
 *
 * - `source`: `frontier` (LifeOS frontier locks), `activity` (`.spectant/activity.jsonl`) or `none`. `none` means the
 *   page says "no agent source" and a write runs under the hash check alone (ISC-86).
 * - `lock`: the newest lock on a claim of this spec, null when none is held.
 *
 * A holder, not a fetcher: the shell `connect`s the spec payload's `areas.live` (`core/src/files.ts` `SpecAreas`), so
 * the value follows whatever the shell has loaded. With no spec open, or before the spec route answers, the reading
 * is null and the source is `none`. A later feed (the live frame of T90, SSE later) connects its own signal.
 */
@Injectable({ providedIn: 'root' })
export class LockSourceService {
  private readonly feed = signal<Signal<LiveReading | null>>(NO_READING);

  readonly reading = computed(() => this.feed()());
  readonly source = computed(() => this.reading()?.lockSource ?? 'none');
  readonly lock = computed(() => this.reading()?.lock ?? null);
  readonly agentsWorking = computed(() => this.reading()?.agentsWorking ?? 0);

  connect(reading: Signal<LiveReading | null>): void {
    this.feed.set(reading);
  }
}
