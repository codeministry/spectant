import type { ClaimLock, GateView } from '../../../../../core/src/files';
import { gateAction, gateInHead, pathSegments, relativeTime, relativeUnit, shortHash, slugName } from './spec-head-model';

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
    expect(slugName('002-web-console', '002')).toBe('web-console');
    expect(slugName('web-console', '002')).toBe('web-console');
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
