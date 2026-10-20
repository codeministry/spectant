// `spec-check pack <spec> T<k> --json` (spec 010, T4/T5, ISC-333), driven as a process the way the skill calls it. The
// fixture repository `fixtures/pack/` (a master, a constitution with `## Lanes`, two specs whose words overlap) is
// copied into a fresh git repository under the system temp directory; the pack of 001's Anti-claim task equals the
// golden `fixtures/pack.golden.json`, its keys stand in the fixed order, and the command writes nothing. Its
// decisions (T16, ISC-337) are exactly the spec's and the plan's Decisions rows naming ISC-3 or T3 as a whole token.
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
    const r = run(root, 'pack', '001', 'T9');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toContain('unknown-task');
    // Under --json the refusal is the one error object on stdout, stderr empty (ISC-335).
    const json = run(root, 'pack', '001', 'T9', '--json');
    expect({ code: json.code, err: json.err }).toEqual({ code: 1, err: '' });
    expect(JSON.parse(json.out)).toMatchObject({ error: 'unknown-task', command: 'pack' });
    expect(tree(root)).toEqual(before);
  });
});

// T16, ISC-337: the Decisions rows of 001's spec.md and plan.md name ISC-3, ISC-3.1, ISC-30, T3, T30, T3x, other
// claims, or nothing; 002-other's rows name T3 and ISC-5 of another spec.
describe('spec-check pack decisions (ISC-337)', () => {
  const decisionsOf = (): Array<{ source: string; text: string }> =>
    (JSON.parse(run(repo(), 'pack', '001', 'T3', '--json').out) as { decisions: Array<{ source: string; text: string }> }).decisions;

  test('pack decisions: exactly the rows naming ISC-3 (sub-claims included) or T3, spec.md first, in file order', () => {
    expect(decisionsOf()).toEqual([
      { source: 'spec.md', text: '2026-03-04: ISC-3 counts a repeated title as two notes; T3 keeps both lines.' },
      { source: 'spec.md', text: '2026-03-04: ISC-3.1 splits off a title that repeats across two weeks.' },
      { source: 'spec.md', text: '2026-03-05: The digest renders as one page,\n  its title order kept line by line as\n  T3 writes it.' },
      { source: 'plan.md', text: '2026-03-03: T3 compares titles case-sensitively; ISC-3 names no folding.' },
      { source: 'plan.md', text: '2026-03-05: A repeated title keeps its own line (ISC-3).' },
    ]);
  });

  test('pack decisions: no row that names only ISC-30, T30, T3x, other claims or nothing, and none of another spec', () => {
    const texts = decisionsOf().map((d) => d.text);
    for (const text of texts) {
      expect(text).not.toContain('ISC-30');
      expect(text).not.toContain('T30');
      expect(text).not.toContain('Markdown, not HTML');
      expect(text).not.toContain('T1 reads no file');
      expect(text).not.toContain('archive');
    }
  });
});
