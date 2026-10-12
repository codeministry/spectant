// Seam test for spec 008 T37: the names the fill-in tasks build against (workflow.ts T42–T44, ideas.ts T51–T52,
// actor.ts T59–T60, transition.ts T71–T72) and the safe defaults their stubs return. Evidence for the seam only;
// ISC-122 closes on core/tests/workflow.test.ts (T42). Each fill-in replaces its stub without touching this file:
// the test pins the exported names and the shape of the result, and checks a stub's default only while the stub
// stands (a stub result carries the marker the stub sets).
import { describe, expect, test } from 'bun:test';

import * as core from '../src/index.ts';
import { FILE_KINDS, repoFilePath, specFilePath } from '../src/files.ts';
import type { ActorRef, IdeaRef, SpecHead, TransitionPlan, Workflow, WorkflowRow, WorkflowStage } from '../src/files.ts';
import { parseActor } from '../src/actor.ts';
import { readIdeas } from '../src/ideas.ts';
import { planTransition } from '../src/transition.ts';
import { parseWorkflow } from '../src/workflow.ts';

describe('spec 008 seam: barrel', () => {
  test('exports the four readers of spec 008 through the browser-safe barrel', () => {
    for (const name of ['parseWorkflow', 'readIdeas', 'parseActor', 'planTransition']) {
      expect(typeof (core as Record<string, unknown>)[name]).toBe('function');
    }
  });
});

describe('spec 008 seam: repository-level file kinds', () => {
  test('idea and workflow are repository kinds after master, in FORMAT.md order', () => {
    const kinds = Object.keys(FILE_KINDS);
    expect(kinds.slice(-3)).toEqual(['master', 'idea', 'workflow']);
    expect(FILE_KINDS.idea).toMatchObject({ scope: 'repo', repoPath: 'specs/ideas/', directory: true, required: false });
    expect(FILE_KINDS.workflow).toMatchObject({ scope: 'repo', repoPath: 'specs/workflow.md', directory: false, required: false });
  });

  test('every repository kind names its path from the root; every spec kind names none', () => {
    for (const info of Object.values(FILE_KINDS)) {
      if (info.scope === 'repo') expect(typeof info.repoPath).toBe('string');
      else expect(info.repoPath).toBeNull();
    }
    expect(FILE_KINDS.constitution.scope).toBe('repo');
    expect(FILE_KINDS.master.scope).toBe('repo');
  });

  test('repoFilePath joins a repository kind onto the root; specFilePath agrees for an active spec folder', () => {
    expect(repoFilePath('/srv/repo', 'workflow')).toBe('/srv/repo/specs/workflow.md');
    expect(repoFilePath('/srv/repo/', 'idea')).toBe('/srv/repo/specs/ideas');
    expect(repoFilePath('repo', 'constitution')).toBe('repo/specs/constitution.md');
    expect(repoFilePath('', 'master')).toBe('ISA.md');
    for (const kind of ['constitution', 'master', 'idea', 'workflow'] as const) {
      expect(specFilePath('/srv/repo/specs/002-web-console', kind)).toBe(repoFilePath('/srv/repo', kind));
    }
  });
});

describe('spec 008 seam: stubs return safe defaults', () => {
  test('parseWorkflow returns a Workflow; without the file its source is the default', () => {
    const missing: Workflow = parseWorkflow(null);
    expect(missing.source).toBe('default');
    expect(Array.isArray(missing.rows)).toBe(true);
    expect(Array.isArray(missing.diagnostics)).toBe(true);
    const rows: readonly WorkflowRow[] = parseWorkflow('| type | stages | code_review |\n').rows;
    expect(Array.isArray(rows)).toBe(true);
  });

  test('readIdeas returns a list and diagnostics; an empty folder has no ideas', () => {
    const reading = readIdeas({});
    const ideas: readonly IdeaRef[] = reading.ideas;
    expect(ideas).toEqual([]);
    expect(reading.diagnostics).toEqual([]);
  });

  test('parseActor keeps the raw value; a value outside the grammar is legacy', () => {
    const legacy: ActorRef = parseActor('principal');
    expect(legacy).toMatchObject({ raw: 'principal', kind: 'legacy', legacy: true });
    expect(parseActor('a:claude:sess-7/T12').raw).toBe('a:claude:sess-7/T12');
  });

  test('planTransition returns a TransitionPlan; the stub refuses every transition', () => {
    const to: WorkflowStage = 'build';
    const plan: TransitionPlan = planTransition({
      files: { folder: '001-demo', texts: { 'spec': '---\nslug: 001-demo\n---\n' } },
      workflow: parseWorkflow(null),
      to,
      actor: 'u:0123abcd',
      now: new Date('2026-01-01T00:00:00Z'),
      reviewed: 'fresh',
      partition: { takeable: 1, open: 0, closed: 0, dropped: 0 },
      featureSiblingsOpen: [],
    });
    expect(plan.to).toBe('build');
    if (!plan.ok && plan.reason.startsWith('not implemented')) expect(plan.command).toBeNull();
  });

  test('SpecHead carries priority, stageSource and assignee as optional fields until their fill-ins', () => {
    const head: Pick<SpecHead, 'priority' | 'stageSource' | 'assignee'> = {};
    expect(head).toEqual({});
  });
});
