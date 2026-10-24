// The plugin CLI `spec-check` (spec 031, T15/T16, ISC-41), driven as a process the way the skill calls it. Every test
// works in a fresh git repository under the system temp directory and never in this repository's own `specs/`. The
// chain the claim names: `allocate` a feature spec, `mint` two claims (master first, then the spec), `verify` one,
// `decide`, `drift` clean, `status --json` lists the spec, `frontier` names the open claim takeable.
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseClaims } from '../../core/src/claims.ts';
import { parseFrontmatter } from '../../core/src/frontmatter.ts';
import { hashForGate } from '../../core/src/gates.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');

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

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** A fresh git repository with one empty commit; `master` writes ISA.md at its root. */
function repo(master: string | null = MASTER): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  if (master !== null) writeFileSync(join(dir, 'ISA.md'), master);
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

function json(r: Run): unknown {
  expect(r.err).toBe('');
  return JSON.parse(r.out);
}

const read = (root: string, path: string): string => readFileSync(join(root, path), 'utf8');

function writeClaims(root: string): string {
  const path = join(root, '.claims.json');
  writeFileSync(path, JSON.stringify(CLAIMS));
  return path;
}

/** The reviewed mark the later `gate reviewed --yes` writes, set by hand so `frontier` can show a takeable claim. */
function markReviewed(root: string, dir: string): void {
  const spec = read(root, `${dir}/spec.md`);
  const mark = { gate: 'reviewed', at: '2026-03-04T08:00:00Z', files: { 'spec.md': hashForGate('spec.md', spec), 'plan.md': null, 'tasks.md': null } };
  Bun.spawnSync(['mkdir', '-p', join(root, dir, '.gates')]);
  writeFileSync(join(root, dir, '.gates', 'reviewed.json'), JSON.stringify(mark));
}

describe('spec-check: the new-spec chain (ISC-41)', () => {
  test('allocate → mint → verify → decide → drift 0 → status lists it → frontier names the open claim', () => {
    const root = repo();

    const allocated = run(root, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.', '--feature', 'F1', '--json');
    expect(allocated.code).toBe(0);
    const alloc = json(allocated) as { dir: string; number: number };
    expect(alloc.dir).toBe('specs/001-digest');
    for (const f of ['spec.md', 'context.md', 'events.jsonl']) expect(existsSync(join(root, alloc.dir, f))).toBe(true);
    expect(parseFrontmatter(read(root, 'specs/001-digest/spec.md')).data.isaFeature).toBe('F1');

    const minted = run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root), '--json');
    expect(minted.err).toBe('');
    expect(minted.code).toBe(0);
    expect(json(minted) as { ids: string[]; master: boolean }).toMatchObject({ ids: ['ISC-1', 'ISC-2'], master: true });
    const master = parseClaims(read(root, 'ISA.md'));
    expect(master.features.find((f) => f.id === 'F1')?.claims).toEqual(['ISC-1', 'ISC-2']);
    const spec = parseClaims(read(root, 'specs/001-digest/spec.md'));
    expect(spec.claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-2']);
    expect(spec.claims[1]?.after).toEqual(['ISC-1']);

    const verified = run(root, 'verify', 'specs/001-digest', 'ISC-1', 'test', 'bun test digest.test.ts — 3 pass');
    expect(verified.err).toBe('');
    expect(verified.code).toBe(0);
    for (const file of ['ISA.md', 'specs/001-digest/spec.md']) {
      const doc = parseClaims(read(root, file));
      expect(doc.claims.find((c) => c.id === 'ISC-1')?.checked).toBe(true);
      expect(doc.verification.map((v) => v.id)).toContain('ISC-1');
    }
    expect(parseFrontmatter(read(root, 'specs/001-digest/spec.md')).values.progress).toBe('1/2');

    const decided = run(root, 'decide', 'specs/001-digest/spec.md', 'The digest is Markdown, not HTML.');
    expect(decided.code).toBe(0);
    expect(read(root, 'specs/001-digest/spec.md')).toMatch(/^- \d{4}-\d{2}-\d{2}: The digest is Markdown, not HTML\.$/m);

    const drift = run(root, 'drift');
    expect(drift.err).toBe('');
    expect(drift.code).toBe(0);
    const driftJson = json(run(root, 'drift', '001', '--json')) as { drift: boolean; specs: Array<{ id: string; drift: boolean }> };
    expect(driftJson.drift).toBe(false);
    expect(driftJson.specs.map((s) => s.id)).toEqual(['001']);

    type StatusRow = { id: string; slug: string; phase: string | null; stage: string; progress: string; partition: { open: string[]; closed: string[] } };
    const status = json(run(root, 'status', '--json')) as { specs: StatusRow[] };
    expect(status.specs).toHaveLength(1);
    expect(status.specs[0]).toMatchObject({ id: '001', slug: '001-digest', phase: 'scoping', progress: '1/2' });
    expect(status.specs[0]?.partition.closed).toEqual(['ISC-1']);
    expect(status.specs[0]?.partition.open).toEqual(['ISC-2']);

    // Before the review the open claim is gated, never takeable (ISC-99).
    const gated = json(run(root, 'frontier', '001', '--json')) as { takeable: string[]; gated: string[] };
    expect(gated.takeable).toEqual([]);
    expect(gated.gated).toEqual(['ISC-2']);

    markReviewed(root, 'specs/001-digest');
    const frontier = run(root, 'frontier', 'specs/001-digest', '--json');
    expect(frontier.code).toBe(0);
    const front = json(frontier) as { takeable: string[]; dispatch: Array<{ claim: string }>; reviewed: string };
    expect(front.reviewed).toBe('fresh');
    expect(front.takeable).toEqual(['ISC-2']);
    expect(front.dispatch.map((d) => d.claim)).toEqual(['ISC-2']);
  });

  test('drift exits 3 when the master and the spec disagree', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.', '--feature', 'F1').code).toBe(0);
    expect(run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root)).code).toBe(0);
    expect(run(root, 'verify', '001', 'ISC-1', 'test', 'green').code).toBe(0);
    writeFileSync(join(root, 'ISA.md'), read(root, 'ISA.md').replace('- [x] ISC-1', '- [ ] ISC-1')); // single-core: allow — the test reopens a claim to cause drift; it parses nothing
    const drift = run(root, 'drift', '--json');
    expect(drift.code).toBe(3);
    // Exit 3 under --json is the one error object; the report stands in its detail (ISC-335).
    const answer = json(drift) as { error: string; command: string; detail: { drift: boolean; specs: Array<{ report: { state_mismatch: unknown[] } }> } };
    expect(answer).toMatchObject({ error: 'drift', command: 'drift' });
    expect(answer.detail.drift).toBe(true);
    expect(answer.detail.specs[0]?.report.state_mismatch).toHaveLength(1);
  });
});

describe('spec-check --json: compact errors', () => {
  /** The fixed error codes `spec-check --help` names on its `Error codes` line. */
  const helpCodes = (root: string): string[] => {
    const line = run(root, '--help').out.split('\n').find((l) => l.startsWith('Error codes')) ?? '';
    return line
      .slice(line.indexOf(':') + 1)
      .split(',')
      .map((c) => c.trim().replace(/\.$/u, ''))
      .filter((c) => c !== '');
  };

  test('compact: an unknown spec under --json is one error object on stdout and nothing on stderr', () => {
    const root = repo();
    const codes = helpCodes(root);
    for (const args of [['frontier', '999'], ['pack', '999', 'T1'], ['tick', 'nope', 'T1']]) {
      const r = run(root, ...args, '--json');
      expect({ code: r.code, err: r.err }).toEqual({ code: 1, err: '' });
      expect(r.out.trimEnd().split('\n')).toHaveLength(1);
      const answer = JSON.parse(r.out) as Record<string, unknown>;
      expect(Object.keys(answer)).toEqual(['error', 'command', 'detail']);
      expect(answer).toMatchObject({ error: 'unknown-spec', command: args[0] });
      expect(String(answer.detail)).toContain('no spec folder matches');
      expect(codes).toContain(String(answer.error));
    }
  });

  test('compact: without --json the unknown spec stays one line on stderr and stdout stays empty', () => {
    const root = repo();
    const r = run(root, 'frontier', '999');
    expect(r.code).toBe(1);
    expect(r.out).toBe('');
    expect(r.err).toMatch(/^spec-check: frontier: no spec folder matches "999"/u);
  });

  test('compact: an unknown command and a bad option under --json answer with their own codes', () => {
    const root = repo();
    const unknown = run(root, 'nope', '--json');
    expect({ code: unknown.code, err: unknown.err }).toEqual({ code: 1, err: '' });
    expect(JSON.parse(unknown.out)).toEqual({ error: 'unknown-command', command: 'nope', detail: 'unknown command "nope"' });
    const option = run(root, 'status', '--bogus', '--json');
    expect({ code: option.code, err: option.err }).toEqual({ code: 1, err: '' });
    expect(JSON.parse(option.out)).toEqual({ error: 'bad-args', command: 'status', detail: 'unknown option --bogus' });
    const codes = helpCodes(root);
    for (const code of ['unknown-command', 'bad-args', 'unknown-spec', 'drift', 'unknown-task']) expect(codes).toContain(code);
  });
});

// T11, ISC-335: every command but `hook`, in a fresh copy of the pack fixture repository, answers one success and one
// refusal under --json with exactly one JSON object on stdout and nothing on stderr; a refusal (exit 1, 3 or 4) is
// `{error, command, detail}` with a code from the `--help` list. The command list comes from `--help`, so a new
// command without a case here fails the guard test.
describe('spec-check --json: compact answers of every command', () => {
  const FIXTURE = join(import.meta.dir, 'fixtures', 'pack');
  const HOLDER = 'a:claude:00000001';
  const OTHER = 'a:claude:00000002';

  interface Case {
    /** Commands run first, without --json, each expected to exit 0. */
    readonly setup?: ReadonlyArray<readonly string[]>;
    /** The refusal, run before the success: its exit code and error code. */
    readonly fail: readonly string[];
    readonly exit: 1 | 3 | 4;
    readonly code: string;
    readonly ok: readonly string[];
  }

  const CASES: Readonly<Record<string, Case>> = {
    allocate: { fail: ['novel', 'x'], exit: 1, code: 'bad-args', ok: ['feature', 'fresh', '--goal', 'One page.'] },
    mint: { fail: ['001', '--feature', 'F1'], exit: 1, code: 'bad-args', ok: ['001', '--feature', 'F1', '--claims', '.claims.json'] },
    verify: { fail: ['001', 'ISC-9', 'test', 'green'], exit: 1, code: 'unknown-id', ok: ['001', 'ISC-1', 'test', 'green'] },
    decide: { fail: ['001', 'one\ntwo'], exit: 1, code: 'multi-line', ok: ['001', 'The digest is one page.'] },
    drift: { fail: ['999'], exit: 1, code: 'unknown-spec', ok: ['001'] },
    status: { fail: ['999'], exit: 1, code: 'unknown-spec', ok: [] },
    frontier: { fail: ['999'], exit: 1, code: 'unknown-spec', ok: ['001'] },
    pack: { fail: ['001', 'T9'], exit: 1, code: 'unknown-task', ok: ['001', 'T3'] },
    tick: { fail: ['001', 'T9'], exit: 1, code: 'unknown-task', ok: ['001', 'T1'] },
    claim: {
      setup: [['claim', 'ISC-2', '--task', 'T2', '--session', HOLDER]],
      fail: ['ISC-2', '--task', 'T2', '--session', OTHER],
      exit: 4,
      code: 'lock-held',
      ok: ['ISC-1', '--task', 'T1', '--session', HOLDER],
    },
    release: {
      setup: [['claim', 'ISC-2', '--task', 'T2', '--session', HOLDER]],
      fail: ['ISC-2', '--task', 'T2', '--session', OTHER],
      exit: 4,
      code: 'lock-lost',
      ok: ['ISC-2', '--task', 'T2', '--session', HOLDER],
    },
    transition: { setup: [['gate', 'reviewed', '001', '--yes']], fail: ['001', 'done'], exit: 3, code: 'refused', ok: ['001', 'build'] },
    run: { fail: ['end', 'r-unknown', '--outcome', 'ok'], exit: 1, code: 'bad-args', ok: ['start', '001', '--command', '/spec implement 001'] },
    gate: { fail: ['check', 'reviewed', '001'], exit: 3, code: 'gate-missing', ok: ['reviewed', '001', '--yes'] },
    archive: { fail: ['001', '--dry-run'], exit: 3, code: 'blocked', ok: ['001', '--dry-run', '--reason', 'superseded'] },
    // A --plan that is a directory is no refusal the command foresaw: it answers with the code `internal`.
    rounds: { fail: ['record', '001', '--plan', 'specs'], exit: 1, code: 'internal', ok: ['record', '001'] },
    activity: {
      fail: ['probe', '--task', 'T1', '--session', HOLDER, '--result', 'green'],
      exit: 1,
      code: 'bad-args',
      ok: ['probe', '--task', 'T1', '--claim', 'ISC-1', '--session', HOLDER, '--result', 'green'],
    },
    // The pack fixture has no tech.md: doc check refuses `incomplete`, doc target only names the target.
    doc: { fail: ['check'], exit: 3, code: 'incomplete', ok: ['target'] },
    tldr: { fail: ['sweep'], exit: 1, code: 'bad-args', ok: ['facts'] },
  };

  /** A fresh git repository holding a copy of the pack fixture and the claims file `mint` reads. */
  function fixtureRepo(): string {
    const root = repo(null);
    cpSync(FIXTURE, root, { recursive: true });
    writeClaims(root);
    return root;
  }

  /** The command names `spec-check --help` lists, one per indented `  <name>  <summary>` line. */
  const helpCommands = (root: string): string[] =>
    run(root, '--help')
      .out.split('\n')
      .filter((l) => l.startsWith('  '))
      .map((l) => l.trim().split(' ')[0] ?? '');

  /** The fixed error codes `spec-check --help` names on its `Error codes` line. */
  const helpCodes = (root: string): string[] => {
    const line = run(root, '--help').out.split('\n').find((l) => l.startsWith('Error codes')) ?? '';
    return line
      .slice(line.indexOf(':') + 1)
      .split(',')
      .map((c) => c.trim().replace(/\.$/u, ''))
      .filter((c) => c !== '');
  };

  /** The whole stdout is exactly one JSON value, an object, and stderr is empty. */
  function oneObject(r: Run): Record<string, unknown> {
    expect(r.err).toBe('');
    const value = JSON.parse(r.out) as unknown;
    expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(true);
    return value as Record<string, unknown>;
  }

  test('compact: every command --help lists, hook aside, has a success and a refusal case here', () => {
    const commands = helpCommands(repo(null));
    expect(commands).toContain('hook');
    expect(commands.filter((c) => c !== 'hook').toSorted()).toEqual(Object.keys(CASES).toSorted());
  });

  for (const [name, c] of Object.entries(CASES)) {
    test(`compact: ${name} --json answers one object on success and one error object on refusal`, () => {
      const root = fixtureRepo();
      const codes = helpCodes(root);
      for (const step of c.setup ?? []) expect(run(root, ...step).code).toBe(0);

      const refused = run(root, name, ...c.fail, '--json');
      const error = oneObject(refused);
      expect({ exit: refused.code, keys: Object.keys(error) }).toEqual({ exit: c.exit, keys: ['error', 'command', 'detail'] });
      expect(error).toMatchObject({ error: c.code, command: name });
      expect(codes).toContain(String(error.error));

      const done = run(root, name, ...c.ok, '--json');
      const answer = oneObject(done);
      expect(done.code).toBe(0);
      expect(Object.keys(answer)).not.toContain('error');
    });
  }

  test('compact: hook stays the exception and prints nothing, also with --json', () => {
    const root = fixtureRepo();
    const r = Bun.spawnSync(['bun', CLI, 'hook', '--json'], {
      cwd: root,
      stdin: Buffer.from('{not json'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    expect({ code: r.exitCode, out: r.stdout.toString() }).toEqual({ code: 0, out: '' });
  });
});

describe('spec-check: allocate', () => {
  test('the next number is one past every folder, archived folder and spec branch', () => {
    const root = repo();
    git(root, 'branch', 'feature/007-elsewhere');
    Bun.spawnSync(['mkdir', '-p', join(root, 'specs', 'archive', '004-old')]);
    const r = json(run(root, 'allocate', 'bug', 'broken-digest', '--goal', 'The digest renders again.', '--json')) as { dir: string; number: number };
    expect(r).toMatchObject({ dir: 'specs/008-broken-digest', number: 8 });
  });

  test('refuses a slug that already has a folder and bad arguments, exit 1', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.').code).toBe(0);
    const again = run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.');
    expect(again.code).toBe(1);
    expect(again.err).toContain('digest');
    expect(existsSync(join(root, 'specs', '002-digest'))).toBe(false);
    expect(run(root, 'allocate', 'novel', 'x').code).toBe(1);
    expect(run(root, 'allocate', 'feature').code).toBe(1);
    expect(run(root, 'allocate', 'feature', 'x', '--bogus').code).toBe(1);
  });

});

// The read source of a spec (spec 062, ISC-438): status, drift, frontier, pack and gate check read each spec where the
// app reads it, the copy in its live spec worktree when git tracks `specs/NNN-slug` there, else the main checkout,
// whichever checkout they are called from. Each fixture carries one change only in the worktree's copy: ISC-1 ticked,
// a new goal and a reviewed mark over the changed spec.md.
describe('spec-check: worktree source', () => {
  const SPEC = 'specs/001-digest';
  const WORKTREE = '.worktrees/001-digest';
  const TASKS = '# Tasks 001 — Digest\n\n- [ ] T1 · ISC-1 · core — Digest model · `core/src/digest.ts`\n';

  /** A repository with spec 001 minted (ISC-1, ISC-2) and one task; nothing committed yet. */
  function minted(): string {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.', '--feature', 'F1').code).toBe(0);
    expect(run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root)).code).toBe(0);
    rmSync(join(root, '.claims.json'));
    writeFileSync(join(root, SPEC, 'tasks.md'), TASKS);
    return root;
  }

  /** The change only the worktree's copy at `dir` (relative to `root`) carries: ISC-1 ticked, a new goal, a mark. */
  function changeCopy(root: string, dir: string): void {
    const path = join(root, dir, 'spec.md');
    const text = readFileSync(path, 'utf8');
    const changed = text.replace('- [ ] ISC-1:', '- [x] ISC-1:').replace('One digest.', 'The worktree digest.'); // single-core: allow — a fixture edit, not a reader
    expect(changed).not.toBe(text);
    writeFileSync(path, changed);
    const files = { 'spec.md': hashForGate('spec.md', changed), 'plan.md': null, 'tasks.md': hashForGate('tasks.md', TASKS) };
    mkdirSync(join(root, dir, '.gates'), { recursive: true });
    writeFileSync(join(root, dir, '.gates', 'reviewed.json'), JSON.stringify({ gate: 'reviewed', at: '2026-03-04T08:00:00Z', files }));
  }

  /** What the five reads show for spec 001, called from `cwd`. */
  function reads(cwd: string): Record<string, unknown> {
    const status = json(run(cwd, 'status', '--json')) as { specs: Array<{ progress: string; reviewed: string }> };
    const front = json(run(cwd, 'frontier', '001', '--json')) as { takeable: string[]; reviewed: string };
    const pack = json(run(cwd, 'pack', '001', 'T1', '--json')) as { goal: string };
    return {
      status: status.specs.map((s) => `${s.progress} ${s.reviewed}`),
      drift: run(cwd, 'drift', '001').code,
      frontier: `${front.reviewed} ${front.takeable.join(',')}`,
      goal: pack.goal.trim(),
      gate: run(cwd, 'gate', 'check', 'reviewed', '001').code,
    };
  }

  const MAIN = { status: ['0/2 missing'], drift: 0, frontier: 'missing ', goal: 'One digest.', gate: 3 };
  const COPY = { status: ['1/2 fresh'], drift: 3, frontier: 'fresh ISC-2', goal: 'The worktree digest.', gate: 0 };

  test('worktree source: a spec worktree with tracked specs/ reads its copy, from the worktree and from the main checkout', () => {
    const root = minted();
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'spec 001');
    expect(reads(root)).toEqual(MAIN);
    git(root, 'worktree', 'add', '-q', join(root, WORKTREE), '-b', 'feature/001-digest');
    changeCopy(root, `${WORKTREE}/${SPEC}`);
    expect(reads(join(root, WORKTREE))).toEqual(COPY);
    expect(reads(root)).toEqual(COPY);
    expect(read(root, `${SPEC}/spec.md`)).toContain('- [ ] ISC-1:');
  });

  test('worktree source: a spec worktree with a linked specs/ reads the main checkout', () => {
    const root = minted();
    git(root, 'worktree', 'add', '-q', join(root, WORKTREE), '-b', 'feature/001-digest');
    symlinkSync(join(root, 'specs'), join(root, WORKTREE, 'specs'));
    expect(reads(join(root, WORKTREE))).toEqual(MAIN);
    expect(reads(root)).toEqual(MAIN);
  });

  test('worktree source: a spec worktree without specs/ reads the main checkout', () => {
    const root = minted();
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'spec 001');
    git(root, 'worktree', 'add', '-q', join(root, WORKTREE), '-b', 'feature/001-digest');
    git(join(root, WORKTREE), 'rm', '-r', '-q', 'specs');
    expect(existsSync(join(root, WORKTREE, 'specs'))).toBe(false);
    expect(reads(join(root, WORKTREE))).toEqual(MAIN);
    expect(reads(root)).toEqual(MAIN);
  });

  test('worktree source: a worktree without tracked specs/ reads the main checkout', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.').code).toBe(0);
    git(root, 'worktree', 'add', '-q', join(root, '.worktrees', 'side'), '-b', 'side');
    const status = json(run(join(root, '.worktrees', 'side'), 'status', '--json')) as { specs: Array<{ slug: string }> };
    expect(status.specs.map((s) => s.slug)).toEqual(['001-digest']);
  });

  // Every write of spec-check lands in the spec's read source (spec 062, ISC-439): called from a spec worktree whose
  // branch tracks `specs/`, tick, verify, mint, decide, transition, gate reviewed, gate code-reviewed, allocate and
  // archive change only the worktree's copy; the main checkout's `specs/` (and a tracked ISA.md) stay byte-identical.
  describe('worktree writes', () => {
    /** Every file under `dir` but `.git`, `.worktrees` and `.spectant`, by relative path. */
    function snapshot(dir: string, prefix = ''): Record<string, string> {
      const out: Record<string, string> = {};
      for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
        const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
        if (['.git', '.worktrees', '.spectant'].includes(path)) continue;
        if (entry.isDirectory()) Object.assign(out, snapshot(dir, path));
        else out[path] = readFileSync(join(dir, path), 'utf8');
      }
      return out;
    }

    /** The tree id `git add -A && git write-tree` gives in `checkout`, through a throwaway index. */
    function treeOf(checkout: string): string {
      const index = join(mkdtempSync(join(tmpdir(), 'spec-check-index-')), 'index');
      dirs.push(dirname(index));
      const env = { ...process.env, GIT_INDEX_FILE: index };
      for (const args of [['add', '-A'], ['write-tree']]) {
        const r = Bun.spawnSync(['git', ...args], { cwd: checkout, env, stdout: 'pipe', stderr: 'pipe' });
        if (r.exitCode !== 0) throw new Error(r.stderr.toString());
        if (args[0] === 'write-tree') return r.stdout.toString().trim();
      }
      return '';
    }

    /** A claims file outside the repository, so no checkout's tree carries it. */
    function claimsFile(text: string): string {
      const dir = mkdtempSync(join(tmpdir(), 'spec-check-claims-'));
      dirs.push(dir);
      const path = join(dir, 'claims.json');
      writeFileSync(path, JSON.stringify([{ text, row: { type: 'test', check: 'export', threshold: 'one file', tool: 'bun test', anchorsTo: 'goal' } }]));
      return path;
    }

    /** Spec 001 committed on main (ISA.md too when `withMaster`), its spec worktree on `feature/001-digest`. */
    function forked(withMaster: boolean): { root: string; wt: string } {
      const root = minted();
      git(root, 'add', ...(withMaster ? ['-A'] : ['specs']));
      git(root, 'commit', '-q', '-m', 'spec 001');
      const wt = join(root, WORKTREE);
      git(root, 'worktree', 'add', '-q', wt, '-b', 'feature/001-digest');
      return { root, wt };
    }

    test('worktree writes: every write command lands in the worktree copy; the gate checks read the marks fresh from both checkouts', () => {
      const { root, wt } = forked(true);
      const before = snapshot(root);
      const ok = (cwd: string, ...args: string[]): Run => {
        const r = run(cwd, ...args);
        expect(`${args.join(' ')} → ${r.code} ${r.err}${r.code === 0 ? '' : r.out}`).toBe(`${args.join(' ')} → 0 `);
        return r;
      };
      ok(wt, 'tick', '001', 'T1');
      ok(wt, 'mint', '001', '--feature', 'F1', '--claims', claimsFile('The digest exports as one file.'));
      ok(wt, 'verify', '001', 'ISC-1', 'test', 'bun test src/digest.test.ts — 1 pass');
      ok(wt, 'decide', '001', 'The digest is Markdown.');
      const tasks = read(wt, `${SPEC}/tasks.md`);
      rmSync(join(wt, SPEC, 'tasks.md'));
      writeFileSync(join(wt, SPEC, 'plan.md'), '# 001 — Plan\n\n## Approach\n\nOne pass over the notes.\n');
      ok(wt, 'transition', '001', 'tasks', '--command', '/spec plan 001');
      writeFileSync(join(wt, SPEC, 'tasks.md'), tasks);
      ok(wt, 'transition', '001', 'review', '--command', '/spec tasks 001');
      ok(wt, 'gate', 'reviewed', '001', '--yes');
      ok(wt, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0');
      for (const cwd of [wt, root]) for (const gate of ['reviewed', 'code-reviewed']) ok(cwd, 'gate', 'check', gate, '001');

      const copy = read(wt, `${SPEC}/spec.md`);
      expect(read(wt, `${SPEC}/tasks.md`)).toContain('- [x] T1 ·');
      expect(parseClaims(copy).claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-2', 'ISC-3']);
      expect(read(wt, 'ISA.md')).toContain('ISC-3');
      expect(copy).toContain('The digest is Markdown.');
      expect(parseFrontmatter(copy).data.stage).toBe('review');
      expect(read(wt, `${SPEC}/events.jsonl`)).toContain('"to":"build"');
      const mark = JSON.parse(read(wt, `${SPEC}/.gates/code-reviewed.json`)) as { tree: string; branch: string };
      expect(mark.branch).toBe('feature/001-digest');
      expect(mark.tree).toBe(treeOf(wt));
      expect(read(wt, '.gitignore')).toContain('.gates/');

      // allocate from the worktree: the new folder in its specs/, numbered past every source.
      expect(json(ok(wt, 'allocate', 'feature', 'export', '--goal', 'One export.', '--json'))).toMatchObject({ dir: 'specs/002-export' });
      expect(existsSync(join(wt, 'specs/002-export/spec.md'))).toBe(true);
      // archive from the worktree: the move in the worktree's index, never the main checkout's.
      ok(wt, 'archive', '001', '--reason', 'a fixture');
      expect(existsSync(join(wt, 'specs/archive/001-digest/spec.md'))).toBe(true);
      expect(git(wt, 'status', '--porcelain', '--', 'specs')).toContain('RM specs/001-digest/spec.md -> specs/archive/001-digest/spec.md');

      expect(snapshot(root)).toEqual(before);
      expect(git(root, 'status', '--porcelain', '--', 'specs', 'ISA.md', '.gitignore')).toBe('');
      // A later allocation from the main checkout skips the number only the worktree carries.
      expect(json(ok(root, 'allocate', 'feature', 'import', '--goal', 'One import.', '--json'))).toMatchObject({ dir: 'specs/003-import' });
    }, 30_000); // seventeen CLI processes, each with its git reads

    test('worktree writes: with ISA.md untracked, mint and verify write the main checkout master and the worktree copy', () => {
      const { root, wt } = forked(false);
      const before = snapshot(join(root, 'specs'));
      expect(run(wt, 'mint', '001', '--feature', 'F1', '--claims', claimsFile('The digest exports as one file.')).code).toBe(0);
      expect(run(wt, 'verify', '001', 'ISC-3', 'test', 'bun test src/export.test.ts — 1 pass').code).toBe(0);
      expect(existsSync(join(wt, 'ISA.md'))).toBe(false);
      expect(read(root, 'ISA.md')).toContain('ISC-3');
      expect(parseClaims(read(wt, `${SPEC}/spec.md`)).claims.find((c) => c.id === 'ISC-3')?.checked).toBe(true);
      expect(snapshot(join(root, 'specs'))).toEqual(before);
    });

    // A linked `specs/` reads from the main checkout, yet the mark names the spec worktree's tree, as the app reads it
    // (spec 041, ISC-211): set from either checkout, it is the worktree's tree and fresh in both.
    test('worktree writes: with a linked specs/, a code-reviewed mark set from either checkout names the spec worktree tree', () => {
      const root = minted();
      const wt = join(root, WORKTREE);
      git(root, 'worktree', 'add', '-q', wt, '-b', 'feature/001-digest');
      symlinkSync(join(root, 'specs'), join(wt, 'specs'));
      for (const cwd of [root, wt]) {
        expect(run(cwd, 'gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0').code).toBe(0);
        const mark = JSON.parse(read(root, `${SPEC}/.gates/code-reviewed.json`)) as { tree: string; branch: string };
        expect(mark.branch).toBe('feature/001-digest');
        expect(mark.tree).toBe(treeOf(wt));
        for (const at of [root, wt]) expect(run(at, 'gate', 'check', 'code-reviewed', '001').code).toBe(0);
      }
    }, 30_000);

    // The main checkout stays untouched (spec 062, ISC-440): from a spec worktree whose branch tracks `specs/` and
    // ISA.md, every command `spec-check --help` lists changes no file of the main checkout but
    // `.spectant/activity.jsonl`, creates no directory there and runs no `git mv` there.
    describe('main untouched', () => {
      /** Every file under `root` by relative path with its sha256, and every directory; `skip` paths are left out. */
      function fullTree(root: string, skip: readonly string[]): { files: Record<string, string>; dirs: string[] } {
        const files: Record<string, string> = {};
        const found: string[] = [];
        const walk = (prefix: string): void => {
          for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
            const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
            if (skip.includes(path)) continue;
            if (entry.isDirectory()) {
              found.push(path);
              walk(path);
            } else files[path] = new Bun.CryptoHasher('sha256').update(readFileSync(join(root, path))).digest('hex');
          }
        };
        walk('');
        return { files, dirs: found.toSorted() };
      }

      test('main untouched: every listed command run from the spec worktree leaves the main checkout byte-identical but activity.jsonl', () => {
        const { root, wt } = forked(true);
        const LOG = '.spectant/activity.jsonl';
        const SESSION = 'a:claude:00000062';
        mkdirSync(join(root, '.spectant'));
        writeFileSync(join(root, LOG), '');
        // Left out: the worktree itself and its own index under `.git/worktrees/`, which `archive` moves the spec in.
        // Everything else under `.git/` counts, the main index and the object store included.
        const skip = ['.worktrees', '.git/worktrees/001-digest/index', LOG];
        const porcelain = git(root, 'status', '--porcelain', '--untracked-files=all');
        const stage = git(root, 'ls-files', '-s');
        const before = fullTree(root, skip);
        const covered = new Set<string>();
        const ok = (args: readonly string[], env: Record<string, string> = {}, stdin = ''): Run => {
          covered.add(args[0] ?? '');
          const r = Bun.spawnSync(['bun', CLI, ...args], { cwd: wt, stdin: Buffer.from(stdin), stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
          const got = { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
          expect(`${args.join(' ')} → ${got.code} ${got.err}${got.code === 0 ? '' : got.out}`).toBe(`${args.join(' ')} → 0 `);
          return got;
        };

        for (const args of [['status', '--json'], ['drift', '001'], ['frontier', '001'], ['pack', '001', 'T1'], ['tick', '001', 'T1']]) ok(args);
        ok(['mint', '001', '--feature', 'F1', '--claims', claimsFile('The digest exports as one file.')]);
        ok(['verify', '001', 'ISC-1', 'test', 'bun test src/digest.test.ts — 1 pass']);
        ok(['decide', '001', 'The digest is Markdown.']);
        const tasks = read(wt, `${SPEC}/tasks.md`);
        rmSync(join(wt, SPEC, 'tasks.md'));
        writeFileSync(join(wt, SPEC, 'plan.md'), '# 001 — Plan\n\n## Approach\n\nOne pass over the notes.\n');
        ok(['transition', '001', 'tasks', '--command', '/spec plan 001']);
        writeFileSync(join(wt, SPEC, 'tasks.md'), tasks);
        ok(['transition', '001', 'review', '--command', '/spec tasks 001']);
        ok(['gate', 'reviewed', '001', '--yes']);
        ok(['gate', 'check', 'reviewed', '001']);
        ok(['claim', 'ISC-2', '--task', 'T1', '--session', SESSION]);
        ok(['activity', 'probe', '--task', 'T1', '--claim', 'ISC-2', '--session', SESSION, '--result', 'green']);
        ok(['release', 'ISC-2', '--task', 'T1', '--session', SESSION]);
        const started = JSON.parse(ok(['run', 'start', '001', '--command', '/spec implement 001', '--json']).out) as { run: string };
        ok(['run', 'end', started.run, '--outcome', 'ok']);
        ok(['rounds', 'record', '001', '--outcome', 'T1=pass', '--builder', 'T1=Engineer']);
        const data = mkdtempSync(join(tmpdir(), 'spec-check-data-'));
        dirs.push(data);
        // The hook claims and dispatches ISC-1 of spec 001 (T1), then builds and releases it.
        for (const payload of ['pre-tool-use-agent', 'post-tool-use-agent-completed']) {
          ok(['hook'], { CLAUDE_PROJECT_DIR: wt, CLAUDE_PLUGIN_DATA: data }, readFileSync(join(import.meta.dir, 'fixtures', 'payloads', `${payload}.json`), 'utf8'));
        }
        ok(['gate', 'code-reviewed', '001', '--yes', '--code', '0', '--security', '0']);
        ok(['gate', 'check', 'code-reviewed', '001']);
        ok(['allocate', 'feature', 'export', '--goal', 'One export.']);
        // No tech.md and no tldr.md in the fixture: doc target finds nothing to copy, the rest only reads.
        ok(['doc', 'target', '--json']);
        ok(['tldr', 'target', '--json']);
        ok(['tldr', 'facts', '--json']);
        ok(['archive', '001', '--reason', 'a fixture']);

        expect([...covered].toSorted()).toEqual(run(root, '--help').out.split('\n').filter((l) => l.startsWith('  ')).map((l) => l.trim().split(' ')[0] ?? '').toSorted());
        expect(fullTree(root, skip)).toEqual(before);
        expect(git(root, 'status', '--porcelain', '--untracked-files=all')).toBe(porcelain);
        expect(git(root, 'ls-files', '-s')).toBe(stage);
        // The one file the main checkout may change: the activity log, which got the claim, probe, release, run and hook lines.
        expect(read(root, LOG)).toContain('"run-end"');
        expect(existsSync(join(wt, LOG))).toBe(false);
      }, 60_000); // twenty-five CLI processes, each with its git reads
    });
  });
});

describe('spec-check: without a master', () => {
  test('mint writes the claims into the spec only and says so', () => {
    const root = repo(null);
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.').code).toBe(0);
    const minted = run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root));
    expect(minted.code).toBe(0);
    expect(minted.out).toContain('no master ISA.md');
    expect(existsSync(join(root, 'ISA.md'))).toBe(false);
    expect(parseClaims(read(root, 'specs/001-digest/spec.md')).claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-2']);
    expect(run(root, 'drift').code).toBe(0);
  });
});

describe('spec-check: a claimless spec (spec 043)', () => {
  type NextRow = { id: string; slug: string; stage: string; next: string | null; reason: string | null };

  test('status sends a freshly allocated feature spec without claims to /spec new NNN, never plan or tasks (ISC-267)', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.', '--feature', 'F1', '--json').code).toBe(0);
    const status = json(run(root, 'status', '--json')) as { specs: NextRow[] };
    expect(status.specs).toHaveLength(1);
    const row = status.specs[0] as NextRow;
    expect(row).toMatchObject({ id: '001', slug: '001-digest', next: '/spec new 001', reason: 'no claims yet' });
    expect(row.next?.startsWith('/spec plan')).toBe(false);
    expect(row.next?.startsWith('/spec tasks')).toBe(false);
    const one = json(run(root, 'status', '001', '--json')) as { specs: NextRow[] };
    expect(one.specs.map((s) => s.next)).toEqual(['/spec new 001']);
  });

  test('mint into the existing claimless folder keeps its number, drift exits 0, status names /spec plan again (ISC-268)', () => {
    const root = repo();
    const alloc = json(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.', '--feature', 'F1', '--json')) as { dir: string; number: number };
    expect(alloc).toMatchObject({ dir: 'specs/001-digest', number: 1 });
    const before = json(run(root, 'status', '001', '--json')) as { specs: NextRow[] };
    expect(before.specs.map((s) => s.next)).toEqual(['/spec new 001']);

    const minted = run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root), '--json');
    expect(minted.err).toBe('');
    expect(minted.code).toBe(0);
    expect(json(minted) as { ids: string[] }).toMatchObject({ ids: ['ISC-1', 'ISC-2'] });

    const folders = readdirSync(join(root, 'specs'), { withFileTypes: true }).filter((e) => e.isDirectory() && /^\d{3}-/.test(e.name));
    expect(folders.map((e) => e.name)).toEqual(['001-digest']);
    expect(parseClaims(read(root, 'specs/001-digest/spec.md')).claims.map((c) => c.id)).toEqual(['ISC-1', 'ISC-2']);

    const drift = run(root, 'drift', '001');
    expect(drift.err).toBe('');
    expect(drift.code).toBe(0);

    const after = json(run(root, 'status', '001', '--json')) as { specs: NextRow[] };
    expect(after.specs).toHaveLength(1);
    expect(after.specs[0]).toMatchObject({ id: '001', slug: '001-digest', next: '/spec plan 001' });
  });
});

describe('spec-check: the command surface', () => {
  test('--help lists the commands and each command has its own help', () => {
    const root = repo();
    const help = run(root, '--help');
    expect(help.code).toBe(0);
    for (const c of ['allocate', 'mint', 'verify', 'decide', 'drift', 'status', 'frontier']) expect(help.out).toContain(c);
    const one = run(root, 'mint', '--help');
    expect(one.code).toBe(0);
    expect(one.out).toContain('--claims');
  });

  test('an unknown command exits 1, and every command the help lists is built', () => {
    const root = repo();
    const unknown = run(root, 'nonsense');
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('unknown command');
    const help = run(root, '--help');
    expect(help.out).toContain('archive');
    expect(help.out).not.toContain('not built yet');
  });

  test('verify refuses a multi-line stub and an unknown claim, writing nothing', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.', '--feature', 'F1').code).toBe(0);
    expect(run(root, 'mint', '001', '--feature', 'F1', '--claims', writeClaims(root)).code).toBe(0);
    const before = read(root, 'specs/001-digest/spec.md');
    expect(run(root, 'verify', '001', 'ISC-1', 'test', 'one\ntwo').code).toBe(1);
    expect(run(root, 'verify', '001', 'ISC-9', 'test', 'green').code).toBe(1);
    expect(read(root, 'specs/001-digest/spec.md')).toBe(before);
  });
});

describe('spec-check: activity run events (spec 032, ISC-33.1)', () => {
  const LOG = '.spectant/activity.jsonl';
  const SESSION = 'a:claude:00000000';
  const WORKTREE = '.claude/worktrees/agent-a1b2c3d4e5f6a7b8c';

  const logLines = (root: string): Array<Record<string, unknown>> =>
    existsSync(join(root, LOG)) ? read(root, LOG).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>) : [];

  test('a run event without --claim is refused, exit 1, nothing written', () => {
    const root = repo();
    for (const event of ['patch', 'apply', 'dispatch', 'build']) {
      const r = run(root, 'activity', event, '--task', 'T1', '--session', SESSION, '--worktree', WORKTREE);
      expect(r.code).toBe(1);
      expect(r.err).toContain('claim');
      expect(r.err).toContain('nothing written');
    }
    expect(existsSync(join(root, LOG))).toBe(false);
  });

  test('patch and apply with --claim are written through the shared writer, each line carrying its claim', () => {
    const root = repo();
    for (const event of ['patch', 'apply']) {
      const r = run(root, 'activity', event, '--task', 'T1', '--claim', 'ISC-1', '--session', SESSION, '--worktree', WORKTREE, '--json');
      expect(r.code).toBe(0);
      expect(json(r)).toMatchObject({ event, claim: 'ISC-1', task: 'T1', session: SESSION, worktree: WORKTREE });
    }
    expect(logLines(root).map((l) => [l.event, l.claim, l.task])).toEqual([
      ['patch', 'ISC-1', 'T1'],
      ['apply', 'ISC-1', 'T1'],
    ]);
  });
});
