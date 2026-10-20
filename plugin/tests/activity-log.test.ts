// The shared write path of the activity log (spec 032, T3, ISC-33): `plugin/src/activity-log.ts` is the one place the
// CLI and the hook command append to `.spectant/activity.jsonl`. The root is resolved from a directory the caller
// passes (for the hook `CLAUDE_PROJECT_DIR`, which may be a linked worktree) through `git rev-parse --git-common-dir`,
// so a worktree writes into the main checkout's log; outside git the directory itself is the root. The lines stay
// core's plans (`core/src/activity-text.ts`); the strict run-event writer refuses a dispatch, build, patch or apply
// line without `claim` and writes nothing, while core's reader stays tolerant of old lines without one (ISC-213).
//
// Every test works in a fresh directory under the system temp directory, never in this repository.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runEventLine } from '../../core/src/activity-text.ts';
import { activityReading } from '../../core/src/locks.ts';
import { ActivityLogError, activityPath, appendActivity, appendRunEvent, repoRoot } from '../src/activity-log.ts';

const LOG = '.spectant/activity.jsonl';
const SESSION = 'a:claude:spec-001/T1';
const TS = '2026-10-19T10:00:00.000Z';

const dirs: string[] = [];

/** A fresh directory under the system temp directory, its real path (macOS links the temp folder). */
function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spectant-activity-log-')));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: readonly string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A git repository with one commit, so a linked worktree can be added to it. */
function gitRepo(): string {
  const root = tempDir();
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(join(root, 'README.md'), '# Fixture\n');
  git(root, ['add', 'README.md']);
  git(root, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '-m', 'init']);
  return root;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('repoRoot', () => {
  test('the main checkout resolves to itself, a subfolder of it to the checkout', () => {
    const root = gitRepo();
    mkdirSync(join(root, 'specs'));
    expect(repoRoot(root)).toBe(root);
    expect(repoRoot(join(root, 'specs'))).toBe(root);
  });

  test('a linked worktree resolves to the main checkout, never to itself', () => {
    const root = gitRepo();
    const worktree = join(root, '.worktrees', 'builder');
    git(root, ['worktree', 'add', '-q', worktree, '-b', 'feature/builder']);
    expect(repoRoot(worktree)).toBe(root);
  });

  test('a directory outside git resolves to itself', () => {
    const dir = tempDir();
    expect(repoRoot(dir)).toBe(dir);
  });
});

describe('appendActivity', () => {
  test('creates .spectant/ and appends the line at the root', () => {
    const root = tempDir();
    expect(activityPath(root)).toBe(join(root, LOG));
    const line = runEventLine({ event: 'dispatch', task: 'T1', claim: 'ISC-1', session: SESSION, ts: TS });
    appendActivity(root, line);
    expect(readFileSync(join(root, LOG), 'utf8')).toBe(line);
  });

  test('repairs a missing final newline before appending', () => {
    const root = tempDir();
    const first = runEventLine({ event: 'dispatch', task: 'T1', claim: 'ISC-1', session: SESSION, ts: TS });
    appendActivity(root, first.trimEnd());
    const second = runEventLine({ event: 'build', task: 'T1', claim: 'ISC-1', session: SESSION, ts: TS });
    appendActivity(root, second);
    expect(readFileSync(join(root, LOG), 'utf8')).toBe(`${first.trimEnd()}\n${second}`);
  });

  test('a worktree resolved through repoRoot writes into the main checkout log', () => {
    const root = gitRepo();
    const worktree = join(root, '.worktrees', 'builder');
    git(root, ['worktree', 'add', '-q', worktree, '-b', 'feature/builder']);
    appendActivity(repoRoot(worktree), runEventLine({ event: 'dispatch', task: 'T1', claim: 'ISC-1', session: SESSION, ts: TS }));
    expect(existsSync(join(root, LOG))).toBe(true);
    expect(existsSync(join(worktree, LOG))).toBe(false);
  });
});

describe('appendRunEvent', () => {
  test.each(['dispatch', 'build', 'patch', 'apply'] as const)('writes a %s line with its claim, as core plans it', (event) => {
    const root = tempDir();
    const input = { event, task: 'T1', claim: 'ISC-1', session: SESSION, ts: TS, ...(event === 'patch' || event === 'apply' ? { worktree: '.worktrees/t1' } : {}) };
    const line = appendRunEvent(root, input);
    expect(line).toBe(runEventLine(input));
    expect(readFileSync(join(root, LOG), 'utf8')).toBe(line);
  });

  test.each(['dispatch', 'build', 'patch', 'apply'] as const)('refuses a %s line without a claim and writes nothing', (event) => {
    const root = tempDir();
    const input = { event, task: 'T1', session: SESSION, ts: TS, worktree: '.worktrees/t1' };
    expect(() => appendRunEvent(root, input)).toThrow(ActivityLogError);
    try {
      appendRunEvent(root, input);
    } catch (error) {
      expect((error as ActivityLogError).code).toBe('claim-required');
    }
    expect(existsSync(join(root, LOG))).toBe(false);
  });

  test('refuses an empty claim and writes nothing', () => {
    const root = tempDir();
    expect(() => appendRunEvent(root, { event: 'build', task: 'T1', claim: '', session: SESSION, ts: TS })).toThrow(ActivityLogError);
    expect(existsSync(join(root, LOG))).toBe(false);
  });

  test('core refuses a malformed line and nothing is written', () => {
    const root = tempDir();
    expect(() => appendRunEvent(root, { event: 'build', task: 'T1', claim: 'ISC-1', session: 'nobody', ts: TS })).toThrow();
    expect(existsSync(join(root, LOG))).toBe(false);
  });

  test("core's reader still reads an old run line without a claim beside a strict one", () => {
    const root = tempDir();
    appendActivity(root, runEventLine({ event: 'build', task: 'T1', session: SESSION, ts: TS }));
    appendRunEvent(root, { event: 'build', task: 'T2', claim: 'ISC-2', session: SESSION, ts: TS });
    const text = readFileSync(join(root, LOG), 'utf8');
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    expect(() => activityReading(text)).not.toThrow();
  });
});

// Spec 056, ISC-347: a spec without tasks.md has the frontier units `C<n>` instead of `T<n>`; `spec-check activity
// probe|question --task C<n>` writes its one line like `--task T<n>`, from a builder session `a:<kind>:<id>/C<n>`.
describe('spec-check activity with a C<n> unit (ISC-347)', () => {
  const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
  const C_SESSION = 'a:claude:spec-056/C1';

  const cli = (cwd: string, ...args: string[]): { code: number; err: string } => {
    const r = Bun.spawnSync(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return { code: r.exitCode, err: r.stderr.toString() };
  };
  const logLines = (root: string): Array<Record<string, string>> =>
    existsSync(join(root, LOG))
      ? readFileSync(join(root, LOG), 'utf8')
          .split('\n')
          .filter((l) => l.trim() !== '')
          .map((l) => JSON.parse(l) as Record<string, string>)
      : [];

  test('activity probe --task C1 writes exactly one probe line, exit 0', () => {
    const root = gitRepo();
    const r = cli(root, 'activity', 'probe', '--task', 'C1', '--claim', 'ISC-1', '--session', C_SESSION, '--result', 'red');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const lines = logLines(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'probe', task: 'C1', claim: 'ISC-1', session: C_SESSION, result: 'red' });
  });

  test('activity question --task C1 writes exactly one question line, exit 0', () => {
    const root = gitRepo();
    const r = cli(root, 'activity', 'question', '--task', 'C1', '--claim', 'ISC-1', '--session', C_SESSION, '--text', 'Which unit?');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const lines = logLines(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: 'question', task: 'C1', claim: 'ISC-1', session: C_SESSION, text: 'Which unit?' });
  });

  test("core's reader keeps the C1 step beside a T1 step", () => {
    const root = gitRepo();
    expect(cli(root, 'activity', 'probe', '--task', 'C1', '--claim', 'ISC-1', '--session', C_SESSION, '--result', 'green').code).toBe(0);
    expect(cli(root, 'activity', 'probe', '--task', 'T1', '--claim', 'ISC-2', '--session', SESSION, '--result', 'green').code).toBe(0);
    const reading = activityReading(readFileSync(join(root, LOG), 'utf8'));
    expect(reading.steps?.map((s) => s.task)).toEqual(['C1', 'T1']);
  });
});
