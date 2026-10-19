// The reviewed mark's text (spec 031, T23): `reviewedMarkText` is the seam the plugin CLI writes `.gates/reviewed.json`
// through. Its bytes are the app's (write path 1): `JSON.stringify({gate, at, files}, null, 2)` and one newline, files
// in `REVIEWED_FILES` order, a missing file as null. Whatever it writes `readGateMark` reads back unchanged, without a
// diagnostic, and the mark reads fresh against the texts it was hashed from.
import { describe, expect, test } from 'bun:test';
import { REVIEWED_FILES, gateState, hashForGate, readGateMark, reviewedMarkText } from '../src/gates.ts';

const AT = '2026-03-04T08:00:00.000Z';
const SPEC = '---\nid: 001\nstage: review\n---\n# 001 — Digest\n\n## Claims\n\n- [ ] ISC-1: One digest a week.\n';
const PLAN = '# 001 — Plan\n\n## Approach\n\nOne pass.\n';

describe('reviewedMarkText (T23)', () => {
  test('writes the bytes of the app reviewed write: two-space JSON, files in order, null for a missing file, one newline', () => {
    const spec = hashForGate('spec.md', SPEC);
    const plan = hashForGate('plan.md', PLAN);
    const text = reviewedMarkText(AT, { 'tasks.md': null, 'plan.md': plan, 'spec.md': spec });
    expect(text).toBe(
      `{\n  "gate": "reviewed",\n  "at": "${AT}",\n  "files": {\n    "spec.md": "${spec}",\n    "plan.md": "${plan}",\n    "tasks.md": null\n  }\n}\n`,
    );
  });

  test('round-trips through readGateMark and reads fresh against the texts it hashed', () => {
    const files = { 'spec.md': hashForGate('spec.md', SPEC), 'plan.md': hashForGate('plan.md', PLAN), 'tasks.md': null };
    const reading = readGateMark('reviewed', reviewedMarkText(AT, files));
    expect(reading.diagnostics).toEqual([]);
    expect(reading.mark).toEqual({ gate: 'reviewed', at: AT, files });
    const check = gateState('reviewed', reading.mark, { texts: { 'spec.md': SPEC, 'plan.md': PLAN } });
    expect(check.state).toBe('fresh');
    const edited = gateState('reviewed', reading.mark, { texts: { 'spec.md': SPEC, 'plan.md': `${PLAN}A second pass.\n` } });
    expect(edited).toMatchObject({ state: 'stale', changed: ['plan.md'] });
  });

  test('refuses a hash that could never be read back as one', () => {
    const files = Object.fromEntries(REVIEWED_FILES.map((f) => [f, null])) as Record<(typeof REVIEWED_FILES)[number], string | null>;
    expect(() => reviewedMarkText(AT, { ...files, 'spec.md': 'not-a-hash' })).toThrow(RangeError);
    expect(() => reviewedMarkText('', files)).toThrow(RangeError);
  });
});
