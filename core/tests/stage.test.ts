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
import { parseFrontmatter } from '../src/frontmatter.ts';
import type { MarkState } from '../src/gates.ts';
import {
  STAGE_RULES,
  TYPE_NEEDS,
  fillReason,
  nextCommand,
  nextCommandWithReason,
  stageOf,
  type ClaimCounts,
  type Stage,
  type StageInput,
  type StageRule,
} from '../src/stage.ts';
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
    expect(CASES.length).toBe(12);
  });

  test('leadgen 012 names its takeable claim as the reason', () => {
    const { input } = specInput('leadgen/specs/012-pwa-install', { reviewed: fresh, codeReviewed: missing });
    expect(nextCommandWithReason(input)).toEqual({
      stage: 'build',
      command: '/spec-implement 012',
      reason: 'ISC-334 is takeable',
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
  test('eight rows in table order, each with its command', () => {
    expect(STAGE_RULES.map((r) => [r.stage, r.next])).toEqual([
      ['done', null],
      ['plan', '/spec-plan'],
      ['tasks', '/spec-tasks'],
      ['review', '/spec-review'],
      ['build', '/spec-implement'],
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
    });
  });

  test('stageOf is the first rule that matches, nextCommand its command with the number', () => {
    const input = at({});
    const first = STAGE_RULES.find((r) => r.when(input));
    expect(first?.stage).toBe(stageOf(input));
    expect(nextCommand(input)).toBe(`${first?.next ?? ''} 007`);
  });
});

describe('one synthetic case per row', () => {
  const rows: ReadonlyArray<[string, StageInput, Stage, string | null]> = [
    ['done: phase complete', at({ phase: 'complete' }), 'done', null],
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
      expect(namesReason(ruleFor(got.stage), got.reason)).toBe(true);
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

/** A rule as the markdown row FORMAT.md must hold for it. */
function renderRow(rule: StageRule, index: number): string {
  const next = rule.next === null ? '—' : code(`${rule.next} NNN`);
  return `| ${index + 1} | ${code(rule.stage)} | ${rule.condition} | ${next} | ${rule.reasons.map(code).join(' or ')} |`;
}

const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `reason` is one of the rule's templates with every `{placeholder}` filled by some non-empty text. */
function namesReason(rule: StageRule, reason: string): boolean {
  return rule.reasons.some((template) => new RegExp(`^${template.split(/\{[a-zA-Z]+\}/).map(escapeRe).join('.+')}$`).test(reason));
}

function ruleFor(stage: Stage): StageRule {
  const rule = STAGE_RULES.find((r) => r.stage === stage);
  if (!rule) throw new Error(`no stage row for ${stage}`);
  return rule;
}

describe('FORMAT.md holds STAGE_RULES verbatim', () => {
  const table = formatStageTable();

  test('the header names the five columns', () => {
    expect(table.slice(0, 2)).toEqual(TABLE_HEAD);
  });

  test('one markdown row per rule, no more, no fewer', () => {
    expect(table.length - TABLE_HEAD.length).toBe(STAGE_RULES.length);
  });

  STAGE_RULES.forEach((rule, i) => {
    test(`row ${i + 1}: ${rule.stage}`, () => {
      expect(table[i + TABLE_HEAD.length]).toBe(renderRow(rule, i));
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
  'spectant-001': [['specs/001-app-skeleton', 'review', '/spec-review 001', 'the reviewed mark is missing']],
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
  const rule = ruleFor(stage);
  const number = (folder.split('/').pop() ?? '').slice(0, 3);
  expect(command).toBe(rule.next === null ? null : `${rule.next} ${number}`);
  expect(namesReason(rule, reason)).toBe(true);
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
    expect(compared).toBe(12);
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
