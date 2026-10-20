// `spec-check tick <spec> T<k> [--json]` (spec 010, T9, ISC-334), driven as a process the way the skill calls it. Every
// test works in a fresh git repository under the system temp directory. The box of exactly the named task turns `[x]`:
// one line of tasks.md differs before and after and every other byte stays; a task already ticked exits 0 with
// "already ticked" and writes nothing; an unknown task exits 1 and writes nothing. No file but tasks.md changes.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const DIR = 'specs/001-digest';
const TASKS_PATH = `${DIR}/tasks.md`;

const SPEC = ['---', 'type: feature', 'phase: building', 'stage: build', 'progress: 0/3', '---', '', '# 001 — Digest', ''].join('\n');

// CRLF line ends, a fenced example line and a ticked task: the tick must keep every one of them as it is.
const TASKS = [
  '# 001 — Tasks',
  '',
  '- [ ] T1 · ISC-1 · core — red test for the screen limit · `src/digest.test.ts`',
  '- [ ] T2 · ISC-2 · core — every note in the digest (after: T1) · `src/digest.ts`',
  '- [x] T3 · ISC-3 · core — each note links its source · `src/digest.ts`',
  '',
  '```',
  '- [ ] T4 · ISC-9 · core — an example inside a fence, never a task',
  '```',
  '',
].join('\r\n');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A fresh git repository with one empty commit and spec 001 with its spec.md and tasks.md. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-tick-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  mkdirSync(join(dir, DIR), { recursive: true });
  writeFileSync(join(dir, DIR, 'spec.md'), SPEC);
  writeFileSync(join(dir, TASKS_PATH), TASKS);
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

/** Every file of the tree outside `.git/` with its bytes and mtime, so a run that writes anything shows up. */
function tree(root: string): Record<string, { bytes: string; mtime: number }> {
  const files: Record<string, { bytes: string; mtime: number }> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name));
    if (path === '.git' || path.startsWith('.git/')) continue;
    files[path] = { bytes: readFileSync(join(root, path)).toString('base64'), mtime: statSync(join(root, path)).mtimeMs };
  }
  return files;
}

const lines = (text: string): string[] => text.split('\r\n');

describe('spec-check tick', () => {
  test('tick sets the box of exactly that task: one line of tasks.md differs, every other byte stays', () => {
    const root = repo();
    const before = tree(root);
    const r = run(root, 'tick', '001', 'T2');
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    expect(r.out.trim()).toBe('ticked T2');

    const after = readFileSync(join(root, TASKS_PATH), 'utf8');
    const was = lines(TASKS);
    const now = lines(after);
    expect(now.length).toBe(was.length);
    const differing = now.map((line, i) => (line === was[i] ? -1 : i)).filter((i) => i >= 0);
    expect(differing).toEqual([3]);
    expect(now[3]).toBe('- [x] T2 · ISC-2 · core — every note in the digest (after: T1) · `src/digest.ts`');
    expect(after).toBe(TASKS.replace('- [ ] T2', '- [x] T2')); // single-core: allow — the expected bytes, built from the fixture; it parses nothing

    // No file but tasks.md changed.
    const changed = Object.entries(tree(root))
      .filter(([path, file]) => before[path]?.bytes !== file.bytes)
      .map(([path]) => path);
    expect(changed).toEqual([TASKS_PATH]);
  });

  test('tick --json answers with the spec, the task and the result', () => {
    const root = repo();
    const r = run(root, 'tick', 'specs/001-digest/', 'T1', '--json');
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(r.out)).toEqual({ spec: '001-digest', task: 'T1', result: 'ticked' });
    const again = run(root, 'tick', '001', 'T1', '--json');
    expect({ code: again.code, err: again.err }).toEqual({ code: 0, err: '' });
    expect(JSON.parse(again.out)).toEqual({ spec: '001-digest', task: 'T1', result: 'already-ticked' });
  });

  test('tick of a task already ticked exits 0 with "already ticked" and writes nothing', () => {
    const root = repo();
    expect(run(root, 'tick', '001', 'T1').code).toBe(0);
    const before = tree(root);
    const again = run(root, 'tick', '001', 'T1');
    expect({ code: again.code, err: again.err }).toEqual({ code: 0, err: '' });
    expect(again.out.trim()).toBe('already ticked T1');
    const fixtureTicked = run(root, 'tick', '001', 'T3');
    expect(fixtureTicked.code).toBe(0);
    expect(fixtureTicked.out.trim()).toBe('already ticked T3');
    expect(tree(root)).toEqual(before);
  });

  test('tick of an unknown task exits 1 and leaves the bytes unchanged', () => {
    const root = repo();
    const before = tree(root);
    for (const task of ['T9', 'T4']) {
      // T4 stands only inside a fence: no task line carries it.
      const r = run(root, 'tick', '001', task);
      expect(r.code).toBe(1);
      expect(r.out).toBe('');
      expect(r.err).toContain('unknown-task');
    }
    expect(tree(root)).toEqual(before);
  });

  test('tick of a spec without tasks.md exits 1 and writes nothing', () => {
    const root = repo();
    rmSync(join(root, TASKS_PATH));
    const before = tree(root);
    const r = run(root, 'tick', '001', 'T1');
    expect(r.code).toBe(1);
    expect(r.err).toContain('has no tasks.md');
    expect(tree(root)).toEqual(before);
  });
});
