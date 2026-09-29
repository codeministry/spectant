import type { Note } from '../../../../../../server/src/notes.contract';
import {
  anchorFromValue,
  anchorLabel,
  anchorValue,
  excerpt,
  filterNotes,
  isSavable,
  nextSaveState,
  rowTime,
  saveLabel,
  type SaveState,
} from './notes-model';

const note = (id: string, anchor: Note['anchor'], title = '', body = 'body'): Note => ({
  id,
  pinned: false,
  workspace: 'harbor',
  anchor,
  title,
  body,
  created: '2026-03-06T09:00:00.000Z',
  updated: '2026-03-06T09:00:00.000Z',
});

describe('notes model: filterNotes', () => {
  const notes = [
    note('a', { kind: 'spec', spec: '002' }, 'Rollout'),
    note('b', { kind: 'claim', spec: '002', id: 'ISC-51' }, '', 'probe the **empty** state'),
    note('c', { kind: 'task', spec: '003', id: 'T4' }),
    note('d', null, 'Loose'),
  ];

  it('narrows to the spec, the unanchored or the whole workspace, in the given order', () => {
    expect(filterNotes(notes, 'spec', '002', '').map((n) => n.id)).toEqual(['a', 'b']);
    expect(filterNotes(notes, 'unanchored', '002', '').map((n) => n.id)).toEqual(['d']);
    expect(filterNotes(notes, 'workspace', '002', '').map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('searches title and body, case-insensitive, trimmed', () => {
    expect(filterNotes(notes, 'workspace', '002', '  EMPTY ').map((n) => n.id)).toEqual(['b']);
    expect(filterNotes(notes, 'spec', '002', 'loose')).toEqual([]);
  });
});

describe('notes model: the anchor label and select value', () => {
  it('labels the spec by its number, a claim or task of this spec by its id, of another spec with that spec', () => {
    expect(anchorLabel(null, '002')).toBeNull();
    expect(anchorLabel({ kind: 'spec', spec: '002' }, '002')).toEqual({ kind: 'spec', text: '002' });
    expect(anchorLabel({ kind: 'claim', spec: '002', id: 'ISC-51' }, '002')).toEqual({ kind: 'claim', text: 'ISC-51' });
    expect(anchorLabel({ kind: 'task', spec: '003', id: 'T4' }, '002')).toEqual({ kind: 'task', text: '003 · T4' });
  });

  it('round-trips every anchor through its select value and refuses anything else', () => {
    const anchors = [null, { kind: 'spec', spec: '002' }, { kind: 'claim', spec: '002', id: 'ISC-94.1' }, { kind: 'task', spec: '002', id: 'T1' }] as const;
    for (const anchor of anchors) expect(anchorFromValue(anchorValue(anchor))).toEqual(anchor);
    expect(anchorValue({ kind: 'claim', spec: '002', id: 'ISC-51' })).toBe('claim:002:ISC-51');
    for (const bad of ['', 'spec', 'spec:002:x', 'claim:002', 'note:002:x']) expect(anchorFromValue(bad), bad).toBeNull();
  });
});

describe('notes model: excerpt and savable', () => {
  it('takes the first line with text, without heading, quote or list markers', () => {
    expect(excerpt('\n\n# Rollout order\n\nShip it')).toBe('Rollout order');
    expect(excerpt('- item one\n- two')).toBe('item one');
    expect(excerpt('> quoted')).toBe('quoted');
    expect(excerpt('   ')).toBe('');
  });

  it('a blank body is not savable', () => {
    expect(isSavable({ anchor: null, title: 'x', body: '  \n' })).toBe(false);
    expect(isSavable({ anchor: null, title: '', body: 'x' })).toBe(true);
  });
});

describe('notes model: the autosave state', () => {
  const at = '2026-03-08T15:01:00.000Z';

  it('edit → pending → saving → saved at the answer time', () => {
    let state: SaveState = { kind: 'idle' };
    state = nextSaveState(state, { type: 'edit' });
    expect(state).toEqual({ kind: 'pending' });
    state = nextSaveState(state, { type: 'start' });
    expect(state).toEqual({ kind: 'saving' });
    expect(nextSaveState(state, { type: 'saved', at })).toEqual({ kind: 'saved', at });
  });

  it('an edit during the write keeps pending when the write lands; a failure says so', () => {
    const during = nextSaveState(nextSaveState({ kind: 'saving' }, { type: 'edit' }), { type: 'saved', at });
    expect(during).toEqual({ kind: 'pending' });
    expect(nextSaveState({ kind: 'saving' }, { type: 'fail' })).toEqual({ kind: 'failed' });
  });

  it('labels each state with its notes.save key; saved carries the formatted time', () => {
    const time = (iso: string): string => iso.slice(11, 16);
    expect(saveLabel({ kind: 'idle' }, time)).toBeNull();
    expect(saveLabel({ kind: 'pending' }, time)).toEqual({ key: 'notes.save.pending', params: {} });
    expect(saveLabel({ kind: 'saving' }, time)).toEqual({ key: 'notes.save.saving', params: {} });
    expect(saveLabel({ kind: 'failed' }, time)).toEqual({ key: 'notes.save.failed', params: {} });
    expect(saveLabel({ kind: 'saved', at }, time)).toEqual({ key: 'notes.save.saved', params: { time: '15:01' } });
  });

  it('a row shows the clock time today and the date otherwise', () => {
    const now = new Date('2026-03-08T16:00:00');
    expect(rowTime(new Date('2026-03-08T12:04:00').toISOString(), now, 'en-GB')).toBe('12:04');
    expect(rowTime(new Date('2026-03-06T12:04:00').toISOString(), now, 'en-GB')).toBe('6 Mar');
    expect(rowTime(new Date('2025-03-06T12:04:00').toISOString(), now, 'en-GB')).toBe('6 Mar 2025');
  });
});
