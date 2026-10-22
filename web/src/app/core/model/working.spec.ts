import { describe, expect, it } from 'vitest';
import { holderOf, workingOf } from './working';

// Spec 064 (T1, ISC-466): the "In Arbeit" list derives from the lock holder, the same source as the spec table's agent.

const LOCK = { id: 'ISC-3', session: 'a:claude:sess-5', since: '2026-10-21T09:00:00Z', source: 'activity' };
const LATER = { id: 'ISC-4', session: 'a:claude:sess-6', since: '2026-10-21T10:00:00Z', source: 'activity' };

describe('holderOf (spec 064, T1, ISC-466)', () => {
  it('reads the first entry of `taken` with a session string, with its `since`', () => {
    expect(holderOf({ taken: [LOCK, LATER] })).toEqual({ session: 'a:claude:sess-5', since: '2026-10-21T09:00:00Z' });
    expect(holderOf({ taken: [null, { id: 'ISC-1' }, LATER] })).toEqual({ session: 'a:claude:sess-6', since: '2026-10-21T10:00:00Z' });
    expect(holderOf({ taken: [{ session: 'x', since: 7 }] })).toEqual({ session: 'x', since: null });
  });

  it('reads no holder without a lock, after a release (core drops the lock from `taken`) or from a malformed row', () => {
    expect(holderOf({ id: '006' })).toBeNull();
    expect(holderOf({ taken: [] })).toBeNull();
    expect(holderOf({ taken: 'no' })).toBeNull();
    expect(holderOf(null)).toBeNull();
    expect(holderOf('row')).toBeNull();
  });
});

describe('workingOf (spec 064, T1, ISC-466)', () => {
  it('lists the specs with a lock holder in served order, the title falling back to the id', () => {
    const body = {
      specs: [
        { id: '007', title: 'Seventh', taken: [LATER] },
        { id: '005', title: 'Fifth', taken: [] },
        { id: '006', taken: [LOCK] },
        { id: '008', title: 'Eighth' },
      ],
    };
    expect(workingOf(body)).toEqual([
      { id: '007', title: 'Seventh', session: 'a:claude:sess-6', since: '2026-10-21T10:00:00Z' },
      { id: '006', title: '006', session: 'a:claude:sess-5', since: '2026-10-21T09:00:00Z' },
    ]);
  });

  it('drops a spec once its lock is released, and lists none from a body that is not a dashboard', () => {
    const held = { specs: [{ id: '005', title: 'Fifth', taken: [LOCK] }] };
    const released = { specs: [{ id: '005', title: 'Fifth', taken: [] }] };
    expect(workingOf(held).map((entry) => entry.id)).toEqual(['005']);
    expect(workingOf(released)).toEqual([]);
    expect(workingOf(undefined)).toEqual([]);
    expect(workingOf({ specs: 'no' })).toEqual([]);
    expect(workingOf({ specs: [{ title: 'no id', taken: [LOCK] }, 3] })).toEqual([]);
  });
});
