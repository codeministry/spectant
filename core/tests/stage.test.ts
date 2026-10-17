// Stage per spec and the next command (spec 001 T37, evidence for ISC-14 until T41's parity test runs on real trees).
// The expected stage of every fixture spec is what the old Spec skill derives: `stageOf()`/`nextCommand()` of
// SpecDashboard.ts, run on copies of these trees with the old SpecGate reviewed check and the old SpecRun takeable set.
// The harbor rows match core/fixtures/README.md's "Expected" column.
//
// Two inputs are built by hand here because their core modules are still stubs:
// - gate states (T36, gates.ts): a mark's presence decides missing; fresh or stale is the old SpecGate verdict, and
//   every code-reviewed mark is stale because its tree id matches no working tree (core/fixtures/README.md).
// - the claim partition (T34, status.ts): the old IsaFrontier rule with no locks (resolved = checked or dropped; an
//   open claim is takeable when every `after` claim is resolved, else blocked).
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseClaims } from '../src/claims.ts';
import { buildDashboard } from '../src/dashboard.ts';
import { deriveStages } from '../src/derived-stages.ts';
import type { CodeReviewMode, SpecFiles, SpecType, StageSource, Workflow, WorkflowStage } from '../src/files.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import type { MarkState } from '../src/gates.ts';
import {
  SPEC_RULES,
  STAGE_RULES,
  STORY_RULE,
  TRANSITIONS,
  WAITING_STAGES,
  TYPE_NEEDS,
  WORKFLOW_STAGES,
  WORKFLOW_TYPES,
  allowedTransition,
  defaultWorkflowRow,
  fillReason,
  fillsTemplate,
  nextCommand,
  nextCommandWithReason,
  reasonOf,
  stageMismatchOf,
  stageOf,
  storyStep,
  transitionsOf,
  type ClaimCounts,
  type Stage,
  type StageInput,
  type StageRule,
} from '../src/stage.ts';
import { planTransition } from '../src/transition.ts';
import { parseWorkflow } from '../src/workflow.ts';
import { goldenPath } from './helpers/golden.ts';
import { fixtureTrees, readTree } from './helpers/read-tree.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');

interface HandGates {
  readonly reviewed: MarkState;
  readonly codeReviewed: MarkState;
}

function specInput(rel: string, gates: HandGates): { input: StageInput; blocked: number } {
  const dir = join(FIXTURES, rel);
  const text = readFileSync(join(dir, 'spec.md'), 'utf8');
  const fm = parseFrontmatter(text).data;
  const doc = parseClaims(text);
  const resolved = new Set(doc.claims.filter((c) => c.checked || c.dropped).map((c) => c.id));
  const takeable: string[] = [];
  let blocked = 0;
  for (const c of doc.claims) {
    if (c.checked || c.dropped) continue;
    if (c.after.every((id) => resolved.has(id))) takeable.push(c.id);
    else blocked += 1;
  }
  const partition: ClaimCounts = {
    takeable: takeable.length,
    open: blocked,
    closed: doc.claims.filter((c) => c.checked && !c.dropped).length,
    dropped: doc.claims.filter((c) => c.dropped).length,
  };
  // The hand-built gate states must at least agree with the mark files on presence.
  expect(existsSync(join(dir, '.gates', 'reviewed.json'))).toBe(gates.reviewed !== 'missing');
  expect(existsSync(join(dir, '.gates', 'code-reviewed.json'))).toBe(gates.codeReviewed !== 'missing');
  const name = rel.split('/').pop() ?? rel;
  return {
    input: {
      number: name.slice(0, 3),
      type: fm.specType,
      phase: fm.phase,
      hasPlan: existsSync(join(dir, 'plan.md')),
      hasTasks: existsSync(join(dir, 'tasks.md')),
      claims: doc.counted,
      reviewed: gates.reviewed,
      codeReviewed: gates.codeReviewed,
      takeable,
      partition,
      // The old derivation knew no explicit stage and no feature-wide code review; the explicit and close-pending cases
      // run below, through the real pipeline.
      explicitStage: null,
      lastEventTo: null,
      codeReview: 'spec',
      mainFeature: null,
      featureSiblingsOpen: [],
    },
    blocked,
  };
}

interface FixtureCase {
  readonly rel: string;
  readonly gates: HandGates;
  /** Old SpecStatus counts: every claim line, and closed = checked or dropped. */
  readonly total: number;
  readonly resolved: number;
  readonly takeable: number;
  readonly stage: Stage;
  readonly next: string | null;
}

const fresh: MarkState = 'fresh';
const stale: MarkState = 'stale';
const missing: MarkState = 'missing';

// Stage and next command as the old skill derives them (see the header); harbor rows as the README states them.
const CASES: readonly FixtureCase[] = [
  { rel: 'harbor/specs/archive/001-manifest-sync', gates: { reviewed: fresh, codeReviewed: stale }, total: 46, resolved: 46, takeable: 0, stage: 'done', next: null },
  { rel: 'harbor/specs/002-web-console', gates: { reviewed: fresh, codeReviewed: missing }, total: 30, resolved: 25, takeable: 4, stage: 'build', next: '/spec-implement 002' },
  { rel: 'harbor/specs/003-config-loader', gates: { reviewed: missing, codeReviewed: missing }, total: 13, resolved: 0, takeable: 7, stage: 'tasks', next: '/spec-tasks 003' },
  { rel: 'harbor/specs/004-retention-policies', gates: { reviewed: fresh, codeReviewed: stale }, total: 30, resolved: 30, takeable: 0, stage: 'code-review', next: '/spec-code-review 004' },
  { rel: 'harbor/specs/005-config-format-choice', gates: { reviewed: missing, codeReviewed: missing }, total: 1, resolved: 0, takeable: 1, stage: 'review', next: '/spec-review 005' },
  { rel: 'harbor/specs/006-partial-push', gates: { reviewed: stale, codeReviewed: missing }, total: 4, resolved: 0, takeable: 4, stage: 'review', next: '/spec-review 006' },
  // The chore (spec 008): reviewed, every claim closed, so the chore row makes it done (T50); the old skill knew no chore.
  { rel: 'harbor/specs/007-rotate-mirror-token', gates: { reviewed: fresh, codeReviewed: missing }, total: 2, resolved: 2, takeable: 0, stage: 'done', next: null },
  // The spike pair of F6: 008 closed, 009 open. Under the default code review, as here, 008 waits for its code review;
  // harbor's `code_review: feature` makes it close-pending (the close-pending tests below, T49).
  { rel: 'harbor/specs/008-referrers-support', gates: { reviewed: fresh, codeReviewed: missing }, total: 2, resolved: 2, takeable: 0, stage: 'code-review', next: '/spec-code-review 008' },
  { rel: 'harbor/specs/009-chunked-upload-limits', gates: { reviewed: fresh, codeReviewed: missing }, total: 2, resolved: 1, takeable: 1, stage: 'build', next: '/spec-implement 009' },
  { rel: 'lantern/specs/001-reading-list', gates: { reviewed: fresh, codeReviewed: missing }, total: 8, resolved: 4, takeable: 2, stage: 'build', next: '/spec-implement 001' },
  { rel: 'lantern/specs/002-duplicate-links', gates: { reviewed: fresh, codeReviewed: missing }, total: 2, resolved: 0, takeable: 2, stage: 'build', next: '/spec-implement 002' },
  // The frozen copy carries no `.gates/`, so the old skill derives review here, not build.
  { rel: 'spectant-001/specs/001-app-skeleton', gates: { reviewed: missing, codeReviewed: missing }, total: 47, resolved: 14, takeable: 29, stage: 'review', next: '/spec-review 001' },
  { rel: 'leadgen/specs/012-pwa-install', gates: { reviewed: fresh, codeReviewed: missing }, total: 10, resolved: 9, takeable: 1, stage: 'build', next: '/spec-implement 012' },
  { rel: 'leadgen/specs/022-chat-turn-status-and-bulk-delete', gates: { reviewed: fresh, codeReviewed: stale }, total: 8, resolved: 8, takeable: 0, stage: 'done', next: null },
  { rel: 'leadgen/specs/archive/013-tech-debt', gates: { reviewed: missing, codeReviewed: missing }, total: 15, resolved: 15, takeable: 0, stage: 'done', next: null },
];

describe('stage per fixture spec equals the old derivation', () => {
  for (const c of CASES) {
    test(`${c.rel} → ${c.stage}`, () => {
      const { input } = specInput(c.rel, c.gates);
      const p = input.partition;
      expect(p).toBeDefined();
      if (!p) return;
      // The hand partition reproduces the old SpecStatus counts.
      expect(p.takeable + p.open + p.closed + p.dropped).toBe(c.total);
      expect(p.closed + p.dropped).toBe(c.resolved);
      expect(p.takeable).toBe(c.takeable);
      expect(stageOf(input)).toBe(c.stage);
      expect(nextCommand(input)).toBe(c.next);
    });
  }

  test('the comparison ran on every listed spec', () => {
    expect(CASES.length).toBe(15);
  });

  test('leadgen 012 names its takeable claim as the reason', () => {
    const { input } = specInput('leadgen/specs/012-pwa-install', { reviewed: fresh, codeReviewed: missing });
    expect(nextCommandWithReason(input)).toEqual({
      stage: 'build',
      stageSource: 'derived',
      command: '/spec-implement 012',
      reason: 'ISC-334 is takeable',
      row: 6,
    });
  });

  test('harbor 003 is a refactor: tasks.md comes before the review mark', () => {
    const { input } = specInput('harbor/specs/003-config-loader', { reviewed: missing, codeReviewed: missing });
    expect(nextCommandWithReason(input).reason).toBe('13 claims and no tasks.md');
  });
});

// ─── The table, row by row ─────────────────────────────────────────────────────────────────────────────────────────

const BASE: StageInput = {
  number: '007',
  type: 'feature',
  phase: 'building',
  hasPlan: true,
  hasTasks: true,
  claims: { closed: 1, total: 4 },
  reviewed: 'fresh',
  codeReviewed: 'missing',
  takeable: ['ISC-2'],
  partition: { takeable: 1, open: 2, closed: 1, dropped: 0 },
  explicitStage: null,
  lastEventTo: null,
  codeReview: 'spec',
  mainFeature: 'F2',
  featureSiblingsOpen: [],
};

function at(patch: Partial<StageInput>): StageInput {
  return { ...BASE, ...patch };
}

const ALL_CLOSED: Partial<StageInput> = {
  claims: { closed: 4, total: 4 },
  takeable: [],
  partition: { takeable: 0, open: 0, closed: 4, dropped: 0 },
};

describe('STAGE_RULES is the status contract as data', () => {
  test('eleven rows in table order, each with its command', () => {
    expect(STAGE_RULES.map((r) => [r.stage, r.next])).toEqual([
      ['idea', '/spec new'],
      ['done', null],
      ['plan', '/spec-plan'],
      ['tasks', '/spec-tasks'],
      ['review', '/spec-review'],
      ['build', '/spec-implement'],
      ['done', null],
      ['close-pending', null],
      ['code-review', '/spec-code-review'],
      ['close', '/spec-complete'],
      ['blocked', '/spec-status'],
    ]);
  });

  test('the type router: which files each type needs', () => {
    expect(TYPE_NEEDS).toEqual({
      bug: { plan: false, tasks: false },
      spike: { plan: false, tasks: false },
      refactor: { plan: false, tasks: true },
      feature: { plan: true, tasks: true },
      project: { plan: true, tasks: true },
      infra: { plan: true, tasks: false },
      chore: { plan: false, tasks: false },
    });
  });

  test('stageOf is the first rule that matches, nextCommand its command with the number', () => {
    const input = at({});
    const first = SPEC_RULES.find((r) => r.when(input));
    expect(first?.stage).toBe(stageOf(input));
    expect(nextCommand(input)).toBe(`${first?.next ?? ''} 007`);
  });
});

describe('one synthetic case per row', () => {
  const rows: ReadonlyArray<[string, StageInput, Stage, string | null]> = [
    ['done: phase complete', at({ phase: 'complete' }), 'done', null],
    ['chore done: every claim closed, no code-reviewed mark, no phase edit', at({ type: 'chore', hasPlan: false, hasTasks: false, ...ALL_CLOSED }), 'done', null],
    ['plan: a feature without plan.md', at({ hasPlan: false }), 'plan', '/spec-plan 007'],
    ['plan: an infra spec without plan.md', at({ type: 'infra', hasPlan: false, hasTasks: false }), 'plan', '/spec-plan 007'],
    ['plan: a project without plan.md', at({ type: 'project', hasPlan: false }), 'plan', '/spec-plan 007'],
    ['tasks: a feature with four claims and no tasks.md', at({ hasTasks: false }), 'tasks', '/spec-tasks 007'],
    ['tasks: a refactor with three claims and no tasks.md', at({ type: 'refactor', hasPlan: false, hasTasks: false, partition: { takeable: 1, open: 1, closed: 1, dropped: 0 } }), 'tasks', '/spec-tasks 007'],
    ['review: the reviewed mark is missing', at({ reviewed: 'missing' }), 'review', '/spec-review 007'],
    ['review: the reviewed mark is stale', at({ reviewed: 'stale' }), 'review', '/spec-review 007'],
    ['build: a claim is takeable', at({}), 'build', '/spec-implement 007'],
    ['code-review: all closed, code-reviewed mark missing', at({ ...ALL_CLOSED }), 'code-review', '/spec-code-review 007'],
    ['code-review: all closed, code-reviewed mark stale', at({ ...ALL_CLOSED, codeReviewed: 'stale' }), 'code-review', '/spec-code-review 007'],
    ['close: all closed and code-reviewed', at({ ...ALL_CLOSED, codeReviewed: 'fresh' }), 'close', '/spec-complete 007'],
    ['blocked: open claims, none takeable', at({ takeable: [], partition: { takeable: 0, open: 3, closed: 1, dropped: 0 } }), 'blocked', '/spec-status 007'],
    ['blocked: no claims at all falls through to status', at({ claims: { closed: 0, total: 0 }, takeable: [], partition: { takeable: 0, open: 0, closed: 0, dropped: 0 } }), 'blocked', '/spec-status 007'],
  ];
  for (const [name, input, stage, next] of rows) {
    test(name, () => {
      expect(stageOf(input)).toBe(stage);
      expect(nextCommand(input)).toBe(next);
    });
  }
});

// Spec 008 (ISC-117): a chore runs review → build → done. Done comes once every claim is closed, without a
// code-reviewed mark and without `phase: complete`; its claims still wait on a fresh reviewed mark.
describe('chore done', () => {
  const chore = (patch: Partial<StageInput>): StageInput => at({ type: 'chore', hasPlan: false, hasTasks: false, ...patch });

  test('chore done: every claim closed, whatever the code-reviewed mark', () => {
    for (const codeReviewed of ['missing', 'stale', 'fresh'] as const) {
      expect(nextCommandWithReason(chore({ ...ALL_CLOSED, codeReviewed }))).toEqual({
        stage: 'done',
        stageSource: 'derived',
        command: null,
        reason: 'every claim of the chore is closed',
        row: 7,
      });
    }
  });

  test('chore done waits on the reviewed mark like every type', () => {
    expect(stageOf(chore({ ...ALL_CLOSED, reviewed: 'missing' }))).toBe('review');
    expect(stageOf(chore({ ...ALL_CLOSED, reviewed: 'stale' }))).toBe('review');
  });

  test('chore done needs no plan.md or tasks.md, and an open claim keeps it in build', () => {
    expect(stageOf(chore({}))).toBe('build');
    expect(stageOf(chore({ takeable: [], partition: { takeable: 0, open: 2, closed: 1, dropped: 0 } }))).toBe('blocked');
  });

  test('chore done is the chore row only: another type with every claim closed goes to code-review', () => {
    expect(stageOf(at({ type: 'bug', hasPlan: false, hasTasks: false, ...ALL_CLOSED }))).toBe('code-review');
    expect(stageOf(at({ type: null, hasPlan: false, hasTasks: false, ...ALL_CLOSED }))).toBe('code-review');
  });
});

// Spec 028 (ISC-183): under `code_review: none` a spec of any type but chore goes from build to close once every
// claim is closed, without a code-reviewed mark; row 9 (`code-review`) applies only where the type has a code review.
describe('code_review none', () => {
  const NO_REVIEW_TYPES = WORKFLOW_TYPES.filter((type) => type !== 'chore');

  test('code_review none: every type but chore stands on close with every claim closed and no mark', () => {
    for (const type of NO_REVIEW_TYPES) {
      expect(nextCommandWithReason(at({ type, codeReview: 'none', ...ALL_CLOSED, codeReviewed: 'missing' }))).toEqual({
        stage: 'close',
        stageSource: 'derived',
        command: '/spec-complete 007',
        reason: 'every claim is closed and the workflow has no code review',
        row: 10,
      });
    }
  });

  test('code_review none: the chore row still wins', () => {
    const chore = at({ type: 'chore', hasPlan: false, hasTasks: false, codeReview: 'none', ...ALL_CLOSED });
    expect(nextCommandWithReason(chore).stage).toBe('done');
    expect(nextCommandWithReason(chore).row).toBe(7);
  });

  test('code_review none: an open claim keeps the spec in build, a stale reviewed mark in review', () => {
    expect(stageOf(at({ codeReview: 'none' }))).toBe('build');
    expect(stageOf(at({ codeReview: 'none', ...ALL_CLOSED, reviewed: 'stale' }))).toBe('review');
  });

  test('code_review none: spec and feature still stop on code-review without a fresh mark', () => {
    expect(stageOf(at({ codeReview: 'spec', ...ALL_CLOSED }))).toBe('code-review');
    expect(stageOf(at({ codeReview: 'feature', ...ALL_CLOSED }))).toBe('code-review');
  });

  // ISC-183.1: `/spec-code-review` stays callable; the mark it writes changes nothing under `none`.
  test('voluntary mark: a fresh or stale code-reviewed mark under none gives the same stage, reason and command', () => {
    for (const type of NO_REVIEW_TYPES) {
      const without = nextCommandWithReason(at({ type, codeReview: 'none', ...ALL_CLOSED, codeReviewed: 'missing' }));
      for (const codeReviewed of ['fresh', 'stale'] as const) {
        expect(nextCommandWithReason(at({ type, codeReview: 'none', ...ALL_CLOSED, codeReviewed }))).toEqual(without);
      }
    }
  });
});

describe('the type router decides plan and tasks', () => {
  test('bug and spike never wait for plan.md or tasks.md', () => {
    for (const type of ['bug', 'spike'] as const) {
      expect(stageOf(at({ type, hasPlan: false, hasTasks: false }))).toBe('build');
    }
  });

  test('a refactor needs no plan, an infra spec no tasks', () => {
    expect(stageOf(at({ type: 'refactor', hasPlan: false }))).toBe('build');
    expect(stageOf(at({ type: 'infra', hasTasks: false }))).toBe('build');
  });

  test('an unknown type needs neither, like the old empty-string type', () => {
    expect(stageOf(at({ type: null, hasPlan: false, hasTasks: false }))).toBe('build');
  });

  test('below three claims a spec needs no tasks.md', () => {
    const two = at({ hasTasks: false, partition: { takeable: 1, open: 0, closed: 1, dropped: 0 } });
    expect(stageOf(two)).toBe('build');
  });

  test('a dropped claim counts toward the three, as in the old SpecStatus count', () => {
    const withDropped = at({ hasTasks: false, partition: { takeable: 1, open: 0, closed: 1, dropped: 1 } });
    expect(stageOf(withDropped)).toBe('tasks');
  });
});

describe('first match wins', () => {
  test('phase complete beats everything', () => {
    const worst = at({ phase: 'complete', hasPlan: false, hasTasks: false, reviewed: 'missing', takeable: [] });
    expect(stageOf(worst)).toBe('done');
    expect(nextCommand(worst)).toBeNull();
  });

  test('a missing plan beats missing tasks', () => {
    expect(stageOf(at({ hasPlan: false, hasTasks: false }))).toBe('plan');
  });

  test('missing tasks beat a missing review mark', () => {
    expect(stageOf(at({ hasTasks: false, reviewed: 'missing' }))).toBe('tasks');
  });

  test('a stale review mark beats a takeable claim', () => {
    expect(stageOf(at({ reviewed: 'stale' }))).toBe('review');
  });

  test('a stale review mark beats all-closed', () => {
    expect(stageOf(at({ ...ALL_CLOSED, reviewed: 'stale', codeReviewed: 'fresh' }))).toBe('review');
  });

  test('the frontmatter phase decides nothing but done', () => {
    expect(stageOf(at({ phase: 'scoping' }))).toBe('build');
    expect(stageOf(at({ phase: null }))).toBe('build');
  });
});

describe('claim counts', () => {
  test('without a partition the counts come from claims and the takeable IDs', () => {
    const rest: StageInput = { ...BASE, partition: undefined };
    expect(stageOf(rest)).toBe('build');
    expect(stageOf({ ...rest, takeable: [] })).toBe('blocked');
    expect(stageOf({ ...rest, takeable: [], claims: { closed: 4, total: 4 }, codeReviewed: 'fresh' })).toBe('close');
    expect(stageOf({ ...rest, hasTasks: false, claims: { closed: 0, total: 2 } })).toBe('build');
  });

  test('the partition decides over claims and takeable when both are given', () => {
    const disagree = at({ takeable: ['ISC-2'], partition: { takeable: 0, open: 3, closed: 1, dropped: 0 } });
    expect(stageOf(disagree)).toBe('blocked');
  });

  test('every claim dropped or closed counts as all closed', () => {
    const resolved = at({ takeable: [], partition: { takeable: 0, open: 0, closed: 2, dropped: 2 }, codeReviewed: 'fresh' });
    expect(stageOf(resolved)).toBe('close');
  });
});

describe('nextCommandWithReason', () => {
  const cases: ReadonlyArray<[StageInput, string]> = [
    [at({ phase: 'complete' }), 'phase: complete'],
    [at({ hasPlan: false }), 'a feature spec needs plan.md and it is missing'],
    [at({ hasTasks: false }), '4 claims and no tasks.md'],
    [at({ reviewed: 'missing' }), 'the reviewed mark is missing'],
    [at({ reviewed: 'stale' }), 'the reviewed mark is stale'],
    [at({ takeable: ['ISC-2', 'ISC-3'], partition: { takeable: 2, open: 1, closed: 1, dropped: 0 } }), 'ISC-2 and ISC-3 are takeable'],
    [at({ takeable: ['ISC-2', 'ISC-3', 'ISC-4', 'ISC-5'], partition: { takeable: 4, open: 0, closed: 1, dropped: 0 } }), 'ISC-2, ISC-3 and 2 more are takeable'],
    [at({ takeable: [], partition: { takeable: 2, open: 1, closed: 1, dropped: 0 } }), '2 claims are takeable'],
    [at({ type: 'chore', hasPlan: false, hasTasks: false, ...ALL_CLOSED }), 'every claim of the chore is closed'],
    [at({ ...ALL_CLOSED, codeReview: 'feature', featureSiblingsOpen: ['009'] }), 'every claim is closed and F2 waits on spec 009'],
    [at({ ...ALL_CLOSED }), 'every claim is closed and the code-reviewed mark is missing'],
    [at({ ...ALL_CLOSED, codeReviewed: 'stale' }), 'every claim is closed and the code-reviewed mark is stale'],
    [at({ ...ALL_CLOSED, codeReviewed: 'fresh' }), 'every claim is closed and code-reviewed'],
    [at({ takeable: [], partition: { takeable: 0, open: 3, closed: 1, dropped: 0 } }), '3 open claims, none takeable'],
    [at({ takeable: [], partition: { takeable: 0, open: 1, closed: 1, dropped: 0 } }), '1 open claim, none takeable'],
    [at({ claims: { closed: 0, total: 0 }, takeable: [], partition: { takeable: 0, open: 0, closed: 0, dropped: 0 } }), 'no claims yet'],
  ];
  for (const [input, reason] of cases) {
    test(reason, () => {
      const got = nextCommandWithReason(input);
      expect(got.reason).toBe(reason);
      expect(got.stage).toBe(stageOf(input));
      expect(got.command).toBe(nextCommand(input));
      // The reason is one the row names, not free text.
      expect(rulesFor(got.stage).some((rule) => namesReason(rule, got.reason))).toBe(true);
    });
  }
});

// ─── FORMAT.md's stage table is STAGE_RULES, row by row (spec 002 T11, ISC-79) ─────────────────────────────────────
//
// FORMAT.md is the written contract (core/CLAUDE.md). STAGE_RULES carries every column of its table as data: the
// condition in words, the command with `NNN` for the number, and the reason templates. The test renders each rule as
// the markdown row it must be and compares it verbatim with FORMAT.md, so either side changing alone fails here.

const ROOT = join(import.meta.dir, '..', '..');

/** The rows of the first table under `## The stage table` in FORMAT.md, header and rule line included, verbatim. */
function formatStageTable(): string[] {
  const lines = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8').split('\n');
  const heading = lines.indexOf('## The stage table');
  expect(heading).toBeGreaterThan(-1);
  const from = lines.findIndex((line, i) => i > heading && line.startsWith('|'));
  const to = lines.findIndex((line, i) => i > from && !line.startsWith('|'));
  return lines.slice(from, to < 0 ? undefined : to);
}

const code = (text: string): string => `\`${text}\``;

const TABLE_HEAD = ['| # | Stage | Condition | Next command | Reason |', '|---|-------|-----------|--------------|--------|'];

/** A rule as the markdown row FORMAT.md must hold for it: a spec row's command takes `NNN`, the story row's `<slug>`. */
function renderRow(rule: StageRule, index: number): string {
  const next = rule.next === null ? '—' : code(`${rule.next} ${rule.subject === 'story' ? '<slug>' : 'NNN'}`);
  return `| ${index + 1} | ${code(rule.stage)} | ${rule.condition} | ${next} | ${rule.reasons.map(code).join(' or ')} |`;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `reason` is one of the rule's templates with every `{placeholder}` filled by some non-empty text. */
function namesReason(rule: StageRule, reason: string): boolean {
  return rule.reasons.some((template) => new RegExp(`^${template.split(/\{[a-zA-Z]+\}/).map(escapeRe).join('.+')}$`).test(reason));
}

/** Every row of `stage`: `done` has two, `phase: complete` and the chore row. */
function rulesFor(stage: Stage): StageRule[] {
  const rules = STAGE_RULES.filter((r) => r.stage === stage);
  if (rules.length === 0) throw new Error(`no stage row for ${stage}`);
  return rules;
}

describe('FORMAT.md holds STAGE_RULES verbatim', () => {
  const table = formatStageTable();

  test('the header names the five columns', () => {
    expect(table.slice(0, 2)).toEqual(TABLE_HEAD);
  });

  // Every row has its rule: `idea` (row 1) since spec 008, T54, `close-pending` since T49. No row is pending.
  const body = table.slice(TABLE_HEAD.length);

  test('one markdown row per rule, no more, no fewer: all eleven', () => {
    expect(STAGE_RULES).toHaveLength(11);
    expect(body).toHaveLength(STAGE_RULES.length);
  });

  test('the rows are numbered 1 to n without a gap', () => {
    expect(body.map((row) => row.split('|')[1]?.trim())).toEqual(body.map((_row, i) => String(i + 1)));
  });

  STAGE_RULES.forEach((rule, i) => {
    test(`row ${i + 1}: ${rule.stage}`, () => {
      expect(body[i]).toBe(renderRow(rule, i));
    });
  });

  test('every placeholder a template uses is named in the legend under the table', () => {
    const text = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8');
    const legend = text.slice(text.indexOf('## The stage table'), text.indexOf('## The drift classes'));
    const names = new Set(STAGE_RULES.flatMap((r) => r.reasons.flatMap((t) => [...t.matchAll(/\{[a-zA-Z]+\}/g)].map((m) => m[0]))));
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(legend).toContain(`\`${name}\`:`);
  });
});

// ─── Row 1, the story (spec 008, T54, ISC-124) ──────────────────────────────────────────────────────────────────────

describe('the story row (T54)', () => {
  test('a story stands in idea, its command is /spec new <slug>, its reason the row phrase', () => {
    expect(storyStep('console-audit-log')).toEqual({
      stage: 'idea',
      command: '/spec new console-audit-log',
      reason: 'the story is shaped but has no spec',
      row: 1,
    });
    expect(reasonOf(storyStep('registry-webhooks'))).toBe(STORY_RULE.reasons[0] ?? '');
  });

  test('row 1 is the only story row, and no spec input ever lands in it', () => {
    expect(STAGE_RULES.filter((r) => r.subject === 'story')).toEqual([STORY_RULE]);
    expect(STAGE_RULES[0]).toBe(STORY_RULE);
    expect(SPEC_RULES.map((r) => r.subject)).toEqual(Array.from(SPEC_RULES, () => 'spec'));
    expect(SPEC_RULES.some((r) => (r.stage as string) === 'idea')).toBe(false);
    for (const input of [at({}), at({ phase: 'complete' }), at({ hasPlan: false }), at({ ...ALL_CLOSED })]) {
      expect(nextCommandWithReason(input).row).toBeGreaterThan(1);
    }
  });

  test('the default workflow rows never list idea', () => {
    for (const type of WORKFLOW_TYPES) expect(defaultWorkflowRow(type).stages).not.toContain('idea');
  });
});

// ─── One reason phrase per waiting row (spec 008, T58, ISC-122.3) ──────────────────────────────────────────────────

describe('reasonOf: one phrase per waiting row (T58)', () => {
  const waiting: ReadonlyArray<[string, StageInput]> = [
    ['review, missing', at({ reviewed: 'missing' })],
    ['review, stale', at({ reviewed: 'stale' })],
    ['blocked, open claims', at({ takeable: [], partition: { takeable: 0, open: 3, closed: 1, dropped: 0 } })],
    ['blocked, no claims', at({ claims: { closed: 0, total: 0 }, takeable: [], partition: { takeable: 0, open: 0, closed: 0, dropped: 0 } })],
    ['close-pending, one sibling', at({ ...ALL_CLOSED, codeReview: 'feature', featureSiblingsOpen: ['009'] })],
    ['close-pending, many siblings', at({ ...ALL_CLOSED, codeReview: 'feature', featureSiblingsOpen: ['009', '010', '011'] })],
    ['code-review, missing', at({ ...ALL_CLOSED })],
    ['code-review, stale', at({ ...ALL_CLOSED, codeReviewed: 'stale' })],
    ['close', at({ ...ALL_CLOSED, codeReviewed: 'fresh' })],
  ];

  test('the waiting rows are review, blocked, close-pending, code-review and close', () => {
    expect([...WAITING_STAGES].sort()).toEqual(['blocked', 'close', 'close-pending', 'code-review', 'review']);
  });

  test('every waiting row is reached by the cases below', () => {
    expect(new Set(waiting.map(([, input]) => stageOf(input)))).toEqual(new Set(WAITING_STAGES));
  });

  for (const [name, input] of waiting) {
    test(`${name}: reasonOf is the row's filled phrase, exactly one template of the whole table`, () => {
      const step = nextCommandWithReason(input);
      const rule = STAGE_RULES[step.row - 1];
      if (rule?.subject !== 'spec') throw new Error(`no spec row ${step.row}`);
      expect(WAITING_STAGES.has(rule.stage)).toBe(true);
      const { form = 0, values = {} } = rule.explain(input);
      expect(reasonOf(step)).toBe(fillReason(rule.reasons[form] ?? '', values));
      // One phrase: exactly one template of all eleven rows fills it, so no row yields two phrases joined.
      const matching = STAGE_RULES.flatMap((r) => r.reasons).filter((t) => fillsTemplate(t, reasonOf(step)));
      expect(matching).toEqual([rule.reasons[form] ?? '']);
    });
  }

  const SAMPLE: Readonly<Record<string, string>> = { is: 'is', state: 'stale' };
  test('every row of the table, its forms filled, matches exactly its own template', () => {
    for (const rule of STAGE_RULES) {
      for (const template of rule.reasons) {
        const phrase = template.replace(/\{([a-zA-Z]+)\}/g, (_m, name: string) => SAMPLE[name] ?? 'x');
        expect(STAGE_RULES.flatMap((r) => r.reasons).filter((t) => fillsTemplate(t, phrase))).toEqual([template]);
      }
    }
  });

  test('a reason that is no template of its row throws', () => {
    const step = nextCommandWithReason(at({ reviewed: 'stale' }));
    expect(() => reasonOf({ ...step, reason: `${step.reason}; 1 item waits on you` })).toThrow();
    expect(() => reasonOf({ ...step, row: 99 })).toThrow();
  });
});

describe('fillReason', () => {
  test('fills every placeholder', () => {
    expect(fillReason('{ids} {is} takeable', { ids: 'ISC-334', is: 'is' })).toBe('ISC-334 is takeable');
  });

  test('throws on a placeholder without a value, so no row can emit a half-filled reason', () => {
    expect(() => fillReason('the reviewed mark is {state}', {})).toThrow('{state}');
  });
});

// ─── Every fixture spec, through the real pipeline ─────────────────────────────────────────────────────────────────
//
// The dashboard row (dashboard.ts: gates, the ISC-99 partition, nextCommandWithReason) and the spec page's head and
// first reason (spec.ts, from its golden, which golden.test.ts pins to the built model) for every spec folder of every
// fixture tree, active and archived. Each must be the row of FORMAT.md's table its stage names: the command that row
// names with the spec's number, and a reason that row names. A fixture tree added without rows here fails.

type Walked = readonly [folder: string, stage: Stage, command: string | null, reason: string];

const WALK: Readonly<Record<string, readonly Walked[]>> = {
  'empty-master': [],
  harbor: [
    ['specs/002-web-console', 'build', '/spec-implement 002', 'ISC-74, ISC-75 and 2 more are takeable'],
    ['specs/003-config-loader', 'tasks', '/spec-tasks 003', '13 claims and no tasks.md'],
    ['specs/004-retention-policies', 'code-review', '/spec-code-review 004', 'every claim is closed and the code-reviewed mark is stale'],
    ['specs/005-config-format-choice', 'review', '/spec-review 005', 'the reviewed mark is missing'],
    ['specs/006-partial-push', 'review', '/spec-review 006', 'the reviewed mark is stale'],
    // The chore, reviewed with every claim closed: done by the chore row (spec 008, T50).
    ['specs/007-rotate-mirror-token', 'done', null, 'every claim of the chore is closed'],
    // The spike pair of F6 under `code_review: feature`: 008 waits on its open sibling 009 (spec 008, T49).
    ['specs/008-referrers-support', 'close-pending', null, 'every claim is closed and F6 waits on spec 009'],
    ['specs/009-chunked-upload-limits', 'build', '/spec-implement 009', 'ISC-131 is takeable'],
    ['specs/archive/001-manifest-sync', 'done', null, 'phase: complete'],
  ],
  lantern: [
    ['specs/001-reading-list', 'build', '/spec-implement 001', 'ISC-7 and ISC-9 are takeable'],
    ['specs/002-duplicate-links', 'build', '/spec-implement 002', 'ISC-11 and ISC-12 are takeable'],
  ],
  leadgen: [
    ['specs/012-pwa-install', 'build', '/spec-implement 012', 'ISC-334 is takeable'],
    ['specs/022-chat-turn-status-and-bulk-delete', 'done', null, 'phase: complete'],
    ['specs/archive/013-tech-debt', 'done', null, 'phase: complete'],
  ],
  // Spec 026: the feature specs carry no plan.md and no gates; the completed 001 is done by its phase.
  'milestone-lines': [
    ['specs/001-signal-intake', 'done', null, 'phase: complete'],
    ['specs/002-alert-routing', 'plan', '/spec-plan 002', 'a feature spec needs plan.md and it is missing'],
    ['specs/003-escalation-chains', 'plan', '/spec-plan 003', 'a feature spec needs plan.md and it is missing'],
  ],
  'spectant-001': [['specs/001-app-skeleton', 'review', '/spec-review 001', 'the reviewed mark is missing']],
  // Spec 036: the backlog tree holds a master and specs/backlog.md, no spec folder.
  'backlog-ranks': [],
};

interface SpecPageGolden {
  readonly head: { readonly stage: Stage };
  readonly next: { readonly command: string | null; readonly reasons: readonly string[] };
}

function specPages(tree: string): Record<string, SpecPageGolden> {
  return JSON.parse(readFileSync(goldenPath(tree, 'spec'), 'utf8')) as Record<string, SpecPageGolden>;
}

/** The expectation of one walked spec: the table row its stage names, with the spec's number in the command. */
function expectTableRow(folder: string, stage: Stage, command: string | null, reason: string): void {
  const rule = rulesFor(stage).find((r) => namesReason(r, reason));
  expect(rule).toBeDefined();
  const number = (folder.split('/').pop() ?? '').slice(0, 3);
  const next = rule?.next ?? null;
  expect(command).toBe(next === null ? null : `${next} ${number}`);
}

describe('every fixture spec derives the stage table row it names (ISC-79)', () => {
  test('the walk covers every fixture tree', () => {
    expect(fixtureTrees()).toEqual(Object.keys(WALK).sort());
  });

  let compared = 0;
  for (const [tree, rows] of Object.entries(WALK)) {
    test(`${tree}: ${rows.length} spec${rows.length === 1 ? '' : 's'}`, () => {
      const model = buildDashboard(readTree(tree));
      const pages = specPages(tree);
      expect(Object.keys(pages).sort()).toEqual(rows.map((r) => r[0]).sort());
      const active = rows.filter(([folder]) => !folder.startsWith('specs/archive/'));
      expect(model.specs.map((s) => `specs/${s.slug}`).sort()).toEqual(active.map((r) => r[0]).sort());
      expect(model.archive.map((a) => `specs/archive/${a.slug}`).sort()).toEqual(rows.filter((r) => !active.includes(r)).map((r) => r[0]).sort());

      for (const [folder, stage, command, reason] of rows) {
        expectTableRow(folder, stage, command, reason);
        const page = pages[folder];
        expect(page).toBeDefined();
        expect([page?.head.stage, page?.next.command, page?.next.reasons[0]]).toEqual([stage, command, reason]);
        const row = model.specs.find((s) => `specs/${s.slug}` === folder);
        if (row) expect([row.stage, row.nextCommand, row.nextReason]).toEqual([stage, command, reason]);
        compared += 1;
      }
    });
  }

  test('the walk compared every listed spec', () => {
    // 15, plus the three specs of milestone-lines (spec 026).
    expect(compared).toBe(18);
  });
});

// ─── core/fixtures/README.md's Expected column ─────────────────────────────────────────────────────────────────────

/** `tree/specs/folder → stage` from every README table with an Expected column; a table without a Tree column is harbor's. */
function readmeExpected(): Map<string, string> {
  const out = new Map<string, string>();
  const lines = readFileSync(join(FIXTURES, 'README.md'), 'utf8').split('\n');
  const cells = (line: string): string[] => line.split('|').slice(1, -1).map((c) => c.trim());
  lines.forEach((line, i) => {
    if (!line.startsWith('|') || lines[i - 1]?.startsWith('|')) return;
    const head = cells(line);
    const expected = head.findIndex((c) => c.startsWith('Expected'));
    if (expected < 0) return;
    const treeCol = head.indexOf('Tree');
    const specCol = head.indexOf('Spec');
    for (let j = i + 2; lines[j]?.startsWith('|'); j += 1) {
      const row = cells(lines[j] ?? '');
      const tree = treeCol < 0 ? 'harbor' : (row[treeCol] ?? '').replace(/`/g, '').replace(/\/$/, '');
      const folder = (row[specCol] ?? '').replace(/`/g, '');
      const stage = /\bstage ([a-z-]+)/.exec(row[expected] ?? '')?.[1];
      if (stage) out.set(`${tree}/specs/${folder}`, stage);
    }
  });
  return out;
}

test('core/fixtures/README.md states the walked stage for every fixture spec', () => {
  const walked = Object.entries(WALK).flatMap(([tree, rows]) => rows.map(([folder, stage]): [string, string] => [`${tree}/${folder}`, stage]));
  expect([...readmeExpected()].sort()).toEqual([...walked].sort());
});

// ─── Transitions (spec 008, T45, ISC-29) ───────────────────────────────────────────────────────────────────────────
//
// The expected pairs are rebuilt here from FORMAT.md's rule in words, independent of `rowTransitions`: each stage to
// its successor in the row, `build ⇄ blocked` for every type, `close-pending → code-review` where the row has
// code-review. Every ordered pair over all of WorkflowStage is then asked of `allowedTransition`.

const DEFAULT_WF: Workflow = parseWorkflow(null);
const HARBOR_WF: Workflow = parseWorkflow(readFileSync(join(FIXTURES, 'harbor', 'specs', 'workflow.md'), 'utf8'));

const pair = (from: WorkflowStage, to: WorkflowStage): string => `${from} → ${to}`;

function expectedPairs(stages: readonly WorkflowStage[], codeReview: CodeReviewMode): Set<string> {
  const out = new Set<string>();
  for (const [i, to] of stages.slice(1).entries()) {
    const from = stages[i];
    if (from !== undefined) out.add(pair(from, to));
  }
  out.add(pair('build', 'blocked'));
  out.add(pair('blocked', 'build'));
  if (codeReview === 'feature') out.add(pair('build', 'close-pending'));
  if (stages.includes('code-review')) out.add(pair('close-pending', 'code-review'));
  return out;
}

/** Every ordered pair of stages `allowedTransition` answers yes to. */
function allowedPairs(type: SpecType, workflow: Workflow): Set<string> {
  const out = new Set<string>();
  for (const from of WORKFLOW_STAGES) for (const to of WORKFLOW_STAGES) if (allowedTransition(from, to, type, workflow)) out.add(pair(from, to));
  return out;
}

const rowStages = (workflow: Workflow, type: SpecType): readonly WorkflowStage[] => workflow.rows.find((r) => r.type === type)?.stages ?? [];
const rowCodeReview = (workflow: Workflow, type: SpecType): CodeReviewMode => workflow.rows.find((r) => r.type === type)?.codeReview ?? 'spec';
const minus = (a: Set<string>, b: Set<string>): string[] => [...a].filter((x) => !b.has(x)).sort();

describe('transitions (T45, ISC-29)', () => {
  test('WORKFLOW_STAGES holds every workflow stage once', () => {
    expect(WORKFLOW_STAGES).toEqual(['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'code-review', 'close-pending', 'close', 'done']);
  });

  test('TRANSITIONS is the default table as data, one entry per type', () => {
    expect(Object.keys(TRANSITIONS)).toEqual([...WORKFLOW_TYPES]);
    expect(TRANSITIONS).toEqual(transitionsOf(DEFAULT_WF));
    for (const type of WORKFLOW_TYPES) {
      const row = defaultWorkflowRow(type);
      expect(new Set(TRANSITIONS[type].map((p) => pair(p.from, p.to)))).toEqual(expectedPairs(row.stages, row.codeReview));
    }
  });

  test('the chore row, literally: review → build → done and the blocked detour, no code-review pairs', () => {
    expect(TRANSITIONS.chore).toEqual([
      { from: 'review', to: 'build' },
      { from: 'build', to: 'done' },
      { from: 'build', to: 'blocked' },
      { from: 'blocked', to: 'build' },
    ]);
  });

  test('property: under the default workflow allowedTransition is true exactly for the pairs in TRANSITIONS', () => {
    let asked = 0;
    for (const type of WORKFLOW_TYPES) {
      for (const from of WORKFLOW_STAGES) {
        for (const to of WORKFLOW_STAGES) {
          const listed = TRANSITIONS[type].some((p) => p.from === from && p.to === to);
          expect([type, from, to, allowedTransition(from, to, type, DEFAULT_WF)]).toEqual([type, from, to, listed]);
          asked += 1;
        }
      }
    }
    expect(asked).toBe(WORKFLOW_TYPES.length * WORKFLOW_STAGES.length ** 2);
  });

  test("property: under the harbor workflow every type allows exactly its row's pairs", () => {
    for (const type of WORKFLOW_TYPES) expect(allowedPairs(type, HARBOR_WF)).toEqual(expectedPairs(rowStages(HARBOR_WF, type), rowCodeReview(HARBOR_WF, type)));
  });

  test("harbor's feature row (review before tasks) changes exactly the feature pairs it reorders", () => {
    const harbor = allowedPairs('feature', HARBOR_WF);
    const fallback = allowedPairs('feature', DEFAULT_WF);
    expect(minus(harbor, fallback)).toEqual(['plan → review', 'review → tasks', 'tasks → build']);
    expect(minus(fallback, harbor)).toEqual(['plan → tasks', 'review → build', 'tasks → review']);
    // Every other type keeps its pairs but the spike, whose `code_review: feature` adds the close-pending pair (T49).
    for (const type of WORKFLOW_TYPES.filter((t) => t !== 'feature' && t !== 'spike')) expect(allowedPairs(type, HARBOR_WF)).toEqual(allowedPairs(type, DEFAULT_WF));
  });

  test("close-pending: harbor's spike row (`code_review: feature`) adds exactly build → close-pending", () => {
    expect(minus(allowedPairs('spike', HARBOR_WF), allowedPairs('spike', DEFAULT_WF))).toEqual(['build → close-pending']);
    expect(minus(allowedPairs('spike', DEFAULT_WF), allowedPairs('spike', HARBOR_WF))).toEqual([]);
    expect(allowedTransition('close-pending', 'code-review', 'spike', HARBOR_WF)).toBe(true);
    // The default table has no feature-wide review, so no type enters close-pending there.
    for (const type of WORKFLOW_TYPES) expect(allowedTransition('build', 'close-pending', type, DEFAULT_WF)).toBe(false);
  });

  test('a backward move or a skip stays refused, for every type under both workflows', () => {
    const refused: ReadonlyArray<[WorkflowStage, WorkflowStage]> = [
      ['build', 'review'],
      ['review', 'plan'],
      ['done', 'build'],
      ['close', 'code-review'],
      ['code-review', 'build'],
      ['review', 'done'],
      ['idea', 'review'],
      ['build', 'build'],
    ];
    for (const workflow of [DEFAULT_WF, HARBOR_WF]) {
      for (const type of WORKFLOW_TYPES) {
        for (const [from, to] of refused) expect([type, from, to, allowedTransition(from, to, type, workflow)]).toEqual([type, from, to, false]);
      }
    }
  });

  test('the detours: blocked ⇄ build for every type, close-pending → code-review only where the row has code-review', () => {
    for (const type of WORKFLOW_TYPES) {
      expect(allowedTransition('build', 'blocked', type, DEFAULT_WF)).toBe(true);
      expect(allowedTransition('blocked', 'build', type, DEFAULT_WF)).toBe(true);
      expect(allowedTransition('close-pending', 'code-review', type, DEFAULT_WF)).toBe(type !== 'chore');
      expect(allowedTransition('code-review', 'close-pending', type, DEFAULT_WF)).toBe(false);
    }
  });
});

// ─── FORMAT.md's transition table is TRANSITIONS, row by row (spec 008, T46, ISC-30) ───────────────────────────────
//
// The table under `## The transition table` lists per spec type the pairs TRANSITIONS holds, in its order. The
// expected table is rendered from TRANSITIONS, never written out here, so a change to `rowTransitions` fails until
// FORMAT.md follows; on a mismatch the test prints the Markdown the section must hold, ready to paste.

/** The lines of the first table under `heading` in FORMAT.md, header and rule line included, verbatim. */
function formatTableUnder(heading: string): string[] {
  const lines = readFileSync(join(ROOT, 'FORMAT.md'), 'utf8').split('\n');
  const at = lines.indexOf(heading);
  expect(at).toBeGreaterThan(-1);
  const next = lines.findIndex((line, i) => i > at && line.startsWith('## '));
  const from = lines.findIndex((line, i) => i > at && (next < 0 || i < next) && line.startsWith('|'));
  expect(from).toBeGreaterThan(at);
  const to = lines.findIndex((line, i) => i > from && !line.startsWith('|'));
  return lines.slice(from, to < 0 ? undefined : to);
}

const TRANSITION_HEAD = ['| type | transitions (from → to) |', '|------|-------------------------|'];

/** A type's TRANSITIONS entry as the markdown row FORMAT.md must hold for it. */
const renderTransitionRow = (type: SpecType): string => `| ${type} | ${TRANSITIONS[type].map((p) => pair(p.from, p.to)).join(' · ')} |`;

describe('FORMAT.md holds TRANSITIONS verbatim (T46, ISC-30)', () => {
  const table = formatTableUnder('## The transition table');
  const expected = [...TRANSITION_HEAD, ...WORKFLOW_TYPES.map(renderTransitionRow)];

  test('the whole table is TRANSITIONS rendered; a mismatch prints the table to paste', () => {
    const documented = table.join('\n');
    const wanted = expected.join('\n');
    if (documented !== wanted) console.error(`FORMAT.md § The transition table must hold:\n\n${wanted}\n`);
    expect(documented).toBe(wanted);
  });

  test('the header names the two columns', () => {
    expect(table.slice(0, 2)).toEqual(TRANSITION_HEAD);
  });

  test('one row per spec type, in WORKFLOW_TYPES order', () => {
    expect(table.slice(TRANSITION_HEAD.length).map((row) => row.split('|')[1]?.trim())).toEqual([...WORKFLOW_TYPES]);
  });

  for (const type of WORKFLOW_TYPES) {
    test(`row ${type}: its pairs as TRANSITIONS lists them`, () => {
      expect(table.find((row) => row.startsWith(`| ${type} |`))).toBe(renderTransitionRow(type));
    });
  }
});

// ─── The explicit stage (spec 008, T47, ISC-120) ───────────────────────────────────────────────────────────────────
//
// Every test name here carries "explicit", so `bun test core/tests/stage.test.ts -t explicit` runs exactly them.

interface SourceGolden {
  readonly head: { readonly stage: Stage; readonly stageSource?: StageSource };
}

/** The one harbor spec whose `stage:` its last event confirms; 006's `stage: review` is contradicted by `to: build`. */
const EXPLICIT_IN_HARBOR: Readonly<Record<string, StageSource>> = { '002-web-console': 'explicit' };

describe('explicit stage (T47, ISC-120)', () => {
  const explicit = (stage: string | null, last: WorkflowStage | null, patch: Partial<StageInput> = {}): StageInput =>
    at({ explicitStage: stage, lastEventTo: last, ...patch });

  test("explicit: a row stage equal to the last event wins; command and reason stay the stage table's", () => {
    const input = explicit('build', 'build', { reviewed: 'stale' });
    expect(stageOf(input)).toBe('build');
    expect(nextCommandWithReason(input)).toEqual({
      stage: 'build',
      stageSource: 'explicit',
      command: '/spec-review 007',
      reason: 'the reviewed mark is stale',
      row: 5,
    });
  });

  test('explicit: a value the last event contradicts falls back to derived', () => {
    const got = nextCommandWithReason(explicit('review', 'build'));
    expect([got.stage, got.stageSource]).toEqual(['build', 'derived']);
  });

  test('explicit: a value without any event falls back to derived', () => {
    const got = nextCommandWithReason(explicit('code-review', null));
    expect([got.stage, got.stageSource]).toEqual(['build', 'derived']);
  });

  test('explicit: without the key the stage is derived', () => {
    expect(nextCommandWithReason(explicit(null, 'review')).stageSource).toBe('derived');
  });

  test("explicit: a value outside the type's row falls back to derived, the detours and unknown words included", () => {
    const chore: Partial<StageInput> = { type: 'chore', hasPlan: false, hasTasks: false };
    const outside: readonly WorkflowStage[] =['code-review', 'plan', 'blocked', 'close-pending', 'idea'];
    for (const stage of outside) {
      const got = nextCommandWithReason(explicit(stage, stage, chore));
      expect([stage, got.stage, got.stageSource]).toEqual([stage, 'build', 'derived']);
    }
    expect(nextCommandWithReason(explicit('shipping', 'build')).stageSource).toBe('derived');
  });

  test('explicit: the workflow passed in decides the row', () => {
    const refactor: Partial<StageInput> = { type: 'refactor', hasPlan: false };
    const narrowed = parseWorkflow('| type | stages | code_review |\n|---|---|---|\n| refactor | review · build · code-review · close · done | spec |\n');
    expect(stageOf(explicit('tasks', 'tasks', refactor))).toBe('tasks');
    expect(stageOf(explicit('tasks', 'tasks', { ...refactor, workflow: narrowed }))).toBe('build');
  });

  test('explicit: an untyped spec runs review · build · code-review · close · done', () => {
    expect(stageOf(explicit('close', 'close', { type: null }))).toBe('close');
    expect(stageOf(explicit('plan', 'plan', { type: null }))).toBe('build');
  });

  test('explicit: the harbor goldens: 002 explicit, 006 (contradicted by its last event) derived, every other spec derived', () => {
    const golden = JSON.parse(readFileSync(goldenPath('harbor', 'dashboard'), 'utf8')) as { specs: Array<{ slug: string; stage: Stage; stageSource: StageSource }> };
    const pages = JSON.parse(readFileSync(goldenPath('harbor', 'spec'), 'utf8')) as Record<string, SourceGolden>;
    expect(golden.specs.length).toBe(8); // six specs plus the F6 spike pair (T30)
    for (const row of golden.specs) {
      const want = EXPLICIT_IN_HARBOR[row.slug] ?? 'derived';
      expect([row.slug, row.stageSource]).toEqual([row.slug, want]);
      expect([row.slug, pages[`specs/${row.slug}`]?.head.stageSource]).toEqual([row.slug, want]);
    }
    expect(golden.specs.find((r) => r.slug === '006-partial-push')?.stage).toBe('review');
    expect(pages['specs/archive/001-manifest-sync']?.head.stageSource).toBe('derived');
    // The goldens are the built model, not a hand edit.
    expect(buildDashboard(readTree('harbor')).specs.map((s) => [s.slug, s.stageSource])).toEqual(golden.specs.map((r) => [r.slug, r.stageSource]));
  });

  test('explicit: every spec of every other fixture tree is derived', () => {
    for (const tree of fixtureTrees().filter((t) => t !== 'harbor')) {
      const pages = JSON.parse(readFileSync(goldenPath(tree, 'spec'), 'utf8')) as Record<string, SourceGolden>;
      for (const [folder, page] of Object.entries(pages)) expect([tree, folder, page.head.stageSource]).toEqual([tree, folder, 'derived']);
      for (const row of buildDashboard(readTree(tree)).specs) expect([tree, row.slug, row.stageSource]).toEqual([tree, row.slug, 'derived']);
    }
  });
});

// ─── Illegal transitions (spec 008, T72, ISC-31) ────────────────────────────────────────────────────────────────────
//
// Every test name here carries "illegal", so `bun test core/tests/stage.test.ts -t illegal` runs exactly them. A spec
// stands in each stage of its type's default row through an explicit `stage:` its last event confirms, and in
// `blocked` through the files (reviewed, one open claim, none takeable); `idea` and `close-pending` are no stage a
// spec under the default workflow stands in, so no pair starts there.

/** A spec of `type` standing in `from`, as SpecFiles. */
function standingIn(type: SpecType, from: WorkflowStage): SpecFiles {
  const explicit = from !== 'blocked';
  const spec = `---\nslug: 010-demo\nspec_type: ${type}\n${explicit ? `stage: ${from}\n` : ''}---\n# 010 — Demo\n`;
  const events = `{"ts":"2026-03-01T00:00:00Z","from":null,"to":"${explicit ? from : 'review'}","command":"/spec-${type} demo","actor":"u:0123abcd"}\n`;
  return { folder: '010-demo', texts: { spec, events, plan: '# Plan\n', tasks: '# Tasks\n' } };
}

describe('illegal transitions (T72, ISC-31)', () => {
  test('illegal: every forbidden pair of every type under the default workflow is refused, with a reason and no event', () => {
    let asked = 0;
    for (const type of WORKFLOW_TYPES) {
      const froms: readonly WorkflowStage[] = [...defaultWorkflowRow(type).stages, 'blocked'];
      for (const from of froms) {
        for (const to of WORKFLOW_STAGES) {
          if (TRANSITIONS[type].some((p) => p.from === from && p.to === to)) continue;
          const plan = planTransition({
            files: standingIn(type, from),
            workflow: DEFAULT_WF,
            to,
            actor: 'u:0123abcd',
            now: new Date('2026-03-10T08:00:00Z'),
            reviewed: 'fresh',
            partition: { takeable: 0, open: 1, closed: 0, dropped: 0 },
            featureSiblingsOpen: [],
          });
          expect([type, from, to, plan.ok, plan.from]).toEqual([type, from, to, false, from]);
          if (!plan.ok) expect(plan.reason.trim().length).toBeGreaterThan(0);
          expect('event' in plan || 'specText' in plan).toBe(false);
          asked += 1;
        }
      }
    }
    const expected = WORKFLOW_TYPES.reduce((n, type) => {
      const froms = [...defaultWorkflowRow(type).stages, 'blocked'];
      return n + froms.length * WORKFLOW_STAGES.length - TRANSITIONS[type].filter((p) => froms.includes(p.from)).length;
    }, 0);
    expect(asked).toBe(expected);
    expect(asked).toBeGreaterThan(400);
  });

  test('illegal: a refused move names the next command of the stage table', () => {
    const plan = planTransition({
      files: standingIn('bug', 'build'),
      workflow: DEFAULT_WF,
      to: 'review',
      actor: 'u:0123abcd',
      now: new Date('2026-03-10T08:00:00Z'),
      reviewed: 'fresh',
      partition: { takeable: 1, open: 0, closed: 0, dropped: 0 },
      featureSiblingsOpen: [],
    });
    expect(plan).toEqual({ ok: false, from: 'build', to: 'review', reason: 'the bug workflow lists no move build → review', command: '/spec-implement 010' });
  });
});

// ─── The stage-mismatch warning (spec 008, T48, ISC-120.1) ─────────────────────────────────────────────────────────
//
// Every test name here carries "mismatch", so `bun test core/tests/stage.test.ts -t mismatch` runs exactly them.

/** The `stage-mismatch` diagnostics of one spec folder in the built model. */
function mismatches(model: ReturnType<typeof buildDashboard>, folder: string) {
  return model.diagnostics.filter((d) => d.diagnostic.code === 'stage-mismatch' && d.file === `specs/${folder}/spec.md`).map((d) => d.diagnostic);
}

/** The harbor input with one folder's spec.md rewritten. */
function harborWith(folder: string, edit: (spec: string) => string): ReturnType<typeof readTree> {
  const tree = readTree('harbor');
  return { ...tree, specs: tree.specs.map((f) => (f.folder === folder ? { ...f, texts: { ...f.texts, spec: edit(f.texts.spec ?? '') } } : f)) };
}

describe('stage-mismatch (T48, ISC-120.1)', () => {
  const explicit = (stage: string | null, last: WorkflowStage | null, patch: Partial<StageInput> = {}): StageInput =>
    at({ explicitStage: stage, lastEventTo: last, ...patch });

  test('mismatch: a value outside the type row is one warning, subject the value, at the line given', () => {
    const got = stageMismatchOf(explicit('code-review', 'code-review', { type: 'chore', hasPlan: false, hasTasks: false }), 8);
    expect(got).toMatchObject({ severity: 'warning', code: 'stage-mismatch', line: 8, subject: 'code-review' });
    expect(got?.message).toContain('chore workflow (review · build · done)');
    for (const value of ['blocked', 'close-pending', 'idea', 'shipping']) {
      expect(stageMismatchOf(explicit(value, 'build'))).toMatchObject({ code: 'stage-mismatch', subject: value });
    }
  });

  test('mismatch: a value the last event contradicts, or that no event enters, is one warning, without a line when none is known', () => {
    const contradicted = stageMismatchOf(explicit('review', 'build'));
    expect(contradicted).toMatchObject({ code: 'stage-mismatch', subject: 'review' });
    expect(contradicted?.message).toContain('enters "build"');
    expect(contradicted !== null && 'line' in contradicted).toBe(false);
    expect(stageMismatchOf(explicit('review', null))).toMatchObject({ code: 'stage-mismatch', subject: 'review' });
  });

  test('mismatch: a consistent value and a missing key give none', () => {
    expect(stageMismatchOf(explicit('build', 'build'))).toBeNull();
    expect(stageMismatchOf(explicit(null, 'build'))).toBeNull();
  });

  test('mismatch: a warning exactly where a written value does not apply', () => {
    for (const input of [explicit('review', 'build'), explicit('close-pending', 'close-pending'), explicit('build', 'build'), explicit(null, null)]) {
      const applies = nextCommandWithReason(input).stageSource === 'explicit';
      expect(stageMismatchOf(input) === null).toBe(input.explicitStage === null || applies);
    }
  });

  test('mismatch: harbor 006 (stage: review, last event build) carries exactly one, at its key line; the derived stage applies', () => {
    const model = buildDashboard(readTree('harbor'));
    expect(mismatches(model, '006-partial-push')).toEqual([
      {
        severity: 'warning',
        code: 'stage-mismatch',
        message: 'stage "review" is contradicted by the last events.jsonl line, which enters "build"; the derived stage applies.',
        line: 8,
        subject: 'review',
      },
    ]);
    const row = model.specs.find((s) => s.slug === '006-partial-push');
    expect([row?.stage, row?.stageSource]).toEqual(['review', 'derived']);
    // 002's `stage: build` agrees with its last event: no warning there, nor anywhere else in harbor.
    expect(model.diagnostics.filter((d) => d.diagnostic.code === 'stage-mismatch').map((d) => d.file)).toEqual(['specs/006-partial-push/spec.md']);
  });

  test('mismatch: harbor 002 with a value outside its row carries exactly one; the derived stage applies', () => {
    const model = buildDashboard(harborWith('002-web-console', (spec) => spec.replace('stage: build', 'stage: close-pending')));
    expect(mismatches(model, '002-web-console')).toMatchObject([{ code: 'stage-mismatch', subject: 'close-pending', line: 9 }]);
    const row = model.specs.find((s) => s.slug === '002-web-console');
    expect([row?.stage, row?.stageSource]).toEqual(['build', 'derived']);
  });
});

// ─── close-pending (spec 008, T49, ISC-122.2) ──────────────────────────────────────────────────────────────────────
//
// Every test name here carries "close-pending", so `bun test core/tests/stage.test.ts -t "close-pending"` runs them.

describe('close-pending (T49, ISC-122.2)', () => {
  const pending = (patch: Partial<StageInput>): StageInput => at({ ...ALL_CLOSED, codeReview: 'feature', mainFeature: 'F6', ...patch });

  test('close-pending: every claim closed, code_review feature, a sibling open; no command, the siblings named', () => {
    expect(nextCommandWithReason(pending({ featureSiblingsOpen: ['009'] }))).toEqual({
      stage: 'close-pending',
      stageSource: 'derived',
      command: null,
      reason: 'every claim is closed and F6 waits on spec 009',
      row: 8,
    });
    expect(nextCommandWithReason(pending({ featureSiblingsOpen: ['005', '006'] })).reason).toBe('every claim is closed and F6 waits on specs 005 and 006');
    expect(nextCommandWithReason(pending({ featureSiblingsOpen: ['005', '006', '010', '011'] })).reason).toBe(
      'every claim is closed and F6 waits on specs 005, 006 and 2 more',
    );
  });

  test('close-pending needs all three: without an open sibling, code_review feature or every claim closed the row does not match', () => {
    expect(stageOf(pending({ featureSiblingsOpen: [] }))).toBe('code-review');
    expect(stageOf(pending({ featureSiblingsOpen: ['009'], codeReview: 'spec' }))).toBe('code-review');
    expect(stageOf(at({ codeReview: 'feature', featureSiblingsOpen: ['009'] }))).toBe('build');
    // The chore row comes first.
    expect(stageOf(pending({ type: 'chore', hasPlan: false, hasTasks: false, featureSiblingsOpen: ['009'] }))).toBe('done');
  });

  test('close-pending on harbor: 008 waits on 009 with no command and no closed warning; 009 builds', () => {
    const model = buildDashboard(readTree('harbor'));
    const row = model.specs.find((s) => s.slug === '008-referrers-support');
    expect([row?.stage, row?.stageSource, row?.nextCommand, row?.nextReason]).toEqual(['close-pending', 'derived', null, 'every claim is closed and F6 waits on spec 009']);
    expect(row?.warnings.map((w) => w.kind)).toEqual([]);
    expect(model.specs.find((s) => s.slug === '009-chunked-upload-limits')?.stage).toBe('build');
    expect(model.stageCounts['close-pending']).toBe(1);
    const page = specPages('harbor')['specs/008-referrers-support'];
    expect([page?.head.stage, page?.next.command, page?.next.reasons[0]]).toEqual(['close-pending', null, 'every claim is closed and F6 waits on spec 009']);
  });

  test('close-pending on harbor: once 009 closes its last claim, both go to code-review', () => {
    const model = buildDashboard(harborWith('009-chunked-upload-limits', (spec) => spec.replace('- [ ] ISC-131', '- [x] ISC-131')));
    const pair = model.specs.filter((s) => s.slug.startsWith('008') || s.slug.startsWith('009')).map((s) => [s.slug, s.stage]);
    expect(pair.sort()).toEqual([
      ['008-referrers-support', 'code-review'],
      ['009-chunked-upload-limits', 'code-review'],
    ]);
  });

  test('close-pending on harbor: a sibling at phase complete holds nothing back', () => {
    const model = buildDashboard(harborWith('009-chunked-upload-limits', (spec) => spec.replace('phase: building', 'phase: complete')));
    expect(model.specs.find((s) => s.slug === '008-referrers-support')?.stage).toBe('code-review');
  });

  test('close-pending on harbor: under the default workflow 008 is an ordinary closed spike', () => {
    const tree = readTree('harbor');
    const row = buildDashboard({ ...tree, workflow: parseWorkflow(null) }).specs.find((s) => s.slug === '008-referrers-support');
    expect([row?.stage, row?.nextCommand]).toEqual(['code-review', '/spec-code-review 008']);
  });
});

// ─── The chore's done on harbor (spec 008, T50, ISC-117.1) ─────────────────────────────────────────────────────────

describe('chore done on harbor (T50, ISC-117.1)', () => {
  const FOLDER = '007-rotate-mirror-token';

  test('chore done: harbor 007, reviewed with every claim closed, is done without a code-reviewed mark or phase complete', () => {
    const files = readTree('harbor').specs.find((f) => f.folder === FOLDER);
    expect(files?.texts.gateReviewed).toBeDefined();
    expect(files?.texts.gateCodeReviewed).toBeUndefined();
    expect(parseFrontmatter(files?.texts.spec ?? '').data.phase).toBe('building');
    const row = buildDashboard(readTree('harbor')).specs.find((s) => s.slug === FOLDER);
    expect([row?.stage, row?.nextCommand, row?.nextReason, row?.gates.reviewed.state]).toEqual(['done', null, 'every claim of the chore is closed', 'fresh']);
  });

  test('chore done: no "every claim closed, phase not complete" warning on harbor 007', () => {
    const row = buildDashboard(readTree('harbor')).specs.find((s) => s.slug === FOLDER);
    expect(row?.warnings).toEqual([]);
  });

  test('chore done: the derived timeline steps review → build → done for harbor 007', () => {
    const files = readTree('harbor').specs.find((f) => f.folder === FOLDER);
    if (!files) throw new Error('harbor 007 missing');
    expect(deriveStages(files).map((e) => [e.from, e.to, e.ts])).toEqual([
      [null, 'review', '2026-03-09T08:30:00Z'],
      ['review', 'build', '2026-03-09T09:00:00Z'],
      ['build', 'done', ''],
    ]);
  });
});

// ─── The derived timeline under `code_review: none` (spec 028, ISC-183.2) ─────────────────────────────────────────

describe('none timeline (ISC-183.2)', () => {
  // Harbor 008: a spike, reviewed, every claim closed, no code-reviewed mark.
  const harbor008 = (): SpecFiles => {
    const files = readTree('harbor').specs.find((f) => f.folder === '008-referrers-support');
    if (!files) throw new Error('harbor 008 missing');
    return files;
  };
  const mark = readFileSync(join(FIXTURES, 'harbor', 'specs', '004-retention-policies', '.gates', 'code-reviewed.json'), 'utf8');
  const steps = (files: SpecFiles, mode?: CodeReviewMode): Array<[string | null | undefined, string | undefined, string]> =>
    deriveStages(files, undefined, mode).map((e) => [e.from, e.to, e.ts]);

  test('none timeline: every claim closed steps build → close, undated, and no code-review entry', () => {
    expect(steps(harbor008(), 'none')).toEqual([
      [null, 'review', '2026-03-08T13:00:00Z'],
      ['review', 'build', '2026-03-08T14:00:00Z'],
      ['build', 'close', ''],
    ]);
  });

  test('none timeline: a voluntary code-reviewed mark adds no code-review step', () => {
    const files = harbor008();
    const marked: SpecFiles = { ...files, texts: { ...files.texts, gateCodeReviewed: mark } };
    expect(steps(marked, 'none')).toEqual(steps(files, 'none'));
  });

  test('none timeline: without the mode, or under spec, the timeline is what it was', () => {
    const files = harbor008();
    expect(steps(files)).toEqual(steps(files, 'spec'));
    expect(steps(files).map(([, to]) => to)).toEqual(['review', 'build']);
  });
});
