// The facts of the relation index (spec 067, ISC-529, ISC-530): what the detail sidebar's overview shows of a
// feature, a milestone, a claim and a story beyond its relations, as `Relation.facts`; and the story's excerpt
// (`IdeaRef.excerpt`) the idea facts carry. A missing value is a missing key; a spec carries no facts.
import { describe, expect, test } from 'bun:test';

import * as core from '../src/index.ts';
import type { ClaimLock, LockReading } from '../src/files.ts';
import { factsOf } from '../src/relations.ts';
import type { Relation, RelationRef } from '../src/relations.ts';

const master = [
  '# Master',
  '',
  '## Features',
  '',
  '### F1 · Ticket sales',
  'Why: a passenger can buy a ticket without going to the pier.',
  'Milestone: Ferry 1.0',
  '',
  '- [x] ISC-1: A ticket is sold online.',
  '- [ ] ISC-2: Anti: one seat is sold twice.',
  '- [ ] ISC-3: Antecedent: the timetable is published. (after: ISC-1)',
  '- [ ] ISC-4: [DROPPED no longer needed] A paper ticket is printed.',
  '- [ ] ISC-5: A refund is paid back.',
  '',
  '### F2 · Boarding',
  '',
  '- [ ] ISC-6: A pass boards.',
  '',
  '## Milestones',
  '',
  '- Ferry 1.0 · 2026-04-15 · Tickets are sold online.',
  '- Ferry 2.0 · 2026-06-30',
  '',
].join('\n');

const spec = [
  '---',
  'task: "Sales"',
  'isa_feature: F1',
  '---',
  '',
  '# Spec',
  '',
  '## Criteria',
  '',
  '- [x] ISC-1: A ticket is sold online.',
  '- [ ] ISC-2: Anti: one seat is sold twice.',
  '- [ ] ISC-3: Antecedent: the timetable is published.',
  '- [ ] ISC-5: A refund is paid back.',
  '',
  '## Test Strategy',
  '',
  '| isc | type | check | threshold | tool | anchors_to | severity |',
  '|-----|------|-------|-----------|------|------------|----------|',
  '| ISC-1 | bun-test | a sale is paid | pass | `bun test sales` | literal |  |',
  '| ISC-2 | bun-test | no seat twice | pass |  | literal |  |',
  '| ISC-2 | bun-test | a second row | pass | `ignored` | literal |  |',
  '',
  '## Verification',
  '',
  '- ISC-1: `bun test sales` passed, 2026-03-04',
  '- ISC-2: written although open',
  '',
].join('\n');

const lock = (claim: string, session: string): ClaimLock => ({ source: 'activity', claim, session, actor: { kind: 'legacy', raw: session } as unknown as ClaimLock['actor'], since: '2026-03-20T10:00:00Z' });
const locks = { source: 'activity', sources: ['activity'], locks: [lock('ISC-5', 'a:claude:old'), lock('ISC-5', 'a:claude:spec-001/T2'), lock('ISC-1', 'a:claude:done')] } as unknown as LockReading;

const story = (body: string, extra = ''): string => `---\nstatus: idea\ntype: feature\nfeature: F1\npriority: P1\n${extra}---\n## Goal (one sentence)\nA story.\n\n${body}`;

const model = core.buildPlanning({
  master,
  specs: [{ folder: '001-sales', texts: { spec } }],
  archived: [],
  now: '2026-03-20',
  locks,
  ideas: { 'refunds.md': story('## Problem\n\nPassengers wait\nfor refunds.\n\nSecond paragraph.\n'), 'bare.md': '---\nstatus: idea\n---\n## Goal\nBare.\n' },
});
const at = (ref: string): Relation | undefined => model.relations?.[ref as RelationRef];

describe('relation facts (spec 067)', () => {
  test('feature: its Why line and the milestone its line names; a missing value is a missing key', () => {
    expect(at('feature:F1')?.facts).toEqual({ why: 'a passenger can buy a ticket without going to the pier.', milestone: 'Ferry 1.0' });
    expect(at('feature:F2')?.facts).toEqual({});
  });

  test('milestone: its target date and description', () => {
    expect(at('milestone:ferry-1-0')?.facts).toEqual({ target: '2026-04-15', description: 'Tickets are sold online.' });
    expect(at('milestone:ferry-2-0')?.facts).toEqual({ target: '2026-06-30' });
  });

  test('claim: kind, state, probe (tool, else check), Verification only when closed, the holder of its lock', () => {
    expect(at('claim:ISC-1')?.facts).toEqual({ kind: 'normal', state: 'closed', probe: '`bun test sales`', verification: '`bun test sales` passed, 2026-03-04' });
    expect(at('claim:ISC-2')?.facts).toEqual({ kind: 'anti', state: 'open', probe: 'no seat twice' });
    expect(at('claim:ISC-3')?.facts).toEqual({ kind: 'antecedent', state: 'open' });
    expect(at('claim:ISC-4')?.facts).toEqual({ kind: 'normal', state: 'dropped' });
    expect(at('claim:ISC-5')?.facts).toEqual({ kind: 'normal', state: 'open', lockHolder: 'a:claude:spec-001/T2' });
    expect(at('claim:ISC-6')?.facts).toEqual({ kind: 'normal', state: 'open' });
  });

  test('idea: state, priority, type and excerpt; a spec carries no facts', () => {
    expect(at('idea:refunds')?.facts).toEqual({ state: 'open', priority: 'P1', type: 'feature', excerpt: 'Passengers wait for refunds.' });
    expect(at('idea:bare')?.facts).toEqual({ state: 'open', priority: 'P3' });
    const spec = at('spec:001');
    expect(spec).toBeDefined();
    expect(spec === undefined ? null : 'facts' in spec).toBe(false);
  });

  test('factsOf: the variant of the relation type asked for, else undefined', () => {
    const feature = at('feature:F1');
    expect(feature === undefined ? undefined : factsOf(feature, 'feature')?.why).toBe('a passenger can buy a ticket without going to the pier.');
    expect(feature === undefined ? 'none' : factsOf(feature, 'claim')).toBeUndefined();
  });

  test('withIdeaStates: a story running sets the idea facts state too', () => {
    const items = model.ideas.map((i) => ({ kind: 'idea' as const, id: i.slug, state: i.slug === 'refunds' ? ('running' as const) : ('open' as const) }));
    const states = core.withIdeaStates(model, items);
    expect(states.relations?.['idea:refunds' as RelationRef]?.facts).toEqual({ state: 'running', priority: 'P1', type: 'feature', excerpt: 'Passengers wait for refunds.' });
    expect(states.relations?.['idea:bare' as RelationRef]?.facts).toEqual({ state: 'open', priority: 'P3' });
  });
});

describe('story excerpt (spec 067, ISC-529)', () => {
  const excerptOf = (text: string): string | null | undefined => core.readIdeas({ 's.md': text }).ideas[0]?.excerpt;

  test('the first paragraph of ## Problem, joined to one line, comments skipped', () => {
    expect(excerptOf(story('## Problem\n<!-- what hurts -->\n\nOne line\nand another.\n\nNot this.\n\n## Vision\nNo.\n'))).toBe('One line and another.');
  });

  test('without ## Problem the first paragraph of ## Vision; without either null', () => {
    expect(excerptOf(story('## Vision\n\nBoarding with a phone.\n'))).toBe('Boarding with a phone.');
    expect(excerptOf(story('## Problem\n\n## Vision\n\nFrom the vision.\n'))).toBe('From the vision.');
    expect(excerptOf(story('## Notes\n\nNothing.\n'))).toBeNull();
  });

  test('at most 280 characters, cut at a word boundary with an ellipsis', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const cut = excerptOf(story(`## Problem\n\n${long}\n`)) ?? '';
    expect(cut.length).toBeLessThanOrEqual(280);
    expect(cut.endsWith('…')).toBe(true);
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
    expect(long.charAt(cut.length - 1)).toBe(' ');
    const exact = 'x'.repeat(280);
    expect(excerptOf(story(`## Problem\n\n${exact}\n`))).toBe(exact);
    expect(excerptOf(story(`## Problem\n\n${'y'.repeat(300)}\n`))).toBe(`${'y'.repeat(279)}…`);
  });
});
