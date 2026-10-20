// The workflow reader (spec 008 T42, ISC-122): `parseWorkflow` turns `specs/workflow.md` into one row per spec type,
// the file's rows where it has them and the default row elsewhere, and reports what it cannot use as `workflow-…`
// diagnostics without failing the file. The fixed gates (T43, ISC-122.1) are the `workflow-gate` block at the end;
// `bun test core/tests/workflow.test.ts -t gate` runs it alone.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SpecType, Workflow, WorkflowRow } from '../src/files.ts';
import { STAGE_RULES, TYPE_NEEDS, WORKFLOW_STAGES } from '../src/stage.ts';
import { DEFAULT_WORKFLOW, WORKFLOW_TYPES, boardStages, defaultWorkflowRow, parseWorkflow } from '../src/workflow.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const HARBOR = readFileSync(join(FIXTURES, 'harbor', 'specs', 'workflow.md'), 'utf8');

const HEAD = '| type | stages | code_review |\n|------|--------|-------------|\n';
const rowOf = (rows: readonly WorkflowRow[], type: SpecType): WorkflowRow | undefined => rows.find((r) => r.type === type);
const codes = (text: string): string[] => parseWorkflow(text).diagnostics.map((d) => d.code);

describe('parseWorkflow: the default table', () => {
  test('without the file every type runs its default row and the source is default', () => {
    const workflow = parseWorkflow(null);
    expect(workflow.source).toBe('default');
    expect(workflow.diagnostics).toEqual([]);
    expect(workflow.rows).toEqual(DEFAULT_WORKFLOW);
    expect(workflow.rows.map((r) => r.type)).toEqual([...WORKFLOW_TYPES]);
  });

  test('the row order covers every spec type exactly once', () => {
    expect(Object.keys(TYPE_NEEDS).sort()).toEqual([...WORKFLOW_TYPES].sort());
  });

  test('each default row is the stage table in its order, narrowed by TYPE_NEEDS and the code review', () => {
    const tableOrder = [...new Set(STAGE_RULES.map((r) => r.stage))].filter((s) => s !== 'blocked');
    for (const row of DEFAULT_WORKFLOW) {
      const needs = TYPE_NEEDS[row.type];
      expect(row.codeReview).toBe(row.type === 'chore' ? 'none' : 'spec');
      // done is reached last, every other stage keeps its stage-table order
      expect(row.stages.at(-1)).toBe('done');
      const body = row.stages.slice(0, -1);
      expect(body).toEqual(tableOrder.filter((s) => body.includes(s)));
      expect(row.stages.includes('plan')).toBe(needs.plan);
      expect(row.stages.includes('tasks')).toBe(needs.tasks);
      for (const stage of ['review', 'build', 'done'] as const) expect(row.stages).toContain(stage);
      const reviewed = row.codeReview !== 'none';
      expect(row.stages.includes('code-review')).toBe(reviewed);
      expect(row.stages.includes('close')).toBe(reviewed);
      expect(defaultWorkflowRow(row.type)).toEqual(row);
    }
  });

  test('FORMAT.md shows the same default table the code applies', () => {
    const format = readFileSync(join(import.meta.dir, '..', '..', 'FORMAT.md'), 'utf8');
    const start = format.indexOf('**The default**');
    const end = format.indexOf('**Two gates are fixed', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const documented = parseWorkflow(format.slice(start, end));
    expect(documented.diagnostics).toEqual([]);
    expect(documented.rows).toEqual(DEFAULT_WORKFLOW);
  });

  test('the lantern fixture has no workflow file, so it runs the default', () => {
    const path = join(FIXTURES, 'lantern', 'specs', 'workflow.md');
    expect(existsSync(path)).toBe(false);
    expect(parseWorkflow(existsSync(path) ? readFileSync(path, 'utf8') : null)).toEqual({ rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] });
  });
});

describe('parseWorkflow: the harbor file', () => {
  const workflow = parseWorkflow(HARBOR);

  test('parses cleanly from the file', () => {
    expect(workflow.source).toBe('file');
    expect(workflow.diagnostics).toEqual([]);
    expect(workflow.rows.map((r) => r.type)).toEqual([...WORKFLOW_TYPES]);
  });

  test('feature keeps its deviating order: review before tasks', () => {
    expect(rowOf(workflow.rows, 'feature')).toEqual({
      type: 'feature',
      stages: ['plan', 'review', 'tasks', 'build', 'code-review', 'close', 'done'],
      codeReview: 'spec',
    });
    expect(rowOf(workflow.rows, 'feature')).not.toEqual(defaultWorkflowRow('feature'));
  });

  test('spike reviews per feature; every other type matches its default row', () => {
    expect(rowOf(workflow.rows, 'spike')).toEqual({ ...defaultWorkflowRow('spike'), codeReview: 'feature' });
    for (const type of WORKFLOW_TYPES.filter((t) => t !== 'feature' && t !== 'spike')) {
      expect(rowOf(workflow.rows, type)).toEqual(defaultWorkflowRow(type));
    }
  });
});

describe('parseWorkflow: partial files and diagnostics', () => {
  test('a type the file leaves out runs its default row, in the fixed row order', () => {
    const workflow = parseWorkflow(`# Workflow\n\n${HEAD}| chore | review · build · done | none |\n| bug | review · build · done | none |\n`);
    expect(workflow.diagnostics).toEqual([]);
    expect(workflow.rows.map((r) => r.type)).toEqual([...WORKFLOW_TYPES]);
    expect(rowOf(workflow.rows, 'bug')).toEqual({ type: 'bug', stages: ['review', 'build', 'done'], codeReview: 'none' });
    expect(rowOf(workflow.rows, 'feature')).toEqual(defaultWorkflowRow('feature'));
  });

  test('cells may carry backticks and the header any case', () => {
    const workflow = parseWorkflow('| Type | Stages | Code_Review |\n|---|---|---|\n| `bug` | `review` · `build` · `done` | `none` |\n');
    expect(workflow.diagnostics).toEqual([]);
    expect(rowOf(workflow.rows, 'bug')).toEqual({ type: 'bug', stages: ['review', 'build', 'done'], codeReview: 'none' });
  });

  test('an unknown type is workflow-type; the row is dropped and the rest still parses', () => {
    const workflow = parseWorkflow(`${HEAD}| epic | review · build · done | spec |\n| bug | review · build · done | none |\n`);
    expect(workflow.diagnostics).toEqual([expect.objectContaining({ code: 'workflow-type', line: 3, subject: 'epic', severity: 'warning' })]);
    expect(rowOf(workflow.rows, 'bug')?.codeReview).toBe('none');
    expect(workflow.rows).toHaveLength(WORKFLOW_TYPES.length);
  });

  test('a code_review outside spec | feature | none is workflow-code-review; that type runs its default', () => {
    const workflow = parseWorkflow(`${HEAD}| bug | review · build · done | always |\n`);
    expect(workflow.diagnostics).toEqual([expect.objectContaining({ code: 'workflow-code-review', line: 3, subject: 'always' })]);
    expect(rowOf(workflow.rows, 'bug')).toEqual(defaultWorkflowRow('bug'));
  });

  test('a duplicated type is workflow-duplicate on every later row; that type runs its default', () => {
    const workflow = parseWorkflow(`${HEAD}| bug | review · build · done | none |\n| infra | review · build · done | spec |\n| bug | build · review · done | spec |\n`);
    expect(workflow.diagnostics).toEqual([expect.objectContaining({ code: 'workflow-duplicate', line: 5, subject: 'bug' })]);
    expect(rowOf(workflow.rows, 'bug')).toEqual(defaultWorkflowRow('bug'));
    expect(rowOf(workflow.rows, 'infra')?.stages).toEqual(['review', 'build', 'done']);
  });

  test('a file without the table is workflow-table and runs the default table, still from the file', () => {
    const workflow = parseWorkflow('# Workflow\n\nEvery type runs the default.\n');
    expect(workflow.source).toBe('file');
    expect(workflow.diagnostics.map((d) => d.code)).toEqual(['workflow-table']);
    expect(workflow.rows).toEqual(DEFAULT_WORKFLOW);
  });

  test('a table inside a fence is not the workflow table', () => {
    expect(codes(`\`\`\`markdown\n${HEAD}| bug | review · build · done | none |\n\`\`\`\n`)).toEqual(['workflow-table']);
  });

  test('a header without its separator row is a malformed table: workflow-table', () => {
    const workflow = parseWorkflow('| type | stages | code_review |\n| bug | review · build · done | none |\n');
    expect(workflow.diagnostics).toEqual([expect.objectContaining({ code: 'workflow-table', line: 1 })]);
    expect(workflow.rows).toEqual(DEFAULT_WORKFLOW);
  });

  test('a row with the wrong number of cells or an empty stage is workflow-row; that row is dropped', () => {
    const workflow = parseWorkflow(`${HEAD}| bug | review · build · done |\n| spike | review ·  · done | spec |\n| chore | | none |\n| infra | review · build · done | none |\n`);
    expect(workflow.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['workflow-row', 3],
      ['workflow-row', 4],
      ['workflow-row', 5],
    ]);
    for (const type of ['bug', 'spike', 'chore'] as const) expect(rowOf(workflow.rows, type)).toEqual(defaultWorkflowRow(type));
    expect(rowOf(workflow.rows, 'infra')?.codeReview).toBe('none');
  });

  test('CRLF line endings parse like LF', () => {
    expect(parseWorkflow(HARBOR.replace(/\n/g, '\r\n'))).toEqual(parseWorkflow(HARBOR));
  });
});

describe('parseWorkflow: the fixed gates (workflow-gate, T43)', () => {
  /** One row of `bug` between two clean rows: the broken row is line 4. */
  const broken = (stages: string): string =>
    `${HEAD}| chore | review · build · done | none |\n| bug | ${stages} | spec |\n| infra | plan · review · build · done | none |\n`;

  const expectOneGate = (stages: string): void => {
    const workflow = parseWorkflow(broken(stages));
    expect(workflow.source).toBe('file');
    expect(workflow.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'workflow-gate', line: 4, subject: 'bug' })]);
    expect(rowOf(workflow.rows, 'bug')).toEqual(defaultWorkflowRow('bug'));
    // the file still parses: the clean rows around the broken one are taken from it
    expect(rowOf(workflow.rows, 'chore')).toEqual({ type: 'chore', stages: ['review', 'build', 'done'], codeReview: 'none' });
    expect(rowOf(workflow.rows, 'infra')).toEqual({ type: 'infra', stages: ['plan', 'review', 'build', 'done'], codeReview: 'none' });
  };

  test.each([
    ['review left out', 'build · code-review · close · done'],
    ['review only after build', 'build · review · code-review · close · done'],
  ])('gate: review must come before build (%s)', (_name, stages) => expectOneGate(stages));

  test.each([
    ['done left out', 'review · build · code-review · close'],
    ['done not last', 'review · build · done · code-review · close'],
  ])('gate: done must be the last stage (%s)', (_name, stages) => expectOneGate(stages));

  test.each([
    ['build left out', 'review · code-review · close · done'],
    ['review and build swapped', 'build · review · done'],
    ['done first', 'done · review · build'],
    ['a fixed gate listed twice', 'review · build · review · done'],
  ])('gate: no fixed gate is reordered or left out (%s)', (_name, stages) => expectOneGate(stages));

  test.each([
    ['a name core does not know', 'review · build · deploy · done'],
    ['the blocked detour', 'review · build · blocked · done'],
    ['the close-pending detour', 'review · build · close-pending · close · done'],
  ])('gate: a stage outside the row stages is a gate violation (%s)', (_name, stages) => expectOneGate(stages));

  test('gate: the message names the type, the fixed gate it moves and the default it falls back to', () => {
    const [diagnostic] = parseWorkflow(broken('build · review · done')).diagnostics;
    expect(diagnostic?.message).toContain('type bug');
    expect(diagnostic?.message).toContain('review');
    expect(diagnostic?.message).toContain('default row');
  });

  test('gate: optional stages may be narrowed or reordered around the fixed gates', () => {
    const workflow = parseWorkflow(`${HEAD}| feature | review · plan · build · tasks · close · code-review · done | spec |\n| bug | review · build · done | spec |\n`);
    expect(workflow.diagnostics).toEqual([]);
    expect(rowOf(workflow.rows, 'feature')?.stages).toEqual(['review', 'plan', 'build', 'tasks', 'close', 'code-review', 'done']);
  });

  test('gate: two broken rows are one workflow-gate each', () => {
    const workflow = parseWorkflow(`${HEAD}| bug | build · review · done | spec |\n| spike | review · build | spec |\n`);
    expect(workflow.diagnostics.map((d) => [d.code, d.line, d.subject])).toEqual([
      ['workflow-gate', 3, 'bug'],
      ['workflow-gate', 4, 'spike'],
    ]);
  });

  test('gate: the harbor workflow keeps every fixed gate, zero workflow-gate', () => {
    expect(codes(HARBOR).filter((c) => c === 'workflow-gate')).toEqual([]);
  });

  test('gate: every default row passes its own gate check', () => {
    const table = DEFAULT_WORKFLOW.map((r) => `| ${r.type} | ${r.stages.join(' · ')} | ${r.codeReview} |`).join('\n');
    expect(parseWorkflow(`${HEAD}${table}\n`)).toEqual({ rows: DEFAULT_WORKFLOW, source: 'file', diagnostics: [] });
  });
});

// The board's columns (T44, ISC-129): the union of every type's stages in table order, the two detours right after
// `build`, the story stage `idea` first. `bun test core/tests/workflow.test.ts -t boardStages` runs this block alone.
describe('boardStages: the columns of the board', () => {
  test('boardStages: the default table gives idea, the stage table order, and both detours after build', () => {
    expect(boardStages(parseWorkflow(null))).toEqual(['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done']);
  });

  test("boardStages: harbor reviews a feature before its tasks, so review precedes tasks on its board", () => {
    expect(rowOf(parseWorkflow(HARBOR).rows, 'feature')?.stages.slice(0, 3)).toEqual(['plan', 'review', 'tasks']);
    expect(boardStages(parseWorkflow(HARBOR))).toEqual(['idea', 'plan', 'review', 'tasks', 'build', 'blocked', 'close-pending', 'code-review', 'close', 'done']);
  });

  test('boardStages: a table of one type holds its row, idea first and both detours, nothing else', () => {
    const chore: Workflow = { rows: [defaultWorkflowRow('chore')], source: 'file', diagnostics: [] };
    expect(boardStages(chore)).toEqual(['idea', 'review', 'build', 'blocked', 'close-pending', 'done']);
  });

  test('boardStages: a stage only a later row lists sits before its successor in that row, done stays last', () => {
    const rows: WorkflowRow[] = [
      { type: 'infra', stages: ['plan', 'review', 'build', 'done'], codeReview: 'none' },
      { type: 'refactor', stages: ['tasks', 'review', 'build', 'code-review', 'done'], codeReview: 'spec' },
    ];
    expect(boardStages({ rows, source: 'file', diagnostics: [] })).toEqual(['idea', 'plan', 'tasks', 'review', 'build', 'blocked', 'close-pending', 'code-review', 'done']);
  });

  test('boardStages: each stage once, and the default board holds every WorkflowStage', () => {
    const board = boardStages(parseWorkflow(null));
    expect(new Set(board).size).toBe(board.length);
    expect([...board].sort()).toEqual([...WORKFLOW_STAGES].sort());
  });
});
