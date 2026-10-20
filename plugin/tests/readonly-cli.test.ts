// `spec-check pack` and `tick` stay read-only (spec 010, T25, ISC-342, Anti). The fixture repository `fixtures/pack/`
// is committed into a fresh git repository under the system temp directory, with a `.spectant/activity.jsonl`, and
// every file and directory of the tree, `.git/` and `.spectant/` included, is hashed before and after a run: `pack`
// leaves the tree identical, `tick` changes 001's tasks.md and nothing else. Network and app database are checked
// statically, the cheaper honest way: neither the CLI source nor any module it imports (walked from its relative
// imports, core included) nor the shipped bundle names `fetch(`, a socket or HTTP module, `WebSocket`, a Bun socket or
// server, `bun:sqlite`, a `.db`/`.sqlite` path or the user's home or config directory.
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const CLI = join(import.meta.dir, '..', 'src', 'spec-check.ts');
const BUNDLE = join(import.meta.dir, '..', 'spectant', 'bin', 'spec-check');
const FIXTURE = join(import.meta.dir, 'fixtures', 'pack');
const REPO = resolve(import.meta.dir, '..', '..');
const TASKS = 'specs/001-digest/tasks.md';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

/** A fresh git repository with the fixture committed and one activity line in `.spectant/`, so both dirs are hashed. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-readonly-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  cpSync(FIXTURE, dir, { recursive: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'fixture');
  mkdirSync(join(dir, '.spectant'));
  writeFileSync(join(dir, '.spectant', 'activity.jsonl'), '{"kind":"probe","at":"2026-03-04T08:00:00Z"}\n');
  return dir;
}

function run(cwd: string, ...args: string[]): { code: number; err: string } {
  const r = Bun.spawnSync(['bun', CLI, ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { code: r.exitCode, err: r.stderr.toString() };
}

/** Every file of the tree by its sha256 and every directory by a marker, `.git/` and `.spectant/` included. */
function tree(root: string): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
    const path = relative(root, join(entry.parentPath, entry.name));
    if (entry.isDirectory()) entries[`${path}/`] = 'dir';
    else entries[path] = new Bun.CryptoHasher('sha256').update(readFileSync(join(root, path))).digest('hex');
  }
  return entries;
}

/** The paths whose hash differs, appeared or vanished between two trees. */
function changed(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((p) => before[p] !== after[p]).sort();
}

describe('spec-check pack and tick readonly (ISC-342)', () => {
  test('readonly: pack --json leaves every file of the tree identical, .git/ and .spectant/ included', () => {
    const root = repo();
    const before = tree(root);
    expect(Object.keys(before).some((p) => p.startsWith('.git/objects/'))).toBe(true);
    expect(before['.spectant/activity.jsonl']).toBeDefined();
    expect(run(root, 'pack', '001', 'T3', '--json')).toEqual({ code: 0, err: '' });
    expect(run(root, 'pack', '001', 'T3')).toEqual({ code: 0, err: '' });
    expect(changed(before, tree(root))).toEqual([]);
  });

  test('readonly: tick changes 001\'s tasks.md and no other file or directory of the tree', () => {
    const root = repo();
    const before = tree(root);
    expect(run(root, 'tick', '001', 'T1')).toEqual({ code: 0, err: '' });
    expect(changed(before, tree(root))).toEqual([TASKS]);
    // A second tick of the same box writes nothing more.
    const ticked = tree(root);
    expect(run(root, 'tick', '001', 'T1').code).toBe(0);
    expect(changed(ticked, tree(root))).toEqual([]);
  });

  test('readonly: a refused pack or tick of an unknown task changes nothing', () => {
    const root = repo();
    const before = tree(root);
    expect(run(root, 'pack', '001', 'T9', '--json').code).toBe(1);
    expect(run(root, 'tick', '001', 'T9').code).toBe(1);
    expect(changed(before, tree(root))).toEqual([]);
  });
});

/** What no module behind pack and tick may name: network access, the app's SQLite database, the user's home or config. */
const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
  ['fetch(', /\bfetch\s*\(/],
  ['node:net / http / https / http2 / tls / dgram', /['"](node:)?(net|http|https|http2|tls|dgram)['"]/],
  ['WebSocket', /\bWebSocket\b/],
  ['Bun socket or server', /\bBun\.(connect|listen|serve|udpSocket)\b/],
  ['bun:sqlite', /bun:sqlite/],
  ['a .db or .sqlite path', /\.(db|sqlite3?)['"`]/],
  ['the home or config directory', /\bhomedir\b|XDG_CONFIG_HOME|XDG_DATA_HOME|Application Support|spectant\.db/],
];

/** The CLI source and every module it reaches through relative imports, core's included. */
function importGraph(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() ?? '';
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = resolve(dirname(file), m[1] ?? '');
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

function offences(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return FORBIDDEN.filter(([, pattern]) => pattern.test(text)).map(([name]) => `${relative(REPO, file)}: ${name}`);
}

describe('spec-check readonly: no network, no app database (ISC-342)', () => {
  test('readonly: the CLI source and every module it imports name no network, SQLite, .db path or config dir', () => {
    const graph = importGraph(CLI);
    for (const module of ['core/src/pack.ts', 'core/src/tasks.ts', 'plugin/src/activity-log.ts']) {
      expect(graph.map((f) => relative(REPO, f))).toContain(module);
    }
    expect(graph.flatMap(offences)).toEqual([]);
  });

  test('readonly: the shipped bundle names no network, SQLite, .db path or config dir either', () => {
    expect(offences(BUNDLE)).toEqual([]);
  });
});
