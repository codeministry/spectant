// No skill command writes an `.html` file (spec 031, T28, ISC-46). Specs and their companions are Markdown and JSON
// lines; a page is the app's job. Two guards hold it:
//
// 1. The chain. In a fresh git repository under the system temp directory the test drives every command
//    `spec-check --help` lists, the way the subcommands call them, each subcommand inside its `run start` / `run end`
//    pair: allocate, mint, decide, transition plan → tasks → review → build → code-review → close → done, verify,
//    frontier, claim and release, every `activity` step, `rounds record`, status and drift. Then it walks the whole
//    fixture tree (`.git/` and the linked worktree included) in TypeScript, so the test needs no extra tool, and finds
//    no file ending `.html` or `.htm`. The chain checks both gates and, at done, archives the spec (dry run, the move)
//    and restores it, so the archive's moves and rewrites fall under the same walk. The reviewed mark is written the way the app's reviewed write does it, as in transitions.test.ts.
//
// 2. The static guard. The rule, as the regexes below implement it:
//    - Prose (every file under `plugin/spectant/`, the bundle `bin/spec-check` excluded): a line breaks the rule when
//      it names an `.html` file or an HTML page/file/report/deck and either names a concrete path (`index.html`,
//      `${dir}/deck.html`, `*.html`) or carries a write verb (write, create, save, render, generate, emit, output,
//      produce, export, build). A mention that a negation governs in the same clause ("no `.html`", "never writes an
//      HTML page", "without an .html file") is allowed: that is the rule stated, not an instruction.
//    - Code (`.ts` and `.js` under `plugin/src/` and `plugin/spectant/`, bundle excluded): a string literal that is an
//      output path ending `.html` (`'deck.html'`, `` `${out}/x.html` ``), a bare extension literal (`'.html'`, the
//      piece a path is built from), or a write call (`writeFileSync`, `Bun.write`, `appendFile`, `copyFile`, `rename`,
//      `cpSync`, `createWriteStream`) whose arguments reach `.html`. Comments that state the rule carry no literal and
//      no write call, so they pass.
//    The guard's own fixtures prove each regex fires on an offending line and stays quiet on the allowed ones.
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { hashForGate } from '../../core/src/gates.ts';

const PLUGIN = join(import.meta.dir, '..');
const CLI = join(PLUGIN, 'src', 'spec-check.ts');
const SHIPPED = join(PLUGIN, 'spectant');
const DIR = 'specs/001-digest';
const MAIN = 'a:claude:main';
const BUILDER = 'a:claude:builder/T1';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------
// The guard

/** One finding: the file, the line number and the line. */
interface Finding {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** An `.html`/`.htm` mention, or an HTML page, file, report, deck, document, export or output. */
const HTML_MENTION = /\.html?\b|\bhtml\s+(?:file|page|report|deck|document|export|output)s?\b/gi;
/** A name character right before `.html`: the mention is a concrete path, not the bare extension. */
const CONCRETE = /[\w$}*\])-]$/;
/** A negation that governs the mention: in the same clause, at most 60 characters before it. */
const NEGATED = /\b(?:no|never|not|nor|without)\b(?:(?!\.\s|[;!?\n]).){0,60}$/i;
const WRITE_VERB =
  /\b(?:write|writes|writing|written|wrote|create|creates|created|save|saves|saved|render|renders|rendered|generate|generates|generated|emit|emits|output|outputs|produce|produces|export|exports|build|builds)\b/i;

/** The prose rule for one line: true when the line instructs writing an `.html` file. */
function proseWritesHtml(line: string): boolean {
  for (const m of line.matchAll(HTML_MENTION)) {
    const before = line.slice(0, m.index);
    if (NEGATED.test(before)) continue;
    const concrete = m[0].startsWith('.') && CONCRETE.test(before);
    if (concrete || WRITE_VERB.test(line)) return true;
  }
  return false;
}

/** A string literal that is a path ending `.html`, with a stem. */
const HTML_PATH_LITERAL = /(['"`])[^'"`\n]*[\w$}/*-]\.html?\1/;
/** The bare extension as a literal: the piece an `.html` path is built from. */
const HTML_EXT_LITERAL = /(['"])\.html?\1/;
/** A write call whose arguments reach `.html` within the same statement. */
const HTML_WRITE_CALL =
  /\b(?:writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|copyFileSync|copyFile|renameSync|rename|cpSync|Bun\.write)\s*\([^;]{0,300}?\.html?\b/;

/** The code rule over one source: every line that builds or writes an `.html` output path. */
function codeWritesHtml(source: string): number[] {
  const hits = new Set<number>();
  const lines = source.split('\n');
  lines.forEach((line, i) => {
    if (HTML_PATH_LITERAL.test(line) || HTML_EXT_LITERAL.test(line)) hits.add(i + 1);
  });
  for (const m of source.matchAll(new RegExp(HTML_WRITE_CALL.source, 'g'))) {
    hits.add(source.slice(0, m.index).split('\n').length);
  }
  return [...hits].sort((a, b) => a - b);
}

/** Every file under `root`, relative paths; `skip` names directories (relative) left out. */
function walk(root: string, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  const visit = (abs: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = join(abs, entry.name);
      const rel = relative(root, path);
      if (skip.includes(rel)) continue;
      if (entry.isDirectory()) visit(path);
      else out.push(rel);
    }
  };
  visit(root);
  return out;
}

const htmlFiles = (root: string): string[] => walk(root).filter((f) => /\.html?$/i.test(f));

function proseFindings(root: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of walk(root, ['bin'])) {
    readFileSync(join(root, file), 'utf8')
      .split('\n')
      .forEach((text, i) => {
        if (proseWritesHtml(text)) findings.push({ file, line: i + 1, text });
      });
  }
  return findings;
}

function codeFindings(root: string, base: string): Finding[] {
  const findings: Finding[] = [];
  for (const file of walk(root, ['bin']).filter((f) => /\.[jt]s$/.test(f))) {
    const source = readFileSync(join(root, file), 'utf8');
    const lines = source.split('\n');
    for (const n of codeWritesHtml(source)) findings.push({ file: `${base}/${file}`, line: n, text: lines[n - 1] ?? '' });
  }
  return findings;
}

describe('the static guard fires on an instruction or a write, never on the rule itself (ISC-46)', () => {
  test('prose: an instruction to write an .html file is caught', () => {
    for (const line of [
      'Write the deck to `specs/deck.html` and open it.',
      'Render the summary as an HTML page and save it next to the spec.',
      '4. Save `index.html` in the spec folder.',
      'The workflow generates one .html per spec.',
      'Export `${NNN}-review.html` for the principal.',
      'Create `*.html` previews of every screen.',
    ]) {
      expect({ line, caught: proseWritesHtml(line) }).toEqual({ line, caught: true });
    }
  });

  test('prose: the rule stated as a negation passes', () => {
    for (const line of [
      '- **No `.html` written by any subcommand.**',
      '- It writes no `.html` and reads nothing outside the repository and this plugin.',
      'a gap; a section is never invented for it. No prototype and no `.html` file: the pass plans the surface in Markdown',
      '- **No `.html`, no screenshots, no images.**',
      '- **No `plan.md`, no `tasks.md`, no `.html`, no commit.**',
      'The subcommand never writes an HTML page; the app shows the spec.',
      'Specs are Markdown and JSON lines.',
    ]) {
      expect({ line, caught: proseWritesHtml(line) }).toEqual({ line, caught: false });
    }
  });

  test('code: a write call or an output path ending .html is caught; a comment stating the rule is not', () => {
    const offending = [
      "writeFileSync(join(dir, 'index.html'), page);",
      'await Bun.write(`${out}/report.html`, html);',
      "const OUT = 'tldr.html';",
      "writeFileSync(path + '.html', body);",
      "appendFileSync(\n  join(root, specDir, `${slug}.html`),\n  page,\n);",
      'writeFileSync(target.replace(/\\.md$/, ".html"), page);',
    ];
    for (const source of offending) expect({ source, hits: codeWritesHtml(source).length > 0 }).toEqual({ source, hits: true });
    const allowed = [
      '// The CLI writes no .html file: specs are Markdown and JSON lines.',
      "writeFileSync(join(dir, 'spec.md'), text);",
      "const help = 'writes no `.html` anywhere';",
      'await Bun.write(`${dir}/events.jsonl`, line);',
    ];
    for (const source of allowed) expect({ source, hits: codeWritesHtml(source) }).toEqual({ source, hits: [] });
  });

  test('the tree walk finds an .html file wherever it lies', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-nohtml-walk-')));
    dirs.push(root);
    mkdirSync(join(root, 'specs', '001-x', '.gates'), { recursive: true });
    writeFileSync(join(root, 'specs', '001-x', 'spec.md'), '# x\n');
    expect(htmlFiles(root)).toEqual([]);
    writeFileSync(join(root, 'specs', '001-x', '.gates', 'deck.HTML'), '<p>');
    writeFileSync(join(root, 'page.htm'), '<p>');
    expect(htmlFiles(root).sort()).toEqual(['page.htm', 'specs/001-x/.gates/deck.HTML']);
  });

  test('no file the plugin ships instructs writing an .html file', () => {
    expect(proseFindings(SHIPPED)).toEqual([]);
  });

  test('no source under plugin/src/ or plugin/spectant/ writes or builds an .html path', () => {
    expect([...codeFindings(join(PLUGIN, 'src'), 'src'), ...codeFindings(SHIPPED, 'spectant')]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The chain

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
  {
    text: 'The digest links each note to its source file.',
    row: { type: 'test', check: 'links in the digest', threshold: 'one per note', tool: 'bun test', anchorsTo: 'goal' },
  },
];

const PLAN = ['# 001 — Plan', '', '## Approach', '', 'One pass over the notes of the week, newest first.', ''].join('\n');
const TASKS = [
  '# 001 — Tasks',
  '',
  '- [ ] T1 · ISC-1 · core — red test for the screen limit · `src/digest.test.ts`',
  '- [ ] T2 · ISC-2 · core — every note in the digest (after: T1) · `src/digest.ts`',
  '- [ ] T3 · ISC-3 · core — each note links its source · `src/digest.ts`',
  '',
].join('\n');

function git(cwd: string, ...args: string[]): void {
  const r = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`);
}

function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'spec-check-nohtml-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'builder@example.invalid');
  git(dir, 'config', 'user.name', 'Builder');
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init');
  writeFileSync(join(dir, 'ISA.md'), MASTER);
  return dir;
}

/** Every CLI command the chain called, with its exit code, for the coverage check. */
const called: string[] = [];

/** One CLI call; its exit code must be one of `codes`. */
function cli(root: string, codes: readonly number[], ...args: string[]): string {
  const r = Bun.spawnSync(['bun', CLI, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (!codes.includes(r.exitCode)) throw new Error(`spec-check ${args.join(" ")}: exit ${r.exitCode}, expected ${codes.join("|")}: ${r.stderr.toString()}${r.stdout.toString()}`);
  called.push(args[0] ?? '');
  return r.stdout.toString();
}

/** `run start` → the work → `run end`, as every subcommand that works on a spec, an idea or the repository does. */
function subcommand(root: string, target: string, command: string, work: () => void): void {
  const id = (JSON.parse(cli(root, [0], 'run', 'start', target, '--command', command, '--session', MAIN, '--json')) as { run: string }).run;
  work();
  cli(root, [0], 'run', 'end', id, '--outcome', 'ok', '--session', MAIN);
}

/** The reviewed mark and its review → build line, written the way the app's reviewed write does (write path 1). */
function markReviewed(root: string): void {
  const read = (name: string): string => readFileSync(join(root, DIR, name), 'utf8');
  const files = Object.fromEntries((['spec.md', 'plan.md', 'tasks.md'] as const).map((name) => [name, hashForGate(name, read(name))]));
  mkdirSync(join(root, DIR, '.gates'), { recursive: true });
  writeFileSync(join(root, DIR, '.gates', 'reviewed.json'), `${JSON.stringify({ gate: 'reviewed', at: '2026-03-04T08:00:00Z', files })}\n`);
  const event = { ts: '2026-03-04T08:00:00.000Z', from: 'review', to: 'build', command: '/spec review 001', actor: 'a:claude:spec-check' };
  writeFileSync(join(root, DIR, 'events.jsonl'), `${read('events.jsonl')}${JSON.stringify(event)}\n`);
}

describe('the whole CLI chain writes no .html file (ISC-46)', () => {
  test('allocate through done, every command the help lists: no .html anywhere in the fixture tree', () => {
    const root = repo();
    const tree = join(root, '.worktrees', '001-digest');
    const claimsFile = join(root, '.claims.json');
    writeFileSync(claimsFile, JSON.stringify(CLAIMS));
    const GATE = [0, 3]; // a gate check exits 0 on a fresh mark, 3 on a missing or stale one

    subcommand(root, 'init', '/spec', () => {
      cli(root, [0], 'status');
      cli(root, [0, 3], 'drift');
    });
    subcommand(root, 'digest', '/spec new digest', () => {
      cli(root, [0], 'allocate', 'feature', 'digest', '--goal', 'A week of notes becomes one digest.', '--feature', 'F1');
      cli(root, [0], 'mint', '001', '--feature', 'F1', '--claims', claimsFile);
      cli(root, [0], 'decide', `${DIR}/spec.md`, 'The digest is Markdown, one file per week.');
      cli(root, [0], 'decide', 'ISA.md', 'Digests stay in the repository as Markdown.');
    });
    subcommand(root, '001', '/spec plan 001', () => {
      writeFileSync(join(root, DIR, 'plan.md'), PLAN);
      cli(root, [0], 'transition', '001', 'tasks', '--command', '/spec plan 001');
    });
    subcommand(root, '001', '/spec tasks 001', () => {
      writeFileSync(join(root, DIR, 'tasks.md'), TASKS);
      cli(root, [0], 'transition', '001', 'review', '--command', '/spec tasks 001');
    });
    subcommand(root, '001', '/spec review 001', () => {
      cli(root, GATE, 'gate', 'check', 'reviewed', '001');
      markReviewed(root);
      cli(root, GATE, 'gate', 'check', 'reviewed', '001');
    });
    subcommand(root, '001', '/spec implement 001', () => {
      git(root, 'worktree', 'add', '-q', tree, '-b', 'feature/001-digest');
      const board = cli(root, [0], 'frontier', '001', '--json');
      expect(() => JSON.parse(board) as unknown).not.toThrow();
      cli(root, [0], 'pack', '001', 'T1', '--json');
      cli(root, [0], 'claim', 'ISC-1', '--task', 'T1', '--session', BUILDER, '--worktree', '.worktrees/001-digest');
      const step = (event: string, ...extra: string[]): string => cli(root, [0], 'activity', event, '--task', 'T1', '--claim', 'ISC-1', ...extra);
      step('dispatch', '--session', MAIN);
      step('build', '--session', BUILDER);
      step('probe', '--session', BUILDER, '--result', 'red');
      step('question', '--session', BUILDER, '--text', 'Newest first or oldest first?');
      step('probe', '--session', BUILDER, '--result', 'green');
      step('patch', '--session', BUILDER, '--worktree', '.worktrees/001-digest');
      step('apply', '--session', MAIN, '--worktree', '.worktrees/001-digest');
      cli(root, [0], 'verify', '001', 'ISC-1', 'test', 'bun test src/digest.test.ts — 3 pass');
      cli(root, [0], 'release', 'ISC-1', '--task', 'T1', '--session', BUILDER);
      cli(root, [0], 'hook'); // no payload on stdin: the hook writes nothing and still exits 0 (hooks.test.ts drives it)
      writeFileSync(join(root, DIR, 'tasks.md'), TASKS.replace('- [ ] T1', '- [x] T1')); // single-core: allow — the test ticks its own fixture task; it parses nothing
      const planFile = join(root, '.plan.json');
      writeFileSync(
        planFile,
        JSON.stringify({ width: 2, dispatch: [{ task: 'T1', claim: 'ISC-1', reason: 'claim takeable' }], held: [{ task: 'T2', claim: 'ISC-2', reason: 'after T1' }] }),
      );
      cli(root, [0], 'rounds', 'record', '001', '--plan', planFile, '--outcome', 'T1=pass', '--builder', 'T1=Engineer', '--stop', 'width reached');
      cli(root, [0], 'verify', '001', 'ISC-2', 'test', 'bun test src/digest.ts — 1 pass');
      cli(root, [0], 'verify', '001', 'ISC-3', 'test', 'bun test src/digest.ts — 1 pass');
      cli(root, [0], 'transition', '001', 'code-review', '--command', '/spec implement 001');
    });
    subcommand(root, '001', '/spec review 001', () => {
      cli(root, GATE, 'gate', 'check', 'code-reviewed', '001');
      cli(root, [0], 'transition', '001', 'close', '--command', '/spec review 001');
    });
    subcommand(root, '001', '/spec done 001', () => {
      cli(root, [0], 'transition', '001', 'done', '--command', '/spec done 001');
      cli(root, [0], 'status', '001', '--json');
      cli(root, [0, 3], 'drift', '001', '--json');
      // The close step of the done workflow writes `phase: complete` by hand; the archive then moves without a reason.
      const spec = join(root, DIR, 'spec.md');
      writeFileSync(spec, readFileSync(spec, 'utf8').replace(/^phase: .*$/m, 'phase: complete'));
      cli(root, [0], 'archive', '001', '--dry-run');
      cli(root, [0], 'archive', '001');
      expect(existsSync(join(root, 'specs', 'archive', '001-digest', 'spec.md'))).toBe(true);
      cli(root, [0], 'archive', 'restore', '001');
    });

    // Every command `spec-check --help` lists ran at least once.
    const listed = [...cli(root, [0], '--help').matchAll(/^ {2}(\w+)\s{2,}/gm)].map((m) => m[1]);
    expect(listed.length).toBeGreaterThanOrEqual(14);
    expect(listed.filter((c) => !called.includes(c ?? ''))).toEqual([]);

    // The chain really ran to done: the spec moved, the log and the round log exist.
    expect(readFileSync(join(root, DIR, 'spec.md'), 'utf8')).toMatch(/^stage: done$/m);
    const files = walk(root);
    expect([`${DIR}/events.jsonl`, `${DIR}/rounds.jsonl`, '.spectant/activity.jsonl'].filter((f) => !files.includes(f))).toEqual([]);

    // ISC-46: not one .html file anywhere in the fixture tree, `.git/` and the linked worktree included.
    expect(htmlFiles(root)).toEqual([]);
  });
});
