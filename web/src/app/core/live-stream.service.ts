import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { EVENTS_PATH, isLiveUpdate, LIVE_EVENT, type LiveUpdate } from '../../../../server/src/spec-routes.contract';

/** The part of a browser `EventSource` the live stream uses. */
export interface LiveSource extends EventTarget {
  close(): void;
}

/** How the live stream opens its connection: `EventSource`, or a fake the unit tests drive. */
export type LiveSourceConstructor = new (url: string) => LiveSource;

/**
 * The `EventSource` constructor as a token, like `DOCUMENT`, so the unit tests hand in a fake. `null` where the
 * runtime has none (a DOM emulation): the stream then stays disconnected and the poll carries the refresh alone.
 */
export const EVENT_SOURCE = new InjectionToken<LiveSourceConstructor | null>('EVENT_SOURCE', {
  providedIn: 'root',
  factory: () => (typeof EventSource === 'undefined' ? null : EventSource),
});

function parse(data: unknown): LiveUpdate | null {
  if (typeof data !== 'string') return null;
  try {
    const body: unknown = JSON.parse(data);
    return isLiveUpdate(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * The live update stream (spec 030, ISC-28; plan 030 § Interfaces): one `EventSource` on `EVENTS_PATH`, the I/O
 * boundary of the push path, bridged into signals. `connected` follows the stream's `open` and `error` (the browser
 * reconnects on its own after an error), and `updates` holds the last `LIVE_EVENT` frame that parsed and passed
 * `isLiveUpdate`; every frame is a new object, so an effect on it runs once per frame. Anything else is dropped.
 * The stream closes when the root injector is destroyed.
 */
@Injectable({ providedIn: 'root' })
export class LiveStreamService {
  private readonly connectedState = signal(false);
  private readonly updatesState = signal<LiveUpdate | null>(null);
  private readonly listeners = new Set<(update: LiveUpdate) => void>();

  /** True while the stream is open; false before the first `open` and after every `error` until the next. */
  readonly connected = this.connectedState.asReadonly();
  /** The last valid update frame; null until one arrived. */
  readonly updates = this.updatesState.asReadonly();

  constructor() {
    const Source = inject(EVENT_SOURCE);
    if (Source === null) return;
    const source = new Source(EVENTS_PATH);
    source.addEventListener('open', () => this.connectedState.set(true));
    source.addEventListener('error', () => this.connectedState.set(false));
    source.addEventListener(LIVE_EVENT, (event) => {
      const update = parse((event as MessageEvent<unknown>).data);
      if (update === null) return;
      for (const listener of this.listeners) listener(update);
      this.updatesState.set(update);
    });
    inject(DestroyRef).onDestroy(() => source.close());
  }

  /**
   * Calls `listener` with every valid frame, synchronously as it arrives, before `updates` moves; returns the
   * unsubscribe. A consumer that must see every frame (the refresh primes each one) listens here, since `updates` keeps
   * only the last of frames that arrive before effects run.
   */
  onUpdate(listener: (update: LiveUpdate) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
