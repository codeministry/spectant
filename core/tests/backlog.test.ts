// The feature backlog (spec 036): `specs/backlog.md` read into a rank and a priority per feature block. Probes by
// name, as spec 036's Test Strategy calls them: "backlog" (ISC-190), "backlog diagnostics" (ISC-190.1), "backlog write"
// (ISC-191) and "backlog refuse" (ISC-191.1).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { backlogFeatures, parseBacklog, planBacklogMove, planBacklogPriority, renderBacklog, type BacklogPlan } from '../src/backlog.ts';

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

// ISC-191 and ISC-191.1: the two writes planned in memory, over the backlog-ranks fixture. Probe names "backlog write"
// and "backlog refuse".
describe('backlog write', () => {
  const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'backlog-ranks');
  const MASTER = readFileSync(join(FIXTURE, 'ISA.md'), 'utf8');
  const TEXT = readFileSync(join(FIXTURE, 'specs', 'backlog.md'), 'utf8');
  const FEATURES_OF = backlogFeatures(MASTER);
  const NOW = new Date('2026-03-10T08:00:00Z');
  const ACTOR = 'u:3f9c0a7d';
  const base = { text: TEXT, features: FEATURES_OF, actor: ACTOR, now: NOW };
  const PREAMBLE = ['# Backlog', '', '<!-- One line per feature, `- F<n> · P<1-4>`; the line\'s position is the feature\'s rank. -->', ''];

  test('backlog write: the features of the master carry the milestone group they move within', () => {
    expect(FEATURES_OF).toEqual([
      { id: 'F0', milestone: null },
      { id: 'F1', milestone: 'Ferry 1.0' },
      { id: 'F2', milestone: 'Ferry 1.0' },
      { id: 'F3', milestone: 'Ferry 2.0' },
      { id: 'F4', milestone: 'Ferry 2.0' },
    ]);
  });

  test('backlog write: moving F1 before F2 swaps the two within the ranks Ferry 1.0 holds and writes one move event', () => {
    const plan = planBacklogMove({ ...base, feature: 'F1', before: 'F2' });
    if (!plan.ok) throw new Error(plan.reason);
    // The preamble stays; the unknown F9, the second F3 line and F4's invalid priority are gone; F0 is materialized.
    // Ferry 1.0 holds ranks 1 and 3: F1 takes 1, F2 moves to 3, and F3 of Ferry 2.0 keeps rank 2.
    expect(plan.text).toBe([...PREAMBLE, '- F1 · P3', '- F3 · P2', '- F2 · P1', '- F4 · P3', '- F0 · P3', ''].join('\n'));
    expect(plan.event).toEqual({ ts: '2026-03-10T08:00:00.000Z', actor: ACTOR, kind: 'move', feature: 'F1', from: 3, to: 1 });
    expect(plan.line).toBe(`${JSON.stringify(plan.event)}\n`);
    expect(parseBacklog(plan.text, FEATURES_OF.map((f) => f.id)).diagnostics).toEqual([]);
  });

  test('backlog write: before null moves a feature behind the last feature of its own milestone', () => {
    const plan = planBacklogMove({ ...base, feature: 'F3', before: null });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.text).toBe([...PREAMBLE, '- F2 · P1', '- F4 · P3', '- F1 · P3', '- F3 · P2', '- F0 · P3', ''].join('\n'));
    expect(plan.event).toMatchObject({ kind: 'move', feature: 'F3', from: 2, to: 4 });
  });

  test('backlog write: setting a priority keeps the order and writes one priority event', () => {
    const plan = planBacklogPriority({ ...base, feature: 'F0', priority: 'P1' });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.text).toBe([...PREAMBLE, '- F2 · P1', '- F3 · P2', '- F1 · P3', '- F4 · P3', '- F0 · P1', ''].join('\n'));
    expect(plan.event).toEqual({ ts: '2026-03-10T08:00:00.000Z', actor: ACTOR, kind: 'priority', feature: 'F0', from: 'P3', to: 'P1' });
  });

  test('backlog write: without the file the first write materializes every feature under a heading', () => {
    const plan = planBacklogPriority({ ...base, text: null, feature: 'F2', priority: 'P2' });
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.text).toBe(['# Backlog', '', '- F0 · P3', '- F1 · P3', '- F2 · P2', '- F3 · P3', '- F4 · P3', ''].join('\n'));
  });

  test('backlog write: renderBacklog writes one line per entry after the preamble', () => {
    const { entries } = parseBacklog('- F1 · P2\n', ['F0', 'F1']);
    expect(renderBacklog(entries, '# Mine\n')).toBe('# Mine\n\n- F1 · P2\n- F0 · P3\n');
  });
});

describe('backlog refuse', () => {
  const FIXTURE = join(import.meta.dir, '..', 'fixtures', 'backlog-ranks');
  const MASTER = readFileSync(join(FIXTURE, 'ISA.md'), 'utf8');
  const TEXT = readFileSync(join(FIXTURE, 'specs', 'backlog.md'), 'utf8');
  const base = { text: TEXT, features: backlogFeatures(MASTER), actor: 'u:3f9c0a7d', now: new Date('2026-03-10T08:00:00Z') };
  const reasonOf = (plan: BacklogPlan): string => {
    expect(plan.ok).toBe(false);
    expect('text' in plan || 'event' in plan).toBe(false);
    return plan.ok ? '' : plan.reason;
  };

  test('backlog refuse: a move before a feature of another milestone is refused with the reason', () => {
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F1', before: 'F3' }))).toBe('F1 belongs to Ferry 1.0 and F3 to Ferry 2.0: a feature moves only within its milestone');
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F0', before: 'F1' }))).toBe('F0 belongs to no milestone and F1 to Ferry 1.0: a feature moves only within its milestone');
  });

  test('backlog refuse: an unknown feature, on either side of a move or for a priority, is refused', () => {
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F9', before: 'F1' }))).toBe('F9 is not a feature block of the master');
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F1', before: 'F9' }))).toBe('F9 is not a feature block of the master');
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F9', priority: 'P1' }))).toBe('F9 is not a feature block of the master');
  });

  test('backlog refuse: a priority other than P1 to P4 is refused', () => {
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F1', priority: 'P5' }))).toBe('priority "P5" is none of P1 to P4');
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F1', priority: 'high' }))).toBe('priority "high" is none of P1 to P4');
  });

  test('backlog refuse: a write that changes nothing, a legacy actor and an invalid time are refused', () => {
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F2', before: 'F1' }))).toBe('F2 already stands there: nothing to move');
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F4', before: null }))).toBe('F4 already stands there: nothing to move');
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F0', before: null }))).toBe('F0 already stands there: nothing to move');
    expect(reasonOf(planBacklogMove({ ...base, feature: 'F2', before: 'F2' }))).toBe('F2 cannot move before itself');
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F2', priority: 'P1' }))).toBe('F2 already has P1');
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F2', priority: 'P2', actor: 'principal' }))).toBe('the actor "principal" is outside the actor grammar');
    expect(reasonOf(planBacklogPriority({ ...base, feature: 'F2', priority: 'P2', now: new Date('nope') }))).toBe('the event time is not a valid date');
  });
});
