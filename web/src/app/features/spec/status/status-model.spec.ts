import type { ClaimLock, ClaimView, GateView } from '../../../../../../core/src/files';
import { gateAction, openClaims, pathSegments, shortHash } from './status-model';

const gate = (state: GateView['state']): GateView => ({ state, detail: '' });
const LOCK: ClaimLock = { source: 'frontier', claim: 'ISC-74', session: 'spec-002-ISC-74', since: '2026-03-08T16:00:00Z' };
const claim = (id: string, state: ClaimView['state']): ClaimView =>
  ({ id, state, text: id, feature: null, kind: 'normal', edges: [], blockedBy: [], probe: null, verification: null, lock: null, dropped: null, noteCount: 0, line: 1 }) satisfies ClaimView;

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

describe('openClaims', () => {
  it('drops closed and dropped claims and keeps the order', () => {
    const claims = [claim('ISC-1', 'closed'), claim('ISC-2', 'takeable'), claim('ISC-3', 'dropped'), claim('ISC-4', 'blocked'), claim('ISC-5', 'open')];
    expect(openClaims(claims).map((c) => c.id)).toEqual(['ISC-2', 'ISC-4', 'ISC-5']);
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
