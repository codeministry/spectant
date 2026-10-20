// `spec-check pack <spec> T<k> --json` (spec 010, T4/T5, ISC-333), driven as a process the way the skill calls it. The
// fixture repository `fixtures/pack/` (a master, a constitution with `## Lanes`, two specs whose words overlap) is
// copied into a fresh git repository under the system temp directory; the pack of 001's Anti-claim task equals the
// golden `fixtures/pack.golden.json`, its keys stand in the fixed order, and the command writes nothing.
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const FIXTURE = join(import.meta.dir, 'fixtures', 'pack');
const GOLDEN = join(import.meta.dir, 'fixtures', 'pack.golden.json');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A fresh git repository with one empty commit and the fixture repository copied in. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-pack-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  cpSync(FIXTURE, dir, { recursive: true });
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

/** Every file of the tree outside `.git/` with its text, so a run that writes anything shows up as a difference. */
function tree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name));
    if (path === '.git' || path.startsWith(`.git/`)) continue;
    files[path] = readFileSync(join(root, path), 'utf8');
  }
  return files;
}

const golden = (): unknown => JSON.parse(readFileSync(GOLDEN, 'utf8'));

describe('spec-check pack (ISC-333)', () => {
  test('pack --json of the Anti-claim task prints one compact JSON line equal to the golden, and writes nothing', () => {
    const root = repo();
    const before = tree(root);
    const r = run(root, 'pack', '001', 'T3', '--json');
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const pack = JSON.parse(r.out) as unknown;
    expect(r.out).toBe(`${JSON.stringify(pack)}\n`);
    expect(pack).toEqual(golden());
    expect(tree(root)).toEqual(before);
  });

  test('pack --json keeps the fixed key order, top level and nested, and the Anti: prefix of the claim', () => {
    const root = repo();
    const pack = JSON.parse(run(root, 'pack', 'specs/001-digest/', 'T3', '--json').out) as {
      claim: { text: string };
      [key: string]: unknown;
    };
    expect(Object.keys(pack)).toEqual(['spec', 'goal', 'task', 'claim', 'probe', 'lane', 'decisions', 'truncated']);
    for (const [key, keys] of [
      ['task', ['id', 'lane', 'text', 'paths']],
      ['claim', ['id', 'text', 'after']],
      ['probe', ['type', 'check', 'threshold', 'tool']],
      ['lane', ['name', 'context', 'probe']],
    ] as const) {
      expect(Object.keys(pack[key] as object)).toEqual([...keys]);
    }
    expect(pack.claim.text.startsWith('Anti: ')).toBe(true);
  });

  test('pack without --json prints a few readable lines naming the task, the claim and the lane', () => {
    const r = run(repo(), 'pack', '001', 'T3');
    expect(r.code).toBe(0);
    expect(r.out).toContain('T3');
    expect(r.out).toContain('ISC-3: Anti: ');
    expect(r.out).toContain('bun test plugin/');
    expect(() => JSON.parse(r.out) as unknown).toThrow();
  });

  test('pack of an unknown task exits 1 with the code unknown-task, and writes nothing', () => {
    const root = repo();
    const before = tree(root);
    const r = run(root, 'pack', '001', 'T9', '--json');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('unknown-task');
    expect(tree(root)).toEqual(before);
  });
});
