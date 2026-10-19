// The plugin CLI's stage moves (spec 031, T17, ISC-44): a full fixture chain through `spec-check`, driven as a process
// the way the skill calls it, in a fresh git repository under the system temp directory. The allocation writes the
// creation event (`null → plan`); every stage change a subcommand makes after it — plan → tasks → review → build →
// code-review → close → done, the feature row of the default workflow (FORMAT.md § workflow) — is one
// `spec-check transition <spec> <to>`, and each appends exactly one valid line to `events.jsonl` and sets `stage:` in
// spec.md. A move the workflow does not allow exits 3 and leaves every file byte-identical; a repository
// `specs/workflow.md` that reorders the stages is honoured.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEvents, validateEventLine } from '../../core/src/events.ts';
import type { EventLine } from '../../core/src/files.ts';
import { parseFrontmatter } from '../../core/src/frontmatter.ts';
import { hashForGate } from '../../core/src/gates.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const DIR = 'specs/001-digest';

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
    row: { type: 'test', check: 'note titles in the digest', threshold: 'all', tool: 'bun test', anchorsTo: 'goal' },
  },
  {
    text: 'The digest links each note to its source file.',
    row: { type: 'test', check: 'links in the digest', threshold: 'one per note', tool: 'bun test', anchorsTo: 'goal' },
  },
];

const PLAN = ['# 001 — Plan', '', '## Approach', '', 'One pass over the notes of the week, newest first.', ''].join('\n');
const TASKS = ['# 001 — Tasks', '', '- [ ] T1 · ISC-1 · core — the digest fits on one screen', '- [ ] T2 · ISC-2 · core — every note appears', '- [ ] T3 · ISC-3 · core — each note links its source', ''].join('\n');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A fresh git repository with one empty commit and the master ISA.md at its root. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-transition-')));
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

const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');

/** The raw lines of the spec's events.jsonl, each one checked valid by core. */
function eventLines(root: string): string[] {
  const lines = read(root, `${DIR}/events.jsonl`).split('\n').filter((l) => l !== '');
  for (const line of lines) expect(validateEventLine(line).ok).toBe(true);
  return lines;
}

function events(root: string): EventLine[] {
  const parsed = parseEvents(read(root, `${DIR}/events.jsonl`));
  expect(parsed.diagnostics).toEqual([]);
  return parsed.events;
}

const stageKey = (root: string): string | null => parseFrontmatter(read(root, `${DIR}/spec.md`)).data.stage;

/** Every file under the spec folder and the master, byte for byte. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = { 'ISA.md': read(root, 'ISA.md') };
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else out[path] = read(root, path);
    }
  };
  walk('specs');
  return out;
}

/** One stage-changing command: exit 0, exactly one more events.jsonl line, `from`/`to` right, `stage:` set. */
function move(root: string, from: string, to: string, command: string): EventLine {
  const before = eventLines(root);
  const r = run(root, 'transition', '001', to, '--json');
  expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
  const after = eventLines(root);
  expect(after.length).toBe(before.length + 1);
  expect(after.slice(0, before.length)).toEqual(before);
  const last = events(root).at(-1);
  expect(last).toMatchObject({ from, to, command, actor: 'a:claude:spec-check' });
  expect(stageKey(root)).toBe(to);
  expect(JSON.parse(r.out)).toMatchObject({ from, to });
  return last as EventLine;
}

/** The reviewed mark over spec.md, plan.md and tasks.md as they stand, the bytes `gate reviewed --yes` writes later. */
function markReviewed(root: string): void {
  const mark = {
    gate: 'reviewed',
    at: '2026-03-04T08:00:00Z',
    files: {
      'spec.md': hashForGate('spec.md', read(root, `${DIR}/spec.md`)),
      'plan.md': hashForGate('plan.md', read(root, `${DIR}/plan.md`)),
      'tasks.md': hashForGate('tasks.md', read(root, `${DIR}/tasks.md`)),
    },
  };
  mkdirSync(join(root, DIR, '.gates'), { recursive: true });
  writeFileSync(join(root, DIR, '.gates', 'reviewed.json'), `${JSON.stringify(mark)}\n`);
}

/** The review → build line the app's reviewed write appends beside the mark (FORMAT.md § events, "Mark reviewed"). */
function appendReviewedEvent(root: string): void {
  const event = { ts: '2026-03-04T08:00:00.000Z', from: 'review', to: 'build', command: '/spec review 001', actor: 'a:claude:spec-check' };
  writeFileSync(join(root, DIR, 'events.jsonl'), `${read(root, `${DIR}/events.jsonl`)}${JSON.stringify(event)}\n`);
}

function allocate(root: string): void {
  const r = run(root, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.', '--feature', 'F1');
  expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
}

describe('spec-check transition: the full chain (ISC-44)', () => {
  test('allocate writes the creation event; each stage change after it appends exactly one event', () => {
    const root = repo();
    allocate(root);
    expect(events(root)).toMatchObject([{ from: null, to: 'plan' }]);
    expect(stageKey(root)).toBe('plan');

    const claimsFile = join(root, '.claims.json');
    writeFileSync(claimsFile, JSON.stringify(CLAIMS));
    expect(run(root, 'mint', '001', '--feature', 'F1', '--claims', claimsFile).code).toBe(0);
    expect(eventLines(root)).toHaveLength(1);

    // A file a stage needs overtakes an explicit stage: `stage:` then yields to the stage the files give (FORMAT.md §
    // spec, `stage`), and core plans every move from there. So each subcommand records its move before it writes the
    // file that carries the spec on: `/spec plan` moves plan → tasks, then writes plan.md.
    move(root, 'plan', 'tasks', '/spec plan 001');
    writeFileSync(join(root, DIR, 'plan.md'), PLAN);

    // `/spec tasks`: tasks → review, then tasks.md.
    move(root, 'tasks', 'review', '/spec tasks 001');
    writeFileSync(join(root, DIR, 'tasks.md'), TASKS);

    // `/spec review`: the fresh reviewed mark is what lets a spec past review, and it carries the spec to build by
    // itself, so no `transition` can make this move (before the mark core refuses it, after it the spec stands in build).
    // `gate reviewed --yes` writes the mark and the one review → build line together, as the app's reviewed write does
    // (write path 1); until it is built (T22) the test writes both the same way.
    const beforeMark = eventLines(root).length;
    expect(run(root, 'transition', '001', 'build').code).toBe(3);
    markReviewed(root);
    expect(run(root, 'transition', '001', 'build').code).toBe(3);
    expect(eventLines(root)).toHaveLength(beforeMark);
    appendReviewedEvent(root);

    // `/spec implement`: build → code-review before the last claim closes, which would carry the spec on by itself.
    expect(run(root, 'verify', '001', 'ISC-1', 'test', 'bun test digest.test.ts — ISC-1 pass').code).toBe(0);
    move(root, 'build', 'code-review', '/spec implement 001');
    for (const id of ['ISC-2', 'ISC-3']) expect(run(root, 'verify', '001', id, 'test', `bun test digest.test.ts — ${id} pass`).code).toBe(0);
    expect(eventLines(root)).toHaveLength(5);

    // `/spec review` as the code review, then `/spec done`.
    move(root, 'code-review', 'close', '/spec review 001');
    move(root, 'close', 'done', '/spec done 001');

    expect(events(root).map((e) => `${e.from ?? 'null'}→${e.to}`)).toEqual([
      'null→plan',
      'plan→tasks',
      'tasks→review',
      'review→build',
      'build→code-review',
      'code-review→close',
      'close→done',
    ]);
  });

  test('--actor and --command land in the event line as given', () => {
    const root = repo();
    allocate(root);
    const r = run(root, 'transition', '001', 'tasks', '--actor', 'a:claude:sess-7', '--command', '/spec plan 001 --again');
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    expect(events(root).at(-1)).toMatchObject({ from: 'plan', to: 'tasks', actor: 'a:claude:sess-7', command: '/spec plan 001 --again' });
  });
});

describe('spec-check transition: refusals write nothing (ISC-44)', () => {
  test('a move the workflow does not list exits 3 and leaves every file byte-identical', () => {
    const root = repo();
    allocate(root);
    const before = snapshot(root);
    for (const to of ['build', 'done', 'close']) {
      const r = run(root, 'transition', '001', to);
      expect(r.code).toBe(3);
      expect(r.err).toContain(`plan → ${to}`);
      expect(snapshot(root)).toEqual(before);
    }
  });

  test('a stage past review without a fresh reviewed mark exits 3 and writes nothing', () => {
    const root = repo();
    allocate(root);
    move(root, 'plan', 'tasks', '/spec plan 001');
    move(root, 'tasks', 'review', '/spec tasks 001');
    const before = snapshot(root);
    const r = run(root, 'transition', '001', 'build');
    expect(r.code).toBe(3);
    expect(r.err).toContain('reviewed mark');
    expect(snapshot(root)).toEqual(before);
  });

  test('an unknown stage is a bad argument (exit 1) and writes nothing', () => {
    const root = repo();
    allocate(root);
    const before = snapshot(root);
    expect(run(root, 'transition', '001', 'shipped').code).toBe(1);
    expect(snapshot(root)).toEqual(before);
  });
});

describe('spec-check transition: the repository workflow (ISC-44)', () => {
  test('specs/workflow.md that puts tasks before plan is honoured', () => {
    const root = repo();
    allocate(root);
    writeFileSync(
      join(root, 'specs', 'workflow.md'),
      ['# Workflow', '', '| type | stages | code_review |', '|------|--------|-------------|', '| feature | tasks · plan · review · build · code-review · close · done | spec |', ''].join('\n'),
    );
    const before = snapshot(root);
    const refused = run(root, 'transition', '001', 'tasks');
    expect(refused.code).toBe(3);
    expect(snapshot(root)).toEqual(before);

    move(root, 'plan', 'review', '/spec plan 001');
  });
});
