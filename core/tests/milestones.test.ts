// Milestones parser (spec 003 T3): the master's `## Milestones` section, one bullet per milestone.
import { describe, expect, test } from 'bun:test';

import { milestoneSlug, parseMilestones } from '../src/milestones.ts';

const MASTER = [
  '# Master',
  '',
  '## Milestones',
  '',
  '- Harbor 0.9 · 2026-11-01 · First public release',
  '- Lantern · 2027-02-15',
  '',
  '## Decisions',
  '',
  '- Not a milestone · 2030-01-01',
].join('\n');

describe('parseMilestones', () => {
  test('two entries parse name, slug, date, description and line', () => {
    const doc = parseMilestones(MASTER);
    expect(doc.diagnostics).toEqual([]);
    expect(doc.milestones).toEqual([
      { name: 'Harbor 0.9', slug: 'harbor-0-9', target: '2026-11-01', description: 'First public release', line: 5 },
      { name: 'Lantern', slug: 'lantern', target: '2027-02-15', description: null, line: 6 },
    ]);
  });

  test('an entry without description gives null, also with a trailing separator', () => {
    const doc = parseMilestones('## Milestones\n- A · 2026-01-01\n- B · 2026-01-02 · \n');
    expect(doc.milestones.map((m) => m.description)).toEqual([null, null]);
  });

  test('a line without a valid date warns master-milestone-line and is skipped', () => {
    const doc = parseMilestones('## Milestones\n- Only a name\n- Bad · soon\n- Off · 2026-13-40\n- Good · 2026-05-05\n');
    expect(doc.milestones.map((m) => m.name)).toEqual(['Good']);
    expect(doc.diagnostics.map((d) => [d.severity, d.code, d.line])).toEqual([
      ['warning', 'master-milestone-line', 2],
      ['warning', 'master-milestone-line', 3],
      ['warning', 'master-milestone-line', 4],
    ]);
  });

  // Review finding 3: two rows sharing a slug would share a track key and a `#m-<slug>` anchor.
  test('a repeated name warns master-milestone-duplicate on the later line and keeps the first entry', () => {
    const doc = parseMilestones('## Milestones\n- Harbor 1.0 · 2026-05-14 · First\n- Harbor 1.0 · 2026-06-01 · Second\n');
    expect(doc.milestones.map((m) => [m.name, m.target, m.line])).toEqual([['Harbor 1.0', '2026-05-14', 2]]);
    expect(doc.diagnostics).toEqual([
      {
        severity: 'warning',
        code: 'master-milestone-duplicate',
        message: 'Milestone "Harbor 1.0" repeats an earlier entry (same name or slug "harbor-1-0"); this one is skipped.',
        line: 3,
      },
    ]);
  });

  test('different names with one slug warn master-milestone-duplicate and keep the first entry', () => {
    const doc = parseMilestones('## Milestones\n- V1.0 · 2026-05-14\n- v1-0 · 2026-06-01\n');
    expect(doc.milestones.map((m) => [m.name, m.slug])).toEqual([['V1.0', 'v1-0']]);
    expect(doc.diagnostics.map((d) => [d.severity, d.code, d.line, d.message])).toEqual([
      ['warning', 'master-milestone-duplicate', 3, 'Milestone "v1-0" repeats an earlier entry (same name or slug "v1-0"); this one is skipped.'],
    ]);
  });

  test('no section gives an empty list and no diagnostics', () => {
    expect(parseMilestones('# Master\n\n## Features\n- x\n')).toEqual({ milestones: [], diagnostics: [], skipped: [] });
    expect(parseMilestones('')).toEqual({ milestones: [], diagnostics: [], skipped: [] });
  });

  test('the section stops at the next level-two heading', () => {
    const doc = parseMilestones(MASTER);
    expect(doc.milestones).toHaveLength(2);
    expect(doc.diagnostics).toEqual([]);
  });

  test('the section stops at a --- rule and ignores fenced lines', () => {
    const doc = parseMilestones('## Milestones\n```\n- Fenced · 2026-01-01\n```\n- A · 2026-01-01\n---\n- After · 2026-02-02\n');
    expect(doc.milestones.map((m) => m.name)).toEqual(['A']);
  });

  // Review round 2, finding 5: only a top-level bullet is a milestone line; an indented one is a note under its entry.
  test('an indented sub-bullet under an entry is ignored silently', () => {
    const doc = parseMilestones('## Milestones\n\n- Harbor 1.0 · 2026-05-14 · First\n  - ships with console\n\t* and a CLI\n- Lantern · 2027-02-15\n');
    expect(doc.diagnostics).toEqual([]);
    expect(doc.milestones.map((m) => [m.name, m.line])).toEqual([['Harbor 1.0', 3], ['Lantern', 6]]);
  });

  test('any heading ends the section, a level-one heading and a level-three one included', () => {
    const appendix = parseMilestones('## Milestones\n- A · 2026-01-01\n\n# Appendix\n\n- a plain list\n- Not one · 2030-01-01\n');
    expect(appendix.diagnostics).toEqual([]);
    expect(appendix.milestones.map((m) => m.name)).toEqual(['A']);
    const sub = parseMilestones('## Milestones\n- A · 2026-01-01\n### Notes\n- a note\n');
    expect(sub.diagnostics).toEqual([]);
    expect(sub.milestones.map((m) => m.name)).toEqual(['A']);
  });

  test('CRLF text reads like LF text', () => {
    expect(parseMilestones(MASTER.replace(/\n/g, '\r\n'))).toEqual(parseMilestones(MASTER));
  });

  test('non-bullet prose is ignored and a description keeps later separators', () => {
    const doc = parseMilestones('## Milestones\n\nSome intro.\n\n- A · 2026-01-01 · d · with dot\n');
    expect(doc.diagnostics).toEqual([]);
    expect(doc.milestones[0]?.description).toBe('d · with dot');
  });
  // Review round 3, finding 3: the names of skipped lines travel beside the diagnostics, so the planning tree can tell a
  // name the master lists but could not use from one it never lists.
  test('skipped lists the name part of every skipped line that has one, in file order', () => {
    const doc = parseMilestones('## Milestones\n- Harbor 1.0 · 2026-13-01\n- Only a name\n-  · 2026-01-01\n- V1.0 · 2026-05-14\n- v1-0 · 2026-06-01\n- V1.0 · 2026-07-01\n');
    expect(doc.milestones.map((m) => m.name)).toEqual(['V1.0']);
    expect(doc.skipped).toEqual(['Harbor 1.0', 'Only a name', 'v1-0', 'V1.0']);
    expect(doc.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['master-milestone-line', 2],
      ['master-milestone-line', 3],
      ['master-milestone-line', 4],
      ['master-milestone-duplicate', 6],
      ['master-milestone-duplicate', 7],
    ]);
  });

  // Review round 3, finding 9: a separator is a `·` with whitespace on both sides (the end of the line counts), so a
  // name may carry a bare `·` and runs to the first ` · `, as FORMAT.md writes it.
  test('a bare middle dot inside the name is part of the name', () => {
    const doc = parseMilestones('## Milestones\n- v1·beta · 2026-01-01 · d\n');
    expect(doc.diagnostics).toEqual([]);
    expect(doc.milestones.map((m) => [m.name, m.target, m.description])).toEqual([['v1·beta', '2026-01-01', 'd']]);
  });
});

describe('milestoneSlug', () => {
  test('kebab-cases the name', () => {
    expect(milestoneSlug('Harbor 0.9')).toBe('harbor-0-9');
    expect(milestoneSlug('  Spaced  Name ')).toBe('spaced-name');
    expect(milestoneSlug('v1.0-RC')).toBe('v1-0-rc');
  });
});
