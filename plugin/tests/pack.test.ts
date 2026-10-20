// `spec-check pack <spec> T<k> --json` (spec 010, T4/T5, ISC-333), driven as a process the way the skill calls it. The
// fixture repository `fixtures/pack/` (a master, a constitution with `## Lanes`, two specs whose words overlap) is
// copied into a fresh git repository under the system temp directory; the pack of 001's Anti-claim task equals the
// golden `fixtures/pack.golden.json`, its keys stand in the fixed order, and the command writes nothing. Its
// decisions (T16, ISC-337) are exactly the spec's and the plan's Decisions rows naming ISC-3 or T3 as a whole token.
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { buildPack } from '../../core/src/pack.ts';

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

// T17, ISC-338 (Anti): the pack of 001 T3 holds no line of another spec, none of the master outside the task's goal,
// claim and Test Strategy row, and no text of 001's other claims, rows, tasks or decisions. The fixture's words overlap
// on purpose (digest, title, repeated, T3, ISC-3); each fragment below stands in exactly one foreign place, and the
// test first proves it is still there, so a fixture edit cannot empty the check.
describe('spec-check pack foreign lines (ISC-338)', () => {
  const FOREIGN: Readonly<Record<string, readonly string[]>> = {
    'specs/002-other/spec.md': [
      'A digest of last month is gone',
      'stays findable by its week number',
      'An archived digest keeps its week number',
      'archiving a digest rewrites a note',
      'byte-identical notes',
      'T3 of the archive keeps a repeated digest title as two files',
      'stay outside the archive index ledger',
    ],
    'specs/002-other/plan.md': ['it never opens a note', 'names the second file with a counter'],
    'specs/002-other/tasks.md': ['Repeated digest titles kept as two files', 'Archive file name with the week number', 'plugin/src/archive-cli.ts'],
    'ISA.md': [
      'Why: the notes of a week become one page',
      'an old digest stays findable',
      'The digest and the archive ship as two specs',
      'settle repeated titles in the master ledger',
    ],
    'specs/001-digest/spec.md': [
      'The notes of a week sit in seven files',
      'The digest of one week fits on one screen',
      'Every note title of the week appears in the digest',
      'digest: line budget',
      'all titles present',
      '`bun test core/ -t "digest"`',
      'The digest is Markdown, not HTML',
      'ISC-30 is a later claim',
      'T30 and T3x are other tasks',
    ],
    'specs/001-digest/plan.md': ['A pure model in `core/`', 'T1 reads no file', 'T30 sorts the archive'],
    'specs/001-digest/tasks.md': ['Digest model with a line budget', 'Every note title into the digest', 'Command `digest` prints the page', 'core/src/digest.ts', 'core/tests/digest.test.ts'],
  };

  /** Every string value of the pack, at any depth, so a fragment is matched unescaped. */
  const strings = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : typeof value === 'object' && value !== null ? Object.values(value).flatMap(strings) : [];

  function packText(): { text: string; source: (path: string) => string } {
    const root = repo();
    const r = run(root, 'pack', '001', 'T3', '--json');
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    return { text: strings(JSON.parse(r.out) as unknown).join('\n'), source: (path) => readFileSync(join(root, path), 'utf8') };
  }

  test('pack: no foreign lines of another spec, the master, or 001\'s other claims, rows, tasks and decisions', () => {
    const { text, source } = packText();
    for (const [path, fragments] of Object.entries(FOREIGN)) {
      const file = source(path);
      for (const fragment of fragments) {
        expect({ path, fragment, inSource: file.includes(fragment) }).toEqual({ path, fragment, inSource: true });
        expect({ path, fragment, inPack: text.includes(fragment) }).toEqual({ path, fragment, inPack: false });
      }
    }
  });

  test('pack: the own goal, claim, row and task line are in, so the foreign check reads a real pack', () => {
    const { text } = packText();
    for (const own of ['A week of notes becomes one digest page', 'Anti: the digest drops a note whose title repeats an earlier one.', 'both notes listed', 'Repeated titles kept as two lines']) {
      expect(text).toContain(own);
    }
  });
});

// T19, ISC-339: a temp copy of the fixture whose 001 spec.md and plan.md each get 20 more dated Decisions rows naming
// T3 and ISC-3, 40 in all and well over 8 KiB together. `pack` prints `capPack(buildPack(…))` at PACK_LIMIT: the line
// is at most 8192 UTF-8 bytes, the oldest rows went first and are counted in `truncated`, and goal, task, claim, probe
// and lane are the uncapped pack's. The plain fixture stays under the limit, its golden unchanged with truncated 0.
describe('spec-check pack size (ISC-339)', () => {
  const LIMIT = 8192;
  const bytes = (s: string): number => new TextEncoder().encode(s).length;

  /** Row n (0–39) dated 2026-04-01 + n days, every row about 300 bytes, even rows into spec.md, odd ones into plan.md. */
  const rowOf = (n: number): string => {
    const date = new Date(Date.UTC(2026, 3, 1 + n)).toISOString().slice(0, 10);
    return `${date}: T3 keeps repeated title ${n} as its own line, and ISC-3 holds for it; ${'the digest stays one page. '.repeat(10).trim()}`;
  };

  /** The fixture repository with the 40 rows put at the top of both Decisions sections. */
  function bigRepo(): string {
    const root = repo();
    for (const [file, parity] of [['spec.md', 0], ['plan.md', 1]] as const) {
      const path = join(root, 'specs', '001-digest', file);
      const rows = Array.from({ length: 40 }, (_, n) => n)
        .filter((n) => n % 2 === parity)
        .map((n) => `- ${rowOf(n)}`);
      writeFileSync(path, readFileSync(path, 'utf8').replace('## Decisions\n', `## Decisions\n\n${rows.join('\n')}\n`));
    }
    return root;
  }

  type Decision = { source: string; text: string };
  type PackOut = { decisions: Decision[]; truncated: number; [key: string]: unknown };

  /** The uncapped pack of the same files, built by core directly, as the reference the capped one is held against. */
  function uncapped(root: string): PackOut {
    const dir = join(root, 'specs', '001-digest');
    return buildPack({
      slug: '001-digest',
      spec: readFileSync(join(dir, 'spec.md'), 'utf8'),
      tasks: readFileSync(join(dir, 'tasks.md'), 'utf8'),
      plan: readFileSync(join(dir, 'plan.md'), 'utf8'),
      constitution: readFileSync(join(root, 'specs', 'constitution.md'), 'utf8'),
      task: 'T3',
    }) as unknown as PackOut;
  }

  test('pack size: 40 extra Decisions rows print one line of at most 8192 bytes, truncated naming the rows left out', () => {
    const root = bigRepo();
    const full = uncapped(root);
    expect(full.decisions.length).toBe(45);
    expect(bytes(JSON.stringify(full))).toBeGreaterThan(LIMIT);
    const r = run(root, 'pack', '001', 'T3', '--json');
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: '' });
    expect(r.out.endsWith('\n')).toBe(true);
    expect(r.out.slice(0, -1)).not.toContain('\n');
    expect(bytes(r.out.slice(0, -1))).toBeLessThanOrEqual(LIMIT);
    const pack = JSON.parse(r.out) as PackOut;
    expect(pack.truncated).toBeGreaterThan(0);
    expect(pack.truncated).toBe(full.decisions.length - pack.decisions.length);
  });

  test('pack size: the newest rows are kept in pack order, and no more were dropped than the 8192-byte limit needs', () => {
    const root = bigRepo();
    const full = uncapped(root);
    const pack = JSON.parse(run(root, 'pack', '001', 'T3', '--json').out) as PackOut;
    const kept = new Set(pack.decisions.map((d) => d.text));
    const dropped = full.decisions.filter((d) => !kept.has(d.text));
    expect(pack.decisions).toEqual(full.decisions.filter((d) => kept.has(d.text)));
    const date = (d: Decision): string => d.text.slice(0, 10);
    const oldestKept = pack.decisions.map(date).sort()[0] ?? '';
    for (const d of dropped) expect(date(d) <= oldestKept).toBe(true);
    expect(kept.has(rowOf(39))).toBe(true);
    // One more row, the newest of those dropped, would push the line over the limit: the cap is 8192, not lower.
    const back = [...dropped].sort((a, b) => (date(a) < date(b) ? -1 : 1)).at(-1);
    expect(back).toBeDefined();
    const plusOne = { ...pack, decisions: full.decisions.filter((d) => kept.has(d.text) || d === back), truncated: pack.truncated - 1 };
    expect(bytes(JSON.stringify(plusOne))).toBeGreaterThan(LIMIT);
  });

  test('pack size: goal, task, claim, probe and lane are never cut and equal the uncapped pack', () => {
    const root = bigRepo();
    const full = uncapped(root);
    const pack = JSON.parse(run(root, 'pack', '001', 'T3', '--json').out) as PackOut;
    for (const key of ['spec', 'goal', 'task', 'claim', 'probe', 'lane'] as const) expect(pack[key]).toEqual(full[key]);
    expect(Object.keys(pack)).toEqual(['spec', 'goal', 'task', 'claim', 'probe', 'lane', 'decisions', 'truncated']);
  });

  test('pack size: the plain fixture stays under the limit, equal to the golden with truncated 0', () => {
    const r = run(repo(), 'pack', '001', 'T3', '--json');
    expect(bytes(r.out)).toBeLessThanOrEqual(LIMIT);
    expect(JSON.parse(r.out)).toEqual(golden());
    expect((JSON.parse(r.out) as PackOut).truncated).toBe(0);
  });
});
