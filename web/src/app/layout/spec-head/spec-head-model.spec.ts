import type { ClaimLock, GateView } from '../../../../../core/src/files';
import type { PlanningFeature, PlanningHolder, PlanningModel } from '../../../../../core/src/planning';
import { featurePlace, gateAction, gateInHead, pathSegments, relativeTime, relativeUnit, shortHash, slugName } from './spec-head-model';

const gate = (state: GateView['state']): GateView => ({ state, detail: '' });
const LOCK: ClaimLock = { source: 'frontier', claim: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T16:00:00Z' };
const NOW = Date.parse('2026-09-01T08:00:00Z');

describe('gateAction (ISC-85)', () => {
  it('is ready without a mark, stale on a stale mark, done on a fresh one', () => {
    expect(gateAction(gate('missing'), null)).toBe('ready');
    expect(gateAction(gate('stale'), null)).toBe('stale');
    expect(gateAction(gate('fresh'), null)).toBe('done');
  });

  it('is paused while a lock holds the spec, whatever the mark says', () => {
    for (const state of ['missing', 'stale', 'fresh'] as const) expect(gateAction(gate(state), LOCK)).toBe('paused');
  });
});

describe('gateInHead', () => {
  it('offers the gate from tasks through code review, never before a plan or once done', () => {
    for (const stage of ['tasks', 'review', 'build', 'blocked', 'code-review']) expect(gateInHead(stage)).toBe(true);
    for (const stage of ['plan', 'done', 'close', '']) expect(gateInHead(stage)).toBe(false);
  });
});

describe('pathSegments', () => {
  it('cuts after every slash and keeps the text whole', () => {
    expect(pathSegments('specs/002-web/spec.md')).toEqual(['specs/', '002-web/', 'spec.md']);
    expect(pathSegments('spec.md')).toEqual(['spec.md']);
    expect(pathSegments('specs/002-web/spec.md').join('')).toBe('specs/002-web/spec.md');
  });
});

describe('shortHash', () => {
  it('keeps twelve hex digits and passes null through', () => {
    expect(shortHash('a'.repeat(64))).toBe('a'.repeat(12));
    expect(shortHash(null)).toBeNull();
  });
});

describe('slugName', () => {
  it('drops the NNN- prefix of the folder name and keeps a slug without one', () => {
    expect(slugName('002-web-console')).toBe('web-console');
    expect(slugName('web-console')).toBe('web-console');
  });
});

describe('relativeUnit', () => {
  it('picks the largest unit that keeps the value readable, signed into the past', () => {
    expect(relativeUnit(-30_000)).toEqual({ value: -30, unit: 'second' });
    expect(relativeUnit(-5 * 60_000)).toEqual({ value: -5, unit: 'minute' });
    expect(relativeUnit(-3 * 3_600_000)).toEqual({ value: -3, unit: 'hour' });
    expect(relativeUnit(-4 * 86_400_000)).toEqual({ value: -4, unit: 'day' });
    expect(relativeUnit(-177 * 86_400_000)).toEqual({ value: -6, unit: 'month' });
    expect(relativeUnit(-800 * 86_400_000)).toEqual({ value: -2, unit: 'year' });
  });
});

describe('relativeTime (ISC-22)', () => {
  it('formats in the UI language with Intl', () => {
    expect(relativeTime('2026-09-01T07:55:00Z', NOW, 'en')).toBe('5 minutes ago');
    expect(relativeTime('2026-09-01T07:55:00Z', NOW, 'de')).toBe('vor 5 Minuten');
    expect(relativeTime('2026-03-08T16:45:00Z', NOW, 'en')).toBe('6 months ago');
  });

  it('is null for a missing or unreadable date', () => {
    expect(relativeTime(null, NOW, 'en')).toBeNull();
    expect(relativeTime('not a date', NOW, 'en')).toBeNull();
  });
});

describe('featurePlace (ISC-105)', () => {
  const holder = (id: string, main: boolean): PlanningHolder => ({ id, slug: `${id}-x`, title: 'x', archived: false, main, held: 1, stage: null });
  const feature = (id: string, holders: readonly PlanningHolder[], claims: readonly string[]): PlanningFeature => ({
    id,
    name: id,
    why: null,
    closed: 0,
    total: claims.length,
    claims: claims.map((claim) => ({ id: claim, closed: false, dropped: false, holder: holders[0]?.id ?? null })),
    holders,
    unheld: [],
  });
  /**
   * 002 is main under F7 and holds F0 too; F8's ISC-80 is listed by 002 as well, but 003 won it (planning's winner
   * rule), so 002 is no holder of F8.
   */
  const MODEL: PlanningModel = {
    features: [
      feature('F0', [holder('002', false)], ['ISC-1']),
      feature('F7', [holder('002', true)], ['ISC-100']),
      feature('F8', [holder('003', true)], ['ISC-80']),
    ],
    milestones: [],
    recount: null,
    diagnostics: [],
  };
  const ids = (place: ReturnType<typeof featurePlace>): [string | null, string[]] => [place.crumb?.id ?? null, place.others.map((f) => f.id)];

  it("is the open claim's block when the spec holds that block", () => {
    expect(ids(featurePlace(MODEL, '002', 'ISC-1'))).toEqual(['F0', ['F7']]);
  });

  it('falls back to the main feature when the open claim sits in a block the spec does not hold', () => {
    expect(ids(featurePlace(MODEL, '002', 'ISC-80'))).toEqual(['F7', ['F0']]);
  });

  it('is the main feature without an open claim', () => {
    expect(ids(featurePlace(MODEL, '002', null))).toEqual(['F7', ['F0']]);
  });
});
