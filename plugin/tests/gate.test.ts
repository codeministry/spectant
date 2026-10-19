// The plugin CLI's gate check (spec 031, T21, ISC-45): `spec-check gate check reviewed <spec>` decides, without the
// app, whether a spec may be implemented. Without `.gates/reviewed.json` it exits 3 and names the review as the next
// step (`/spec review NNN`); with a fresh mark it exits 0; with a stale mark it exits 3 and names the changed files.
//
// RED until T22 builds `gate`: each case is `test.failing`, so `bun test plugin/` stays green while the stub exits 1,
// and each one turns into a reported failure the moment `gate check reviewed` behaves as written here. T22 then drops
// `.failing` from every case.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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

describe('spec-check gate check reviewed (ISC-45) — red until T22', () => {
  test.failing('without a reviewed mark: exit 3, a review is needed, next step /spec review 001', () => {
    const root = repoWithSpec();
    const r = run(root, 'gate', 'check', 'reviewed', '001');
    expect(r.code).toBe(3);
    expect(r.text).toMatch(/review/i);
    expect(r.text).toContain('/spec review 001');
  });

  test.failing('with a fresh reviewed mark: exit 0', () => {
    const root = repoWithSpec();
    markReviewed(root);
    expect(run(root, 'gate', 'check', 'reviewed', '001').code).toBe(0);
  });

  test.failing('with a stale reviewed mark: exit 3 and the changed files named', () => {
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
