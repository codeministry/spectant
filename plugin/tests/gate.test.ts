// The plugin CLI's gate check (spec 031, T21, ISC-45): `spec-check gate check reviewed <spec>` decides, without the
// app, whether a spec may be implemented. Without `.gates/reviewed.json` it exits 3 and names the review as the next
// step (`/spec review NNN`); with a fresh mark it exits 0; with a stale mark it exits 3 and names the changed files.
//
// T24 adds the writes: `gate reviewed <spec> --yes` sets the mark the app sets (write path 1: the mark, then one
// `review → build` line in events.jsonl), and `gate code-reviewed <spec> --yes` the per-spec code-review mark; without
// `--yes` neither writes anything.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REVIEWED_FILES, hashForGate } from '../../core/src/gates.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const DIR = 'specs/001-digest';
const PLAN = ['# 001 — Plan', '', '## Approach', '', 'One pass over the notes of the week, newest first.', ''].join('\n');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

interface Run {
  readonly code: number;
  /** stdout and stderr together: where the message lands is the command's choice. */
  readonly text: string;
}

function run(cwd: string, ...args: string[]): Run {
  const r = Bun.spawnSync(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, text: `${r.stdout.toString()}${r.stderr.toString()}` };
}

const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');

/** A fresh git repository, no master, with one allocated feature spec 001 and its plan.md. */
function repoWithSpec(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-gate-')));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'builder@example.invalid');
  git(root, 'config', 'user.name', 'Builder');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  const r = Bun.spawnSync(['bun', CLI, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`allocate failed: ${r.stderr.toString()}`);
  writeFileSync(join(root, DIR, 'plan.md'), PLAN);
  return root;
}

/** The reviewed mark over the spec's files as they stand (a missing file hashed as null), the way the app writes it. */
function markReviewed(root: string): void {
  const files: Record<string, string | null> = {};
  for (const file of REVIEWED_FILES) {
    let text: string | null = null;
    try {
      text = read(root, `${DIR}/${file}`);
    } catch {
      text = null;
    }
    files[file] = text === null ? null : hashForGate(file, text);
  }
  mkdirSync(join(root, DIR, '.gates'), { recursive: true });
  writeFileSync(join(root, DIR, '.gates', 'reviewed.json'), `${JSON.stringify({ gate: 'reviewed', at: '2026-03-04T08:00:00Z', files })}\n`);
}

describe('spec-check gate check reviewed (ISC-45)', () => {
  test('without a reviewed mark: exit 3, a review is needed, next step /spec review 001', () => {
    const root = repoWithSpec();
    const r = run(root, 'gate', 'check', 'reviewed', '001');
    expect(r.code).toBe(3);
    expect(r.text).toMatch(/review/i);
    expect(r.text).toContain('/spec review 001');
  });

  test('with a fresh reviewed mark: exit 0', () => {
    const root = repoWithSpec();
    markReviewed(root);
    expect(run(root, 'gate', 'check', 'reviewed', '001').code).toBe(0);
  });

  test('with a stale reviewed mark: exit 3 and the changed files named', () => {
    const root = repoWithSpec();
    markReviewed(root);
    writeFileSync(join(root, DIR, 'plan.md'), `${PLAN}\nA second pass sorts the notes by tag.\n`);
    const r = run(root, 'gate', 'check', 'reviewed', '001');
    expect(r.code).toBe(3);
    expect(r.text).toContain('plan.md');
    expect(r.text).toContain('/spec review 001');
  });
});

describe('the gate fixtures read as intended (green now)', () => {
  const reviewedOf = (root: string): unknown => {
    const r = Bun.spawnSync(['bun', CLI, 'status', '001', '--json'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    return (JSON.parse(r.stdout.toString()) as { specs: Array<{ reviewed: unknown }> }).specs[0]?.reviewed;
  };

  test('no mark is missing, the written mark is fresh, an edited plan.md makes it stale', () => {
    const root = repoWithSpec();
    expect(reviewedOf(root)).toBe('missing');
    markReviewed(root);
    expect(reviewedOf(root)).toBe('fresh');
    writeFileSync(join(root, DIR, 'plan.md'), `${PLAN}\nA second pass sorts the notes by tag.\n`);
    expect(reviewedOf(root)).toBe('stale');
  });
});

/** The last line of the spec's events.jsonl, parsed; null without the file. */
function lastEvent(root: string): Record<string, unknown> | null {
  if (!existsSync(join(root, DIR, 'events.jsonl'))) return null;
  const lines = read(root, `${DIR}/events.jsonl`).split('\n').filter((l) => l.trim() !== '');
  return JSON.parse(lines.at(-1) ?? 'null') as Record<string, unknown> | null;
}

describe('spec-check gate reviewed --yes (ISC-45.1, T24)', () => {
  test('without --yes: exit 1, "needs --yes", no mark and no event', () => {
    const root = repoWithSpec();
    const before = read(root, `${DIR}/events.jsonl`);
    const r = run(root, 'gate', 'reviewed', '001');
    expect(r.code).toBe(1);
    expect(r.text).toContain('needs --yes');
    expect(existsSync(join(root, DIR, '.gates'))).toBe(false);
    expect(read(root, `${DIR}/events.jsonl`)).toBe(before);
  });

  test('with --yes: .gates/reviewed.json exists, one review → build line is appended, and the check then exits 0', () => {
    const root = repoWithSpec();
    const before = read(root, `${DIR}/events.jsonl`).split('\n').filter((l) => l.trim() !== '').length;
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', 'u:0a1b2c3d');
    expect(r.code).toBe(0);
    expect(existsSync(join(root, DIR, '.gates', 'reviewed.json'))).toBe(true);
    const lines = read(root, `${DIR}/events.jsonl`).split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBe(before + 1);
    expect(lastEvent(root)).toMatchObject({ from: 'review', to: 'build', command: '/spec review 001', actor: 'u:0a1b2c3d' });
    const mark = JSON.parse(read(root, `${DIR}/.gates/reviewed.json`)) as { gate: string; at: string; files: Record<string, string | null> };
    expect(mark.gate).toBe('reviewed');
    expect(lastEvent(root)?.ts).toBe(mark.at);
    expect(mark.files['tasks.md']).toBeNull();
    expect(run(root, 'gate', 'check', 'reviewed', '001').code).toBe(0);
  });
});

// spec 056 (T3, ISC-350, ISC-351): `gate reviewed --yes` takes the app's run lock. An open run on the spec that core's
// `runLockOf` reads `running`, started by another session, refuses the mark with exit 3 and writes nothing; the caller's
// own open run (its session equals `--actor`) and an `aborted` run (older than the default abort age) lock nothing.
const REVIEWER = 'a:claude:review01';
const OTHER = 'a:claude:other999';

/** Appends one `run-start` line on spec 001 to the repository's activity log, as `spec-check run start` writes it. */
function openRun(root: string, runId: string, session: string, ts: string, command = '/spec implement 001'): void {
  mkdirSync(join(root, '.spectant'), { recursive: true });
  const line = JSON.stringify({ ts, event: 'run-start', run: runId, command, session, spec: '001-digest' });
  const path = join(root, '.spectant', 'activity.jsonl');
  writeFileSync(path, `${existsSync(path) ? readFileSync(path, 'utf8') : ''}${line}\n`);
}

/** The bytes the gate write may touch: the spec's events, the mark, the activity log and the .gitignore. */
function gateBytes(root: string): string {
  const opt = (p: string): string => (existsSync(join(root, p)) ? read(root, p) : '<absent>');
  return [opt(`${DIR}/events.jsonl`), opt(`${DIR}/.gates/reviewed.json`), opt('.spectant/activity.jsonl'), opt('.gitignore')].join('\u0000');
}

describe('spec-check gate reviewed under a run lock (spec 056, ISC-350)', () => {
  test('ISC-350: a running run of another session on the spec refuses the mark with exit 3, naming the run, and writes nothing', () => {
    const root = repoWithSpec();
    openRun(root, 'run-foreign-1', OTHER, new Date().toISOString());
    const before = gateBytes(root);
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', REVIEWER);
    expect(r.code).toBe(3);
    expect(r.text).toContain('run-foreign-1');
    expect(r.text).toContain(OTHER);
    expect(r.text).toContain('/spec implement 001');
    expect(r.text.trim().split('\n').length).toBe(1);
    expect(existsSync(join(root, DIR, '.gates'))).toBe(false);
    expect(gateBytes(root)).toBe(before);
  });

  test('ISC-350: under --json the run lock is one compact refusal with the code run-locked (spec 010, ISC-335)', () => {
    const root = repoWithSpec();
    openRun(root, 'run-foreign-3', OTHER, new Date().toISOString());
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', REVIEWER, '--json');
    expect(r.code).toBe(3);
    const answer = JSON.parse(r.text) as { error: string; command: string; detail: string };
    expect(answer.error).toBe('run-locked');
    expect(answer.command).toBe('gate');
    expect(answer.detail).toContain('run-foreign-3');
  });

  test("ISC-350: the caller's own open run does not hide a running run of another session", () => {
    const root = repoWithSpec();
    openRun(root, 'run-own-1', REVIEWER, new Date().toISOString(), '/spec review 001');
    openRun(root, 'run-foreign-2', OTHER, new Date().toISOString());
    const before = gateBytes(root);
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', REVIEWER);
    expect(r.code).toBe(3);
    expect(r.text).toContain('run-foreign-2');
    expect(gateBytes(root)).toBe(before);
  });
});

describe('spec-check gate reviewed in its own run and after an aborted one (spec 056, ISC-351)', () => {
  test("ISC-351: the caller's own running run (session equals --actor) does not lock: exit 0, mark and event written", () => {
    const root = repoWithSpec();
    openRun(root, 'run-own-2', REVIEWER, new Date().toISOString(), '/spec review 001');
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', REVIEWER);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, DIR, '.gates', 'reviewed.json'))).toBe(true);
    expect(lastEvent(root)).toMatchObject({ from: 'review', to: 'build', actor: REVIEWER });
  });

  test('ISC-351: an aborted run of another session (older than the abort age) does not lock: exit 0', () => {
    const root = repoWithSpec();
    openRun(root, 'run-foreign-old', OTHER, new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());
    const r = run(root, 'gate', 'reviewed', '001', '--yes', '--actor', REVIEWER);
    expect(r.code).toBe(0);
    expect(existsSync(join(root, DIR, '.gates', 'reviewed.json'))).toBe(true);
  });
});

describe('spec-check gate code-reviewed (T22, T24)', () => {
  test('absent: exit 3 naming the code review; --yes without counts exits 1; with them the check exits 0, an edit makes it stale', () => {
    const root = repoWithSpec();
    const absent = run(root, 'gate', 'check', 'code-reviewed', '001');
    expect(absent.code).toBe(3);
    expect(absent.text).toContain('/spec review 001');
    expect(run(root, 'gate', 'code-reviewed', '001').code).toBe(1);
    expect(run(root, 'gate', 'code-reviewed', '001', '--yes').code).toBe(1);
    expect(existsSync(join(root, DIR, '.gates', 'code-reviewed.json'))).toBe(false);

    const r = run(root, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '1', '--note', 'one accepted finding');
    expect(r.code).toBe(0);
    const mark = JSON.parse(read(root, `${DIR}/.gates/code-reviewed.json`)) as Record<string, unknown>;
    expect(mark).toMatchObject({ gate: 'code-reviewed', code: 0, security: 1, note: 'one accepted finding' });
    expect(mark.scope).toBeUndefined();
    expect(run(root, 'gate', 'check', 'code-reviewed', '001').code).toBe(0);

    writeFileSync(join(root, 'notes.ts'), 'export const week = 7;\n');
    const stale = run(root, 'gate', 'check', 'code-reviewed', '001');
    expect(stale.code).toBe(3);
    expect(stale.text).toContain('notes.ts');
  });
});

// Spec 044 (ISC-270): a code-reviewed mark the plugin writes reads fresh at once (`status` judges its tree the way
// `gate check code-reviewed` does), and `code-review → close` stands in events.jsonl exactly once, however often the
// mark is set.
describe('spec-check gate code-reviewed: fresh at once, one event (ISC-270)', () => {
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
  const TASKS = ['# 001 — Tasks', '', '- [ ] T1 · ISC-1 · core — the digest fits on one screen', '- [ ] T2 · ISC-2 · core — every note appears', '- [ ] T3 · ISC-3 · core — each note links its source', ''].join('\n');
  const claim = (text: string): unknown => ({ text, row: { type: 'test', check: 'the digest', threshold: 'all', tool: 'bun test', anchorsTo: 'goal' } });

  const ok = (r: Run): void => expect({ code: r.code, text: r.code === 0 ? '' : r.text }).toEqual({ code: 0, text: '' });
  const closeEvents = (root: string): number =>
    read(root, `${DIR}/events.jsonl`)
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as { from: string | null; to: string })
      .filter((e) => e.from === 'code-review' && e.to === 'close').length;
  const statusOf = (root: string): { stage: string; reason: string | null } => {
    const r = Bun.spawnSync(['bun', CLI, 'status', '001', '--json'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
    const specs = (JSON.parse(r.stdout.toString()) as { specs: Array<{ stage: string; reason: string | null }> }).specs;
    return specs[0] ?? { stage: '', reason: null };
  };

  /** The fixture chain of the 031 probe run: allocate, mint, plan, tasks, the reviewed mark, every claim verified, code-review. */
  function repoInCodeReview(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-code-reviewed-')));
    dirs.push(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'config', 'user.email', 'builder@example.invalid');
    git(root, 'config', 'user.name', 'Builder');
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
    writeFileSync(join(root, 'ISA.md'), MASTER);
    ok(run(root, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.', '--feature', 'F1'));
    writeFileSync(join(root, '.claims.json'), JSON.stringify([claim('The digest fits on one screen.'), claim('Every note appears.'), claim('Each note links its source.')]));
    ok(run(root, 'mint', '001', '--feature', 'F1', '--claims', '.claims.json'));
    writeFileSync(join(root, DIR, 'plan.md'), PLAN);
    ok(run(root, 'transition', '001', 'tasks'));
    writeFileSync(join(root, DIR, 'tasks.md'), TASKS);
    ok(run(root, 'transition', '001', 'review'));
    ok(run(root, 'gate', 'reviewed', '001', '--yes'));
    for (const id of ['ISC-1', 'ISC-2', 'ISC-3']) ok(run(root, 'verify', '001', id, 'test', `bun test digest.test.ts — ${id} pass`));
    ok(run(root, 'transition', '001', 'code-review'));
    expect(statusOf(root).stage).toBe('code-review');
    return root;
  }

  test('code-reviewed once: status reads the mark fresh and the stage close; a second call appends no event', () => {
    const root = repoInCodeReview();
    ok(run(root, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0'));
    expect(run(root, 'gate', 'check', 'code-reviewed', '001').code).toBe(0);
    const first = statusOf(root);
    expect(first.reason ?? '').not.toContain('stale');
    expect(first.stage).toBe('close');
    expect(closeEvents(root)).toBe(1);

    ok(run(root, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0'));
    expect(closeEvents(root)).toBe(1);
    expect(run(root, 'gate', 'check', 'code-reviewed', '001').code).toBe(0);
    const second = statusOf(root);
    expect(second.reason ?? '').not.toContain('stale');
    expect(second.stage).toBe('close');

    // An edit after the review makes the mark stale and reads the spec back in code-review; the renewed mark still
    // appends no second event, because the last one already entered close.
    writeFileSync(join(root, 'notes.ts'), 'export const week = 7;\n');
    expect(run(root, 'gate', 'check', 'code-reviewed', '001').code).toBe(3);
    ok(run(root, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0'));
    expect(closeEvents(root)).toBe(1);
    expect(statusOf(root).stage).toBe('close');
  });
});
