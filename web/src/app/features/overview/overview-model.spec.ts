import emptyMaster from '../../../../../core/fixtures/empty-master.golden.json';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../core/fixtures/lantern.golden.json';
import type { GuidanceEntry } from '../../../../../core/src/files';
import type { WorkingEntry } from '../../core/model/working';
import { monogram, NEXT_UP_LIMIT, readColumn, TILE_ROW_LIMIT, tileOf } from './overview-model';

const entry = (slug: string) => ({ slug, name: slug, pathTail: `code/${slug}` });

describe('readColumn (T65)', () => {
  it('reads the four strip figures from the model KPIs as they are', () => {
    const column = readColumn(entry('harbor'), harbor, 1000);
    const { master, claims, specs, building, scoping, warnings, fog } = harbor.kpis;
    expect(column.kpis).toEqual({ master, claims, specs, building, scoping, warnings, fog });
    expect(column.loadedAt).toBe(1000);
    expect(column.pathTail).toBe('code/harbor');
  });

  it('takes Next up in the model order, at most three, each with its command', () => {
    const column = readColumn(entry('harbor'), harbor, 0);
    expect(NEXT_UP_LIMIT).toBe(3);
    expect(column.next.map((row) => [row.id, row.nextCommand])).toEqual([
      ['004', '/spec review 004 code'],
      ['005', '/spec review 005'],
      ['006', '/spec review 006'],
    ]);
  });

  it('lists every active spec in model order with its phase', () => {
    const column = readColumn(entry('lantern'), lantern, 0);
    expect(column.list.map((row) => [row.id, row.phase])).toEqual([
      ['001', 'building'],
      ['002', 'scoping'],
    ]);
  });

  it('keeps a master-less workspace at null and an empty list empty', () => {
    const column = readColumn(entry('empty-master'), emptyMaster, 0);
    expect(column.kpis.master).toEqual(emptyMaster.kpis.master);
    expect(column.list.length).toBe(emptyMaster.specs.length);
  });

  it('reads a body without kpis or specs as zeros, never throwing', () => {
    const column = readColumn(entry('odd'), { nonsense: true }, 0);
    expect(column.kpis).toEqual({ master: null, claims: { closed: 0, total: 0 }, specs: 0, building: 0, scoping: 0, warnings: 0, fog: 0 });
    expect(column.next).toEqual([]);
    expect(column.list).toEqual([]);
    expect(column.waits).toEqual([]);
  });

  it('passes guidance.waits through in core order, the same entries the model serves (spec 020 T16)', () => {
    expect(readColumn(entry('harbor'), harbor, 0).waits).toEqual(harbor.guidance.waits);
    expect(readColumn(entry('lantern'), lantern, 0).waits).toEqual([]);
  });

  it('reads the specs a session holds a claim of through workingOf (spec 064 T18)', () => {
    const body = {
      specs: [
        { id: '064', title: 'Flat tiles', taken: [{ claim: 'ISC-461', session: 'a:claude:x', since: '2026-10-20T08:00:00Z' }] },
        { id: '065', title: 'Idle' },
      ],
    };
    expect(readColumn(entry('held'), body, 0).working).toEqual([
      { id: '064', title: 'Flat tiles', session: 'a:claude:x', since: '2026-10-20T08:00:00Z' },
    ]);
    expect(readColumn(entry('odd'), { nonsense: true }, 0).working).toEqual([]);
    expect(readColumn(entry('free'), { specs: [{ id: '065', title: 'Idle' }] }, 0).working).toEqual([]);
  });
});

describe('tileOf (spec 066 T4, ISC-518)', () => {
  const work = (n: number): WorkingEntry => ({
    id: String(100 + n),
    title: `Work ${n}`,
    session: `a:claude:s-${n}`,
    since: '2026-10-20T08:00:00Z',
  });
  const wait = (n: number, item: GuidanceEntry['item'] = 'spec'): GuidanceEntry => ({
    spec: String(200 + n),
    item,
    ref: item === 'spec' ? null : `ISC-${n}`,
    title: item === 'spec' ? `Spec title ${n}` : `Claim text ${n}`,
    command: `/spec review ${200 + n}`,
    priority: 'P2',
    since: '2026-10-01T08:00:00Z',
    reason: { key: 'review' },
  } as unknown as GuidanceEntry);
  const many = <T>(count: number, make: (n: number) => T): T[] => Array.from({ length: count }, (_, i) => make(i + 1));

  it('has room for exactly three rows', () => {
    expect(TILE_ROW_LIMIT).toBe(3);
  });

  it('with no entry: no rows, both counters at 0, n = 0, no more link', () => {
    expect(tileOf([], [], {})).toEqual({ rows: [], workingCount: 0, waitsCount: 0, total: 0, more: false });
  });

  it('with one waiting entry: one waiting row titled by its spec title, not the claim text', () => {
    const tile = tileOf([], [wait(1, 'claim')], { '201': 'Resolved spec title' });
    expect(tile.rows).toEqual([
      {
        kind: 'waiting',
        id: '201',
        item: 'claim',
        ref: 'ISC-1',
        title: 'Resolved spec title',
        command: '/spec review 201',
        since: '2026-10-01T08:00:00Z',
      },
    ]);
    expect([tile.workingCount, tile.waitsCount, tile.total, tile.more]).toEqual([0, 1, 1, false]);
  });

  it('falls back to a spec entry of the same spec, then to the entry title, for a waiting row title', () => {
    const claim = { ...wait(1, 'claim') };
    const spec = { ...wait(1), item: 'spec', ref: null, title: 'Listed spec title' } as GuidanceEntry;
    expect(tileOf([], [claim, spec], {}).rows.map((row) => row.title)).toEqual(['Listed spec title', 'Listed spec title']);
    expect(tileOf([], [wait(2, 'claim')], {}).rows.map((row) => row.title)).toEqual(['Claim text 2']);
  });

  it('with three entries: in progress before waiting, all three shown, no more link', () => {
    const tile = tileOf([work(1), work(2)], [wait(1)], {});
    expect(tile.rows.map((row) => [row.kind, row.id])).toEqual([
      ['working', '101'],
      ['working', '102'],
      ['waiting', '201'],
    ]);
    expect(tile.rows[0]).toEqual({ kind: 'working', id: '101', title: 'Work 1', session: 'a:claude:s-1', since: '2026-10-20T08:00:00Z' });
    expect([tile.workingCount, tile.waitsCount, tile.total, tile.more]).toEqual([2, 1, 3, false]);
  });

  it('with sixteen entries: three rows, in progress first, counters per list, n = in progress + waiting, more link', () => {
    const tile = tileOf([work(1)], many(15, (n) => wait(n)), {});
    expect(tile.rows.map((row) => [row.kind, row.id])).toEqual([
      ['working', '101'],
      ['waiting', '201'],
      ['waiting', '202'],
    ]);
    expect([tile.workingCount, tile.waitsCount, tile.total, tile.more]).toEqual([1, 15, 16, true]);
    const busy = tileOf(many(4, work), many(12, (n) => wait(n)), {});
    expect(busy.rows.map((row) => row.kind)).toEqual(['working', 'working', 'working']);
    expect([busy.workingCount, busy.waitsCount, busy.total, busy.more]).toEqual([4, 12, 16, true]);
  });

  it('readColumn carries the tile of its own working and waits, titled from its rows', () => {
    const column = readColumn(entry('harbor'), harbor, 0);
    const titles = Object.fromEntries(column.list.map((row) => [row.id, row.title]));
    expect(column.tile).toEqual(tileOf(column.working, column.waits, titles));
    expect(column.tile.waitsCount).toBe(harbor.guidance.waits.length);
    expect(column.tile.rows.length).toBe(Math.min(TILE_ROW_LIMIT, harbor.guidance.waits.length));
    expect(readColumn(entry('odd'), { nonsense: true }, 0).tile).toEqual({ rows: [], workingCount: 0, waitsCount: 0, total: 0, more: false });
  });
});

describe('monogram', () => {
  it('takes the first letters of two words, else the first two letters, upper-cased', () => {
    expect(monogram('empty-master')).toBe('EM');
    expect(monogram('harbor')).toBe('HA');
    expect(monogram('')).toBe('?');
  });
});
