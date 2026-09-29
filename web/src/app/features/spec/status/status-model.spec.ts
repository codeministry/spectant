import type { ClaimView } from '../../../../../../core/src/files';
import { openClaims } from './status-model';

const claim = (id: string, state: ClaimView['state']): ClaimView =>
  ({ id, state, text: id, feature: null, kind: 'normal', edges: [], blockedBy: [], probe: null, verification: null, lock: null, dropped: null, noteCount: 0, line: 1 }) satisfies ClaimView;

describe('openClaims', () => {
  it('drops closed and dropped claims and keeps the order', () => {
    const claims = [claim('ISC-1', 'closed'), claim('ISC-2', 'takeable'), claim('ISC-3', 'dropped'), claim('ISC-4', 'blocked'), claim('ISC-5', 'open')];
    expect(openClaims(claims).map((c) => c.id)).toEqual(['ISC-2', 'ISC-4', 'ISC-5']);
  });
});
