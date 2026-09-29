import type { Frame, FrameCard } from '../../../../../../core/src/files';
import { absentNote, recutCounts, recutMarkers } from './recut';

const frame = (index: number, extra: Partial<Frame> = {}): Frame => ({
  index,
  kind: index % 2 === 0 ? 'dispatch' : 'result',
  round: Math.floor(index / 2) + 1,
  ts: '2026-03-01T10:00:00Z',
  label: index % 2 === 0 ? `R${String(Math.floor(index / 2) + 1)} dispatch` : `R${String(Math.floor(index / 2) + 1)}`,
  worst: 'waiting',
  cards: [],
  progress: { claims: { closed: 0, total: 1 }, tasks: { landed: 0, total: 0 } },
  closedClaims: [],
  ...extra,
});

const recut = { struck: ['T33'], added: ['T34'], changed: ['T27', 'T28', 'T29', 'T30', 'T31', 'T32'] };
const frames = [frame(0), frame(1), frame(2), frame(3), frame(4, { recut }), frame(5)];

describe('recutCounts', () => {
  it('counts struck, changed and added ids', () => {
    expect(recutCounts(recut)).toEqual({ struck: 1, changed: 6, added: 1 });
  });
});

describe('recutMarkers', () => {
  it('puts one labelled marker before the frame that carries the re-cut', () => {
    expect(recutMarkers(frames, 're-cut')).toEqual([{ before: 4, label: 're-cut' }]);
  });

  it('names the frame and the counts in the marker title', () => {
    const markers = recutMarkers(frames, 're-cut', (c) => `before ${c.frame}: ${String(c.struck)}/${String(c.changed)}/${String(c.added)}`);
    expect(markers).toEqual([{ before: 4, label: 're-cut', title: 'before R3 dispatch: 1/6/1' }]);
  });

  it('gives no marker for frames without a re-cut', () => {
    expect(recutMarkers(frames.slice(0, 4), 're-cut')).toEqual([]);
  });
});

describe('absentNote', () => {
  const card = (state: FrameCard['state'], note?: string): Pick<FrameCard, 'state' | 'note'> => ({ state, ...(note === undefined ? {} : { note }) });

  it("is an absent card's strike note", () => {
    expect(absentNote(card('absent', 'struck 2026-03-08: folded into T29'))).toBe('struck 2026-03-08: folded into T29');
  });

  it('is empty for an absent card without a note and null for any other card', () => {
    expect(absentNote(card('absent'))).toBe('');
    expect(absentNote(card('waiting', 'a hold note'))).toBeNull();
  });
});
