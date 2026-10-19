// The step timeline per task (spec 015, ISC-231): `taskSteps` over a spec folder and the tree's lock reading gives each
// task of the spec its run events, its step events and the release of its claim, in time order. harbor carries two
// tasks with every run and step kind (T26, T28), two released claims (T4, T25) and one question without a claim, which
// only its spec session assigns to spec 002 (ISC-213).
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { SpecFiles, TaskStep } from '../src/files.ts';
import { activityReading, readLockSources } from '../src/locks.ts';
import { taskSteps } from '../src/steps.ts';
import { expectGolden, goldenPath, goldenText } from './helpers/golden.ts';
import { FIXTURES, fixtureTrees, folders } from './helpers/read-tree.ts';
import { stepsModel } from './helpers/steps-model.ts';

const HARBOR = join(FIXTURES, 'harbor');
const harbor = stepsModel(HARBOR, await readLockSources({ repoRoot: HARBOR }));
const web = harbor['specs/002-web-console'] ?? {};
const kinds = (steps: readonly TaskStep[] | undefined): string[] => (steps ?? []).map((s) => (s.kind === 'probe' ? `probe ${s.result ?? '?'}` : s.kind));

const specFolder = (name: string): SpecFiles => {
  const files = folders(join(HARBOR, 'specs')).find((f) => f.folder === name);
  if (files === undefined) throw new Error(`no folder ${name}`);
  return files;
};
const WEB = specFolder('002-web-console');
const RETENTION = specFolder('004-retention-policies');
const line = (fields: Record<string, string>): string => JSON.stringify({ ts: '2026-03-08T16:00:00Z', ...fields });

describe('taskSteps (ISC-231)', () => {
  test("harbor's timeline equals harbor.steps.golden.json", () => {
    expectGolden(goldenPath('harbor', 'steps'), goldenText(harbor), 'bun test core/tests/golden.test.ts');
  });

  test('every timeline of every fixture is in time order, steps logged out of order included', async () => {
    const timelines: Array<readonly TaskStep[]> = [];
    for (const tree of fixtureTrees()) {
      const root = join(FIXTURES, tree);
      timelines.push(...Object.values(stepsModel(root, await readLockSources({ repoRoot: root }))).flatMap((spec) => Object.values(spec)));
    }
    const late = [
      line({ ts: '2026-03-08T16:20:00Z', event: 'apply', claim: 'ISC-73', task: 'T26', session: 'a:claude:sess-2/T26', worktree: 'wt-8' }),
      line({ ts: '2026-03-08T16:05:00Z', event: 'probe', claim: 'ISC-73', task: 'T26', result: 'green', session: 'a:claude:sess-2/T26' }),
    ].join('\n');
    const reordered = taskSteps(activityReading(late), WEB).T26 ?? [];
    expect(kinds(reordered)).toEqual(['probe green', 'apply']);
    timelines.push(reordered);
    expect(timelines.length).toBeGreaterThan(4);
    for (const steps of timelines) {
      const times = steps.map((s) => Date.parse(s.ts));
      expect(times).toEqual([...times].sort((a, b) => a - b));
    }
  });

  test('a task with every kind reads dispatched, started, red, asked, green, patched, applied', () => {
    expect(kinds(web.T26)).toEqual(['dispatch', 'build', 'probe red', 'question', 'probe green', 'patch', 'apply']);
    expect(kinds(web.T28)).toEqual(['dispatch', 'build', 'probe red', 'question', 'probe green', 'patch', 'apply']);
    // `build` is the step a reader names "started": no kind of its own, and an unknown event (`ponder`) is no step.
    const all = Object.values(harbor).flatMap((spec) => Object.values(spec).flat());
    expect([...new Set(all.map((s) => s.kind))].sort()).toEqual(['apply', 'build', 'dispatch', 'patch', 'probe', 'question', 'release']);
    expect(web.T26?.[3]).toEqual({ kind: 'question', ts: '2026-03-08T16:02:00Z', actor: 'a:claude:sess-2/T26', text: 'Should the focus ring follow the theme accent or stay neutral?' });
  });

  test("the release of the task's claim reads as released; a held claim has no step", () => {
    expect(web.T4).toEqual([{ kind: 'release', ts: '2026-03-06T09:58:00Z', actor: 'a:claude:sess-2/T4' }]);
    // ISC-72's release names no task: it counts for the task whose claim it is.
    expect(web.T25).toEqual([{ kind: 'release', ts: '2026-03-08T15:52:00Z', actor: 'a:claude:sess-2' }]);
    // T27 holds ISC-74 without a release: a claim line is no step.
    expect(web.T27).toBeUndefined();
    // Another spec's T4, T25, T26 and T28 carry other claims: nothing of 002 reaches them.
    expect(harbor['specs/004-retention-policies']).toEqual({});
    expect(harbor['specs/archive/001-manifest-sync']).toEqual({});
  });

  test('a release that freed nothing is no step: unclaimed, or by a session that does not hold the claim', () => {
    const log = [
      line({ event: 'release', claim: 'ISC-53', session: 'a:claude:sess-9' }),
      line({ event: 'claim', claim: 'ISC-72', session: 'a:claude:sess-1' }),
      line({ event: 'release', claim: 'ISC-72', session: 'a:claude:sess-9' }),
    ].join('\n');
    expect(taskSteps(activityReading(log), WEB)).toEqual({});
    expect(activityReading(log).releases).toBeUndefined();
    expect(activityReading('').releases).toBeUndefined();
  });

  test('a question without a claim is assigned to its spec through runSpecOf (ISC-213)', () => {
    // harbor's T28 question names no claim; its session ref a:claude:spec-002/T28 puts it on 002 only.
    expect(web.T28?.find((s) => s.kind === 'question')?.actor).toBe('a:claude:spec-002/T28');
    const asked = (fields: Record<string, string>) => activityReading(line({ event: 'question', task: 'T28', text: 'Which way?', ...fields }));
    const bySession = asked({ session: 'a:claude:spec-004/T28' });
    expect(taskSteps(bySession, WEB)).toEqual({});
    expect(kinds(taskSteps(bySession, RETENTION).T28)).toEqual(['question']);
    const byWorktree = asked({ session: 'a:claude:sess-3/T28', worktree: '.worktrees/002-web-console' });
    expect(taskSteps(byWorktree, WEB).T28).toEqual([{ kind: 'question', ts: '2026-03-08T16:00:00Z', actor: 'a:claude:sess-3/T28', text: 'Which way?' }]);
    expect(taskSteps(byWorktree, RETENTION)).toEqual({});
    // Naming neither, it counts for no spec.
    const nowhere = asked({ session: 'a:claude:sess-3/T28' });
    expect([taskSteps(nowhere, WEB), taskSteps(nowhere, RETENTION)]).toEqual([{}, {}]);
    // With a claim, only the task whose claim it is takes it.
    const claimed = asked({ session: 'a:claude:sess-3/T28', claim: 'ISC-122' });
    expect([taskSteps(claimed, WEB), kinds(taskSteps(claimed, RETENTION).T28)]).toEqual([{}, ['question']]);
  });
});
