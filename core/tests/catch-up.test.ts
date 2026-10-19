// The catch-up of a stage move (spec 031, T18, ISC-44): a subcommand writes the file that carries the spec on first
// (plan.md, tasks.md, the last claim's verification) and records the move after it. By then the files derive the spec
// in the next stage and `planTransition` refuses to move it there ("already stands"); `planCatchUp` plans the one event
// line from the last recorded stage to the derived one, with `stage:` set to match. A derived stage the events already
// record is nothing to do; any other gap is refused with a reason.
import { describe, expect, test } from 'bun:test';

import { validateEventLine } from '../src/events.ts';
import type { MarkState, SpecFiles, Workflow, WorkflowStage } from '../src/files.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import type { ClaimCounts } from '../src/stage.ts';
import { planCatchUp, planTransition, type CatchUpPlan, type TransitionInput } from '../src/transition.ts';
import { parseWorkflow } from '../src/workflow.ts';

const DEFAULT_WF: Workflow = parseWorkflow(null);
const NO_REVIEW_WF: Workflow = parseWorkflow(
  ['| type | stages | code_review |', '|------|--------|-------------|', '| feature | plan · tasks · review · build · close · done | none |', ''].join('\n'),
);
const NOW = new Date('2026-03-10T08:00:00Z');
const ACTOR = 'a:claude:spec-check';

function specText(stage: string | null, checked: number): string {
  return [
    '---',
    'task: "A week of notes becomes one digest"',
    'slug: 001-digest',
    'spec_type: feature',
    'isa_feature: F1',
    ...(stage === null ? [] : [`stage: ${stage}`]),
    'phase: planning',
    '---',
    '',
    '# 001 — Digest',
    '',
    '## Features',
    '',
    '### F1 · Digest',
    '',
    ...[1, 2, 3].map((n) => `- [${n <= checked ? 'x' : ' '}] ISC-${n}: Claim ${n} of the digest holds.`),
    '',
  ].join('\n');
}

const line = (from: string | null, to: string, command: string): string =>
  JSON.stringify({ ts: '2026-03-03T10:00:00Z', from, to, command, actor: 'u:3f9c0a7d' });

function files(stage: string | null, events: readonly string[], extra: Partial<Record<'plan' | 'tasks', string>> = {}, checked = 0): SpecFiles {
  return { folder: '001-digest', texts: { spec: specText(stage, checked), events: events.map((l) => `${l}\n`).join(''), ...extra } };
}

const counts = (closed: number): ClaimCounts => ({ takeable: 3 - closed, open: 0, closed, dropped: 0 });

function input(f: SpecFiles, to: WorkflowStage, reviewed: MarkState, closed = 0, workflow = DEFAULT_WF): TransitionInput {
  return { files: f, workflow, to, actor: ACTOR, now: NOW, reviewed, partition: counts(closed), featureSiblingsOpen: [] };
}

function caughtUp(p: CatchUpPlan): Extract<CatchUpPlan, { kind: 'catch-up' }> {
  if (p.kind !== 'catch-up') throw new Error(`expected a catch-up, got ${p.kind}${p.kind === 'refused' ? `: ${p.reason}` : ''}`);
  return p;
}

const ALLOCATED = line(null, 'plan', '/spec new digest');
const PLANNED = line('plan', 'tasks', '/spec plan 001');
const TASKED = line('tasks', 'review', '/spec tasks 001');
const REVIEWED = line('review', 'build', '/spec review 001');

describe('planCatchUp: the files moved on first (T18, ISC-44)', () => {
  test('plan.md written after the allocation: planTransition refuses tasks, the catch-up plans plan → tasks', () => {
    const f = files('plan', [ALLOCATED], { plan: '# Plan\n' });
    const direct = planTransition(input(f, 'tasks', 'missing'));
    expect(direct.ok).toBe(false);
    const p = caughtUp(planCatchUp(input(f, 'tasks', 'missing')));
    expect(p.event).toMatchObject({ ts: NOW.toISOString(), from: 'plan', to: 'tasks', command: '/spec-plan 001', actor: ACTOR });
    expect(validateEventLine(JSON.stringify(p.event)).ok).toBe(true);
    expect(parseFrontmatter(p.specText).data.stage).toBe('tasks');
    expect(parseFrontmatter(p.specText).body).toBe(parseFrontmatter(f.texts.spec ?? '').body);
  });

  test('tasks.md written after plan → tasks: the catch-up plans tasks → review', () => {
    const f = files('tasks', [ALLOCATED, PLANNED], { plan: '# Plan\n', tasks: '# Tasks\n' });
    const p = caughtUp(planCatchUp(input(f, 'review', 'missing')));
    expect(p.event).toMatchObject({ from: 'tasks', to: 'review', command: '/spec-tasks 001' });
    expect(parseFrontmatter(p.specText).data.stage).toBe('review');
  });

  test('the last claim verified in build: the catch-up plans build → code-review', () => {
    const f = files('build', [ALLOCATED, PLANNED, TASKED, REVIEWED], { plan: '# Plan\n', tasks: '# Tasks\n' }, 3);
    const p = caughtUp(planCatchUp(input(f, 'code-review', 'fresh', 3)));
    expect(p.event).toMatchObject({ from: 'build', to: 'code-review', command: '/spec-implement 001' });
  });

  test('code_review none: the last claim verified in build catches up build → close', () => {
    const f = files('build', [ALLOCATED, PLANNED, TASKED, REVIEWED], { plan: '# Plan\n', tasks: '# Tasks\n' }, 3);
    const p = caughtUp(planCatchUp(input(f, 'close', 'fresh', 3, NO_REVIEW_WF)));
    expect(p.event).toMatchObject({ from: 'build', to: 'close' });
    expect(parseFrontmatter(p.specText).data.stage).toBe('close');
  });

  test('without a stage: key the catch-up inserts one', () => {
    const f = files(null, [ALLOCATED], { plan: '# Plan\n' });
    const p = caughtUp(planCatchUp(input(f, 'tasks', 'missing')));
    expect(parseFrontmatter(p.specText).data.stage).toBe('tasks');
  });

  test('pure: the input files are not touched', () => {
    const f = files('plan', [ALLOCATED], { plan: '# Plan\n' });
    const before = JSON.stringify(f);
    planCatchUp(input(f, 'tasks', 'missing'));
    expect(JSON.stringify(f)).toBe(before);
  });
});

describe('planCatchUp: nothing to do, or refused (T18, ISC-44)', () => {
  test('the derived stage the last event already records is nothing to do', () => {
    const f = files('tasks', [ALLOCATED, PLANNED], { plan: '# Plan\n' });
    expect(planCatchUp(input(f, 'tasks', 'missing'))).toEqual({ kind: 'recorded', stage: 'tasks' });
  });

  test('a target the files do not derive is refused', () => {
    const f = files('plan', [ALLOCATED], { plan: '# Plan\n' });
    const p = planCatchUp(input(f, 'review', 'missing'));
    expect(p).toMatchObject({ kind: 'refused', from: 'tasks', to: 'review' });
  });

  test('a gap of two stages is refused: the workflow lists no move plan → review', () => {
    const f = files('plan', [ALLOCATED], { plan: '# Plan\n', tasks: '# Tasks\n' });
    const p = planCatchUp(input(f, 'review', 'missing'));
    if (p.kind !== 'refused') throw new Error(`expected a refusal, got ${p.kind}`);
    expect(p.reason).toContain('plan → review');
  });

  test('review → build is the reviewed mark’s own event: a fresh mark with the last event in review is refused', () => {
    const f = files('review', [ALLOCATED, PLANNED, TASKED], { plan: '# Plan\n', tasks: '# Tasks\n' });
    const p = planCatchUp(input(f, 'build', 'fresh'));
    if (p.kind !== 'refused') throw new Error(`expected a refusal, got ${p.kind}`);
    expect(p).toMatchObject({ from: 'review', to: 'build' });
    expect(p.reason).toContain('reviewed mark');
  });

  test('a spec without events has nothing to catch up from', () => {
    const f = files('plan', [], { plan: '# Plan\n' });
    expect(planCatchUp(input(f, 'tasks', 'missing'))).toMatchObject({ kind: 'refused', to: 'tasks' });
  });

  test('a folder without spec.md is refused', () => {
    expect(planCatchUp(input({ folder: '001-digest', texts: {} }, 'tasks', 'missing'))).toMatchObject({ kind: 'refused' });
  });
});
