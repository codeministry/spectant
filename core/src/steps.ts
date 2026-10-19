// The step timeline per task (spec 015, ISC-231): what each task's agent did, from `.spectant/activity.jsonl` as
// locks.ts reads it. A task of a spec is a tasks.md line; its steps are
//
//   - its run lines `dispatch`, `build`, `patch` and `apply` (`reading.runs`, spec 027): `build` is the step a reader
//     names "started";
//   - its step lines `probe` (with `result` red or green) and `question` (with `text`) (`reading.steps`, ISC-230);
//   - the `release` that ended the hold on its claim (`reading.releases`): the step a reader names "claim released".
//     A release that names a task counts for that task only, one without for every task of the claim.
//
// The log is repository-wide and keyed by task id, so a line counts for a task the way the live frame's layer 4 counts
// a run line (live.ts `specRuns`): when it names a claim, only when that claim is the task's own; without a claim, only
// when its session ref `a:<kind>:spec-NNN/…`, else its worktree `.worktrees/NNN-slug`, names this spec's number
// (`runSpecOf`, spec 041, ISC-213). A line naming neither counts for no spec.
//
// Each timeline is in time order (by `ts`; equal times in the order dispatch, build, probe, question, patch, apply,
// release, then file order). The result keys the tasks with at least one step, in tasks.md order. Pure: no clock, no
// file system, no Node API (`runSpecOf` comes from spec-ref.ts), so it rides the barrel. `LiveFrame` and `TasksTab`
// stay without steps; the routes send this model beside them (ISC-230.1).
import type { LockReading, SpecFiles, TaskStep, TaskStepKind, TaskSteps } from './files.ts';
import { runSpecOf, specIdOf } from './spec-ref.ts';
import { parseTaskLines } from './tasks.ts';

const KIND_ORDER: readonly TaskStepKind[] = ['dispatch', 'build', 'probe', 'question', 'patch', 'apply', 'release'];

interface Placed {
  readonly task: string;
  readonly claim?: string;
  readonly session: string;
  readonly worktree?: string;
  readonly step: TaskStep;
}

/** Every task's timeline of the spec in `files`, from `reading`. Without tasks.md the spec has no task and no step. */
export function taskSteps(reading: LockReading, files: SpecFiles): TaskSteps {
  const tasks = files.texts.tasks;
  if (tasks === undefined) return {};
  const rows = parseTaskLines({ tasks }).tasks;
  const claimOf = new Map(rows.map((r) => [r.id, r.claim]));
  const specId = specIdOf(files.folder);
  const ours = (line: Placed): boolean => {
    if (!claimOf.has(line.task)) return false;
    return line.claim === undefined ? specId !== null && runSpecOf(line) === specId : line.claim === claimOf.get(line.task);
  };

  const placed: Placed[] = [
    ...(reading.runs ?? []).map((r) => ({ ...r, step: { kind: r.event, ts: r.ts, actor: r.session } })),
    ...(reading.steps ?? []).map((s) => ({
      ...s,
      step: { kind: s.event, ts: s.ts, actor: s.session, ...(s.event === 'probe' ? { result: s.result } : { text: s.text }) },
    })),
  ].filter(ours);
  for (const release of reading.releases ?? []) {
    const step: TaskStep = { kind: 'release', ts: release.ts, actor: release.session };
    for (const row of rows) {
      if (row.claim === release.claim && (release.task === undefined || release.task === row.id)) placed.push({ ...release, task: row.id, step });
    }
  }

  const rank = (step: TaskStep): number => KIND_ORDER.indexOf(step.kind);
  const byTask = new Map<string, TaskStep[]>();
  for (const { task, step } of placed) byTask.set(task, [...(byTask.get(task) ?? []), step]);
  const out: Record<string, readonly TaskStep[]> = {};
  for (const row of rows) {
    const steps = byTask.get(row.id);
    if (steps === undefined || row.id in out) continue;
    // Array#sort is stable: equal time and kind keep file order.
    out[row.id] = steps.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts) || rank(a) - rank(b));
  }
  return out;
}
