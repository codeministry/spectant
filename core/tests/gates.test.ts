// The review and code-review marks (spec 001 T36, ISC-15 and ISC-6). `core/src/gates.ts` must verify a mark the old
// Spec skill wrote, byte for byte, and must do so without writing anything: the normalisation and the hashes are
// checked against marks on disk, the tree id against `git write-tree` in a throwaway repository, and the module source
// against a list of tokens that could write.
//
// Only this test shells out to git, and only inside a temp directory outside the repository; the module never does.
import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  gateState,
  hashForGate,
  normalizeForGate,
  readGateMark,
  REVIEWED_FILES,
  treeIdOf,
  type CodeReviewedMark,
  type ReviewedFile,
  type ReviewedMark,
  type TreeEntry,
} from '../src/gates.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const GATES_SOURCE = join(import.meta.dir, '..', 'src', 'gates.ts');

function specTexts(specDir: string): Partial<Record<ReviewedFile, string>> {
  const texts: Partial<Record<ReviewedFile, string>> = {};
  for (const f of REVIEWED_FILES) {
    try {
      texts[f] = readFileSync(join(specDir, f), 'utf-8');
    } catch {
      // absent file: the mark holds null for it
    }
  }
  return texts;
}

function mustReviewed(text: string): ReviewedMark {
  const { mark, diagnostics } = readGateMark('reviewed', text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  if (mark?.gate !== 'reviewed') throw new Error('expected a reviewed mark');
  return mark;
}

function mustCodeReviewed(text: string): CodeReviewedMark {
  const { mark, diagnostics } = readGateMark('code-reviewed', text);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  if (mark?.gate !== 'code-reviewed') throw new Error('expected a code-reviewed mark');
  return mark;
}

describe('normalizeForGate', () => {
  test('drops the frontmatter, and only the leading block', () => {
    const text = '---\nslug: 001-x\nprogress: 1/2\nupdated: 2026-03-01\n---\n\n# Title\n\n---\n\nbody\n';
    expect(normalizeForGate('plan.md', text)).toBe('# Title\n\n---\n\nbody');
  });

  test('resets every checkbox to [ ], indented ones included', () => {
    const text = '- [x] ISC-1: a\n- [X] ISC-2: b\n  - [ ] ISC-2.1: c\n- [x]no space is not a box? still reset\n';
    expect(normalizeForGate('spec.md', text)).toBe('- [ ] ISC-1: a\n- [ ] ISC-2: b\n  - [ ] ISC-2.1: c\n- [ ]no space is not a box? still reset');
  });

  test('a [x] in the middle of a line is text, not a checkbox', () => {
    expect(normalizeForGate('plan.md', 'see [x] here\n')).toBe('see [x] here');
  });

  test('removes struck-task markers in tasks.md only', () => {
    expect(normalizeForGate('tasks.md', '- [x] ~~T1 · done~~\n')).toBe('- [ ] T1 · done');
    expect(normalizeForGate('plan.md', '~~old~~\n')).toBe('~~old~~');
  });

  test('removes Not yet specified, Decisions and Verification from spec.md, up to the next ## heading', () => {
    const text = [
      '## Claims',
      '- [ ] ISC-1: a',
      '## Not yet specified',
      '- fog',
      '## Decisions',
      '- 2026-03-01 chose X',
      '### a sub heading stays inside the section',
      '## Test Strategy',
      '| isc | type |',
      '## Verification',
      'ISC-1 closed by bun test',
      '',
    ].join('\n');
    expect(normalizeForGate('spec.md', text)).toBe('## Claims\n- [ ] ISC-1: a\n## Test Strategy\n| isc | type |');
  });

  test('keeps those sections in plan.md and tasks.md', () => {
    expect(normalizeForGate('plan.md', '## Decisions\nkept\n')).toBe('## Decisions\nkept');
  });

  test('trims trailing whitespace per line and around the text, and folds CRLF', () => {
    expect(normalizeForGate('plan.md', '\n\n# A  \r\nb\t\r\n\r\n  \n')).toBe('# A\nb');
  });

  test('a round that only ticks boxes, rewrites frontmatter and appends Verification leaves the hash unchanged', () => {
    const before = '---\nprogress: 0/1\n---\n## Claims\n- [ ] ISC-1: a\n';
    const after = '---\nprogress: 1/1\nphase: complete\n---\n## Claims\n- [x] ISC-1: a   \n\n## Verification\nISC-1: exit 0\n';
    expect(hashForGate('spec.md', after)).toBe(hashForGate('spec.md', before));
    expect(hashForGate('spec.md', before.replace('ISC-1: a', 'ISC-1: b'))).not.toBe(hashForGate('spec.md', before));
  });
});

describe('hashForGate', () => {
  test('is the sha256 hex of the normalised text', () => {
    // sha256("") and sha256("abc"), known vectors
    expect(hashForGate('plan.md', '---\na: 1\n---\n')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hashForGate('plan.md', 'abc  \n')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  // The oracle: marks produced by the old skill's normalisation (harbor through the fixture generator, lantern
  // through `generate.ts --mark-reviewed`, leadgen by the old skill itself on the source repository).
  const current: Array<[string, string]> = [
    ['harbor 002', 'harbor/specs/002-web-console'],
    ['harbor 004', 'harbor/specs/004-retention-policies'],
    ['harbor 001 (archived)', 'harbor/specs/archive/001-manifest-sync'],
    ['lantern 001', 'lantern/specs/001-reading-list'],
    ['lantern 002', 'lantern/specs/002-duplicate-links'],
    ['leadgen 012 (old skill)', 'leadgen/specs/012-pwa-install'],
    ['leadgen 022 (old skill)', 'leadgen/specs/022-chat-turn-status-and-bulk-delete'],
  ];

  test.each(current)('reproduces every hash of the %s reviewed mark', (_name, dir) => {
    const specDir = join(FIXTURES, dir);
    const mark = mustReviewed(readFileSync(join(specDir, '.gates', 'reviewed.json'), 'utf-8'));
    const texts = specTexts(specDir);
    for (const f of REVIEWED_FILES) {
      const text = texts[f];
      expect([f, text === undefined ? null : hashForGate(f, text)]).toEqual([f, mark.files[f]]);
    }
    expect(gateState('reviewed', mark, { texts })).toEqual({ gate: 'reviewed', state: 'fresh', at: mark.at, changed: [] });
  });
});

describe('readGateMark', () => {
  test('reads the reviewed shape', () => {
    const text = JSON.stringify({ gate: 'reviewed', at: '2026-03-07T15:30:00Z', files: { 'spec.md': 'a'.repeat(64), 'plan.md': null, 'tasks.md': 'b'.repeat(64) } });
    expect(readGateMark('reviewed', text)).toEqual({
      mark: { gate: 'reviewed', at: '2026-03-07T15:30:00Z', files: { 'spec.md': 'a'.repeat(64), 'plan.md': null, 'tasks.md': 'b'.repeat(64) } },
      diagnostics: [],
    });
  });

  test('reads the code-reviewed shape with top-level code and security (harbor)', () => {
    const text = readFileSync(join(FIXTURES, 'harbor/specs/004-retention-policies/.gates/code-reviewed.json'), 'utf-8');
    expect(readGateMark('code-reviewed', text)).toEqual({
      mark: {
        gate: 'code-reviewed',
        at: '2026-03-08T11:00:00Z',
        root: null,
        tree: '0f0b75edd68fe6549744de66e4500c4f95b538bf',
        head: 'da3b7bf10406c1facaabffd3c7acd7853204a65d',
        branch: 'feature/004-retention-policies',
        findings: { code: 0, security: 0 },
        note: 'one finding fixed; tree changed since',
      },
      diagnostics: [],
    });
  });

  test('reads the code-reviewed shape with root and a findings object (old skill, leadgen)', () => {
    const text = readFileSync(join(FIXTURES, 'leadgen/specs/022-chat-turn-status-and-bulk-delete/.gates/code-reviewed.json'), 'utf-8');
    const mark = mustCodeReviewed(text);
    expect(mark.root).toBe('<leadgen-root>');
    expect(mark.tree).toBe('e20cec3e1f2812d45ece09e35c00b8a4162dc1b6');
    expect(mark.branch).toBe('feature/roadmap');
    expect(mark.findings).toEqual({ code: 4, security: 0 });
    expect(mark.note?.startsWith('accepted')).toBe(true);
  });

  test('a code-reviewed mark without findings or counts holds null', () => {
    const mark = mustCodeReviewed(JSON.stringify({ gate: 'code-reviewed', at: 'x', tree: 'c'.repeat(40) }));
    expect(mark).toEqual({ gate: 'code-reviewed', at: 'x', root: null, tree: 'c'.repeat(40), head: null, branch: null, findings: null, note: null });
  });

  const malformed: Array<[string, 'reviewed' | 'code-reviewed', string, string]> = [
    ['broken JSON', 'reviewed', '{"gate": "reviewed", ', 'gate-json-invalid'],
    ['an empty file', 'code-reviewed', '', 'gate-json-invalid'],
    ['a JSON array', 'reviewed', '[1, 2]', 'gate-not-object'],
    ['the other gate', 'reviewed', JSON.stringify({ gate: 'code-reviewed', at: 'x', tree: 'c'.repeat(40) }), 'gate-mismatch'],
    ['a reviewed mark without files', 'reviewed', JSON.stringify({ gate: 'reviewed', at: 'x' }), 'gate-files-missing'],
    ['a code-reviewed mark without a tree', 'code-reviewed', JSON.stringify({ gate: 'code-reviewed', at: 'x' }), 'gate-tree-missing'],
    ['a code-reviewed mark with a tree that is no object id', 'code-reviewed', JSON.stringify({ gate: 'code-reviewed', at: 'x', tree: 'HEAD' }), 'gate-tree-invalid'],
  ];

  test.each(malformed)('%s gives no mark and an error diagnostic, never a throw', (_name, gate, text, code) => {
    const reading = readGateMark(gate, text);
    expect(reading.mark).toBeNull();
    expect(reading.diagnostics.map((d) => [d.severity, d.code])).toContainEqual(['error', code]);
  });

  test('a file hash that is not a hash warns and can never match', () => {
    const reading = readGateMark('reviewed', JSON.stringify({ gate: 'reviewed', at: 'x', files: { 'spec.md': 42, 'plan.md': null } }));
    expect(reading.diagnostics.map((d) => d.code)).toContain('gate-file-hash-invalid');
    const mark = reading.mark;
    if (mark?.gate !== 'reviewed') throw new Error('expected a reviewed mark');
    // absent key reads as null (the old skill's `?? null`); the invalid value is kept apart from null
    expect(mark.files['tasks.md']).toBeNull();
    expect(gateState('reviewed', mark, { texts: {} }).changed).toEqual(['spec.md']);
  });

  test('a mark without a gate field or time warns but is read', () => {
    const reading = readGateMark('code-reviewed', JSON.stringify({ tree: 'c'.repeat(40) }));
    expect(reading.mark?.gate).toBe('code-reviewed');
    expect(reading.diagnostics.map((d) => [d.severity, d.code])).toEqual([
      ['warning', 'gate-name-missing'],
      ['warning', 'gate-at-missing'],
    ]);
    expect(gateState('code-reviewed', reading.mark, { worktreeTree: 'c'.repeat(40) }).at).toBeNull();
  });
});

describe('gateState', () => {
  const reviewed: ReviewedMark = {
    gate: 'reviewed',
    at: '2026-03-01T10:00:00Z',
    files: { 'spec.md': hashForGate('spec.md', '# S\n'), 'plan.md': hashForGate('plan.md', '# P\n'), 'tasks.md': null },
  };

  test('missing without a mark', () => {
    expect(gateState('reviewed', null, {})).toEqual({ gate: 'reviewed', state: 'missing', at: null, changed: [] });
    expect(gateState('code-reviewed', null, { worktreeTree: 'c'.repeat(40) })).toEqual({ gate: 'code-reviewed', state: 'missing', at: null, changed: [] });
  });

  test('missing when the mark belongs to the other gate', () => {
    expect(gateState('code-reviewed', reviewed, {}).state).toBe('missing');
  });

  test('reviewed: fresh when every file matches, a missing tasks.md included', () => {
    expect(gateState('reviewed', reviewed, { texts: { 'spec.md': '---\na: 1\n---\n# S  \n', 'plan.md': '# P' } })).toEqual({
      gate: 'reviewed',
      state: 'fresh',
      at: '2026-03-01T10:00:00Z',
      changed: [],
    });
  });

  test('reviewed: stale lists the changed files, a file that appeared or vanished included', () => {
    const check = gateState('reviewed', reviewed, { texts: { 'spec.md': '# S changed', 'tasks.md': '- [ ] T1' } });
    expect(check.state).toBe('stale');
    expect(check.changed).toEqual(['spec.md', 'plan.md', 'tasks.md']);
  });

  const codeReviewed: CodeReviewedMark = {
    gate: 'code-reviewed',
    at: '2026-03-05T14:30:00Z',
    root: null,
    tree: 'c'.repeat(40),
    head: null,
    branch: 'main',
    findings: { code: 0, security: 0 },
    note: null,
  };

  test('code-reviewed: fresh when the caller’s tree id matches', () => {
    expect(gateState('code-reviewed', codeReviewed, { worktreeTree: 'c'.repeat(40) })).toEqual({
      gate: 'code-reviewed',
      state: 'fresh',
      at: '2026-03-05T14:30:00Z',
      changed: [],
    });
  });

  test('code-reviewed: stale when the tree id differs', () => {
    expect(gateState('code-reviewed', codeReviewed, { worktreeTree: 'd'.repeat(40) }).state).toBe('stale');
  });

  test('code-reviewed: stale, never fresh, when the tree id could not be computed', () => {
    const check = gateState('code-reviewed', codeReviewed, { worktreeTree: null });
    expect(check.state).toBe('stale');
    expect(check.detail).toBe('worktree tree id unavailable');
    expect(gateState('code-reviewed', codeReviewed, {}).state).toBe('stale');
  });

  test('the harbor fixture: 006 reviewed is stale by construction, only spec.md exists', () => {
    const s006 = join(FIXTURES, 'harbor/specs/006-partial-push');
    const r006 = readGateMark('reviewed', readFileSync(join(s006, '.gates', 'reviewed.json'), 'utf-8')).mark;
    expect(gateState('reviewed', r006, { texts: specTexts(s006) })).toMatchObject({ state: 'stale', changed: ['spec.md'] });
  });
});

// ── the tree id ──────────────────────────────────────────────────────────────────────────────────────

describe('treeIdOf', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  test('no entries is git’s empty tree', () => {
    expect(treeIdOf([])).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });

  test('one file matches the id git gives `hello\\n` at the root', () => {
    // `printf 'hello\n' > hello.txt && git add -A && git write-tree`
    expect(treeIdOf([{ path: 'hello.txt', mode: '100644', bytes: bytes('hello\n') }])).toBe('aaa96ced2d9a1c8e72c56b253a0e2fe78393feb7');
  });

  test('input order does not matter', () => {
    const a: TreeEntry = { path: 'a/x', mode: '100644', bytes: bytes('1') };
    const b: TreeEntry = { path: 'b', mode: '100755', bytes: bytes('2') };
    expect(treeIdOf([a, b])).toBe(treeIdOf([b, a]));
  });

  test.each([
    ['an absolute path', [{ path: '/a', mode: '100644', bytes: bytes('') }]],
    ['an empty segment', [{ path: 'a//b', mode: '100644', bytes: bytes('') }]],
    ['a dot segment', [{ path: 'a/../b', mode: '100644', bytes: bytes('') }]],
    ['a duplicate path', [{ path: 'a', mode: '100644', bytes: bytes('') }, { path: 'a', mode: '100644', bytes: bytes('') }]],
    ['a path that is both file and directory', [{ path: 'a', mode: '100644', bytes: bytes('') }, { path: 'a/b', mode: '100644', bytes: bytes('') }]],
    ['an unsupported mode', [{ path: 'a', mode: '040000', bytes: bytes('') }]],
  ] as Array<[string, TreeEntry[]]>)('rejects %s', (_name, entries) => {
    expect(() => treeIdOf(entries)).toThrow(RangeError);
  });

  // Parity with git: build a throwaway repository outside this one, let git stage and write the tree there, and
  // compare with the in-memory id computed from the same files. Skipped, and named so, when git is missing.
  const hasGit = spawnSync('git', ['--version']).status === 0;
  const title = hasGit ? 'equals `git write-tree` on a temp repository' : 'equals `git write-tree` (SKIPPED: git is not on PATH)';

  test.skipIf(!hasGit)(title, () => {
    const dir = mkdtempSync(join(tmpdir(), 'spectant-gates-'));
    try {
      const put = (rel: string, content: string | Uint8Array) => {
        const p = join(dir, rel);
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, content);
      };
      // names chosen for git's sort quirk: a directory sorts as if its name ended in '/'
      put('a.txt', 'dot\n');
      put('a/inner.md', '# inner\n');
      put('a/deep/er/file.json', '{"k": 1}\n');
      put('a-b', 'dash');
      put('a0', 'zero');
      put('B-upper', 'upper sorts before lower');
      put('empty', '');
      put('größe.md', 'utf-8 name\n');
      put('bin.dat', new Uint8Array([0, 1, 2, 255, 0, 10, 13]));
      put('run.sh', '#!/bin/sh\necho hi\n');
      chmodSync(join(dir, 'run.sh'), 0o755);
      symlinkSync('a/inner.md', join(dir, 'link'));

      const git = (...args: string[]) => {
        const r = spawnSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.fileMode=true', '-c', 'core.symlinks=true', ...args], { cwd: dir, encoding: 'utf-8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
        return r.stdout.trim();
      };
      git('init', '-q');
      git('add', '-A');
      const expected = git('write-tree');

      const entries: TreeEntry[] = [];
      const walk = (rel: string) => {
        for (const name of readdirSync(join(dir, rel))) {
          if (rel === '' && name === '.git') continue;
          const r = rel ? `${rel}/${name}` : name;
          const st = lstatSync(join(dir, r));
          if (st.isDirectory()) walk(r);
          else if (st.isSymbolicLink()) entries.push({ path: r, mode: '120000', bytes: new TextEncoder().encode(readlinkSync(join(dir, r))) });
          else entries.push({ path: r, mode: st.mode & 0o111 ? '100755' : '100644', bytes: new Uint8Array(readFileSync(join(dir, r))) });
        }
      };
      walk('');
      expect(entries.length).toBe(11);
      expect(treeIdOf(entries)).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── read-only guard ──────────────────────────────────────────────────────────────────────────────────

describe('gates.ts writes nothing', () => {
  const source = readFileSync(GATES_SOURCE, 'utf-8');

  test.each(['writeFile', 'appendFile', 'mkdir', 'rmSync', 'unlink', 'rename', 'spawn', 'execSync', 'execFile', 'child_process', 'Bun.', 'require(', 'import('])(
    'contains no `%s` token',
    (token) => {
      expect(source.includes(token)).toBe(false);
    },
  );

  test('imports only createHash from node:crypto, and types from its own package', () => {
    const imports = [...source.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s+from\s+'([^']+)';$/gm)].map((m) => [m[1] ? 'type' : 'value', (m[2] ?? '').trim(), m[3]]);
    expect(imports).toEqual([
      ['value', 'createHash', 'node:crypto'],
      ['type', 'Diagnostic', './diagnostics.ts'],
      // MarkState lives in files.ts since spec 003 T18 (browser-clean type graph); gates.ts re-exports it.
      ['type', 'MarkState, TextFileKind', './files.ts'],
    ]);
    expect(source.match(/^import\b/gm)?.length).toBe(3);
  });
});
