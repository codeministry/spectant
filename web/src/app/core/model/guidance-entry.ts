import type { Guidance, GuidanceEntry, ItemStateInfo } from '../../../../../core/src/files';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null;

/**
 * Every waiting entry of a `waits` list: each front entry, then the entries core folded under it (spec 070, ISC-568),
 * in their order. A spec page's slice is already unfolded and passes through as it is. Pure.
 */
export function waitingEntries(waits: readonly GuidanceEntry[]): GuidanceEntry[] {
  return waits.flatMap((entry) => [entry, ...(entry.folded ?? [])]);
}

/**
 * The spec's own guidance entry (ISC-237.1): the `item: 'spec'` entry of `spec` in `waits` (a front entry or one folded
 * under its spec's front, spec 070) ∪ `next`, or null when the guidance names none (no clock, or no open item: a
 * running, waiting or done spec keeps the phrase it shows today). The dashboard row, the status block, the board card
 * and Next up all find the entry here, so the same item reads the same catalogue sentence on every surface. Pure.
 */
export function guidanceEntryOf(guidance: Guidance | null | undefined, spec: string | null | undefined): GuidanceEntry | null {
  if (!guidance || !spec) return null;
  const own = (e: GuidanceEntry): boolean => e.spec === spec && e.item === 'spec';
  return waitingEntries(guidance.waits).find(own) ?? guidance.next.find(own) ?? null;
}

/**
 * The `guidance` of a served, untyped dashboard body (`DashboardModel.guidance`, see `DashboardBody`), passed through
 * as it is; undefined when the body carries none or it lacks the two lists.
 */
export function guidanceOfBody(body: unknown): Guidance | undefined {
  const guidance = isRecord(body) ? body['guidance'] : undefined;
  return isRecord(guidance) && Array.isArray(guidance['waits']) && Array.isArray(guidance['next']) ? (guidance as unknown as Guidance) : undefined;
}

/** The item state with its reason read as `sentence`; the same object when there is no reason or nothing changes. */
export function withReason(info: ItemStateInfo, sentence: string | null | undefined): ItemStateInfo {
  return info.reason === undefined || !sentence || sentence === info.reason ? info : { ...info, reason: sentence };
}
