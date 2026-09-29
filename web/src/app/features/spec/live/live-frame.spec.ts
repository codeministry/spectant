import frames from '../../../../../../core/fixtures/harbor.frames.golden.json';
import live from '../../../../../../core/fixtures/harbor.live.golden.json';
import type { Frame, LiveFrame } from '../../../../../../core/src/files';
import { agentOfCard, agentsOf, elapsedLabel, isLiveFrame, lockSourceOf, staleAgents } from './live-frame';

const LIVE = live['specs/002-web-console'] as unknown as LiveFrame;
const HISTORY = (frames['specs/002-web-console'] as unknown as Frame[]).at(-1) as Frame;

describe('live-frame', () => {
  it('tells the live frame from a history frame and names the lock source only for the live one', () => {
    expect(isLiveFrame(LIVE)).toBe(true);
    expect(isLiveFrame(HISTORY)).toBe(false);
    expect(lockSourceOf(LIVE)).toBe(LIVE.lockSource);
    expect(lockSourceOf(HISTORY)).toBeNull();
  });

  it('reads the agent of a locked card: session, source, since and the stale mark the model set', () => {
    const running = LIVE.cards.find((c) => c.lock !== undefined);
    if (!running?.lock) throw new Error('the live golden holds no locked card');
    expect(agentOfCard(running)).toEqual({
      session: running.lock.session,
      source: running.lock.source,
      since: running.since ?? null,
      stale: running.stale === true,
    });
    const free = LIVE.cards.find((c) => c.lock === undefined);
    if (!free) throw new Error('the live golden holds no free card');
    expect(agentOfCard(free)).toBeNull();
  });

  it('lists the agents and the stale ones of the live frame, none for a history frame', () => {
    expect(agentsOf(LIVE)).toEqual(LIVE.agents);
    expect(staleAgents(LIVE)).toEqual(LIVE.agents.filter((a) => a.stale));
    expect(agentsOf(HISTORY)).toEqual([]);
    expect(staleAgents(HISTORY)).toEqual([]);
  });

  it('formats the elapsed time from since with Intl.RelativeTimeFormat in the viewer language', () => {
    const since = '2026-03-08T14:06:00Z';
    const now = Date.parse('2026-03-08T15:00:00Z');
    expect(elapsedLabel(since, now, 'en')).toBe('54 minutes ago');
    expect(elapsedLabel(since, now, 'de')).toBe('vor 54 Minuten');
    expect(elapsedLabel(since, now + 2 * 3_600_000, 'en')).toBe('2 hours ago');
    expect(elapsedLabel(since, Date.parse(since) - 5_000, 'en')).toBe('0 seconds ago');
    expect(elapsedLabel('not a date', now, 'en')).toBeNull();
  });
});
