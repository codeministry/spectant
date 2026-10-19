// The run pair of every plugin subcommand (spec 031, T19, ISC-227): each subcommand that works on a spec, an idea or the
// repository opens with `spec-check run start <target> --command "/spec <sub> …"` and closes with `spec-check run end
// <run-id> --outcome ok|error`, also when it ends with an error. A full fixture run of the chain the workflows run —
// init → new → plan → tasks → review → implement → done — leaves exactly one run-start/run-end pair per subcommand in
// `.spectant/activity.jsonl`, both lines of a pair carrying the same run id, the failed one `outcome: error`, and no run
// open. The log is read back with core's reader (`activityReading`), so the lines are exactly what the app reads.
//
// The lock and step commands the implement subcommand calls (`claim`, `release`, `activity`) and the round log
// (`rounds record`) are driven in the same run. Every test works in a fresh git repository under the system temp
// directory, never in this repository's own `specs/`.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityReading } from '../../core/src/locks.ts';
import { roundLines } from '../../core/src/timeline.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const LOG = '.spectant/activity.jsonl';
const MAIN = 'a:claude:main';

const MASTER = [
  '---',
  'project: quill',
  'progress: 0/0',
  '---',
  '',
  '# Quill',
  '',
  '## Features',
  '',
  '### F1 · Digest',
  'Why: the notes of a week become one page.',
  '',
  '## Test Strategy',
  '',
  '| isc | type | check | threshold | tool | anchors_to | severity |',
  '|-----|------|-------|-----------|------|------------|----------|',
  '',
  '## Decisions',
  '',
  '## Verification',
  '',
].join('\n');

const CLAIMS = [
  {
    text: 'The digest of one week fits on one screen.',
    row: { type: 'test', check: 'line count of the digest', threshold: '<= 40 lines', tool: 'bun test', anchorsTo: 'goal' },
  },
  {
    text: 'Every note of the week appears in the digest.',
    after: ['ISC-1'],
    row: { type: 'test', check: 'note titles in the digest', threshold: 'all', tool: 'bun test', anchorsTo: 'goal' },
  },
];

const PLAN = ['# 001 — Plan', '', '## Approach', '', 'One pass over the notes of the week, newest first.', ''].join('\n');
const TASKS = [
  '# 001 — Tasks',
  '',
  '- [ ] T1 · ISC-1 · core — red test for the screen limit · `src/digest.test.ts`',
  '- [ ] T2 · ISC-2 · core — every note in the digest (after: T1) · `src/digest.ts`',
  '',
].join('\n');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-runs-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  writeFileSync(join(dir, 'ISA.md'), MASTER);
  return dir;
}

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

function run(cwd: string, ...args: string[]): Run {
  const r = Bun.spawnSync(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const log = (root: string): string => (existsSync(join(root, LOG)) ? readFileSync(join(root, LOG), 'utf8') : '');
const lines = (root: string): Array<Record<string, string>> =>
  log(root)
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, string>);

/** `run start` → the work → `run end`; the work's own exit decides the outcome unless one is forced. */
function subcommand(root: string, target: string, command: string, work: () => boolean, forced?: 'error'): string {
  const started = run(root, 'run', 'start', target, '--command', command, '--session', MAIN, '--json');
  expect(started.err).toBe('');
  expect(started.code).toBe(0);
  const id = (JSON.parse(started.out) as { run: string }).run;
  expect(id).toMatch(/^r-/);
  const ok = work();
  const ended = run(root, 'run', 'end', id, '--outcome', forced ?? (ok ? 'ok' : 'error'));
  expect(ended.err).toBe('');
  expect(ended.code).toBe(0);
  return id;
}

describe('spec-check run start / run end (ISC-227)', () => {
  test('a full fixture run: one pair per subcommand, same run id, the failed one outcome error, no open run', () => {
    const root = repo();
    const claimsFile = join(root, '.claims.json');
    writeFileSync(claimsFile, JSON.stringify(CLAIMS));
    const dir = join(root, 'specs', '001-digest');
    const ids: Record<string, string> = {};

    ids.init = subcommand(root, 'init', '/spec init', () => true);
    ids.new = subcommand(root, 'digest', '/spec new digest', () => {
      const allocated = run(root, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.', '--feature', 'F1');
      const minted = run(root, 'mint', '001', '--feature', 'F1', '--claims', claimsFile);
      return allocated.code === 0 && minted.code === 0;
    });
    ids.plan = subcommand(root, '001', '/spec plan 001', () => {
      writeFileSync(join(dir, 'plan.md'), PLAN);
      return true;
    });
    ids.tasks = subcommand(root, '001-digest', '/spec tasks 001', () => {
      writeFileSync(join(dir, 'tasks.md'), TASKS);
      return true;
    });
    // The review fails: the subcommand still closes its run, with `outcome: error`.
    ids.review = subcommand(root, '001', '/spec review 001', () => false);
    ids.implement = subcommand(root, '001', '/spec implement 001', () => {
      const builder = 'a:claude:builder/T1';
      const steps = [
        run(root, 'claim', 'ISC-1', '--task', 'T1', '--session', builder),
        run(root, 'activity', 'dispatch', '--task', 'T1', '--claim', 'ISC-1', '--session', MAIN),
        run(root, 'activity', 'probe', '--task', 'T1', '--claim', 'ISC-1', '--session', builder, '--result', 'red'),
        run(root, 'activity', 'probe', '--task', 'T1', '--claim', 'ISC-1', '--session', builder, '--result', 'green'),
        run(root, 'verify', '001', 'ISC-1', 'test', 'bun test src/digest.test.ts — 3 pass'),
        run(root, 'release', 'ISC-1', '--task', 'T1', '--session', builder),
      ];
      writeFileSync(join(dir, 'tasks.md'), TASKS.replace('- [ ] T1', '- [x] T1')); // single-core: allow — the test ticks its own fixture task; it parses nothing
      const planFile = join(root, '.plan.json');
      writeFileSync(
        planFile,
        JSON.stringify({ width: 2, dispatch: [{ task: 'T1', claim: 'ISC-1', reason: 'claim takeable' }], held: [{ task: 'T2', claim: 'ISC-2', reason: 'after T1' }] }),
      );
      steps.push(run(root, 'rounds', 'record', '001', '--plan', planFile, '--outcome', 'T1=pass', '--builder', 'T1=Engineer', '--stop', 'width reached'));
      return steps.every((s) => s.code === 0 && s.err === '');
    });
    ids.done = subcommand(root, '001', '/spec done 001', () => run(root, 'verify', '001', 'ISC-2', 'test', 'bun test src/digest.ts — 1 pass').code === 0);

    const all = lines(root);
    const runLines = all.filter((l) => l.event === 'run-start' || l.event === 'run-end');
    expect(runLines).toHaveLength(14);
    for (const [sub, id] of Object.entries(ids)) {
      const pair = runLines.filter((l) => l.run === id);
      expect(pair.map((l) => l.event)).toEqual(['run-start', 'run-end']);
      const [start, end] = pair;
      expect(start?.command).toBe(`/spec ${sub}${sub === 'init' ? '' : sub === 'new' ? ' digest' : ' 001'}`);
      expect(end?.command).toBe(start?.command);
      expect(end?.session).toBe(MAIN);
      expect(end?.outcome).toBe(sub === 'review' ? 'error' : 'ok');
    }
    expect(new Set(Object.values(ids)).size).toBe(7);
    // The targets as the reader keys them: init as a spec, the new spec's idea by its slug, the rest by number or folder.
    expect(runLines.find((l) => l.run === ids.init)?.spec).toBe('init');
    expect(runLines.find((l) => l.run === ids.new)?.idea).toBe('digest');
    expect(runLines.find((l) => l.run === ids.tasks)?.spec).toBe('001-digest');

    // Core's reader: no run left open, no unmatched or duplicate run, the claim released, both probes read as steps.
    const reading = activityReading(log(root));
    expect(reading.openRuns).toEqual([]);
    expect((reading.diagnostics ?? []).map((d) => d.code)).toEqual([]);
    expect(reading.locks).toEqual([]);
    expect(reading.steps?.map((s) => (s.event === 'probe' ? s.result : s.event))).toEqual(['red', 'green']);
    expect(reading.runs?.map((r) => `${r.event} ${r.task}`)).toEqual(['dispatch T1']);

    // The round log is the line core's reader takes: round 1, T1 closed by its pass, T2 held with the plan's reason.
    const rounds = roundLines(readFileSync(join(dir, 'rounds.jsonl'), 'utf8'));
    expect(rounds).toHaveLength(1);
    const round = rounds[0] as unknown as { round: number; dispatched: string[]; stop: string; width: number; tasks: Array<Record<string, unknown>>; progress: string };
    expect(round.round).toBe(1);
    expect(round.dispatched).toEqual(['T1']);
    expect(round.width).toBe(2);
    expect(round.stop).toBe('width reached');
    expect(round.tasks.map((t) => [t.id, t.claim, t.state, t.reason, t.builder ?? null])).toEqual([
      ['T1', 'ISC-1', 'closed', 'claim takeable', 'Engineer'],
      ['T2', 'ISC-2', 'held', 'after T1', null],
    ]);
  });

  test('run end of an unknown or closed run id exits 1 and writes nothing', () => {
    const root = repo();
    expect(run(root, 'run', 'end', 'r-unknown', '--outcome', 'ok').code).toBe(1);
    expect(existsSync(join(root, LOG))).toBe(false);

    const id = run(root, 'run', 'start', '001', '--command', '/spec plan 001', '--session', MAIN).out.trim();
    expect(run(root, 'run', 'end', id, '--outcome', 'ok').code).toBe(0);
    const before = log(root);
    const again = run(root, 'run', 'end', id, '--outcome', 'error');
    expect(again.code).toBe(1);
    expect(again.err).toContain(id);
    expect(log(root)).toBe(before);
    expect(run(root, 'run', 'end', id, '--outcome', 'maybe').code).toBe(1);
    expect(run(root, 'run', 'start', 'Not A Target', '--command', '/spec plan', '--session', MAIN).code).toBe(1);
    expect(log(root)).toBe(before);
  });

  test('from a linked worktree the lines land in the main checkout, and a held claim refuses another session', () => {
    const root = repo();
    const tree = join(root, '.worktrees', '001-digest');
    git(root, 'worktree', 'add', '-q', tree, '-b', 'feature/001-digest');

    const id = run(tree, 'run', 'start', '001', '--command', '/spec implement 001', '--session', MAIN).out.trim();
    expect(run(tree, 'claim', 'ISC-1', '--task', 'T1', '--session', 'a:claude:builder/T1', '--worktree', '.worktrees/001-digest').code).toBe(0);
    expect(existsSync(join(tree, LOG))).toBe(false);
    const held = log(root);

    const taken = run(tree, 'claim', 'ISC-1', '--task', 'T2', '--session', 'a:claude:builder/T2');
    expect(taken.code).toBe(4);
    expect(taken.err).toContain('a:claude:builder/T1');
    expect(run(tree, 'release', 'ISC-1', '--session', 'a:claude:builder/T2').code).toBe(4);
    expect(log(root)).toBe(held);

    expect(run(tree, 'release', 'ISC-1', '--session', 'a:claude:builder/T1').code).toBe(0);
    expect(run(tree, 'run', 'end', id, '--outcome', 'ok').code).toBe(0);
    const reading = activityReading(log(root));
    expect(reading.locks).toEqual([]);
    expect(reading.openRuns).toEqual([]);
    expect(lines(root).map((l) => l.event)).toEqual(['run-start', 'claim', 'release', 'run-end']);
  });
});
