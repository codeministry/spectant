// The eviction every process-level cache over git reads shares (`CommitCache`, `MergeCache`, `StateMemo`): a stored
// key moves to the newest place, and the oldest keys leave while the map holds more than its bound.

/** Stores `value` under `key` as the newest entry of `entries`, then drops the oldest entries beyond `max`. */
export function storeBounded<K, V>(entries: Map<K, V>, key: K, value: V, max: number): void {
  entries.delete(key);
  entries.set(key, value);
  while (entries.size > max) {
    const oldest = entries.keys().next();
    if (oldest.done === true) break;
    entries.delete(oldest.value);
  }
}
