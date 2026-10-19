// The plugin CLI's archive (spec 031, ISC-39 surface; the `/spec done <NNN> archive` step): `spec-check archive <NNN>…
// [--dry-run] [--reason "<why>"]` moves finished spec folders from `specs/NNN-slug/` to `specs/archive/NNN-slug/`, all or
// none, and `spec-check archive restore <NNN>` brings one back. Blockers: drift and a live claim lock are hard; a phase
// other than `complete` and an open claim are soft, lifted by `--reason`. Every relative path that leaves the folder
// gains one `../` on the way in and loses it on the way out; references to the old path outside `specs/` are reported,
// never edited; the number stays taken. Exit 0 moved or dry run ok · 1 bad arguments · 3 blocked, nothing moved.
//
// Every case runs in a fresh git repository under the system temp directory.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseFrontmatter } from '../../core/src/frontmatter.ts';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const ACTIVE = 'specs/001-digest';
const ARCHIVED = 'specs/archive/001-digest';
const TODAY = new Date().toISOString().slice(0, 10);

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
  return r.stdout.toString();
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

/** Every file under `root` but `.git/`, with its contents: the tree a dry run must leave as it found it. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (name === '.git') continue;
      if (statSync(path).isDirectory()) walk(path);
      else out[relative(root, path)] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
}

/** Sets `phase:` in a spec's frontmatter; the allocated spec reads `phase: scoping`. */
function setPhase(root: string, dir: string, phase: string): void {
  const path = join(root, dir, 'spec.md');
  writeFileSync(path, readFileSync(path, 'utf8').replace('phase: scoping', `phase: ${phase}`));
}

/** A fresh git repository, no master, with spec 001 complete and spec 002 still scoping. */
function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-archive-')));
  dirs.push(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'builder@example.invalid');
  git(root, 'config', 'user.name', 'Builder');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  for (const slug of ['digest', 'export']) {
    const r = run(root, 'allocate', 'feature', slug, '--goal', `The ${slug} works.`);
    if (r.code !== 0) throw new Error(`allocate failed: ${r.err}`);
  }
  setPhase(root, ACTIVE, 'complete');
  // A link that leaves the folder and one that stays inside it, and a gate mark the move must carry along.
  const spec = join(root, ACTIVE, 'spec.md');
  writeFileSync(spec, `${readFileSync(spec, 'utf8')}\nSee [the export](../002-export/spec.md) and [the context](context.md).\n`);
  mkdirSync(join(root, ACTIVE, '.gates'), { recursive: true });
  writeFileSync(join(root, ACTIVE, '.gates', 'reviewed.json'), '{"gate":"reviewed"}\n');
  return root;
}

describe('spec-check archive', () => {
  test('a dry run reports the move and writes nothing', () => {
    const root = repo();
    const before = snapshot(root);
    const r = run(root, 'archive', '001', '--dry-run');
    expect(r.code).toBe(0);
    expect(r.out).toContain('would archive specs/001-digest');
    expect(snapshot(root)).toEqual(before);
  });

  test('a complete spec moves with all its files, its outbound paths shifted one level and the date stamped', () => {
    const root = repo();
    const before = snapshot(root);
    const r = run(root, 'archive', '001');
    expect(r.code).toBe(0);
    expect(existsSync(join(root, ACTIVE))).toBe(false);
    const moved = Object.keys(before)
      .filter((f) => f.startsWith(`${ACTIVE}/`))
      .map((f) => f.replace(ACTIVE, ARCHIVED));
    expect(moved.length).toBeGreaterThanOrEqual(4);
    for (const f of moved) expect(existsSync(join(root, f))).toBe(true);
    expect(read(root, `${ARCHIVED}/.gates/reviewed.json`)).toBe('{"gate":"reviewed"}\n');

    const spec = read(root, `${ARCHIVED}/spec.md`);
    const fm = parseFrontmatter(spec);
    expect(fm.data.archived).toBe(TODAY);
    expect(fm.data.archivedReason).toBeNull();
    expect(fm.data.isaMaster).toBe('../../../ISA.md');
    expect(spec).toContain('[the export](../../002-export/spec.md)');
    expect(spec).toContain('[the context](context.md)');
    // The other spec stays where it is.
    expect(existsSync(join(root, 'specs/002-export/spec.md'))).toBe(true);
  });

  test('a tracked folder moves with git mv, untracked files along; references outside specs/ are reported, not edited', () => {
    const root = repo();
    writeFileSync(join(root, 'README.md'), '# Notes\n\nThe digest lives in specs/001-digest/spec.md.\n');
    writeFileSync(join(root, '.gitignore'), '.gates/\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'specs');
    const r = run(root, 'archive', '001', '--json');
    expect(r.code).toBe(0);
    const report = JSON.parse(r.out) as { archived: Array<{ spec: string; references: Array<{ file: string; line: number }> }> };
    expect(report.archived.map((a) => a.spec)).toEqual(['001-digest']);
    expect(report.archived[0]?.references).toEqual([expect.objectContaining({ file: 'README.md', line: 3 })]);
    expect(read(root, 'README.md')).toContain('specs/001-digest/spec.md');
    expect(git(root, 'status', '--porcelain')).toContain(`R  ${ACTIVE}/context.md -> ${ARCHIVED}/context.md`);
    expect(existsSync(join(root, ARCHIVED, '.gates', 'reviewed.json'))).toBe(true);
  });

  test('a spec that is not complete, without a reason, blocks the whole call: exit 3, nothing moved', () => {
    const root = repo();
    const before = snapshot(root);
    const alone = run(root, 'archive', '002');
    expect(alone.code).toBe(3);
    expect(`${alone.out}${alone.err}`).toContain('phase is scoping');
    const both = run(root, 'archive', '001', '002');
    expect(both.code).toBe(3);
    expect(`${both.out}${both.err}`).toContain('nothing moved');
    expect(run(root, 'archive', '002', '--dry-run').code).toBe(3);
    expect(snapshot(root)).toEqual(before);
  });

  test('--reason lifts a soft blocker and lands in the frontmatter', () => {
    const root = repo();
    const r = run(root, 'archive', '002', '--reason', 'Dropped: the export moved to another tool.');
    expect(r.code).toBe(0);
    const fm = parseFrontmatter(read(root, 'specs/archive/002-export/spec.md'));
    expect(fm.data.archivedReason).toBe('Dropped: the export moved to another tool.');
  });

  test('a live claim lock is a hard blocker that --reason does not lift', () => {
    const root = repo();
    const claims = join(root, '.claims.json');
    writeFileSync(claims, JSON.stringify([{ text: 'The export writes one file.' }]));
    expect(run(root, 'mint', '002', '--feature', 'F1', '--claims', claims).code).toBe(0);
    expect(run(root, 'claim', 'ISC-1', '--session', 'a:claude:builder/T1').code).toBe(0);
    const r = run(root, 'archive', '002', '--reason', 'Dropped.');
    expect(r.code).toBe(3);
    expect(`${r.out}${r.err}`).toContain('lock');
    expect(existsSync(join(root, 'specs/002-export/spec.md'))).toBe(true);
  });

  test('restore brings the spec back as it was before the archive', () => {
    const root = repo();
    const before = snapshot(root);
    expect(run(root, 'archive', '001').code).toBe(0);
    const r = run(root, 'archive', 'restore', '001');
    expect(r.code).toBe(0);
    expect(r.out).toContain('restored specs/archive/001-digest');
    expect(existsSync(join(root, ARCHIVED))).toBe(false);
    expect(snapshot(root)).toEqual(before);
  });

  test('the number stays taken: allocate after an archive skips it', () => {
    const root = repo();
    expect(run(root, 'archive', '001', '002', '--reason', 'Both done or dropped.').code).toBe(0);
    expect(readdirSync(join(root, 'specs')).filter((n) => n !== 'archive')).toEqual([]);
    const r = run(root, 'allocate', 'feature', 'search', '--goal', 'Search works.');
    expect(r.code).toBe(0);
    expect(existsSync(join(root, 'specs/003-search/spec.md'))).toBe(true);
  });

  test('bad arguments exit 1 and write nothing', () => {
    const root = repo();
    const before = snapshot(root);
    expect(run(root, 'archive').code).toBe(1);
    expect(run(root, 'archive', '009').code).toBe(1);
    expect(run(root, 'archive', 'restore', '001').code).toBe(1); // 001 is active
    expect(run(root, 'archive', '001', '--reason', '').code).toBe(1);
    expect(snapshot(root)).toEqual(before);
    expect(run(root, 'archive', '001').code).toBe(0);
    expect(run(root, 'archive', '001').code).toBe(1); // already archived
  });
});
