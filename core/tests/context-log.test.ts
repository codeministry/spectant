// context.md question rounds and the constitution's lanes and gate tiers as the Docs tabs' cards (spec 024, ISC-149).
import { describe, expect, test } from 'bun:test';

import { parseConstitutionView, parseDecisionLog } from '../src/context-log.ts';

const CONTEXT = [
  '# Context 001',
  '',
  '## Goal — confirmed 2026-03-03T10:00:00Z',
  'A reader sees every spec',
  'on one page.',
  '',
  'Principal\'s words, verbatim: "one page"',
  '',
  '## Round 0 — shaping the idea, 2026-03-03',
  '- Shapes offered: one page (recommended) | a report',
  '- Chosen: one page',
  '',
  '### Q1 · Poll or push?',
  '- From: /spec-plan',
  '- Offered: ETag (empfohlen) | SSE',
  '- Chosen: ETag',
  '- Landed in: ISC-3, `## Constraints` (poll, not push),',
  '  plan.md',
  '',
  '### Notes from the repo',
  '- Offered: not a question',
  '',
  '## Round 1b — design pass, 2026-03-04T09:00:00Z',
  '',
  '```',
  '### Q9 · inside a fence',
  '```',
  '## Still open',
  '- none',
].join('\n');

describe('parseDecisionLog', () => {
  const log = parseDecisionLog(CONTEXT);
  test('the goal lock: its first paragraph joined, and the confirmation time', () => {
    expect(log.goal).toEqual({ text: 'A reader sees every spec on one page.', confirmed: '2026-03-03T10:00:00Z' });
  });
  test('rounds with title and date; shapes and questions, recommended marks lifted, landed-in split on top-level commas', () => {
    expect(log.rounds.map((r) => [r.id, r.title, r.date])).toEqual([
      ['round-0', 'Round 0 — shaping the idea', '2026-03-03'],
      ['round-1', 'Round 1b — design pass', '2026-03-04T09:00:00Z'],
    ]);
    const [r0, r1] = log.rounds;
    expect(r0?.shapes).toEqual([{ text: 'one page', recommended: true }, { text: 'a report', recommended: false }]);
    expect(r0?.shapeChosen).toBe('one page');
    expect(r0?.questions).toEqual([
      { n: '1', title: 'Poll or push?', from: '/spec-plan', offered: [{ text: 'ETag', recommended: true }, { text: 'SSE', recommended: false }], chosen: 'ETag', landedIn: ['ISC-3', '## Constraints (poll, not push)', 'plan.md'] },
    ]);
    expect(r1?.questions).toEqual([]);
  });
});

describe('parseConstitutionView', () => {
  const body = [
    '## Gates',
    '| Tier | Command | Runs when |',
    '|------|---------|-----------|',
    '| static | `bun run check:static` | before every claim closes |',
    '',
    '## Lanes',
    '| Lane | Path prefixes | Context a worker loads | Lane probe |',
    '|------|---------------|------------------------|------------|',
    '| repo | root files (`a`, `b`), `.github/` | root `CLAUDE.md` | `bun run check:static` |',
  ].join('\n');
  test('lanes with their path prefixes and probe; gate tiers with command and when', () => {
    expect(parseConstitutionView(body)).toEqual({
      lanes: [{ lane: 'repo', paths: ['root files (a, b)', '.github/'], probe: 'bun run check:static' }],
      tiers: [{ tier: 'static', command: 'bun run check:static', runsWhen: 'before every claim closes' }],
    });
  });
  test('a constitution without the sections has neither', () => {
    expect(parseConstitutionView('# Constitution\n')).toEqual({ lanes: [], tiers: [] });
  });
});
