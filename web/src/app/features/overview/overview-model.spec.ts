import emptyMaster from '../../../../../core/fixtures/empty-master.golden.json';
import harbor from '../../../../../core/fixtures/harbor.golden.json';
import lantern from '../../../../../core/fixtures/lantern.golden.json';
import { monogram, NEXT_UP_LIMIT, readColumn } from './overview-model';

const entry = (slug: string) => ({ slug, name: slug, pathTail: `code/${slug}` });

describe('readColumn (T65)', () => {
  it('reads the four strip figures from the model KPIs as they are', () => {
    const column = readColumn(entry('harbor'), harbor, 1000);
    expect(column.kpis).toEqual({
      master: { closed: 101, total: 124 },
      claims: { closed: 55, total: 78 },
      specs: 5,
      building: 2,
      scoping: 3,
      warnings: 7,
      fog: 4,
    });
    expect(column.loadedAt).toBe(1000);
    expect(column.pathTail).toBe('code/harbor');
  });

  it('takes Next up in the model order, at most three, each with its command', () => {
    const column = readColumn(entry('harbor'), harbor, 0);
    expect(NEXT_UP_LIMIT).toBe(3);
    expect(column.next.map((row) => [row.id, row.nextCommand])).toEqual([
      ['004', '/spec-code-review 004'],
      ['005', '/spec-review 005'],
      ['006', '/spec-review 006'],
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
  });
});

describe('monogram', () => {
  it('takes the first letters of two words, else the first two letters, upper-cased', () => {
    expect(monogram('empty-master')).toBe('EM');
    expect(monogram('harbor')).toBe('HA');
    expect(monogram('')).toBe('?');
  });
});
