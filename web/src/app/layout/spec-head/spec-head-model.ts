/**
 * Pure display helpers for the spec head and its gate button (T78, ISC-85, ISC-22). Nothing here derives a stage or a
 * gate state: the helpers only pick which of the button's four states the model's facts put it in, whether the stage
 * offers the gate at all, and how a path, a slug and a time read.
 */
import type { ClaimLock, GateView } from '../../../../../core/src/files';

/** The gate button's four states (design.md § Status, ISC-85). */
export type GateAction = 'ready' | 'stale' | 'done' | 'paused';

/**
 * The reviewed gate's button: any lock on this spec pauses writes (a 423 would answer anyway, ISC-86), a stale mark
 * asks for a new review, a fresh one is done, and anything else (no mark yet) is ready.
 */
export function gateAction(reviewed: GateView, lock: ClaimLock | null): GateAction {
  if (lock !== null) return 'paused';
  if (reviewed.state === 'stale') return 'stale';
  if (reviewed.state === 'fresh') return 'done';
  return 'ready';
}

/** The stages whose head carries the gate button: from tasks on, while the spec is still open. */
const HEAD_GATE_STAGES: ReadonlySet<string> = new Set(['tasks', 'review', 'build', 'blocked', 'code-review']);

/** "When the stage allows" (design.md § Spec head): not before there is a plan to review, not once it is done. */
export function gateInHead(stage: string): boolean {
  return HEAD_GATE_STAGES.has(stage);
}

/** A path cut after each `/`, so the template can offer a line break there (`<wbr>`) and nowhere else. */
export function pathSegments(path: string): readonly string[] {
  return path.split(/(?<=\/)/u).filter((segment) => segment.length > 0);
}

/** The first twelve hex digits of a hash for display; null for a file that does not exist. */
export function shortHash(hash: string | null): string | null {
  return hash === null ? null : hash.slice(0, 12);
}

/** The folder name without its `NNN-` prefix: `002-web-console` reads "web-console" beside the mono id. */
export function slugName(slug: string, id: string): string {
  return slug.startsWith(`${id}-`) ? slug.slice(id.length + 1) : slug;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The largest unit that keeps a signed distance readable (negative: in the past), rounded to whole units. */
export function relativeUnit(deltaMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const abs = Math.abs(deltaMs);
  if (abs < MINUTE) return { value: Math.round(deltaMs / SECOND), unit: 'second' };
  if (abs < HOUR) return { value: Math.round(deltaMs / MINUTE), unit: 'minute' };
  if (abs < DAY) return { value: Math.round(deltaMs / HOUR), unit: 'hour' };
  if (abs < 30 * DAY) return { value: Math.round(deltaMs / DAY), unit: 'day' };
  if (abs < 365 * DAY) return { value: Math.round(deltaMs / (30 * DAY)), unit: 'month' };
  return { value: Math.round(deltaMs / (365 * DAY)), unit: 'year' };
}

/** `iso` relative to `now` in the UI language ("5 minutes ago", "vor 5 Minuten"); null for no or no readable date. */
export function relativeTime(iso: string | null, now: number, lang: string): string | null {
  if (iso === null) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const { value, unit } = relativeUnit(then - now);
  return new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(value, unit);
}
