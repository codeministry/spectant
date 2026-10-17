// The feature backlog (spec 036): `specs/backlog.md` read into a rank and a priority per feature block. Probes by
// name, as spec 036's Test Strategy calls them: "backlog" (ISC-190), "backlog diagnostics" (ISC-190.1).
import { describe, expect, test } from 'bun:test';

import { parseBacklog } from '../src/backlog.ts';

const FEATURES = ['F0', 'F1', 'F2', 'F3', 'F4'];

/** `[feature, rank, priority]` per entry, the shape most cases compare. */
const ranks = (text: string | null, features: readonly string[] = FEATURES): Array<[string, number, string]> =>
  parseBacklog(text, features).entries.map((e) => [e.feature, e.rank, e.priority]);

describe('backlog', () => {
  test('backlog: the position of a `- F<n> · P<1-4>` line is the 1-based global rank', () => {
    const text = ['- F3 · P1', '- F1 · P2', '- F0 · P4', '- F2 · P3', '- F4 · P1', ''].join('\n');
    expect(ranks(text)).toEqual([
      ['F3', 1, 'P1'],
      ['F1', 2, 'P2'],
      ['F0', 3, 'P4'],
      ['F2', 4, 'P3'],
      ['F4', 5, 'P1'],
    ]);
    expect(parseBacklog(text, FEATURES).diagnostics).toEqual([]);
  });

  test('backlog: a heading, blank lines and a comment are skipped; each entry keeps its 1-based line', () => {
    const text = ['# Backlog', '', '<!-- One line per feature.', '- F0 · P1 is not a line inside a comment -->', '', '- F2 · P2', '', '- F0 · P1', ''].join('\n');
    const { entries, diagnostics } = parseBacklog(text, FEATURES);
    expect(entries.slice(0, 2).map((e) => [e.feature, e.rank, e.line])).toEqual([
      ['F2', 1, 6],
      ['F0', 2, 8],
    ]);
    expect(diagnostics).toEqual([]);
  });

  test('backlog: a line without a priority reads as P3', () => {
    expect(ranks('- F1\n- F0 · P2\n', ['F0', 'F1'])).toEqual([
      ['F1', 1, 'P3'],
      ['F0', 2, 'P2'],
    ]);
  });

  test('backlog: a feature the file does not list stands behind every listed one, in master order, with P3', () => {
    const { entries } = parseBacklog('- F3 · P1\n- F1 · P2\n', FEATURES);
    expect(entries.map((e) => [e.feature, e.rank, e.priority, e.line])).toEqual([
      ['F3', 1, 'P1', 1],
      ['F1', 2, 'P2', 2],
      ['F0', 3, 'P3', null],
      ['F2', 4, 'P3', null],
      ['F4', 5, 'P3', null],
    ]);
  });

  test('backlog: without the file every feature stands in master order with P3', () => {
    expect(ranks(null)).toEqual(FEATURES.map((f, i): [string, number, string] => [f, i + 1, 'P3']));
    expect(parseBacklog(null, FEATURES).diagnostics).toEqual([]);
    expect(ranks('')).toEqual(ranks(null));
  });

  test('backlog: CRLF line endings and a dotted feature id read like any other line', () => {
    expect(ranks('- F1.1 · P2\r\n- F1 · P1\r\n', ['F1', 'F1.1'])).toEqual([
      ['F1.1', 1, 'P2'],
      ['F1', 2, 'P1'],
    ]);
  });
});

describe('backlog diagnostics', () => {
  const codes = (text: string): Array<[string, number | undefined, string | undefined]> =>
    parseBacklog(text, FEATURES).diagnostics.map((d) => [d.code, d.line, d.subject]);

  test('backlog diagnostics: an unknown id, a second line of one id and an invalid priority warn once each, and parsing goes on', () => {
    const text = ['# Backlog', '', '- F2 · P1', '- F9 · P1', '- F1', '- F2 · P4', '- F4 · high', '- F3 · P2', ''].join('\n');
    const { entries, diagnostics } = parseBacklog(text, FEATURES);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(codes(text)).toEqual([
      ['backlog-unknown-feature', 4, 'F9'],
      ['backlog-duplicate', 6, 'F2'],
      ['backlog-priority', 7, 'high'],
    ]);
    // The first line of F2 wins (P1, rank 1); F4's invalid priority reads as P3; F3 after the findings is still read.
    expect(entries.map((e) => [e.feature, e.rank, e.priority])).toEqual([
      ['F2', 1, 'P1'],
      ['F1', 2, 'P3'],
      ['F4', 3, 'P3'],
      ['F3', 4, 'P2'],
      ['F0', 5, 'P3'],
    ]);
  });

  test('backlog diagnostics: each finding is one warning, however often its kind occurs', () => {
    expect(codes('- F7\n- F8 · P1\n- F1 · P0\n- F1 · P2\n- F1\n').map(([code, line]) => `${code}@${String(line)}`)).toEqual([
      'backlog-unknown-feature@1',
      'backlog-unknown-feature@2',
      'backlog-priority@3',
      'backlog-duplicate@4',
      'backlog-duplicate@5',
    ]);
  });

  test('backlog diagnostics: a duplicate line with an invalid priority is one duplicate warning, not two', () => {
    expect(codes('- F1 · P2\n- F1 · urgent\n')).toEqual([['backlog-duplicate', 2, 'F1']]);
  });
});
