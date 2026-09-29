import type { AgentLockSource, Frame, FrameCard, LiveAgent, LiveCard, LiveFrame, LockSource } from '../../../../../../core/src/files';
import { relativeParts, type RelativeUnit } from '../../../shared/ui/relative-time/relative-time';

/**
 * The live frame's rendering helpers (T85, ISC-90): who holds a card's lock, since when, whether the model marked it
 * stale, and which lock source the reading names. Everything is read from core's `LiveFrame` (`…/live`); nothing is
 * re-derived here except the elapsed time, which core leaves to the web (`ClaimLock.since`: "elapsed time is the
 * web's") so it keeps counting between two readings.
 */

/** The agent behind one locked card, as the card chip shows it. */
export interface CardAgent {
  readonly session: string;
  readonly source: AgentLockSource;
  /** ISO 8601, when the lock was taken; null when the frame gives no time (a history frame's lock). */
  readonly since: string | null;
  /** The model's stale mark: no release for longer than the frame's `staleAfterMs`. */
  readonly stale: boolean;
}

export function isLiveFrame(frame: Frame | LiveFrame): frame is LiveFrame {
  return frame.kind === 'live';
}

/** `frontier`, `activity` or `none` for the live frame; a history frame names no source (null). */
export function lockSourceOf(frame: Frame | LiveFrame): LockSource | null {
  return isLiveFrame(frame) ? frame.lockSource : null;
}

/** The lock holding a card, or null when none does. */
export function agentOfCard(card: FrameCard | LiveCard): CardAgent | null {
  if (card.lock === undefined) return null;
  const live = card as LiveCard;
  return { session: card.lock.session, source: card.lock.source, since: live.since ?? null, stale: live.stale === true };
}

/** The sessions holding locks on this spec, oldest first (core's order); none in a history frame. */
export function agentsOf(frame: Frame | LiveFrame): readonly LiveAgent[] {
  return isLiveFrame(frame) ? frame.agents : [];
}

/** The sessions the model marked stale: the stale-agent alert of "Needs you". */
export function staleAgents(frame: Frame | LiveFrame): readonly LiveAgent[] {
  return agentsOf(frame).filter((agent) => agent.stale);
}

const INTL_UNIT: Readonly<Record<RelativeUnit, Intl.RelativeTimeFormatUnit>> = { s: 'second', min: 'minute', h: 'hour', d: 'day' };

/** "54 minutes ago" / "vor 54 Minuten": whole units from `since` to `now` in `locale`; null for an unreadable `since`. */
export function elapsedLabel(since: string, now: number, locale: string): string | null {
  const then = Date.parse(since);
  if (Number.isNaN(then)) return null;
  const { value, unit } = relativeParts(then, now);
  return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-value, INTL_UNIT[unit]);
}
