// The plugin's bundled CLI (spec 031, T25, ISC-43): `plugin/spectant/bin/spec-check` is `plugin/src/spec-check.ts`
// with every `core/` module it imports inlined, built by `bun run build:plugin` and committed, because a marketplace
// install copies only `plugin/spectant/` and the CLI must run there without this repository beside it.
//
// (a) freshness: `build-plugin.ts --check` rebuilds in memory and compares bytes with the committed bundle, so a
//     change to the CLI source or to `core/` without a rebuild fails `bun test` and with it `verify:quick`;
// (b) standalone: a copy of `plugin/spectant/` in a temp folder outside the repository runs `--help`, `allocate` and
//     `drift` in a fresh git repository, which proves no `../core` import is left for run time;
// (c) nothing individual or machine-bound ships in it: no absolute home path, no Claude home folder, no LifeOS path,
//     variable or tool name; and the plugin's own source adds no LifeOS mention to it (see the note on (c) below).
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SHIPPED = join(ROOT, 'plugin', 'spectant');
const BUNDLE = join(SHIPPED, 'bin', 'spec-check');

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function sh(cwd: string, cmd: string[]): { code: number; text: string } {
  const r = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, text: `${r.stdout.toString()}${r.stderr.toString()}` };
}

function git(cwd: string, ...args: string[]): void {
  const r = sh(cwd, ['git', ...args]);
  if (r.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.text}`);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : name.endsWith('.ts') ? [path] : [];
  });
}

describe('plugin bundle: plugin/spectant/bin/spec-check', () => {
  test('is committed, starts with the bun shebang and is executable', () => {
    expect(existsSync(BUNDLE)).toBe(true);
    expect(readFileSync(BUNDLE, 'utf8').startsWith('#!/usr/bin/env bun\n')).toBe(true);
    expect(statSync(BUNDLE).mode & 0o111).toBe(0o111);
  });

  test('(a) matches a fresh build of plugin/src/spec-check.ts (build-plugin.ts --check)', () => {
    const r = sh(ROOT, ['bun', 'scripts/build-plugin.ts', '--check']);
    expect(r.text).not.toContain('differs');
    expect(r.code).toBe(0);
  });

  test('(b) runs standalone from a copy of plugin/spectant/ outside this repository', () => {
    const copy = join(tempDir('spec-plugin-copy-'), 'spectant');
    cpSync(SHIPPED, copy, { recursive: true });
    const cli = join(copy, 'bin', 'spec-check');
    expect(relative(ROOT, cli).startsWith('..')).toBe(true);

    const help = sh(copy, ['bun', cli, '--help']);
    expect(help.code).toBe(0);
    expect(help.text).toContain('allocate');

    const repo = tempDir('spec-plugin-repo-');
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'builder@example.invalid');
    git(repo, 'config', 'user.name', 'Builder');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init');

    const allocate = sh(repo, ['bun', cli, 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.']);
    expect(allocate.text).not.toContain('Cannot find module');
    expect(allocate.code).toBe(0);
    expect(existsSync(join(repo, 'specs', '001-digest', 'spec.md'))).toBe(true);

    const drift = sh(repo, ['bun', cli, 'drift', '--json']);
    expect([0, 3]).toContain(drift.code);
    expect(JSON.parse(drift.text) as unknown).toHaveProperty('drift');
  });

  test('(c) carries no absolute home path, no Claude home folder and no LifeOS path, variable or tool', () => {
    const text = readFileSync(BUNDLE, 'utf8');
    const forbidden: ReadonlyArray<readonly [string, RegExp]> = [
      ['home path', /\/Users\/[A-Za-z]|\/home\/[A-Za-z]|[A-Z]:\\Users\\/],
      // A path that starts at `~/`, not a regex such as `/~~/g`.
      ['home-relative path', /(?:^|[\s"'`(=])~\/[\w.]/m],
      ['Claude home folder', /\.claude\//],
      ['LifeOS directory or variable', /LIFEOS/],
      ['LifeOS tool', /IsaFrontier|ISAGate|Skill\(\s*["']ISA/],
      ['voice notification', /localhost:31337|\/notify\b/],
    ];
    expect(forbidden.filter(([, re]) => re.test(text)).map(([name]) => name)).toEqual([]);
  });

  // The two diagnostics `core/` writes about an optional LifeOS lock source are inlined with the parser (one parser,
  // no fork); the CLI never passes a LifeOS state directory, so they cannot fire. What the bundle must not gain is a
  // LifeOS mention of the plugin's own: every line naming LifeOS has to come from `core/src/` verbatim.
  test('(c) names LifeOS only in text inlined verbatim from core/, never from plugin/src/', () => {
    const own = sourceFiles(join(ROOT, 'plugin', 'src')).filter((f) => /lifeos/i.test(readFileSync(f, 'utf8')));
    expect(own.map((f) => relative(ROOT, f))).toEqual([]);

    const core = sourceFiles(join(ROOT, 'core', 'src')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const lines = readFileSync(BUNDLE, 'utf8').split('\n').filter((l) => /lifeos/i.test(l));
    const literals = lines.flatMap((l) => [...l.matchAll(/(["'`])((?:(?!\1).)*lifeos(?:(?!\1).)*)\1/gi)].map((m) => m[2] ?? ''));
    expect(literals.filter((s) => !core.includes(s))).toEqual([]);
  });
});
