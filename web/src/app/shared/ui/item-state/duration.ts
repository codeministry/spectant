/**
 * Spec 040 (T45, ISC-224): how long a run has been open, in whole minutes from the `elapsedMs` the API computed at its
 * `now`. "< 1 min", "3 min", "1 h 12 min"; the caller translates the key. No clock is read here: the duration moves
 * only when the refresh tick brings a new `elapsedMs` (ISC-62), so there is no timer and nothing to announce.
 */
export interface ElapsedText {
  readonly key: 'itemState.duration.underMinute' | 'itemState.duration.minutes' | 'itemState.duration.hours';
  readonly params: Readonly<Record<string, number>>;
}

const MINUTE_MS = 60_000;

export function elapsedText(elapsedMs: number): ElapsedText {
  const minutes = Math.floor(Math.max(0, elapsedMs) / MINUTE_MS);
  if (minutes < 1) return { key: 'itemState.duration.underMinute', params: {} };
  if (minutes < 60) return { key: 'itemState.duration.minutes', params: { minutes } };
  return { key: 'itemState.duration.hours', params: { hours: Math.floor(minutes / 60), minutes: minutes % 60 } };
}
