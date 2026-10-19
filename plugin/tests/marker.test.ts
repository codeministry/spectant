// The marker line of a builder brief (spec 032, T2, ISC-33): the implement subcommand writes
// `spectant: spec=<NNN> task=<Tn> claim=<ISC-N>` as the first line of every builder's prompt, and the plugin's hook
// reads it back from the Agent tool's `prompt` to know which task and claim a subagent works on. One module writes and
// parses the line, so the two can never drift. A prompt without the line, or with a garbled one, is no task: the parser
// returns null and the hook writes nothing.
import { describe, expect, test } from 'bun:test';
import { MarkerError, markerLine, parseMarker } from '../src/marker.ts';

const MARKER = { spec: '032', task: 'T2', claim: 'ISC-33' };
const BRIEF = ['SPEC:      /repo/specs/032-plugin-activity-hooks/spec.md', 'CLAIM:     ISC-33 — …', ''].join('\n');

describe('markerLine', () => {
  test('writes the three keys in order', () => {
    expect(markerLine(MARKER)).toBe('spectant: spec=032 task=T2 claim=ISC-33');
  });

  test('writes a sub-claim id', () => {
    expect(markerLine({ spec: '041', task: 'T12', claim: 'ISC-33.1' })).toBe('spectant: spec=041 task=T12 claim=ISC-33.1');
  });

  test('refuses a field the parser would reject', () => {
    expect(() => markerLine({ ...MARKER, spec: '32' })).toThrow(MarkerError);
    expect(() => markerLine({ ...MARKER, task: '2' })).toThrow(MarkerError);
    expect(() => markerLine({ ...MARKER, claim: 'ISC33' })).toThrow(MarkerError);
    expect(() => markerLine({ ...MARKER, task: 'T2 claim=ISC-1' })).toThrow(MarkerError);
  });
});

describe('parseMarker', () => {
  test('reads a valid line from the first line of a brief', () => {
    expect(parseMarker(`${markerLine(MARKER)}\n${BRIEF}`)).toEqual(MARKER);
  });

  test('reads a prompt that is only the line', () => {
    expect(parseMarker('spectant: spec=041 task=T12 claim=ISC-33.1')).toEqual({ spec: '041', task: 'T12', claim: 'ISC-33.1' });
  });

  test('is lenient about surrounding whitespace and line endings', () => {
    expect(parseMarker(`\n  \t spectant:  spec=032\ttask=T2   claim=ISC-33  \r\n${BRIEF}`)).toEqual(MARKER);
  });

  test('a missing line is no task', () => {
    expect(parseMarker(BRIEF)).toBeNull();
    expect(parseMarker('')).toBeNull();
    expect(parseMarker('   \n\n')).toBeNull();
  });

  test('a line below the first is no task', () => {
    expect(parseMarker(`SPEC: x\n${markerLine(MARKER)}`)).toBeNull();
  });

  test('a garbled line is no task', () => {
    const garbled = [
      'spectant: spec=32 task=T2 claim=ISC-33',
      'spectant: spec=0320 task=T2 claim=ISC-33',
      'spectant: spec=032 task=2 claim=ISC-33',
      'spectant: spec=032 task=T claim=ISC-33',
      'spectant: spec=032 task=T2 claim=ISC33',
      'spectant: spec=032 task=T2 claim=ISC-33.',
      'spectant: spec=032 task=T2',
      'spectant: task=T2 spec=032 claim=ISC-33',
      'spectant: spec=032 task=T2 claim=ISC-33 extra=1',
      'spectant spec=032 task=T2 claim=ISC-33',
      'Spectant: spec=032 task=T2 claim=ISC-33',
      'spectant: spec = 032 task=T2 claim=ISC-33',
      'xspectant: spec=032 task=T2 claim=ISC-33',
    ];
    for (const line of garbled) expect(parseMarker(`${line}\n${BRIEF}`)).toBeNull();
  });

  test('round-trips what markerLine writes', () => {
    const marker = { spec: '007', task: 'T40', claim: 'ISC-213.2' };
    expect(parseMarker(markerLine(marker))).toEqual(marker);
  });
});
