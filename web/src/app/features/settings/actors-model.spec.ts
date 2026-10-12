import planning from '../../../../../core/fixtures/harbor.planning.golden.json';
import { actorRows, mappingsOf, parseIdentities, personIdsIn } from './actors-model';

describe('actors-model', () => {
  it('collects every person id a payload names, assignees and lock holders alike, never an agent or a legacy value', () => {
    const payload = {
      specs: [{ assignee: { raw: 'u:0a1b2c3d', kind: 'person', id: 'u:0a1b2c3d', legacy: false } }],
      locks: [{ session: 'u:ffff0000' }, { session: 'a:claude:sess-1' }, { session: 'someone' }],
      text: 'u:0a1b2c3d is not a whole value here',
    };
    expect([...personIdsIn(payload)].sort()).toEqual(['u:0a1b2c3d', 'u:ffff0000']);
  });

  it('finds the harbor planning golden assignee', () => {
    expect([...personIdsIn(planning)]).toEqual(['u:3f9c0a7d']);
  });

  it('lists the union of stored and seen ids by id, a seen id without a mapping blank', () => {
    const rows = actorRows([{ id: 'u:bbbbbbbb', displayName: 'Bo Example', gitIdentities: ['bo@example.test'] }], ['u:aaaaaaaa', 'u:bbbbbbbb']);
    expect(rows).toEqual([
      { id: 'u:aaaaaaaa', displayName: '', gitIdentities: '', stored: false },
      { id: 'u:bbbbbbbb', displayName: 'Bo Example', gitIdentities: 'bo@example.test', stored: true },
    ]);
  });

  it('splits git identities on commas, trimmed, empty and repeated entries dropped', () => {
    expect(parseIdentities(' a@example.test, ,b@example.test,a@example.test ')).toEqual(['a@example.test', 'b@example.test']);
    expect(parseIdentities('')).toEqual([]);
  });

  it('sends only rows with a person id and a name: an invalid id or a blank name never leaves', () => {
    const list = mappingsOf([
      { id: 'u:aaaaaaaa', displayName: ' Ada Example ', gitIdentities: 'ada@example.test' },
      { id: 'u:bbbbbbbb', displayName: '   ', gitIdentities: 'x@example.test' },
      { id: 'a:claude:sess-1', displayName: 'Agent', gitIdentities: '' },
      { id: 'u:XYZ', displayName: 'Bad', gitIdentities: '' },
    ]);
    expect(list).toEqual([{ id: 'u:aaaaaaaa', displayName: 'Ada Example', gitIdentities: ['ada@example.test'] }]);
  });
});
