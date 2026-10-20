// The plugin CLI `spec-check` (spec 031, T15/T16, ISC-41), driven as a process the way the skill calls it. Every test
// works in a fresh git repository under the system temp directory and never in this repository's own `specs/`. The
// chain the claim names: `allocate` a feature spec, `mint` two claims (master first, then the spec), `verify` one,
// `decide`, `drift` clean, `status --json` lists the spec, `frontier` names the open claim takeable.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    const report = json(drift) as { drift: boolean; specs: Array<{ report: { state_mismatch: unknown[] } }> };
    expect(report.drift).toBe(true);
    expect(report.specs[0]?.report.state_mismatch).toHaveLength(1);
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

  test('from a linked worktree the root is the main checkout', () => {
    const root = repo();
    expect(run(root, 'allocate', 'feature', 'digest', '--goal', 'One digest.').code).toBe(0);
    git(root, 'worktree', 'add', '-q', join(root, '.worktrees', 'side'), '-b', 'side');
    const status = json(run(join(root, '.worktrees', 'side'), 'status', '--json')) as { specs: Array<{ slug: string }> };
    expect(status.specs.map((s) => s.slug)).toEqual(['001-digest']);
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
