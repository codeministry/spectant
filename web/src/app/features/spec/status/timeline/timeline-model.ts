import type { TimelineEntry, TimelineKind } from '../../../../../../../core/src/files';
import { localDayKey } from '../../../../shared/time';

/**
 * The sources in chip order (design.md § Status, tablet): the files' five, then the server's
 * joins; `worktree` last, after Agent (spec 027 design.md § Across viewports 5), its pill shown only while the
 * strand holds a worktree entry or the filter names it.
 */
export const TIMELINE_KINDS: readonly TimelineKind[] = ['stage', 'decision', 'round', 'gate', 'commit', 'note', 'agent', 'worktree'];

export interface TimelineRow {
  readonly entry: TimelineEntry;
  /** `entry.id`, or `<kind>-<index>` when the source gave none (the list still needs a stable key). */
  readonly key: string;
  /** The `ts` its clock is shown from (`<ui-time form="clock">`), empty for a date-only `ts`; null on an undated entry ("date unknown"). */
  readonly time: string | null;
}

export interface TimelineDay {
  /** `YYYY-MM-DD` in local time, `undated` when no entry before an undated one gives a day. */
  readonly key: string;
  /**
   * The ISO value the day heading formats (`<ui-time form="date">`): the first dated entry's `ts`, whose local date is
   * the group's day; a date-only `ts` as its local midnight. Null for the `undated` group.
   */
  readonly ts: string | null;
  readonly rows: readonly TimelineRow[];
}

/** A `ts` as an ISO value read in local time, or null when it is empty or unparsable. A date alone (`2026-03-06`) is read as local midnight. */
function localIso(ts: string): string | null {
  if (ts === '') return null;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? `${ts}T00:00:00` : ts;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/**
 * Day groups in list order (newest first, as the API sends them). An entry without a date joins the group of the
 * entry before it, so an undated derived transition stays next to the transition it follows (derived-stages.ts).
 */
export function groupByDay(entries: readonly TimelineEntry[]): TimelineDay[] {
  const days: Array<{ key: string; ts: string | null; rows: TimelineRow[] }> = [];
  entries.forEach((entry, index) => {
    const iso = localIso(entry.ts);
    const time = iso === null ? null : entry.ts.includes('T') ? entry.ts : '';
    const row: TimelineRow = { entry, key: entry.id ?? `${entry.kind}-${index}`, time };
    const key = iso === null ? (days.at(-1)?.key ?? 'undated') : localDayKey(new Date(iso));
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, ts: iso, rows: [row] });
  });
  return days;
}

/** `?kinds=round,gate` → the known kinds it names; anything else is dropped. */
export function parseKinds(value: string | null): readonly TimelineKind[] {
  if (!value) return [];
  const named = new Set(value.split(','));
  return TIMELINE_KINDS.filter((kind) => named.has(kind));
}
