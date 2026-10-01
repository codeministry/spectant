import { describe, expect, it } from 'vitest';
import { CLAMP_ELLIPSIS, fitWords } from './clamp';

// A stand-in for layout: a candidate fits when it has at most `max` characters.
const byLength =
  (max: number) =>
  (candidate: string): boolean =>
    candidate.length <= max;

describe('fitWords (ISC-111)', () => {
  it('keeps a text that fits as it is', () => {
    expect(fitWords('Install spectant with one line', byLength(40))).toEqual({ shown: 'Install spectant with one line', cut: false });
  });

  it('cuts at the last whole word that fits, never inside a word', () => {
    const { shown, cut } = fitWords('Install spectant with one line and see two workspaces', byLength(24));
    expect(cut).toBe(true);
    expect(shown).toBe(`Install spectant with${CLAMP_ELLIPSIS}`);
    expect(shown.length).toBeLessThanOrEqual(24);
  });

  it('drops punctuation left dangling before the ellipsis', () => {
    expect(fitWords('Plan, build, verify and close the spec', byLength(12)).shown).toBe(`Plan, build${CLAMP_ELLIPSIS}`);
  });

  it('shows one word even when that word alone overflows', () => {
    expect(fitWords('Supercalifragilistic word', byLength(5)).shown).toBe(`Supercalifragilistic${CLAMP_ELLIPSIS}`);
  });
});
