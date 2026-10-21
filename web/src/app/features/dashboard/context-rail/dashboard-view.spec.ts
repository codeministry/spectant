import { describe, expect, it } from 'vitest';
import { workingOf } from '../../../core/model/working';
import { dashboardViewOf } from './dashboard-view';

// Spec 064 (T16, ISC-460): the dashboard view carries the "In progress" entries, read by `workingOf` off the same body.

const LOCK = { id: 'ISC-74', session: 'a:claude:sess-2', since: '2026-10-21T09:00:00Z', source: 'activity' };
const BODY = {
  kpis: { warnings: 0, fog: 0 },
  specs: [
    { id: '002', title: 'Gate reviewed mark', taken: [LOCK] },
    { id: '005', title: 'Board stage moves', taken: [] },
  ],
  nextUp: [],
};

describe('dashboardViewOf (spec 064, T16, ISC-460)', () => {
  it('carries `working` from workingOf(body) beside the body fields', () => {
    const view = dashboardViewOf(BODY);
    expect(view?.working).toEqual(workingOf(BODY));
    expect(view?.working).toEqual([{ id: '002', title: 'Gate reviewed mark', session: 'a:claude:sess-2', since: '2026-10-21T09:00:00Z' }]);
    expect(view?.specs).toBe(BODY.specs);
    expect(view?.kpis).toBe(BODY.kpis);
  });

  it('carries an empty `working` without a held claim', () => {
    expect(dashboardViewOf({ ...BODY, specs: [{ id: '005', title: 'Board stage moves', taken: [] }] })?.working).toEqual([]);
  });

  it('reads no view from a body without the KPI block or the spec rows', () => {
    expect(dashboardViewOf(null)).toBeNull();
    expect(dashboardViewOf({ specs: [] })).toBeNull();
    expect(dashboardViewOf({ kpis: {}, specs: 'no' })).toBeNull();
  });
});
